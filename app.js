const SEATS = {
  driver: "主驾",
  front: "副驾",
  rearLeft: "左后",
  rearRight: "右后",
};

const DEFAULT_WORKFLOW_ENDPOINT = "/api/workflow";

const ENVIRONMENT_CLASS = {
  高速路晴天白天: "env-highway-day",
  高速路晴天深夜: "env-highway-night",
  高速路雨天白天: "env-highway-rain",
  城区晴天白天: "env-city-day",
  城区雨天白天: "env-city-rain",
  风景区晴天白天: "env-scenic-day",
  风景区雪景白天: "env-snow-day",
};

const RIDDLES = [
  {
    answer: "雨伞",
    theme: "雨天",
    hint: "这题和外面的雨有关，答案是车里很多人都会带的东西。",
    opening: "外面的雨刚好给了我灵感。这一题沾点水，但不是水本身。",
  },
  {
    answer: "安全带",
    theme: "高速",
    hint: "它平时很安静，但关键时刻比主持人还可靠。",
    opening: "高速局先来一道安全感拉满的题。它不说话，但每个人都离不开它。",
  },
  {
    answer: "斧头",
    theme: "朋友",
    hint: "它常出现在故事里，硬核、直接，和砍东西有关。",
    opening: "年轻朋友局，来点爽快的。这个谜底不绕弯，性格很直。",
  },
  {
    answer: "米老鼠",
    theme: "迪士尼",
    hint: "如果目的地是迪士尼，这位老朋友大概率会第一个出来打招呼。",
    opening: "目的地都快把答案写在路牌上了。这一题和迪士尼的一位老朋友有关。",
  },
  {
    answer: "火锅",
    theme: "家庭",
    hint: "全家人围在一起时，它很容易成为气氛中心。",
    opening: "家庭局来一道热乎的。这个答案越多人一起越有感觉。",
  },
  {
    answer: "雪人",
    theme: "雪景",
    hint: "它怕热，但在风景区雪景里特别应景。",
    opening: "窗外如果是雪景，这个谜底就像自己走进题面一样。",
  },
  {
    answer: "红绿灯",
    theme: "城区",
    hint: "城市里最会指挥交通的三色选手。",
    opening: "城区局启动。这位选手不说话，但所有车都得听它的。",
  },
  {
    answer: "书包",
    theme: "学校",
    hint: "去学校时，它通常比本人还早进入战备状态。",
    opening: "目的地是学校的话，这个答案很可能正在后排或者后备箱里。",
  },
  {
    answer: "方向盘",
    theme: "驾驶",
    hint: "主驾最熟悉它，但现在先让副驾和后排来猜。",
    opening: "这题离主驾很近，但主驾先专心开车，交给其他侦探。",
  },
  {
    answer: "草原",
    theme: "风景",
    hint: "它很开阔，适合风景区，也适合把心情放大一点。",
    opening: "风景区局，答案有点辽阔。别急，先从类别慢慢缩小。",
  },
];

const SCENARIOS = [
  {
    speed: 50,
    destination: "公司",
    relationship: "父母+小孩",
    environment: "高速路晴天白天",
    riddleIndex: 1,
  },
  {
    speed: 100,
    destination: "迪士尼",
    relationship: "父母+小孩",
    environment: "高速路晴天白天",
    riddleIndex: 3,
  },
  {
    speed: 80,
    destination: "火锅店",
    relationship: "年轻朋友",
    environment: "城区雨天白天",
    riddleIndex: 0,
  },
  {
    speed: 50,
    destination: "草原",
    relationship: "中老年+儿女",
    environment: "风景区雪景白天",
    riddleIndex: 5,
  },
];

const DEFAULT_STATE = {
  plugin: "riddle",
  scenarioIndex: 0,
  car: {
    speed: 50,
    destination: "公司",
    environment: "高速路晴天白天",
  },
  passengers: {
    relationship: "父母+小孩",
    selectedSeat: "front",
    seats: {
      driver: { mood: "普通", bubble: "" },
      front: { mood: "普通", bubble: "" },
      rearLeft: { mood: "普通", bubble: "" },
      rearRight: { mood: "普通", bubble: "" },
    },
  },
  game: {
    status: "idle",
    roundIndex: 1,
    totalRounds: 10,
    questionCount: 0,
    maxQuestions: 15,
    currentRiddleIndex: 1,
    history: [],
  },
  host: {
    text: "我已经准备好第一道题了，等你发令。",
    emotion: "normal",
    targetSeat: null,
  },
  ui: {
    cabinMode: "normal",
    animation: "idle",
    showAnswer: false,
    alert: "",
  },
};

