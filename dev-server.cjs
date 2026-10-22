const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { once } = require("events");
const { handleWorkflowBody, getBffHealth, probeBffReadiness } = require("./api/dify-bff");
const { appendWorkflowDiagnostic, sanitizeRecord } = require("./api/local-diagnostics");
const { synthesizeCosyVoice } = require("./api/cosyvoice-websocket.cjs");

const ROOT = __dirname;
loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const RUNTIME = process.env.RUNTIME_ENV || "local";
const TIMEOUT_MS = 60000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_TTS_TEXT_CHARS = 600;
const TTS_RATE_LIMIT_WINDOW_MS = 60_000;
const TTS_RATE_LIMIT_REQUESTS = 20;
const DEFAULT_CHATFLOW_APP_ID = "74bef8bd-22bd-4e19-91da-5e8d645dd8ed";
const RELEASE_INFO_PATH = path.join(ROOT, "release-info.json");
const SERVER_STARTED_AT = new Date().toISOString();
const SERVER_INSTANCE_ID = crypto.randomUUID();
let diagnosticLastWriteAt = null;
let diagnosticLastError = null;
const ttsRateLimits = new Map();
const clientDiagnosticLimits = new Map();
let activeTtsRequests = 0;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
const MEDIA_EXTENSIONS = new Set([".mp4", ".webm", ".mp3", ".m4a", ".wav", ".ogg"]);
const PUBLIC_FILES = new Set(["index.html", "client-app.js", "styles.css", "release-info.json"]);
const ASSET_EXTENSIONS = new Set(Object.keys(MIME_TYPES).filter(ext => ![".html", ".js", ".css"].includes(ext)));

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/api/health" && req.method === "GET") {
      sendJson(res, 200, buildHealthPayload(RUNTIME));
      return;
    }

    if (req.url === "/api/readiness" && req.method === "GET") {
      const readiness = await probeBffReadiness();
      sendJson(res, readiness.ok ? 200 : 503, readiness);
      return;
    }

    if (req.url === "/api/workflow" && req.method === "POST") {
      await proxyWorkflow(req, res);
      return;
    }

    if (req.url === "/api/tts" && req.method === "POST") {
      await proxyCosyVoice(req, res);
      return;
    }

    if (req.url === "/api/client-diagnostic" && req.method === "POST") {
      const body = await readJsonBody(req);
      const runtimeDiagnostic = ["host_voice", "workflow_failure", "client_error", "page_state", "player_submission"].includes(body?.type);
      if (RUNTIME !== "local" && !runtimeDiagnostic) {
        sendJson(res, 404, { error: "NOT_FOUND" });
        return;
      }
      if (!body || !runtimeDiagnostic && !["round_advance_wait", "round_advance_started", "round_advance_completed"].includes(body.type)) {
        sendJson(res, 400, { error: "INVALID_CLIENT_DIAGNOSTIC" });
        return;
      }
      const key = req.socket.remoteAddress || "unknown";
      const now = Date.now();
      const limit = clientDiagnosticLimits.get(key) || { start: now, count: 0 };
      if (now - limit.start >= 60000) { limit.start = now; limit.count = 0; }
      if (++limit.count > 240) { sendJson(res, 429, { error: "DIAGNOSTIC_RATE_LIMITED" }); return; }
      if (!clientDiagnosticLimits.has(key) && clientDiagnosticLimits.size >= 256) clientDiagnosticLimits.delete(clientDiagnosticLimits.keys().next().value);
      clientDiagnosticLimits.set(key, limit);
      persistWorkflowDiagnostic({
        phase: "client_runtime", timestamp: new Date().toISOString(),
        ...(!runtimeDiagnostic ? { game_id: String(body.game_id || "").slice(0, 100), round_id: String(body.round_id || "").slice(0, 140) } : {}),
        client_diagnostic: body,
      });
      sendJson(res, 202, { ok: true });
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    const status = error.statusCode || 500;
    sendJson(res, status, {
      error: status === 413 ? "REQUEST_TOO_LARGE" : "SERVER_ERROR",
      message: RUNTIME === "local" ? error.message : status === 413 ? "Request exceeds 2 MiB." : "Request failed.",
    });
  }
});

