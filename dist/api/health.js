const fs = require("fs");
const path = require("path");

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
      timeout_ms: DEFAULT_TIMEOUT_MS,
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