const state = structuredClone(DEFAULT_STATE);
const els = {};

function boot() {
  cacheElements();
  bindEvents();
  loadWorkflowUrl();
  applyScenario(0, false);
  render();
}

function cacheElements() {
  [
    "environmentBackdrop",
    "environmentLabel",
    "speedLabel",
    "destinationLabel",
    "cabinAlert",
    "roundProgress",
    "questionProgress",
    "gameStatus",
    "stageLabel",
    "riddleTitle",
    "riddleHint",
    "answerReveal",
    "hostBubble",
    "hostAvatar",
    "workflowUrl",
    "saveWorkflow",
    "resetScenario",
    "speedInput",
    "destinationInput",
    "seatSelect",
    "emotionSelect",
    "playerInput",
    "startGame",
    "sendQuestion",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });

  els.speedChips = document.querySelectorAll("[data-speed]");
  els.destinationChips = document.querySelectorAll("[data-destination]");
  els.relationshipChips = document.querySelectorAll("[data-relationship]");
  els.environmentChips = document.querySelectorAll("[data-environment]");
  els.eventButtons = document.querySelectorAll("[data-event]");
  els.seats = document.querySelectorAll("[data-seat]");
}

function bindEvents() {
  els.saveWorkflow.addEventListener("click", saveWorkflowUrl);
  els.resetScenario.addEventListener("click", nextScenario);
  els.startGame.addEventListener("click", startGame);
  els.sendQuestion.addEventListener("click", sendQuestion);
  els.playerInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      sendQuestion();
    }
  });

  els.speedInput.addEventListener("change", () => {
    setSpeed(Number(els.speedInput.value) || 0);
  });

  els.destinationInput.addEventListener("change", () => {
    setDestination(els.destinationInput.value.trim() || "未设置");
  });

  els.seatSelect.addEventListener("change", () => {
    state.passengers.selectedSeat = els.seatSelect.value;
    els.emotionSelect.value = state.passengers.seats[els.seatSelect.value].mood;
    render();
  });

  els.emotionSelect.addEventListener("change", () => {
    const seat = state.passengers.selectedSeat;
    state.passengers.seats[seat].mood = els.emotionSelect.value;
    if (els.emotionSelect.value === "睡着") {
      dispatchWorkflow("event", { type: "passenger_sleep", seat });
    } else {
      render();
    }
  });

  els.speedChips.forEach((button) => {
    button.addEventListener("click", () => setSpeed(Number(button.dataset.speed)));
  });

  els.destinationChips.forEach((button) => {
    button.addEventListener("click", () => setDestination(button.dataset.destination));
  });

  els.relationshipChips.forEach((button) => {
    button.addEventListener("click", () => {
      state.passengers.relationship = button.dataset.relationship;
      dispatchWorkflow("event", {
        type: "relationship_change",
        value: button.dataset.relationship,
      });
    });
  });

  els.environmentChips.forEach((button) => {
    button.addEventListener("click", () => {
      setEnvironment(button.dataset.environment);
      dispatchWorkflow("event", {
        type: "environment_change",
        value: button.dataset.environment,
      });
    });
  });

  els.eventButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.event;
      if (type === "hard_brake") {
        applyImmediateSafetyPause();
      }
      if (type === "resume_game") {
        state.game.status = "playing";
        state.ui.cabinMode = "normal";
        state.ui.alert = "游戏已恢复";
      }
      dispatchWorkflow("event", { type, seat: state.passengers.selectedSeat });
    });
  });

  els.seats.forEach((seatButton) => {
    seatButton.addEventListener("click", () => {
      state.passengers.selectedSeat = seatButton.dataset.seat;
      els.seatSelect.value = state.passengers.selectedSeat;
      els.emotionSelect.value = state.passengers.seats[state.passengers.selectedSeat].mood;
      render();
    });
  });
}

