const fs = require("fs");
const path = require("path");
const { getBffHealth } = require("./dify-bff");

const RELEASE_INFO_PATH = path.join(process.cwd(), "release-info.json");
const DEFAULT_TIMEOUT_MS = 60000;

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }

  return res.status(200).json(buildHealthPayload("vercel"));
};

function buildHealthPayload(runtime) {
  const difyApiKey = process.env.DIFY_CHATFLOW_API_KEY
    || process.env.DIFY_API_KEY
    || hasMappedDifyKey(process.env.DIFY_CHATFLOW_APP_ID || "74bef8bd-22bd-4e19-91da-5e8d645dd8ed");
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
      provider: difyApiKey ? "dify-chatflow" : "unconfigured",
      configured: Boolean(difyApiKey),
      timeout_ms: DEFAULT_TIMEOUT_MS,
      ...getBffHealth(),
    },
    checked_at: new Date().toISOString(),
  };
}

function hasMappedDifyKey(appId) {
  try {
    const keys = JSON.parse(process.env.DIFY_WORKFLOW_API_KEYS || "{}");
    return typeof keys[appId] === "string" && Boolean(keys[appId]);
  } catch {
    return false;
  }
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
