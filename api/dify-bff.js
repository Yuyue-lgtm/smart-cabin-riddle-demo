const { createHmac, timingSafeEqual } = require("node:crypto");
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_CHATFLOW_APP_ID = "74bef8bd-22bd-4e19-91da-5e8d645dd8ed";
const DEFAULT_SITUATION_APP_ID = "bc1ce5be-d5c5-4885-84c5-72c2c1f63d18";
const DEFAULT_PREVIEW_APP_ID = "bf81cd44-a49f-4048-901f-e95e941dc429";
const SITUATION_EVENTS = new Set([
  "hard_brake",
  "safety_pause",
  "answer_correct",
  "round_timeout",
  "game_end",
  "environment_change",
  "speed_overspeed",
  "driver_tired",
  "driver_distracted",
  "temporary_interruption",
  "passenger_sleep",
  "passenger_wake",
  "passenger_inactive",
  "near_destination",
  "game_stuck",
  "near_answer",
  "cabin_laughing",
  "resume_game",
  "round_changed",
  "post_result_feedback",
]);

const situationCache = new Map();

async function handleWorkflowBody(rawBody) {
  const body = normalizeRequestBody(rawBody);
  const input = normalizeInput(body);
  const route = body.route || (input.trigger_type === "chat" ? "chat" : "situation");
  if (input.trigger_type === "event") {
    const eventType = input.event?.type || "";
    if (route === "chat" && body.operation === "environment_round_intro") {
      return runEnvironmentRoundIntro(body, input);
    }
    if (route === "chat" && body.operation === "situation_reply") {
      return runSituationReply(body, input);
    }
    if (route === "preview" && eventType === "start_game") {
      return runPreview(body, input);
    }
    if (route !== "situation") {
      return result(400, { error: "INVALID_EVENT_ROUTE", route, event_type: eventType });
    }
    if (!SITUATION_EVENTS.has(eventType)) {
      return result(200, {
        route: "skipped",
        event_type: eventType,
        event_id: input.event?.id || "",
        reason: "UNSUPPORTED_SITUATION_EVENT",
      });
    }
    return runSituation(body, input);
  }
  if (route !== "chat" || input.trigger_type !== "chat") {
    return result(400, { error: "INVALID_CHAT_ROUTE", route });
  }
  return runChat(body, input);
}