function loadWorkflowUrl() {
  const savedEndpoint = localStorage.getItem("riddle-demo-workflow-url") || DEFAULT_WORKFLOW_ENDPOINT;
  const endpoint = normalizeWorkflowEndpoint(savedEndpoint);
  els.workflowUrl.value = endpoint;
  localStorage.setItem("riddle-demo-workflow-url", endpoint);
}

function saveWorkflowUrl() {
  const rawEndpoint = els.workflowUrl.value.trim() || DEFAULT_WORKFLOW_ENDPOINT;
  const endpoint = normalizeWorkflowEndpoint(rawEndpoint);
  els.workflowUrl.value = endpoint;
  localStorage.setItem("riddle-demo-workflow-url", endpoint);
  state.ui.alert =
    endpoint === rawEndpoint ? "Workflow 代理已保存" : "已切换为安全代理地址";
  render();
}

function normalizeWorkflowEndpoint(endpoint) {
  if (!endpoint || isDirectCozeEndpoint(endpoint)) {
    return DEFAULT_WORKFLOW_ENDPOINT;
  }

  return endpoint;
}

function isDirectCozeEndpoint(endpoint) {
  return /(^https?:\/\/.*\.coze\.site\/run)|(^https?:\/\/api\.coze\.)/i.test(endpoint);
}

function nextScenario() {
  const nextIndex = (state.scenarioIndex + 1) % SCENARIOS.length;
  applyScenario(nextIndex, true);
}

function applyScenario(index, announce) {
  const scenario = SCENARIOS[index];
  state.scenarioIndex = index;
  state.car.speed = scenario.speed;
  state.car.destination = scenario.destination;
  state.car.environment = scenario.environment;
  state.passengers.relationship = scenario.relationship;
  state.game.currentRiddleIndex = scenario.riddleIndex;
  state.game.status = "idle";
  state.game.questionCount = 0;
  state.ui.showAnswer = false;
  state.ui.cabinMode = "normal";
  state.ui.alert = announce ? "已切换下一条模拟数据" : "";
  state.host.text = announce
    ? `模拟数据已切换：${scenario.environment}，目的地${scenario.destination}。`
    : DEFAULT_STATE.host.text;
  Object.values(state.passengers.seats).forEach((seat) => {
    seat.mood = "普通";
    seat.bubble = "";
  });
  render();
}

function getCurrentRiddle() {
  return RIDDLES[state.game.currentRiddleIndex];
}

async function startGame() {
  state.game.status = "opening";
  state.ui.showAnswer = false;
  state.host.text = "各位侦探请就位，我要开始出题了。";
  render();
  await dispatchWorkflow("event", { type: "start_game" });
}

async function sendQuestion() {
  const text = els.playerInput.value.trim();
  if (!text) {
    state.ui.alert = "请输入提问或答案";
    render();
    return;
  }

  if (state.game.status === "paused") {
    state.host.text = "游戏还在暂停中，先恢复再继续问。";
    render();
    return;
  }

  const seat = state.passengers.selectedSeat;
  state.passengers.seats[seat].bubble = text;
  state.host.targetSeat = seat;
  state.game.status = state.game.status === "idle" ? "playing" : state.game.status;
  state.game.questionCount += 1;
  els.playerInput.value = "";
  state.host.text = "收到，我来判断一下这个问题。";
  render();

  await dispatchWorkflow("chat", null, text);
}

function setSpeed(speed) {
  state.car.speed = speed;
  if (speed >= 100) {
    state.ui.alert = "高速安全模式：减少主驾互动";
    state.host.targetSeat = "front";
  }
  dispatchWorkflow("event", { type: "speed_change", value: speed });
  render();
}

function setDestination(destination) {
  state.car.destination = destination;
  dispatchWorkflow("event", { type: "destination_change", value: destination });
  render();
}

function setEnvironment(environment) {
  state.car.environment = environment;
  const matchedIndex = findRiddleForEnvironment(environment);
  if (state.game.status === "idle") {
    state.game.currentRiddleIndex = matchedIndex;
  }
  state.ui.alert = `${environment} 已同步到座舱`;
  render();
}

