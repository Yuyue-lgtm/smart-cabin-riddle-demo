const DEFAULT_TIMEOUT_MS = 60000;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }

  const workflowUrl = process.env.COZE_WORKFLOW_URL;
  const apiToken = process.env.COZE_API_TOKEN || process.env.COZE_WORKFLOW_TOKEN;

  if (!workflowUrl || !apiToken) {
    return res.status(500).json({
      error: "COZE_PROXY_NOT_CONFIGURED",
      message: "Missing COZE_WORKFLOW_URL or COZE_API_TOKEN on the server.",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const body = normalizeRequestBody(req.body);
    const cozeResponse = await fetch(workflowUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await cozeResponse.text();
    const payload = parseMaybeJson(text);

    if (!cozeResponse.ok) {
      return res.status(cozeResponse.status).json({
        error: "COZE_WORKFLOW_REQUEST_FAILED",
        status: cozeResponse.status,
        payload,
      });
    }

    return res.status(200).json({
      workflow_output: extractWorkflowOutput(payload),
      raw: payload,
    });
  } catch (error) {
    const isTimeout = error?.name === "AbortError";
    return res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? "COZE_WORKFLOW_TIMEOUT" : "COZE_PROXY_ERROR",
      message: isTimeout ? "Coze workflow request timed out." : error.message,
    });
  } finally {
    clearTimeout(timeout);
  }
};

function normalizeRequestBody(body) {
  if (!body) {
    return {};
  }

  if (typeof body === "string") {
    return parseMaybeJson(body);
  }

  return body;
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
