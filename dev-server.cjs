const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const TIMEOUT_MS = 60000;
const RELEASE_INFO_PATH = path.join(ROOT, "release-info.json");

loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

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

server.listen(PORT, () => {
  console.log(`Smart cabin demo running at http://localhost:${PORT}`);
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
  const workflowUrl = process.env.COZE_WORKFLOW_URL;
  const apiToken = process.env.COZE_API_TOKEN || process.env.COZE_WORKFLOW_TOKEN;

  if (!workflowUrl || !apiToken) {
    sendJson(res, 500, {
      error: "COZE_PROXY_NOT_CONFIGURED",
      message: "Missing COZE_WORKFLOW_URL or COZE_API_TOKEN in .env.local.",
    });
    return;
  }

  const body = await readJsonBody(req);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(workflowUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = parseMaybeJson(text);

    if (!response.ok) {
      sendJson(res, response.status, {
        error: "COZE_WORKFLOW_REQUEST_FAILED",
        status: response.status,
        payload,
      });
      return;
    }

    sendJson(res, 200, {
      workflow_output: extractWorkflowOutput(payload),
      raw: payload,
    });
  } catch (error) {
    const isTimeout = error.name === "AbortError";
    sendJson(res, isTimeout ? 504 : 500, {
      error: isTimeout ? "COZE_WORKFLOW_TIMEOUT" : "COZE_PROXY_ERROR",
      message: isTimeout ? "Coze workflow request timed out." : error.message,
    });
  } finally {
    clearTimeout(timeout);
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

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    });
    res.end(data);
  });
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
  const workflowUrl = process.env.COZE_WORKFLOW_URL;
  const apiToken = process.env.COZE_API_TOKEN || process.env.COZE_WORKFLOW_TOKEN;
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
      configured: Boolean(workflowUrl && apiToken),
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

function extractWorkflowOutput(payload) {
  const candidates = [
    payload?.workflow_output,
    payload?.data?.workflow_output,
    payload?.output,
    payload?.data?.output,
    payload?.result,
    payload?.data?.result,
    payload,
  ].filter((candidate) => candidate !== undefined && candidate !== null);

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const parsed = parseMaybeJson(candidate);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
      return candidate;
    }

    if (typeof candidate === "object") {
      return candidate;
    }
  }

  return payload;
}