function findRiddleForEnvironment(environment) {
  if (environment.includes("雨")) return 0;
  if (environment.includes("雪")) return 5;
  if (environment.includes("城区")) return 6;
  if (environment.includes("风景区")) return 9;
  if (environment.includes("高速")) return 1;
  return state.game.currentRiddleIndex;
}

function applyImmediateSafetyPause() {
  state.game.status = "paused";
  state.ui.cabinMode = "safety_pause";
  state.ui.alert = "急刹车：游戏已暂停";
  state.host.text = "大家坐稳，游戏先暂停。";
  render();
}

async function dispatchWorkflow(triggerType, event, playerInput = "") {
  const input = buildWorkflowInput(triggerType, event, playerInput);
  let output;

  try {
    output = await requestWorkflow(input);
  } catch (error) {
    output = localDecision(input, error);
  }

  applyWorkflowOutput(output, input);
  render();
}

function buildWorkflowInput(triggerType, event, playerInput) {
  const selectedSeat = state.passengers.selectedSeat;
  return {
    trigger_type: triggerType,
    plugin_id: state.plugin,
    car: {
      speed: state.car.speed,
      destination: state.car.destination,
      environment: state.car.environment,
    },
    passengers: {
      relationship: state.passengers.relationship,
      selected_seat: selectedSeat,
      selected_seat_label: SEATS[selectedSeat],
      states: {
        driver: state.passengers.seats.driver.mood,
        front: state.passengers.seats.front.mood,
        rear_left: state.passengers.seats.rearLeft.mood,
        rear_right: state.passengers.seats.rearRight.mood,
      },
    },
    game: {
      status: state.game.status,
      round_index: state.game.roundIndex,
      total_rounds: state.game.totalRounds,
      question_count: state.game.questionCount,
      max_questions: state.game.maxQuestions,
      current_answer: getCurrentRiddle().answer,
      current_theme: getCurrentRiddle().theme,
      hint: getCurrentRiddle().hint,
    },
    player_seat: SEATS[selectedSeat],
    player_input: playerInput,
    event,
  };
}

async function requestWorkflow(input) {
  const endpoint = normalizeWorkflowEndpoint(els.workflowUrl.value.trim());
  els.workflowUrl.value = endpoint;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input_payload: JSON.stringify(input),
    }),
  });

  if (!response.ok) {
    throw new Error(`Workflow request failed: ${response.status}`);
  }

  const payload = await response.json();
  return normalizeWorkflowPayload(payload);
}

function normalizeWorkflowPayload(payload) {
  const candidates = [
    payload?.workflow_output,
    payload?.data?.workflow_output,
    payload,
    payload.data,
    payload.output,
    payload.result,
    payload?.data?.output,
    payload?.data?.result,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      try {
        return JSON.parse(candidate);
      } catch {
        continue;
      }
    }
    if (typeof candidate === "object" && candidate.ai_reply_text) {
      return candidate;
    }
  }

  return {
    ai_reply_text: "我收到了工作流返回，但格式还需要对齐一下。",
    game_status: state.game.status,
    is_correct: false,
    answer: getCurrentRiddle().answer,
    ui_change: {
      cabin_mode: "normal",
      host_emotion: "thinking",
      animation: "speak",
      show_answer: false,
    },
  };
}

