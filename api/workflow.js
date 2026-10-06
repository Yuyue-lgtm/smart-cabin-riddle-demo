const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_CHATFLOW_APP_ID = "74bef8bd-22bd-4e19-91da-5e8d645dd8ed";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }

  const appId = process.env.DIFY_CHATFLOW_APP_ID || DEFAULT_CHATFLOW_APP_ID;
  const apiKey = process.env.DIFY_CHATFLOW_API_KEY
    || process.env.DIFY_API_KEY
    || getMappedApiKey(appId);
  const apiBase = (process.env.DIFY_API_BASE_URL || "https://api.dify.ai").replace(/\/+$/, "");

  if (!apiKey) {
    return res.status(500).json({
      error: "DIFY_CHATFLOW_NOT_CONFIGURED",
      message: "Missing DIFY_CHATFLOW_API_KEY on the server.",
    });
  }

  const body = normalizeRequestBody(req.body);
  if (body.operation === "sync_state") {
    return syncConversationState({ body, res, apiBase, apiKey, appId });
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
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${apiBase}/v1/chat-messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = parseMaybeJson(text);
    if (!response.ok) {
      return res.status(response.status).json({
        error: "DIFY_CHATFLOW_REQUEST_FAILED",
        status: response.status,
        payload,
      });
    }

    if (typeof payload?.answer !== "string") {
      return res.status(502).json({
        error: "DIFY_CHATFLOW_INVALID_RESPONSE",
        message: "Dify Chatflow response did not include an answer string.",
      });
    }

    return res.status(200).json({
      workflow_output: payload.answer,
      conversation_id: payload.conversation_id || requestBody.conversation_id || "",
      message_id: payload.message_id || payload.id || "",
      app_id: appId,
    });
  } catch (error) {
    const isTimeout = error?.name === "AbortError";
    return res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? "DIFY_CHATFLOW_TIMEOUT" : "DIFY_CHATFLOW_PROXY_ERROR",
      message: isTimeout ? "Dify Chatflow request timed out." : error.message,
    });
  } finally {
    clearTimeout(timeout);
  }
};

async function syncConversationState({ body, res, apiBase, apiKey, appId }) {
  const conversationId = normalizeId(body.conversation_id, "");
  const userId = normalizeId(body.user_id, "");
  const snapshot = body.snapshot;
  if (!conversationId || !userId || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return res.status(400).json({ error: "INVALID_STATE_SYNC_REQUEST" });
  }

  const value = JSON.stringify(snapshot);
  if (value.length > 12000) {
    return res.status(413).json({ error: "STATE_SNAPSHOT_TOO_LARGE" });
  }

  const base = `${apiBase}/v1/conversations/${encodeURIComponent(conversationId)}/variables`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const query = new URLSearchParams({ user: userId });

  try {
    const listResponse = await fetch(`${base}?${query}`, { headers });
    const listPayload = parseMaybeJson(await listResponse.text());
    if (!listResponse.ok) {
      return res.status(listResponse.status).json({
        error: "DIFY_CONVERSATION_VARIABLES_REQUEST_FAILED",
        payload: listPayload,
      });
    }

    const variables = Array.isArray(listPayload?.data)
      ? listPayload.data
      : Array.isArray(listPayload?.variables)
        ? listPayload.variables
        : [];
    const snapshotVariable = variables.find((variable) => variable?.name === "cabin_snapshot");
    if (!snapshotVariable?.id) {
      return res.status(409).json({ error: "DIFY_CABIN_SNAPSHOT_VARIABLE_MISSING" });
    }

    const updateResponse = await fetch(`${base}/${encodeURIComponent(snapshotVariable.id)}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ value, user: userId }),
    });
    const updatePayload = parseMaybeJson(await updateResponse.text());
    if (!updateResponse.ok) {
      return res.status(updateResponse.status).json({
        error: "DIFY_CONVERSATION_VARIABLE_UPDATE_FAILED",
        payload: updatePayload,
      });
    }

    return res.status(200).json({
      ok: true,
      app_id: appId,
      conversation_id: conversationId,
      variable: "cabin_snapshot",
    });
  } catch (error) {
    return res.status(502).json({ error: "DIFY_STATE_SYNC_PROXY_ERROR", message: error.message });
  }
}

function normalizeRequestBody(body) {
  if (!body) return {};
  if (typeof body === "string") return parseMaybeJson(body) || {};
  return body;
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
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