async function runPreview(body, input) {
  const config = getConfig("preview");
  const eventId = input.event?.id || "";
  if (!config.apiKey) {
    return result(500, {
      route: "preview", event_type: "start_game", event_id: eventId,
      error: "DIFY_PREVIEW_NOT_CONFIGURED",
      message: "Missing DIFY_PREVIEW_API_KEY on the server.",
    });
  }

  const scope = deriveScope(input, normalizeId(body.user_id, "demo-user"));
  const planRequest = input.round_question_plan_request || {};
  const repair = planRequest.repair;
  if (repair && (repair.attempt !== 1 || !Array.isArray(repair.accepted_steps)
    || repair.accepted_steps.length > 8 || !Array.isArray(repair.validation_errors)
    || typeof repair.plan_id !== "string" || !repair.plan_id.trim())) {
    return result(400, { route: "preview", error: "INVALID_PREVIEW_REPAIR", event_id: eventId });
  }
  try {
    const response = await fetchWithTimeout(
      `${config.apiBase}/v1/workflows/run`,
      {
        method: "POST",
        headers: jsonHeaders(config.apiKey),
        body: JSON.stringify({
          inputs: { input_payload: JSON.stringify(withScope(input, scope)) },
          response_mode: "blocking",
          user: normalizeId(body.user_id, "demo-user"),
        }),
      },
      config.timeoutMs,
    );
    const payload = parseMaybeJson(await response.text());
    if (!response.ok) {
      return result(response.status, {
        route: "preview", event_type: "start_game", event_id: eventId,
        error: "DIFY_PREVIEW_REQUEST_FAILED", status: response.status, payload,
      });
    }

    const rawOutput = parseMaybeJson(payload?.data?.outputs?.workflow_output
      || payload?.outputs?.workflow_output);
    const rawPlan = parseMaybeJson(rawOutput?.round_question_plan);
    const errors = [...new Set([
      ...(Array.isArray(rawOutput?.debug?.validation_errors) ? rawOutput.debug.validation_errors : []),
      ...(Array.isArray(rawOutput?.preview_diagnostic?.validation_errors) ? rawOutput.preview_diagnostic.validation_errors : []),
    ].filter((value) => typeof value === "string").map((value) => value.slice(0, 160)))].slice(0, 30);
    const rawSteps = Array.isArray(rawPlan?.steps) ? rawPlan.steps : [];
    const requestedCount = Math.max(2, Math.min(8, Number(planRequest.step_count) || rawSteps.length || 4));
    const repairPrefix = repair && Array.isArray(repair.accepted_steps)
      ? repair.accepted_steps.slice(0, requestedCount)
      : [];
    const steps = [];
    for (const step of rawSteps.slice(0, requestedCount)) {
      if (!step || typeof step !== "object" || Array.isArray(step)
        || !step.variants || typeof step.variants !== "object" || Array.isArray(step.variants)
        || !Object.values(step.variants).length
        || Object.values(step.variants).some((question) => typeof question !== "string" || !question.trim())) {
        errors.push("invalid_plan_structure");
        break;
      }
      steps.push(step);
    }
    if (!steps.length && !errors.length) errors.push("empty_question_plan");
    // A repair may append to the accepted prefix, never rewrite questions already in use.
    if (repair && repairPrefix.some((step, index) =>
      previewStepSignature(step) !== previewStepSignature(steps[index]))) {
      steps.length = 0;
      steps.push(...repairPrefix);
      errors.push("accepted_prefix_changed");
    }
    const workflowFailed = payload?.data?.status && payload.data.status !== "succeeded";
    if (workflowFailed) {
      steps.length = 0;
      if (repair) steps.push(...repairPrefix);
      errors.push("upstream_workflow_failed");
    }
    const status = steps.length >= requestedCount ? "ready" : steps.length ? "partial" : "failed";
    const diagnostic = {
      status,
      repair_attempted: Boolean(repair),
      repairable: !repair && status !== "ready" && !workflowFailed && !errors.includes("missing_answer"),
      accepted_step_count: steps.length,
      requested_step_count: requestedCount,
      validation_errors: [...new Set(errors)],
      workflow_run_id: payload.workflow_run_id || payload.data?.id || "",
      upstream_status: payload.data?.status || "",
      upstream_error: typeof payload.data?.error === "string" ? payload.data.error.slice(0, 300) : "",
    };
    const plan = {
      plan_id: String(repair?.plan_id || rawPlan?.plan_id || rawPlan?.id || scope.round_id),
      reasoning_path: Array.isArray(rawPlan?.reasoning_path) ? rawPlan.reasoning_path : [],
      steps: steps.map((step) => ({
        id: step.id,
        order: step.order,
        fact_key: step.fact_key,
        depends_on: step.depends_on,
        stage: step.stage,
        expected_answer: step.expected_answer,
        variants: step.variants,
      })),
    };
    return result(200, {
      route: "preview", event_type: "start_game", event_id: eventId,
      game_id: scope.game_id, round_id: scope.round_id, scene_version: scope.scene_version,
      workflow_output: JSON.stringify({
        round_question_plan: plan,
        preview_status: status,
        preview_diagnostic: diagnostic,
        ...(diagnostic.repairable ? { preview_repair: {
          attempt: 1,
          plan_id: plan.plan_id,
          accepted_steps: steps.map((step) => ({
            id: step.id, order: step.order, fact_key: step.fact_key, depends_on: step.depends_on,
            stage: step.stage, expected_answer: step.expected_answer, variants: step.variants,
            host_reply_text: step.host_reply_text,
          })),
          validation_errors: diagnostic.validation_errors,
        } } : {}),
      }),
      app_id: config.appId,
      workflow_run_id: diagnostic.workflow_run_id,
      preview_status: status,
      preview_diagnostic: diagnostic,
    });
  } catch (error) {
    return result(error.name === "AbortError" ? 504 : 502, {
      route: "preview", event_type: "start_game", event_id: eventId,
      error: error.name === "AbortError" ? "DIFY_PREVIEW_TIMEOUT" : "DIFY_PREVIEW_PROXY_ERROR",
      message: error.name === "AbortError" ? "Question preview timed out." : error.message,
    });
  }
}

function previewStepSignature(step) {
  if (!step || typeof step !== "object") return "";
  return JSON.stringify([
    step.id || "", step.order || 0, step.fact_key || "", step.depends_on || [],
    step.stage || "", step.expected_answer || "",
    Object.entries(step.variants || {}).sort(([a], [b]) => a.localeCompare(b)),
    step.host_reply_text || "",
  ]);
}