async function proxyCosyVoice(req, res) {
  const diagnosticId = crypto.randomUUID();
  const startedAt = Date.now();
  let voiceError = "";
  const voiceTimings = { audio_chunks: 0, audio_bytes: 0, max_chunk_gap_ms: 0 };
  let lastAudioAt = null;
  res.setHeader("X-Voice-Request-Id", diagnosticId);
  const logVoice = () => persistWorkflowDiagnostic({ phase: "tts_finish", route: "tts", diagnostic_id: diagnosticId,
    timestamp: new Date().toISOString(), status: res.statusCode, elapsed_ms: Date.now() - startedAt,
    error: voiceError, tts_timing: voiceTimings });
  const apiKey = process.env.COSYVOICE_API_KEY;
  if (!apiKey) {
    voiceError = "TTS_NOT_CONFIGURED";
    sendJson(res, 503, { error: "TTS_NOT_CONFIGURED" });
    logVoice();
    return;
  }

  const body = await readJsonBody(req);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || Array.from(text).length > MAX_TTS_TEXT_CHARS) {
    sendJson(res, 400, { error: "INVALID_TTS_TEXT", max_characters: MAX_TTS_TEXT_CHARS });
    return;
  }

  const clientIp = String(req.socket.remoteAddress || "unknown").slice(0, 80);
  const now = Date.now();
  const rate = ttsRateLimits.get(clientIp) || { startedAt: now, count: 0 };
  if (now - rate.startedAt >= TTS_RATE_LIMIT_WINDOW_MS) {
    rate.startedAt = now;
    rate.count = 0;
  }
  rate.count += 1;
  ttsRateLimits.set(clientIp, rate);
  if (rate.count > TTS_RATE_LIMIT_REQUESTS) {
    voiceError = "TTS_RATE_LIMITED";
    sendJson(res, 429, { error: "TTS_RATE_LIMITED" });
    logVoice();
    return;
  }
  if (activeTtsRequests >= 3) {
    voiceError = "TTS_BUSY";
    sendJson(res, 503, { error: "TTS_BUSY" });
    logVoice();
    return;
  }

  activeTtsRequests += 1;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  const abortUpstream = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on("close", abortUpstream);

  try {
    const audio = await synthesizeCosyVoice({
      apiKey,
      text,
      baseUrl: process.env.COSYVOICE_API_BASE_URL || "https://dashscope-intl.aliyuncs.com",
      signal: controller.signal,
      onProgress: stage => {
        if (stage === "connected") voiceTimings.connect_ms = Date.now() - startedAt;
        if (stage === "task_started") voiceTimings.task_started_ms = Date.now() - startedAt;
      },
      onAudio: chunk => {
        const now = Date.now();
        if (lastAudioAt === null) voiceTimings.first_audio_ms = now - startedAt;
        else voiceTimings.max_chunk_gap_ms = Math.max(voiceTimings.max_chunk_gap_ms, now - lastAudioAt);
        lastAudioAt = now;
        voiceTimings.audio_chunks += 1;
        voiceTimings.audio_bytes += chunk.length;
        if (!res.headersSent) {
          res.writeHead(200, {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store, no-transform",
            "X-Content-Type-Options": "nosniff",
            "X-Accel-Buffering": "no",
          });
        }
        res.write(chunk);
      },
    });
    if (!res.headersSent) {
      if (!audio) sendJson(res, 502, { error: "TTS_AUDIO_MISSING" });
      else {
        res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.end(audio);
      }
    } else if (!res.destroyed) res.end();
  } catch (error) {
    voiceError = controller.signal.aborted ? "TTS_CANCELLED_OR_TIMEOUT" : "TTS_UPSTREAM_FAILED";
    if (!res.headersSent) sendJson(res, 502, { error: "TTS_UPSTREAM_FAILED" });
    else if (!res.destroyed) res.end();
    if (error.name !== "AbortError") console.warn("CosyVoice request failed.", error.message);
  } finally {
    logVoice();
    clearTimeout(timeout);
    res.off("close", abortUpstream);
    activeTtsRequests = Math.max(0, activeTtsRequests - 1);
    if (ttsRateLimits.size > 5000) {
      for (const [ip, entry] of ttsRateLimits) {
        if (now - entry.startedAt > TTS_RATE_LIMIT_WINDOW_MS) ttsRateLimits.delete(ip);
      }
    }
  }
}