function localDecision(input, error) {
  const riddle = getCurrentRiddle();
  const eventType = input.event?.type;
  const selectedSeat = input.passengers.selected_seat;
  const selectedSeatLabel = input.passengers.selected_seat_label;

  if (eventType === "start_game") {
    return {
      ai_reply_text: `${riddle.opening} 你们有 15 个问题，答案先藏好。`,
      game_status: "playing",
      is_correct: false,
      answer: riddle.answer,
      ui_change: {
        cabin_mode: "normal",
        target_seat: selectedSeat,
        host_emotion: "confident",
        animation: "speak",
        show_answer: false,
      },
    };
  }

  if (eventType === "hard_brake") {
    return {
      ai_reply_text: "大家坐稳，游戏先暂停 30 秒。主驾专心看路，安全第一。",
      game_status: "paused",
      is_correct: false,
      answer: riddle.answer,
      ui_change: {
        cabin_mode: "safety_pause",
        target_seat: "all",
        host_emotion: "serious",
        animation: "pause",
        show_answer: false,
      },
    };
  }

  if (eventType === "resume_game") {
    return {
      ai_reply_text: "状态稳定，悬案继续。刚才的问题不算浪费，我们接着查。",
      game_status: "playing",
      is_correct: false,
      answer: riddle.answer,
      ui_change: {
        cabin_mode: "normal",
        target_seat: selectedSeat,
        host_emotion: "normal",
        animation: "speak",
        show_answer: false,
      },
    };
  }

  if (eventType === "driver_tired") {
    return {
      ai_reply_text: "主驾先专心看路，接下来的 3 个问题交给副驾和后排。我会把节奏放轻一点。",
      game_status: input.game.status === "idle" ? "idle" : "playing",
      is_correct: false,
      answer: riddle.answer,
      ui_change: {
        cabin_mode: "driver_focus",
        target_seat: "front",
        host_emotion: "care",
        animation: "cue",
        show_answer: false,
      },
    };
  }

  if (eventType === "passenger_sleep") {
    return {
      ai_reply_text: `${selectedSeatLabel}像是有点困了，我们把音量和节奏放轻，先不 cue TA。`,
      game_status: input.game.status,
      is_correct: false,
      answer: riddle.answer,
      ui_change: {
        cabin_mode: "soft",
        target_seat: selectedSeat,
        host_emotion: "care",
        animation: "soft",
        show_answer: false,
      },
    };
  }

  if (eventType === "near_destination") {
    return {
      ai_reply_text: "前方快到目的地，进入绝杀局！这一题猜中，直接封神。",
      game_status: input.game.status === "idle" ? "playing" : input.game.status,
      is_correct: false,
      answer: riddle.answer,
      ui_change: {
        cabin_mode: "final_round",
        target_seat: "all",
        host_emotion: "excited",
        animation: "final",
        show_answer: false,
      },
    };
  }

  if (eventType === "environment_change") {
    const index = findRiddleForEnvironment(input.car.environment);
    const next = RIDDLES[index];
    return {
      ai_reply_text: `环境已更新为${input.car.environment}。下一题我会更贴近窗外，比如“${next.theme}”方向。`,
      game_status: input.game.status,
      is_correct: false,
      answer: riddle.answer,
      next_answer: next.answer,
      ui_change: {
        cabin_mode: "environment_sync",
        target_seat: "all",
        host_emotion: "observing",
        animation: "scene_change",
        show_answer: false,
      },
    };
  }

  if (eventType === "speed_change" && input.car.speed >= 100) {
    return {
      ai_reply_text: "车速已经上来了，主驾先退出答题席，副驾和后排接管本轮提问。",
      game_status: input.game.status,
      is_correct: false,
      answer: riddle.answer,
      ui_change: {
        cabin_mode: "driver_focus",
        target_seat: "front",
        host_emotion: "serious",
        animation: "cue",
        show_answer: false,
      },
    };
  }

  if (input.trigger_type === "chat") {
    const guess = input.player_input.trim();
    const isCorrect = guess.includes(riddle.answer);
    const reachedLimit = input.game.question_count >= input.game.max_questions;

    if (isCorrect) {
      return {
        ai_reply_text: `${selectedSeatLabel}真聪明，答案就是“${riddle.answer}”。本局 MVP 已经出现！`,
        game_status: "victory",
        is_correct: true,
        answer: riddle.answer,
        ui_change: {
          cabin_mode: "victory",
          target_seat: selectedSeat,
          host_emotion: "excited",
          animation: "victory",
          show_answer: true,
        },
      };
    }

    if (reachedLimit) {
      return {
        ai_reply_text: `15 个问题用完，谜底揭晓：${riddle.answer}。这题确实有点狡猾。`,
        game_status: "failed",
        is_correct: false,
        answer: riddle.answer,
        ui_change: {
          cabin_mode: "reveal",
          target_seat: "all",
          host_emotion: "comfort",
          animation: "reveal",
          show_answer: true,
        },
      };
    }

    return {
      ai_reply_text: makeLocalAnswer(input.player_input, riddle),
      game_status: "playing",
      is_correct: false,
      answer: riddle.answer,
      ui_change: {
        cabin_mode: "normal",
        target_seat: selectedSeat,
        host_emotion: "thinking",
        animation: "answer",
        show_answer: false,
      },
      debug_fallback_reason: error?.message || "",
    };
  }

  return {
    ai_reply_text: "状态已更新，我会根据新的座舱信息调整主持节奏。",
    game_status: input.game.status,
    is_correct: false,
    answer: riddle.answer,
    ui_change: {
      cabin_mode: "normal",
      target_seat: selectedSeat,
      host_emotion: "normal",
      animation: "speak",
      show_answer: false,
    },
  };
}