async function runEnvironmentRoundIntro(body, input) {
  const environment = String(input.car?.environment || "");
  const matches = [["雨", "雨天"], ["雪", "雪景"], ["城区", "城区"], ["风景区", "风景"], ["高速", "高速"]];
  if (input.event?.type !== "round_changed" || input.event?.source !== "environment_riddle"
    || input.event?.priority !== "P3" || !input.event?.id
    || input.dialogue_request?.kind !== "environment_round_intro"
    || !["opening", "playing"].includes(input.game?.status)
    || !Number.isInteger(input.game?.round_index) || input.game.round_index < 2
    || input.game?.question_count !== 0 || String(input.player_input || "").trim()
    || input.event?.value !== environment
    || !matches.some(([keyword, theme]) => environment.includes(keyword) && input.game?.current_theme === theme)) {
    return result(409, { route: "chat", operation: "environment_round_intro", error: "INVALID_ENVIRONMENT_ROUND_INTRO" });
  }
  const scope = deriveScope(input, normalizeId(body.user_id, "demo-user"));
  const now = Date.now();
  // Selection is deterministic; only the wording needs a model, not another analysis run.
  const scene = { ...scope, event_type: "round_changed", event_id: input.event.id, event_priority: "P3",
    generated_at_ms: now, expires_at_ms: now + 60000, analysis_status: "ready",
    request_proactive_speech: true, usable_for_dialogue: false,
    strategy: "soft_response", reason_codes: ["environment_matched_new_round"],
    dialogue_context: { selected_snapshot: { environment }, knowhow: { status: "not_relevant", retrieved: [] },
      guidance: { strategy: "soft_response", instruction: "当前新题已根据车外环境应景选定。只用一句简短自然的开场，把眼前环境与这道新题应景联系起来；不要只说第几题准备好了。只能提公开的天气或地点和应景这件事，不透露谜底、题目属性、材料、用途、类别或新增线索，不回答历史问题，不邀请具体乘客，不声称执行设备动作。execution_actions必须为空。" } },
  };
  return runChat(body, input, scene, "environment_round_intro");
}

async function runChat(body, input, eventSituation = null, operation = "situation_reply") {
  const config = getConfig("chat");
  if (!config.apiKey) {
    return result(500, {
      route: "chat",
      event_type: input.event?.type || "",
      event_id: input.event?.id || "",
      error: "DIFY_CHATFLOW_NOT_CONFIGURED",
      message: "Missing DIFY_CHATFLOW_API_KEY on the server.",
    });
  }

  const userId = normalizeId(body.user_id, "demo-user");
  const scope = deriveScope(input, userId);
  const situation = eventSituation || getSituationCache(userId, scope);
  const query = eventSituation
    ? `座舱事件：${input.event.type}。请依据当前事件和情境分析，自然地回应一句。`
    : String(body.query || input.player_input || "").trim().slice(0, 800);
  const snapshot = withScope(input, scope);
  if (eventSituation) {
    snapshot.player_input = "";
    snapshot.dialogue_request = { kind: "situation_event", event_id: input.event.id };
  }
  snapshot.round_context = buildRoundContext(input, scope, Boolean(body.conversation_id));
  const requestBody = {
    inputs: {
      snapshot: JSON.stringify(snapshot),
      situation: situation ? JSON.stringify(situation) : "{}",
    },
    query,
    response_mode: "streaming",
    user: userId,
    ...(normalizeId(body.conversation_id, "")
      ? { conversation_id: normalizeId(body.conversation_id, "") }
      : {}),
  };

  try {
    const response = await fetchWithTimeout(
      `${config.apiBase}/v1/chat-messages`,
      { method: "POST", headers: jsonHeaders(config.apiKey), body: JSON.stringify(requestBody) },
      config.timeoutMs,
    );
    const text = await response.text();
    const payload = parseChatResponse(text, response.headers.get("content-type") || "");
    if (!response.ok) {
      return result(response.status, {
        route: "chat",
        event_type: input.event?.type || "",
        event_id: input.event?.id || "",
        error: "DIFY_CHATFLOW_REQUEST_FAILED",
        status: response.status,
        payload: payload.raw || payload,
      });
    }

    const publicOutput = payload.hostResult
      || parsePublicOutput(payload.answer)
      || makeAnswerEnvelope(payload.answer, input);
    const diagnostic = chatDiagnostic(publicOutput, payload);
    const outputScope = publicOutput.context_scope;
    if (outputScope && Object.keys(scope).some((key) => outputScope[key] !== scope[key])) {
      return result(409, {
        route: "chat", ...scope,
        error: "DIFY_CHAT_CONTEXT_MISMATCH",
        message: "Chatflow used a snapshot from a different round or state.",
      });
    }
    return result(200, {
      route: "chat",
      operation: eventSituation ? operation : "passenger_chat",
      ...scope,
      event_type: input.event?.type || "",
      event_id: input.event?.id || "",
      workflow_output: JSON.stringify(publicOutput),
      answer: payload.answer || publicOutput.ai_reply_text,
      host_result: publicOutput,
      situation_context: situation || null,
      conversation_id: payload.conversationId || normalizeId(body.conversation_id, ""),
      message_id: payload.messageId,
      workflow_run_id: payload.workflowRunId,
      app_id: config.appId,
      context_verified: Boolean(outputScope),
      diagnostic,
    });
  } catch (error) {
    return result(error.name === "AbortError" ? 504 : 502, {
      route: "chat",
      event_type: input.event?.type || "",
      event_id: input.event?.id || "",
      error: error.name === "AbortError" ? "DIFY_CHATFLOW_TIMEOUT" : "DIFY_CHATFLOW_PROXY_ERROR",
      message: error.name === "AbortError" ? "Dify Chatflow request timed out." : error.message,
    });
  }
}