server.listen(PORT, HOST, () => {
  persistWorkflowDiagnostic({
    phase: "server_start", timestamp: SERVER_STARTED_AT,
    server_instance_id: SERVER_INSTANCE_ID, diagnostics_version: 2,
  });
  console.log(`Smart cabin demo running at http://${HOST}:${server.address().port}`);
});

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function proxyWorkflow(req, res) {
  const body = normalizeRequestBody(await readJsonBody(req));
  const diagnosticId = crypto.randomUUID();
  const startedAt = Date.now();
  const requestInfo = summarizeWorkflowRequest(body);
  const startDiagnostic = {
    phase: "start",
    diagnostic_id: diagnosticId,
    timestamp: new Date().toISOString(),
    ...requestInfo,
  };
  logWorkflowDiagnostic(startDiagnostic);
  persistWorkflowDiagnostic(startDiagnostic);

  try {
    const response = await handleWorkflowBody(body);
    const workflowOutput = parseJson(response.payload?.workflow_output);
    const hostResult = response.payload?.host_result || workflowOutput || {};
    const trace = hostResult.decision_trace || {};
    const reply = String(hostResult.ai_reply_text || "");
    const finishDiagnostic = {
      ...requestInfo,
      phase: "finish",
      diagnostic_id: diagnosticId,
      timestamp: new Date().toISOString(),
      status: response.status,
      elapsed_ms: Date.now() - startedAt,
      route: response.payload?.route || requestInfo.route,
      context_verified: response.payload?.context_verified ?? null,
      context_scope: hostResult.context_scope || null,
      conversation_fingerprint: fingerprint(response.payload?.conversation_id || ""),
      message_id: response.payload?.message_id || "",
      workflow_run_id: response.payload?.workflow_run_id || "",
      diagnostic: response.payload?.diagnostic || null,
      preview_status: response.payload?.preview_status || "",
      preview_diagnostic: response.payload?.preview_diagnostic || null,
      guard_status: trace.guard_status || "",
      matched_rule: trace.matched_rule || "",
      strategy: hostResult.strategy || "",
      fixed_soft_fallback: reply === "我陪你慢慢想，按你的节奏来。",
      reply_fingerprint: fingerprint(reply),
      error: response.payload?.error || "",
      proxy_failure: response.payload?.proxy_failure || null,
      upstream_failure: response.payload?.upstream_failure || null,
      conversation_recovered: Boolean(response.payload?.conversation_recovered),
      app_id: response.payload?.app_id || "",
    };
    logWorkflowDiagnostic({
      ...finishDiagnostic,
      ai_reply_text: reply,
      decision_trace: trace,
    });
    persistWorkflowDiagnostic(finishDiagnostic);
    sendJson(res, response.status, { ...response.payload, diagnostic_id: diagnosticId });
  } catch (error) {
    const finishDiagnostic = {
      ...requestInfo,
      phase: "finish",
      diagnostic_id: diagnosticId,
      timestamp: new Date().toISOString(),
      route: requestInfo.route,
      trigger_type: requestInfo.trigger_type,
      event_type: requestInfo.event_type,
      event_id: requestInfo.event_id,
      game_id: requestInfo.game_id,
      round_id: requestInfo.round_id,
      status: 500,
      elapsed_ms: Date.now() - startedAt,
      error: RUNTIME === "local" ? String(error.message || error) : "WORKFLOW_PROXY_ERROR",
    };
    logWorkflowDiagnostic(finishDiagnostic);
    persistWorkflowDiagnostic(finishDiagnostic);
    throw error;
  }
}

function logWorkflowDiagnostic(record) {
  console.info("[workflow-diagnostic]", JSON.stringify(RUNTIME === "local" ? record : sanitizeRecord(record)));
}

function persistWorkflowDiagnostic(record) {
  try {
    appendWorkflowDiagnostic({ ...record, server_instance_id: SERVER_INSTANCE_ID, diagnostics_version: 2 });
    diagnosticLastWriteAt = new Date().toISOString();
    diagnosticLastError = null;
  } catch (error) {
    diagnosticLastError = error.code || "LOG_WRITE_FAILED";
    console.warn("Could not persist local workflow diagnostics.", error.message);
  }
}

function summarizeWorkflowRequest(body) {
  const input = typeof body.input_payload === "string"
    ? parseJson(body.input_payload) || {}
    : body.input_payload || {};
  const query = String(body.query || input.player_input || "").trim();
  return {
    route: body.route || (input.trigger_type === "chat" ? "chat" : "situation"),
    operation: body.operation || "",
    trigger_type: input.trigger_type || "",
    event_type: input.event?.type || "",
    event_id: input.event?.id || "",
    game_id: input.game_id || "",
    round_id: input.round_id || "",
    round_transition: input.round_context?.transition || "",
    conversation_fingerprint: fingerprint(body.conversation_id || ""),
    player_input: input.player_input || query,
    current_answer: input.game?.current_answer || "",
    preview_repair_attempt: input.round_question_plan_request?.repair?.attempt || 0,
    recent_messages: input.interaction?.recent_messages || [],
    query_fingerprint: fingerprint(query),
    query_length: query.length,
  };
}

function parseJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function isPublicPath(relativePath) {
  return PUBLIC_FILES.has(relativePath)
    || relativePath.startsWith("assets/") && ASSET_EXTENSIONS.has(path.extname(relativePath));
}