function makeLocalAnswer(playerInput, riddle) {
  const text = playerInput.toLowerCase();
  if (text.includes("活") || text.includes("生命")) {
    return "不是，它没有生命。这个问题很关键，类别已经缩小了。";
  }
  if (text.includes("车") || text.includes("驾驶")) {
    const yes = ["安全带", "方向盘", "红绿灯"].includes(riddle.answer);
    return yes ? "是，和出行或驾驶场景关系很近。" : "不算是车本身的东西，但可能会出现在旅途中。";
  }
  if (text.includes("吃") || text.includes("食物")) {
    return riddle.answer === "火锅" ? "是，而且越多人一起越香。" : "不是食物，先把餐桌方向收一收。";
  }
  if (text.includes("水") || text.includes("雨")) {
    return riddle.answer === "雨伞" ? "非常接近，确实和雨天有关。" : "这一题不主要靠水，但你这个方向有观察力。";
  }
  return "不是直接命中，但这个问题有价值。继续缩小范围，答案已经不远了。";
}

function applyWorkflowOutput(output, input) {
  const uiChange = output.ui_change || {};
  applyPassengerAction(output.passenger_action);
  state.host.text = output.ai_reply_text || state.host.text;
  state.game.status = output.game_status || state.game.status;
  state.ui.cabinMode = uiChange.cabin_mode || state.ui.cabinMode || "normal";
  state.ui.animation = uiChange.animation || "speak";
  state.ui.showAnswer = Boolean(uiChange.show_answer || output.is_correct);
  state.host.emotion = uiChange.host_emotion || state.host.emotion;
  state.host.targetSeat = normalizeTargetSeat(uiChange.target_seat) || state.host.targetSeat;

  if (output.next_answer) {
    const nextIndex = RIDDLES.findIndex((riddle) => riddle.answer === output.next_answer);
    if (nextIndex >= 0 && state.game.status === "idle") {
      state.game.currentRiddleIndex = nextIndex;
    }
  }

  if (output.is_correct) {
    state.ui.cabinMode = "victory";
    state.ui.showAnswer = true;
  }

  state.game.history.push({
    at: new Date().toISOString(),
    input,
    output,
  });
}

function applyPassengerAction(passengerAction) {
  if (!passengerAction || !passengerAction.seat || !passengerAction.text) {
    return;
  }

  const seat = normalizeTargetSeat(passengerAction.seat) || passengerAction.seat;
  if (!state.passengers.seats[seat]) {
    return;
  }

  state.passengers.seats[seat].bubble = passengerAction.text;
  if (passengerAction.mood && ["普通", "大笑", "沉默", "睡着"].includes(passengerAction.mood)) {
    state.passengers.seats[seat].mood = passengerAction.mood;
  }
  state.host.targetSeat = seat;
}

function normalizeTargetSeat(seat) {
  const map = {
    主驾: "driver",
    副驾: "front",
    左后: "rearLeft",
    后排左: "rearLeft",
    右后: "rearRight",
    后排右: "rearRight",
    driver: "driver",
    front: "front",
    rearLeft: "rearLeft",
    rear_left: "rearLeft",
    rearRight: "rearRight",
    rear_right: "rearRight",
    all: null,
  };
  return map[seat] || null;
}