async function runSituationReply(body, input) {
  const scene = readSituationHandoff(body.situation_handoff, normalizeId(body.user_id, "demo-user"));
  const scope = deriveScope(input, normalizeId(body.user_id, "demo-user"));
  const type = input.event?.type;
  const generated = Number(scene?.generated_at_ms), expires = Number(scene?.expires_at_ms);
  if (!scene || !SITUATION_EVENTS.has(type) || isP0Event(input.event)
    || scene.event_type !== type || scene.event_id !== input.event?.id
    || scene.event_priority !== input.event?.priority
    || Object.keys(scope).some(key => scene[key] !== scope[key])
    || scene.analysis_status !== "ready" || !requestsSituationHost(scene, input)
    || !Number.isFinite(generated) || !Number.isFinite(expires)
    || generated > Date.now() + 2000 || expires <= Date.now() || expires > generated + 60000
    || !["opening", "playing"].includes(input.game?.status)
      && !(type === "post_result_feedback" && input.game?.status === "victory")) {
    return result(409, { route: "chat", operation: "situation_reply", error: "INVALID_SITUATION_HANDOFF" });
  }
  return runChat(body, input, scene);
}

function isP0Event(event) {
  return event?.priority === "P0"
    || ["hard_brake", "safety_pause", "temporary_interruption", "answer_correct", "round_timeout", "game_end"].includes(event?.type);
}

function isComfortDecisionCandidate(input) {
  const seat = input.event?.seat;
  const states = input.passengers?.states || {};
  const key = { rearLeft: "rear_left", rearRight: "rear_right" }[seat] || seat;
  const raw = states[seat] ?? states[key];
  const mood = typeof raw === "object" && raw ? raw.mood || raw.state : raw;
  const sleeping = input.event?.type === "passenger_sleep" && ["睡着", "sleeping", "asleep"].includes(mood);
  const waking = input.event?.type === "passenger_wake" && ["普通", "normal", "awake", "清醒", "正常"].includes(mood)
    && Array.isArray(input.car?.sleep_comfort_seats) && input.car.sleep_comfort_seats.includes(seat);
  return (sleeping || waking) && !isP0Event(input.event)
    && ["driver", "front", "rearLeft", "rearRight"].includes(seat)
    && ["opening", "playing"].includes(input.game?.status);
}

function requestsSituationHost(scene, input) {
  if (scene.request_host_decision === true) {
    return scene.host_decision_seat === input.event?.seat && isComfortDecisionCandidate(input);
  }
  return scene.request_proactive_speech === true;
}