function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  const relativePath = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relativePath);
  const relative = path.relative(ROOT, filePath);

  if (urlPath.includes("\\") || relative.startsWith("..") || path.isAbsolute(relative)
    || relativePath.split("/").some(part => part.startsWith("."))) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }
  // Production serves only the page and its assets, never the repository or backend source.
  if (RUNTIME !== "local" && !isPublicPath(relativePath)) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  fs.realpath(filePath, (pathError, actualPath) => {
    const actualRelative = pathError ? "" : path.relative(ROOT, actualPath);
    if (pathError || actualRelative.startsWith("..") || path.isAbsolute(actualRelative)
      || actualRelative.split(path.sep).some(part => part.startsWith("."))
      || RUNTIME !== "local" && !isPublicPath(actualRelative)) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    fs.stat(actualPath, (error, stats) => {
      if (error || !stats.isFile()) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      const isMedia = MEDIA_EXTENSIONS.has(ext);
      const range = isMedia ? parseByteRange(req.headers.range, stats.size) : null;

      if (req.headers.range && isMedia && !range) {
        res.writeHead(416, { "Content-Range": `bytes */${stats.size}` });
        res.end();
        return;
      }

      if (range) {
        const { start, end } = range;
        res.writeHead(206, {
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          "Content-Range": `bytes ${start}-${end}/${stats.size}`,
          "Content-Type": contentType,
        });
        if (req.method === "HEAD") res.end();
        else fs.createReadStream(actualPath, { start, end }).pipe(res);
        return;
      }

      res.writeHead(200, {
        "Accept-Ranges": isMedia ? "bytes" : "none",
        "Content-Length": stats.size,
        "Content-Type": contentType,
        "Cache-Control": "no-store, max-age=0, must-revalidate",
      });
      if (req.method === "HEAD") res.end();
      else fs.createReadStream(actualPath).pipe(res);
    });
  });
}

function parseByteRange(rangeHeader, size) {
  if (!rangeHeader || size === 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;

  const requestedStart = match[1] ? Number(match[1]) : null;
  const requestedEnd = match[2] ? Number(match[2]) : null;
  if (requestedStart === null && requestedEnd === null) return null;
  if (requestedStart !== null && !Number.isSafeInteger(requestedStart)
    || requestedEnd !== null && !Number.isSafeInteger(requestedEnd)) return null;

  if (requestedStart === null) {
    if (requestedEnd === 0) return null;
    const suffixLength = Math.min(requestedEnd, size);
    return { start: size - suffixLength, end: size - 1 };
  }

  if (requestedStart >= size) return null;
  const end = requestedEnd === null ? size - 1 : Math.min(requestedEnd, size - 1);
  if (end < requestedStart) return null;
  return { start: requestedStart, end };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let oversized = false;
    req.on("data", (chunk) => {
      if (oversized) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        oversized = true;
        reject(Object.assign(new Error("Request exceeds 2 MiB."), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!oversized) resolve(parseMaybeJson(Buffer.concat(chunks).toString("utf8") || "{}"));
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function buildHealthPayload(runtime) {
  const appId = process.env.DIFY_CHATFLOW_APP_ID || DEFAULT_CHATFLOW_APP_ID;
  const apiToken = process.env.DIFY_CHATFLOW_API_KEY
    || process.env.DIFY_API_KEY
    || getMappedApiKey(appId);
  const releaseInfo = readReleaseInfo();

  return {
    ok: true,
    runtime,
    release: releaseInfo.release,
    milestone: releaseInfo.milestone,
    focus: releaseInfo.focus,
    build_date: releaseInfo.build_date,
    local_diagnostics: {
      schema_version: 2,
      enabled: diagnosticLastWriteAt !== null && diagnosticLastError === null,
      server_instance_id: SERVER_INSTANCE_ID,
      server_started_at: SERVER_STARTED_AT,
      last_write_at: diagnosticLastWriteAt,
      last_error: diagnosticLastError,
    },
    workflow_proxy: {
      endpoint: "/api/workflow",
      provider: apiToken ? "dify-chatflow" : "unconfigured",
      configured: Boolean(apiToken),
      timeout_ms: TIMEOUT_MS,
      ...getBffHealth(),
    },
    host_voice_configured: Boolean(process.env.COSYVOICE_API_KEY),
    checked_at: new Date().toISOString(),
  };
}

function readReleaseInfo() {
  try {
    return JSON.parse(fs.readFileSync(RELEASE_INFO_PATH, "utf8"));
  } catch {
    return {
      milestone: "V1.x",
      release: "unknown",
      build_date: "",
      focus: "unknown",
    };
  }
}

function parseMaybeJson(value) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeRequestBody(body) {
  if (!body) return {};
  if (typeof body === "string") return parseMaybeJson(body) || {};
  return body;
}

function normalizeId(value, fallback) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().slice(0, 128);
  return normalized || fallback;
}

function getMappedApiKey(appId) {
  try {
    const keys = JSON.parse(process.env.DIFY_WORKFLOW_API_KEYS || "{}");
    return typeof keys[appId] === "string" ? keys[appId] : "";
  } catch {
    return "";
  }
}