function render() {
  const riddle = getCurrentRiddle();
  document.body.classList.toggle("is-paused", state.game.status === "paused");
  document.body.classList.toggle("is-victory", state.game.status === "victory");

  els.environmentBackdrop.className = `environment-backdrop ${
    ENVIRONMENT_CLASS[state.car.environment] || "env-highway-day"
  }`;
  els.environmentLabel.textContent = state.car.environment;
  els.speedLabel.textContent = `${state.car.speed} km/h`;
  els.destinationLabel.textContent = `目的地：${state.car.destination}`;

  els.cabinAlert.textContent = state.ui.alert || getCabinModeText();
  els.cabinAlert.classList.toggle("active", Boolean(state.ui.alert || state.ui.cabinMode !== "normal"));

  els.roundProgress.textContent = `${state.game.roundIndex}/${state.game.totalRounds}`;
  els.questionProgress.textContent = `${state.game.questionCount}/${state.game.maxQuestions}`;
  els.gameStatus.textContent = getGameStatusText();
  els.stageLabel.textContent = getStageLabel();
  els.riddleTitle.textContent = state.ui.showAnswer ? riddle.answer : "谜底隐藏中";
  els.riddleHint.textContent = riddle.hint;
  els.answerReveal.textContent = `谜底：${riddle.answer}`;
  els.answerReveal.classList.toggle("visible", state.ui.showAnswer);
  els.hostBubble.textContent = state.host.text;

  renderSeats();
  renderControls();
}

function renderSeats() {
  els.seats.forEach((seatButton) => {
    const seat = seatButton.dataset.seat;
    const seatState = state.passengers.seats[seat];
    const bubble = seatButton.querySelector("[data-bubble]");
    const avatar = seatButton.querySelector("[data-avatar]");
    const status = seatButton.querySelector("[data-seat-status]");

    seatButton.classList.toggle("selected", state.passengers.selectedSeat === seat);
    seatButton.classList.toggle("cued", state.host.targetSeat === seat);
    seatButton.classList.toggle("sleeping", seatState.mood === "睡着");
    seatButton.classList.toggle("seat-laughing", seatState.mood === "大笑");

    bubble.textContent = seatState.bubble;
    bubble.classList.toggle("visible", Boolean(seatState.bubble));
    status.textContent = seatState.mood;

    avatar.className = "avatar";
    if (state.passengers.relationship === "年轻朋友") avatar.classList.add("friends");
    if (state.passengers.relationship === "中老年+儿女") avatar.classList.add("elder");
    if (seatState.mood === "大笑") avatar.classList.add("laugh");
    if (seatState.mood === "沉默") avatar.classList.add("quiet");
    if (seatState.mood === "睡着") avatar.classList.add("sleep");
  });
}

function renderControls() {
  els.speedInput.value = state.car.speed;
  els.destinationInput.value = state.car.destination;
  els.seatSelect.value = state.passengers.selectedSeat;
  els.emotionSelect.value = state.passengers.seats[state.passengers.selectedSeat].mood;

  setActive(els.speedChips, "speed", String(state.car.speed));
  setActive(els.destinationChips, "destination", state.car.destination);
  setActive(els.relationshipChips, "relationship", state.passengers.relationship);
  setActive(els.environmentChips, "environment", state.car.environment);
}

function setActive(buttons, key, value) {
  buttons.forEach((button) => {
    button.classList.toggle("active", button.dataset[key] === value);
  });
}

function getGameStatusText() {
  const statusText = {
    idle: "待开局",
    opening: "开场",
    playing: "进行中",
    paused: "已暂停",
    victory: "猜对",
    failed: "揭晓",
  };
  return statusText[state.game.status] || "进行中";
}

function getStageLabel() {
  if (state.game.status === "victory") return "谜底揭晓";
  if (state.game.status === "paused") return "安全暂停";
  if (state.game.status === "failed") return "本轮结束";
  if (state.game.questionCount > 0) return "AI 回答";
  return "AI 开场";
}

function getCabinModeText() {
  const modeText = {
    safety_pause: "安全暂停中",
    driver_focus: "主驾专注模式",
    soft: "轻声互动模式",
    final_round: "绝杀局",
    environment_sync: "环境已融合",
    victory: "胜利氛围",
    reveal: "谜底揭晓",
  };
  return modeText[state.ui.cabinMode] || "游戏进行中";
}

boot();