function signSituationHandoff(scene, userId) {
  const payload = Buffer.from(JSON.stringify({ scene, user_id: userId })).toString("base64url");
  const signature = createHmac("sha256", getConfig("situation").apiKey).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readSituationHandoff(ticket, userId) {
  if (typeof ticket !== "string" || ticket.length > 100000 || !getConfig("situation").apiKey) return null;
  try {
    const [payload, signature, extra] = ticket.split(".");
    if (extra || !payload || !signature) return null;
    const expected = createHmac("sha256", getConfig("situation").apiKey).update(payload).digest();
    const received = Buffer.from(signature, "base64url");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    return decoded.user_id === userId ? decoded.scene : null;
  } catch { return null; }
}

function buildRoundContext(input, scope, hasConversation) {
  const previous = input.round_context || {};
  const previousGameId = normalizeId(previous.previous_game_id, "");
  const previousRoundId = normalizeId(previous.previous_round_id, "");
  const transition = !hasConversation ? "conversation_start"
    : previousGameId && previousGameId !== scope.game_id ? "new_game"
    : previousRoundId && previousRoundId !== scope.round_id ? "new_round"
    : previousRoundId === scope.round_id ? "continue_round"
    : "conversation_resume";
  return {
    transition,
    previous_game_id: previousGameId,
    previous_round_id: previousRoundId,
    current_game_id: scope.game_id,
    current_round_id: scope.round_id,
    current_snapshot_is_authoritative: true,
    notice: transition === "new_game" ? "已开始新局，之前各题已结束，当前题快照优先。"
      : transition === "new_round" ? "上一题已结束，当前题快照优先。"
      : "当前题快照优先，历史中的不同题目和旧状态均不适用于当前题。",
    instruction: "上一题已结束时，旧题谜底、问答事实和揭晓状态立即失效。当前题快照优先；当前问题中未明确指向旧题的‘它’指当前题。历史仅用于对话衔接或明确的旧题回顾，不得当作当前题事实。",
  };
}

async function runSituation(body, input) {
  const config = getConfig("situation");
  const environmentEvent = input.event?.type === "environment_change";
  if (!config.apiKey) {
    return result(500, {
      route: "situation",
      event_type: input.event?.type || "",
      event_id: input.event?.id || "",
      error: "DIFY_SITUATION_NOT_CONFIGURED",
      message: "Missing DIFY_SITUATION_API_KEY on the server.",
    });
  }

  const userId = normalizeId(body.user_id, "demo-user");
  const scope = deriveScope(input, userId);
  const snapshot = JSON.stringify(withScope(input, scope));
  const requestBody = {
    inputs: { snapshot },
    response_mode: "blocking",
    user: userId,
  };

  try {
    const response = await fetchWithTimeout(
      `${config.apiBase}/v1/workflows/run`,
      { method: "POST", headers: jsonHeaders(config.apiKey), body: JSON.stringify(requestBody) },
      config.timeoutMs,
    );
    const text = await response.text();
    const payload = parseMaybeJson(text);
    if (!response.ok) {
      return result(response.status, {
        route: "situation",
        event_type: input.event?.type || "",
        event_id: input.event?.id || "",
        error: "DIFY_SITUATION_REQUEST_FAILED",
        status: response.status,
        payload,
      });
    }

    const scene = parseSceneOutput(payload);
    if (!scene) {
      return result(502, {
        route: "situation",
        event_type: input.event?.type || "",
        event_id: input.event?.id || "",
        error: "DIFY_SITUATION_INVALID_RESPONSE",
        message: "Dify Situation Workflow response did not include scene_output.",
      });
    }

    const normalizedScene = { ...scene, event_type: input.event?.type, event_priority: input.event?.priority, host_response: null };
    normalizedScene.request_host_decision = scene.analysis_status === "ready" && isComfortDecisionCandidate(input);
    normalizedScene.host_decision_seat = normalizedScene.request_host_decision ? input.event.seat : null;
    const stored = !environmentEvent && input.event?.type !== "post_result_feedback"
      && input.event?.priority !== "P0" && isUsableSituation(normalizedScene, scope);
    if (stored) {
      situationCache.set(userId, normalizedScene);
    }

    const hostOutput = makeSituationEnvelope(normalizedScene, input);
    return result(200, {
      route: "situation",
      event_type: input.event?.type || "",
      event_id: input.event?.id || "",
      game_id: scope.game_id,
      round_id: scope.round_id,
      scene_version: scope.scene_version,
      workflow_output: JSON.stringify(hostOutput),
      scene_output: normalizedScene,
      cached: stored,
      situation_handoff: normalizedScene.analysis_status === "ready"
        && requestsSituationHost(normalizedScene, input) && !isP0Event(input.event)
        ? signSituationHandoff(normalizedScene, userId) : null,
      app_id: config.appId,
      workflow_run_id: payload.workflow_run_id || payload.data?.id || "",
    });
  } catch (error) {
    return result(error.name === "AbortError" ? 504 : 502, {
      route: "situation",
      event_type: input.event?.type || "",
      event_id: input.event?.id || "",
      error: error.name === "AbortError" ? "DIFY_SITUATION_TIMEOUT" : "DIFY_SITUATION_PROXY_ERROR",
      message: error.name === "AbortError" ? "Dify Situation Workflow request timed out." : error.message,
    });
  }
}

function normalizeInput(body) {
  const raw = typeof body.input_payload === "string"
    ? parseMaybeJson(body.input_payload)
    : body.input_payload || body;
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
  input.trigger_type = body.trigger_type || input.trigger_type || (body.query ? "chat" : "event");
  input.player_input = String(body.query || input.player_input || "").trim().slice(0, 800);
  if (input.event && typeof input.event === "object") {
    input.event = { ...input.event, id: input.event.id || `bff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  }
  return input;
}

function deriveScope(input, userId) {
  const game = input.game && typeof input.game === "object" ? input.game : {};
  const gameId = String(input.game_id || game.game_id || `demo-${userId}-${input.timeline?.id || "session"}`).slice(0, 100);
  const roundId = String(input.round_id || game.round_id || `${game.round_index || 1}`).slice(0, 100);
  const stateForVersion = {
    environment: input.car?.environment,
    destination: input.car?.destination,
    overspeed: Number(input.car?.speed) > 120,
    driver: input.passengers?.states?.driver,
    front: input.passengers?.states?.front,
    rear_left: input.passengers?.states?.rear_left,
    rear_right: input.passengers?.states?.rear_right,
    game_status: game.status,
    game_progress: input.perception?.game_progress,
    p0_epoch: input.p0_epoch,
  };
  return {
    game_id: gameId,
    round_id: roundId,
    scene_version: String(input.scene_version || stableHash(JSON.stringify(stateForVersion))).slice(0, 100),
  };
}

function withScope(input, scope) {
  const game = input.game && typeof input.game === "object" ? input.game : {};
  return {
    ...input,
    ...scope,
    game: { ...game, game_id: scope.game_id, round_id: scope.round_id },
  };
}

function getSituationCache(userId, scope) {
  const cached = situationCache.get(userId);
  return cached && isUsableSituation(cached, scope) ? cached : null;
}

function isUsableSituation(scene, scope) {
  return Boolean(
    scene && scene.analysis_status === "ready" && scene.usable_for_dialogue === true
    && scene.game_id === scope.game_id && scene.round_id === scope.round_id
    && scene.scene_version === scope.scene_version
    && Number.isFinite(Number(scene.expires_at_ms)) && Date.now() < Number(scene.expires_at_ms),
  );
}

function parseSceneOutput(payload) {
  const candidate = payload?.data?.outputs?.scene_output
    || payload?.outputs?.scene_output
    || payload?.data?.output?.scene_output
    || payload?.output?.scene_output
    || payload?.scene_output;
  return parseMaybeJson(candidate);
}

function makeSituationEnvelope(scene, input) {
  return {
    ai_reply_text: "",
    game_status: input.game?.status || "playing",
    is_correct: false,
    answer: "",
    ui_change: {},
    perception: scene.perception || {},
    decision_trace: scene.decision_trace || {},
    execution: scene.execution || { actions: [] },
    knowhow_status: scene.knowhow_status,
    retrieved_knowhow: scene.retrieved_knowhow || [],
    strategy: scene.strategy,
    target_seat: scene.target_seat,
    reason_codes: scene.reason_codes || [],
    applied_knowhow_ids: scene.applied_knowhow_ids || [],
    situation_status: scene.analysis_status,
    scene_output: scene,
  };
}

function makeAnswerEnvelope(answer, input) {
  return {
    ai_reply_text: String(answer || "").trim(),
    intent: "answer_question",
    reply_mode: "normal",
    game_status: input.game?.status || "playing",
    is_correct: false,
    ui_change: { cabin_mode: "chat", target_seat: input.passengers?.selected_seat || "front", host_emotion: "normal", animation: "speak", show_answer: false },
    speech: { priority: "P2", max_duration_ms: 6000, interruptible: true },
  };
}

function parseChatResponse(text, contentType) {
  if (!/event-stream/i.test(contentType)) {
    const payload = parseMaybeJson(text) || {};
    const answer = payload.answer || payload.data?.answer || "";
    const hostResult = parseMaybeJson(payload.data?.outputs?.host_result || payload.outputs?.host_result || payload.host_result);
    return { answer, hostResult, conversationId: payload.conversation_id || payload.data?.conversation_id,
      messageId: payload.message_id || payload.id,
      workflowRunId: payload.workflow_run_id || payload.data?.workflow_run_id || payload.data?.id || "", raw: payload };
  }

  let answer = "";
  let hostResult = null;
  let conversationId = "";
  let messageId = "";
  let workflowRunId = "";
  let eventContext = null;
  const modelNodes = [];
  for (const event of parseSseEvents(text)) {
    const data = parseMaybeJson(event.data);
    if (!data || typeof data !== "object") continue;
    const eventType = typeof data.event === "string" ? data.event : event.event;
    conversationId ||= data.conversation_id || data.data?.conversation_id || "";
    if (eventType === "message" || eventType === "agent_message" || eventType === "message_end") {
      messageId ||= data.message_id || data.id || "";
    }
    if (eventType === "workflow_started" || eventType === "workflow_finished") {
      workflowRunId ||= data.workflow_run_id || data.data?.id || data.id || "";
    }
    if (eventType === "message_end") {
      workflowRunId ||= data.metadata?.workflow_run_id || data.workflow_run_id || "";
    }
    if (eventType === "message" || eventType === "agent_message") {
      if (typeof data.answer === "string") answer += data.answer;
    }
    if (eventType === "node_finished") {
      const node = data.data || data;
      const output = node.outputs || {};
      if (node.node_id === "1000000000002") {
        const context = parseMaybeJson(output.context_json);
        if (context?.event_dialogue && typeof context.event_dialogue.valid === "boolean") {
          eventContext = { valid: context.event_dialogue.valid,
            event_type: String(context.event_dialogue.event_type || "").slice(0, 80),
            situation_status: String(context.situation_status || "").slice(0, 80) };
        }
      }
      if (node.node_type === "llm" || node.node_id === "1000000000005") {
        modelNodes.push(summarizeModelNode(node));
      }
      const candidate = output.host_result || output.workflow_output;
      const parsed = parseMaybeJson(candidate);
      if (parsed && typeof parsed === "object" && (parsed.ai_reply_text !== undefined || parsed.intent !== undefined)) hostResult = parsed;
    }
  }
  return { answer, hostResult, conversationId, messageId, workflowRunId, modelNodes, eventContext, raw: text };
}

function summarizeModelNode(node) {
  const output = node.outputs && typeof node.outputs === "object" ? node.outputs : {};
  const text = typeof output.text === "string" ? output.text.trim() : "";
  const structured = parseMaybeJson(output.structured_output);
  const parsed = parseMaybeJson(text);
  const json = structured && typeof structured === "object" && Object.keys(structured).length ? structured
    : parsed && typeof parsed === "object" ? parsed : null;
  const thinkingEnd = text.lastIndexOf("</think>");
  const thinkingOnly = text.startsWith("<think>")
    && (thinkingEnd < 0 || !text.slice(thinkingEnd + "</think>".length).trim());
  const outputAvailable = ["text", "structured_output", "reasoning_content"].some((key) => key in output);
  const error = [node.error, output.error_message].filter(value => typeof value === "string").join("\n");
  return {
    node_id: node.node_id || "",
    status: node.status || null,
    elapsed_time: node.elapsed_time ?? null,
    error_code: /parse structured output/i.test(error) ? "structured_output_parse_failed" : error ? "model_node_error" : null,
    text_length: text.length,
    output_available: outputAvailable,
    format: !outputAvailable ? "unavailable" : json ? "json" : !text ? "empty" : thinkingOnly ? "think_only" : "non_json",
    ai_reply_text_present: typeof json?.ai_reply_text === "string" && Boolean(json.ai_reply_text.trim()),
    structured_output_present: Boolean(structured && typeof structured === "object" && Object.keys(structured).length),
    reasoning_length: typeof output.reasoning_content === "string" ? output.reasoning_content.length : 0,
  };
}

function chatDiagnostic(output, payload) {
  const debug = output.debug && typeof output.debug === "object" ? output.debug : {};
  const trace = output.decision_trace && typeof output.decision_trace === "object" ? output.decision_trace : {};
  const reasonCodes = Array.isArray(debug.fallback_reason_codes) ? debug.fallback_reason_codes
    : Array.isArray(trace.guard_reason_codes) ? trace.guard_reason_codes : [];
  const validationErrors = Array.isArray(debug.validation_errors) ? debug.validation_errors : [];
  const validationReasons = Array.isArray(debug.validation_reason_codes) ? debug.validation_reason_codes : [];
  const fixedFallback = output.ai_reply_text === "我陪你慢慢想，按你的节奏来。";
  const guardFallback = ["fallback", "knowhow_fallback", "constraint_fallback", "model_output_fallback"].includes(trace.guard_status);
  return {
    status: reasonCodes.length || validationErrors.length ? "reason_recorded"
      : trace.guard_status === "event_reply_skipped" ? "event_reply_skipped"
      : fixedFallback || guardFallback ? "reason_unavailable"
        : payload.hostResult ? "no_guard_fallback_observed" : "no_fixed_fallback_observed",
    source: payload.hostResult ? "dify_structured_result" : "dify_answer_only",
    observed_fixed_fallback: fixedFallback,
    guard_status: trace.guard_status || null,
    fallback_origin: debug.fallback_origin || null,
    reason_codes: reasonCodes,
    validation_errors: validationErrors,
    validation_reason_codes: validationReasons,
    model_output_status: debug.model_output_status || null,
    model_retry_count: Number.isInteger(debug.model_retry_count) ? debug.model_retry_count : 0,
    model_attempts: Array.isArray(debug.model_attempts) ? debug.model_attempts : [],
    model_failure_reason_codes: Array.isArray(debug.model_failure_reason_codes) ? debug.model_failure_reason_codes : [],
    model_nodes: payload.modelNodes || [],
    event_context: payload.eventContext || null,
  };
}

function parseSseEvents(text) {
  return String(text || "").split(/\r?\n\r?\n/).map((block) => {
    let event = "message";
    const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    return { event, data: data.join("\n") };
  }).filter((item) => item.data);
}

function parsePublicOutput(value) {
  const parsed = parseMaybeJson(value);
  if (parsed && typeof parsed === "object" && (typeof parsed.ai_reply_text === "string" || parsed.round_question_plan)) return parsed;
  if (typeof value !== "string") return null;
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return parsePublicOutput(value.slice(start, end + 1));
}

function getConfig(kind) {
  const appId = kind === "situation"
    ? process.env.DIFY_SITUATION_APP_ID || DEFAULT_SITUATION_APP_ID
    : kind === "preview"
      ? process.env.DIFY_PREVIEW_APP_ID || DEFAULT_PREVIEW_APP_ID
      : process.env.DIFY_CHATFLOW_APP_ID || DEFAULT_CHATFLOW_APP_ID;
  const apiKey = kind === "situation"
    ? process.env.DIFY_SITUATION_API_KEY || getMappedApiKey(appId)
    : kind === "preview"
      ? process.env.DIFY_PREVIEW_API_KEY || getMappedApiKey(appId)
      : process.env.DIFY_CHATFLOW_API_KEY || process.env.DIFY_API_KEY || getMappedApiKey(appId);
  return {
    appId,
    apiKey,
    apiBase: (process.env.DIFY_API_BASE_URL || "https://api.dify.ai").replace(/\/+$/, ""),
    timeoutMs: Number(process.env.DIFY_BFF_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  };
}

function jsonHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  return fetch(url, { ...options, signal }).finally(() => clearTimeout(timer));
}

function result(status, payload) {
  return { status, payload };
}

function normalizeRequestBody(body) {
  if (!body) return {};
  if (typeof body === "string") return parseMaybeJson(body) || {};
  return body;
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function normalizeId(value, fallback) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().slice(0, 128);
  return normalized || fallback;
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `sv-${(hash >>> 0).toString(36)}`;
}

function getMappedApiKey(appId) {
  try {
    const keys = JSON.parse(process.env.DIFY_WORKFLOW_API_KEYS || "{}");
    return typeof keys[appId] === "string" ? keys[appId] : "";
  } catch {
    return "";
  }
}

module.exports = {
  DEFAULT_CHATFLOW_APP_ID,
  DEFAULT_SITUATION_APP_ID,
  DEFAULT_PREVIEW_APP_ID,
  SITUATION_EVENTS,
  handleWorkflowBody,
  getBffHealth() {
    const chat = getConfig("chat");
    const situation = getConfig("situation");
    const preview = getConfig("preview");
    return {
      configured: Boolean(chat.apiKey),
      chatflow_configured: Boolean(chat.apiKey),
      situation_configured: Boolean(situation.apiKey),
      preview_configured: Boolean(preview.apiKey),
      chatflow_app_id: chat.appId,
      situation_app_id: situation.appId,
      preview_app_id: preview.appId,
      cache_entries: situationCache.size,
      situation_dialogue_protocol: "serial-v1",
      environment_round_intro: true,
      timeout_ms: Math.max(chat.timeoutMs, situation.timeoutMs, preview.timeoutMs),
    };
  },
};
