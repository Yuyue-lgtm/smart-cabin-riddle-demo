const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const TIMEOUT_MS = 60000;
const DEFAULT_CHATFLOW_APP_ID = "74bef8bd-22bd-4e19-91da-5e8d645dd8ed";
const RELEASE_INFO_PATH = path.join(ROOT, "release-info.json");

loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

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
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
const MEDIA_EXTENSIONS = new Set([".mp4", ".webm", ".mp3"]);

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/api/health" && req.method === "GET") {
      sendJson(res, 200, buildHealthPayload("local"));
      return;
    }

    if (req.url === "/api/workflow" && req.method === "POST") {
      await proxyWorkflow(req, res);
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, {
      error: "LOCAL_SERVER_ERROR",
      message: error.message,
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Smart cabin demo running at http://${HOST}:${PORT}`);
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
  const appId = process.env.DIFY_CHATFLOW_APP_ID || DEFAULT_CHATFLOW_APP_ID;
  const apiToken = process.env.DIFY_CHATFLOW_API_KEY
    || process.env.DIFY_API_KEY
    || getMappedApiKey(appId);
  const apiBase = (process.env.DIFY_API_BASE_URL || "https://api.dify.ai").replace(/\/+$/, "");

  if (!apiToken) {
    sendJson(res, 500, {
      error: "DIFY_CHATFLOW_NOT_CONFIGURED",
      message: "Missing DIFY_CHATFLOW_API_KEY in .env.local.",
    });
    return;
  }

  const body = normalizeRequestBody(await readJsonBody(req));
  if (body.operation === "sync_state") {
    await syncConversationState({ body, res, apiBase, apiToken, appId });
    return;
  }

  const query = typeof body.input_payload === "string"
    ? body.input_payload
    : JSON.stringify(body.input_payload || body);
  const requestBody = {
    inputs: {},
    query,
    response_mode: "blocking",
    user: normalizeId(body.user_id, "demo-user"),
    ...(typeof body.conversation_id === "string" && body.conversation_id.trim()
      ? { conversation_id: body.conversation_id.trim() }
      : {}),
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${apiBase}/v1/chat-messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = parseMaybeJson(text);

    if (!response.ok) {
      sendJson(res, response.status, {
        error: "DIFY_CHATFLOW_REQUEST_FAILED",
        status: response.status,
        payload,
      });
      return;
    }

    if (typeof payload?.answer !== "string") {
      sendJson(res, 502, {
        error: "DIFY_CHATFLOW_INVALID_RESPONSE",
        message: "Dify Chatflow response did not include an answer string.",
      });
      return;
    }

    sendJson(res, 200, {
      workflow_output: payload.answer,
      conversation_id: payload.conversation_id || requestBody.conversation_id || "",
      message_id: payload.message_id || payload.id || "",
      app_id: appId,
    });
  } catch (error) {
    const isTimeout = error.name === "AbortError";
    sendJson(res, isTimeout ? 504 : 500, {
      error: isTimeout ? "DIFY_CHATFLOW_TIMEOUT" : "DIFY_CHATFLOW_PROXY_ERROR",
      message: isTimeout ? "Dify Chatflow request timed out." : error.message,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function syncConversationState({ body, res, apiBase, apiToken, appId }) {
  const conversationId = normalizeId(body.conversation_id, "");
  const userId = normalizeId(body.user_id, "");
  if (!conversationId || !userId || !body.snapshot || typeof body.snapshot !== "object" || Array.isArray(body.snapshot)) {
    sendJson(res, 400, { error: "INVALID_STATE_SYNC_REQUEST" });
    return;
  }

  const value = JSON.stringify(body.snapshot);
  if (value.length > 12000) {
    sendJson(res, 413, { error: "STATE_SNAPSHOT_TOO_LARGE" });
    return;
  }

  const base = `${apiBase}/v1/conversations/${encodeURIComponent(conversationId)}/variables`;
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };
  const query = new URLSearchParams({ user: userId });
  try {
    const listResponse = await fetch(`${base}?${query}`, { headers });
    const listPayload = parseMaybeJson(await listResponse.text());
    if (!listResponse.ok) {
      sendJson(res, listResponse.status, {
        error: "DIFY_CONVERSATION_VARIABLES_REQUEST_FAILED",
        payload: listPayload,
      });
      return;
    }

    const variables = Array.isArray(listPayload?.data)
      ? listPayload.data
      : Array.isArray(listPayload?.variables)
        ? listPayload.variables
        : [];
    const snapshotVariable = variables.find((variable) => variable?.name === "cabin_snapshot");
    if (!snapshotVariable?.id) {
      sendJson(res, 409, { error: "DIFY_CABIN_SNAPSHOT_VARIABLE_MISSING" });
      return;
    }

    const updateResponse = await fetch(`${base}/${encodeURIComponent(snapshotVariable.id)}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ value, user: userId }),
    });
    const updatePayload = parseMaybeJson(await updateResponse.text());
    if (!updateResponse.ok) {
      sendJson(res, updateResponse.status, {
        error: "DIFY_CONVERSATION_VARIABLE_UPDATE_FAILED",
        payload: updatePayload,
      });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      app_id: appId,
      conversation_id: conversationId,
      variable: "cabin_snapshot",
    });
  } catch (error) {
    sendJson(res, 502, { error: "DIFY_STATE_SYNC_PROXY_ERROR", message: error.message });
  }
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safePath === "/" ? "index.html" : safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (error, stats) => {
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
      res.writeHead(416, {
        "Content-Range": `bytes */${stats.size}`,
      });
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
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      "Accept-Ranges": isMedia ? "bytes" : "none",
      "Content-Length": stats.size,
      "Content-Type": contentType,
      "Cache-Control": "no-store, max-age=0, must-revalidate",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function parseByteRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;

  const requestedStart = match[1] ? Number(match[1]) : null;
  const requestedEnd = match[2] ? Number(match[2]) : null;
  if (requestedStart === null && requestedEnd === null) return null;

  if (requestedStart === null) {
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
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      resolve(parseMaybeJson(data || "{}"));
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
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
    workflow_proxy: {
      endpoint: "/api/workflow",
      provider: apiToken ? "dify-chatflow" : "unconfigured",
      configured: Boolean(apiToken),
      timeout_ms: TIMEOUT_MS,
    },
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
