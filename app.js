const SEATS = {
  driver: "主驾",
  front: "副驾",
  rearLeft: "左后",
  rearRight: "右后",
};

const DEFAULT_WORKFLOW_ENDPOINT = "/api/workflow";
const STAGE_WIDTH = 1920;
const STAGE_HEIGHT = 1080;

const PASSENGER_ACTIVITY_LABELS = {
  idle: "",
  thinking: "思考中",
  asking: "提问中",
  answering: "作答中",
  listening: "倾听中",
  celebrating: "庆祝中",
  acting: "互动中",
};

const STRATEGY_LABELS = {
  S00: "快速问答",
  S01: "安全接管",
  S03: "主驾专注",
  S04: "轻声继续",
  S06: "游戏启动",
  S07: "环境融合",
  S09: "目的地收束",
  S12: "小朋友互动",
  S14: "胜利反馈",
  S17: "接近答案",
  S18: "卡题提示",
  S20: "玩梗接住",
  S21: "参与感照顾",
};

const LOCAL_TRACE_EVENT_TYPES = new Set([
  "hard_brake",
  "resume_game",
  "driver_tired",
  "passenger_sleep",
  "near_destination",
]);

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

const GOLDEN_TIMELINES = [
  {
    id: "family_highway_disney",
    name: "高速亲子出行",
    speed: 80,
    destination: "迪士尼",
    relationship: "父母+小孩",
    environment: "高速路晴天白天",
    riddleIndex: 1,
    trace: {
      perception: "载入高速亲子出行场景",
      decision: "默认副驾为真实用户，后排小朋友可自动加入",
      execution: "设置高速晴天、目的地迪士尼、谜底安全带",
      strategyId: "V1.2-A",
      priority: "P3",
    },
    steps: [
      {
        delay: 0,
        label: "初始化高速亲子出行",
        run: () => applyGoldenLineDefaults(),
      },
      {
        delay: 1500,
        label: "AI 主持开局",
        run: () => startGame(),
      },
      {
        delay: 9000,
        label: "后排小朋友尝试提问",
        run: () => runScriptedQuestion("rearRight", "它是不是像超人一样保护我们？"),
      },
      {
        delay: 15000,
        label: "副驾真实用户接手",
        run: () => cueRealUser("副驾，这一问交给你。可以从安全、车内物品这些方向试试。"),
      },
      {
        delay: 18000,
        label: "车速升至高速阈值",
        run: () => runScriptedSpeed(100),
      },
      {
        delay: 22000,
        label: "检测到主驾疲惫",
        run: () => runScriptedEvent("driver_tired", "主驾疲惫"),
      },
      {
        delay: 30000,
        label: "突发急刹打断",
        run: () => runScriptedEvent("hard_brake", "急刹打断"),
      },
      {
        delay: 42000,
        label: "检测到后排左长时间未参与",
        run: () => runScriptedEvent("passenger_inactive", "后排左长时间未参与", "rearLeft"),
      },
      {
        delay: 52000,
        label: "小朋友继续跳脱提问",
        run: () => runScriptedQuestion("rearRight", "它是不是每个人坐车都要用？"),
      },
      {
        delay: 65000,
        label: "等待副驾猜答案",
        run: () => cueRealUser("线索已经很近了，副驾可以直接猜答案。"),
      },
    ],
  },
  {
    id: "rainy_city_hotpot_friends",
    name: "雨天朋友聚会",
    speed: 50,
    destination: "火锅店",
    relationship: "年轻朋友",
    environment: "城区晴天白天",
    riddleIndex: 0,
    trace: {
      perception: "载入雨天朋友聚会场景",
      decision: "朋友局采用轻松玩梗风格，副驾仍为真实用户",
      execution: "设置城区出行、目的地火锅店、谜底雨伞",
      strategyId: "V1.2-B",
      priority: "P3",
    },
    steps: [
      {
        delay: 0,
        label: "初始化雨天朋友聚会",
        run: () => applyGoldenLineDefaults(),
      },
      {
        delay: 1500,
        label: "AI 主持开局",
        run: () => startGame(),
      },
      {
        delay: 9000,
        label: "后排朋友玩梗",
        run: () => runScriptedQuestion("rearLeft", "它是不是火锅店门口最容易被忘的东西？"),
      },
      {
        delay: 17000,
        label: "天气切换为雨天",
        run: () => runScriptedEnvironment("城区雨天白天"),
      },
      {
        delay: 24000,
        label: "检测到舱内持续大笑",
        run: () => runScriptedEvent("cabin_laughing", "舱内持续大笑", "rearLeft"),
      },
      {
        delay: 32000,
        label: "多轮提问仍无进展",
        run: () => runScriptedEvent("game_stuck", "游戏卡住"),
      },
      {
        delay: 40000,
        label: "副驾真实用户推进",
        run: () => cueRealUser("雨已经下起来了，副驾可以顺着天气继续问。"),
      },
    ],
  },
  {
    id: "scenic_snow_family",
    name: "风景区雪景家庭",
    speed: 50,
    destination: "草原",
    relationship: "中老年+儿女",
    environment: "风景区雪景白天",
    riddleIndex: 5,
    trace: {
      perception: "载入风景区雪景家庭场景",
      decision: "用更稳重的语气主持，并避免打扰睡着乘客",
      execution: "设置雪景环境、家庭乘客、谜底雪人",
      strategyId: "V1.2-C",
      priority: "P3",
    },
    steps: [
      {
        delay: 0,
        label: "初始化风景区雪景家庭",
        run: () => applyGoldenLineDefaults(),
      },
      {
        delay: 1500,
        label: "AI 主持开局",
        run: () => startGame(),
      },
      {
        delay: 9000,
        label: "后排家人稳健提问",
        run: () => runScriptedQuestion("rearLeft", "它是不是和雪景有关？"),
      },
      {
        delay: 17000,
        label: "检测到后排右睡着",
        run: () => runScriptedEvent("passenger_sleep", "有人睡着", "rearRight"),
      },
      {
        delay: 25000,
        label: "玩家已经接近答案",
        run: () => runScriptedEvent("near_answer", "接近答案"),
      },
      {
        delay: 32000,
        label: "快到目的地",
        run: () => runScriptedEvent("near_destination", "快到目的地"),
      },
      {
        delay: 40000,
        label: "副驾真实用户收尾",
        run: () => cueRealUser("快到目的地了，副驾来决定这一题要不要直接猜。"),
      },
    ],
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
      driver: { mood: "普通", activity: "idle", activityLabel: "", bubble: "" },
      front: { mood: "普通", activity: "idle", activityLabel: "", bubble: "" },
      rearLeft: { mood: "普通", activity: "idle", activityLabel: "", bubble: "" },
      rearRight: { mood: "普通", activity: "idle", activityLabel: "", bubble: "" },
    },
  },
  perception: {
    driverState: "normal",
    gameProgress: "normal",
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
    correctSeat: null,
    alert: "",
  },
  timeline: {
    id: GOLDEN_TIMELINES[0].id,
    name: GOLDEN_TIMELINES[0].name,
    status: "idle",
    runId: 0,
    startedAt: 0,
    elapsedSeconds: 0,
    currentEvent: "准备好后点击开始模拟，系统会按时间轴触发座舱事件。",
  },
  decisionTrace: {
    perception: "等待座舱事件",
    decision: "等待 Workflow 判断",
    execution: "等待网页动作",
    strategyId: "",
    priority: "",
  },
  workflow: {
    inFlight: false,
    activeRequestId: 0,
    activeLabel: "",
    activeController: null,
    lastResumeAt: 0,
    lastPassengerActionKey: "",
    bubbleTimer: null,
    recoveryTimer: null,
    activityTimer: null,
    pendingChats: [],
  },
};

const state = structuredClone(DEFAULT_STATE);
const els = {};
let audioContext = null;

function boot() {
  cacheElements();
  bindEvents();
  resizeStage();
  loadWorkflowUrl();
  applyGoldenLineDefaults(getActiveGoldenLine(), false);
  render();
}

function cacheElements() {
  [
    "environmentBackdrop",
    "appShell",
    "environmentLabel",
    "speedLabel",
    "destinationLabel",
    "roundProgress",
    "questionProgress",
    "stageLabel",
    "riddleTitle",
    "riddleHint",
    "answerReveal",
    "hostBubble",
    "hostAvatar",
    "timelineName",
    "startTimeline",
    "pauseTimeline",
    "prestartPanel",
    "decisionPerception",
    "decisionDecision",
    "decisionExecution",
    "workflowUrl",
    "switchScenario",
    "resetScenario",
    "playerInput",
    "sendQuestion",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });

  els.speedChips = document.querySelectorAll("[data-speed]");
  els.environmentChips = document.querySelectorAll("[data-environment]");
  els.eventButtons = document.querySelectorAll("[data-event]");
  els.seats = document.querySelectorAll("[data-seat]");
}

function bindEvents() {
  window.addEventListener("resize", resizeStage);
  document.addEventListener("pointerdown", prepareAudioContext, { once: true });
  els.switchScenario.addEventListener("click", nextGoldenLine);
  els.resetScenario.addEventListener("click", resetCurrentGoldenLine);
  els.startTimeline.addEventListener("click", startGoldenTimeline);
  els.pauseTimeline.addEventListener("click", toggleTimelinePause);
  els.sendQuestion.addEventListener("click", sendQuestion);
  els.playerInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      sendQuestion();
    }
  });

  els.speedChips.forEach((button) => {
    button.addEventListener("click", () => setSpeed(Number(button.dataset.speed)));
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
    button.addEventListener("click", async () => {
      const type = button.dataset.event;
      if (type !== "hard_brake" && state.workflow.inFlight) {
        state.ui.alert = "AI 正在处理上一条信息，请稍等";
        render();
        return;
      }
      if (type === "hard_brake") {
        applyImmediateSafetyPause();
      }
      const eventSeat = type === "passenger_sleep" ? "rearRight" : state.passengers.selectedSeat;
      if (type === "passenger_sleep") {
        applyImmediatePassengerSleep(eventSeat);
      }
      if (type === "driver_tired") {
        applyImmediateDriverTired();
      }
      if (type === "near_destination") {
        applyImmediateNearDestination();
      }
      scheduleEventRecovery(type);
      await dispatchWorkflow("event", { type, seat: eventSeat });
      scheduleEventRecovery(type);
    });
  });
}

function resizeStage() {
  const widthScale = window.innerWidth / STAGE_WIDTH;
  const heightScale = window.innerHeight / STAGE_HEIGHT;
  const scale = Math.min(widthScale, heightScale);
  if (els.appShell) {
    const top = Math.round((window.innerHeight - STAGE_HEIGHT * scale) / 2);
    const left = Math.round((window.innerWidth - STAGE_WIDTH * scale) / 2);
    els.appShell.style.transform = `scale(${scale})`;
    els.appShell.style.top = `${top}px`;
    els.appShell.style.left = `${left}px`;
  }
}

function loadWorkflowUrl() {
  const savedEndpoint = localStorage.getItem("riddle-demo-workflow-url") || DEFAULT_WORKFLOW_ENDPOINT;
  const endpoint = normalizeWorkflowEndpoint(savedEndpoint);
  els.workflowUrl.value = endpoint;
  localStorage.setItem("riddle-demo-workflow-url", endpoint);
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

function getActiveGoldenLine() {
  return GOLDEN_TIMELINES[state.scenarioIndex] || GOLDEN_TIMELINES[0];
}

function nextGoldenLine() {
  stopTimeline("已切换黄金体验线");
  const nextIndex = (state.scenarioIndex + 1) % GOLDEN_TIMELINES.length;
  applyGoldenLineDefaults(GOLDEN_TIMELINES[nextIndex], true);
  render();
}

function resetCurrentGoldenLine() {
  stopTimeline("已重置当前模拟");
  applyGoldenLineDefaults(getActiveGoldenLine(), true);
  render();
}

async function startGoldenTimeline() {
  if (state.timeline.status === "running") {
    state.ui.alert = "模拟正在进行中";
    render();
    return;
  }

  const runId = state.timeline.runId + 1;
  const timeline = getActiveGoldenLine();
  state.timeline.runId = runId;
  state.timeline.id = timeline.id;
  state.timeline.name = timeline.name;
  state.timeline.status = "running";
  state.timeline.startedAt = Date.now();
  state.timeline.elapsedSeconds = 0;
  state.timeline.currentEvent = `${timeline.name}启动中`;
  applyGoldenLineDefaults(timeline, false);
  render();

  let previousDelay = 0;
  for (const step of timeline.steps) {
    if (state.timeline.runId !== runId) return;
    await sleep(Math.max(0, step.delay - previousDelay));
    previousDelay = step.delay;
    await waitWhileTimelinePaused(runId);
    if (state.timeline.runId !== runId) return;
    await waitForWorkflowIdle(runId);
    if (state.timeline.runId !== runId) return;
    state.timeline.elapsedSeconds = Math.round((Date.now() - state.timeline.startedAt) / 1000);
    state.timeline.currentEvent = step.label;
    render();
    await step.run();
  }

  if (state.timeline.runId === runId) {
    state.timeline.status = "finished";
    state.timeline.currentEvent = `${timeline.name}已完成`;
    state.ui.alert = "模拟完成";
    render();
  }
}

function toggleTimelinePause() {
  if (state.timeline.status === "running") {
    state.timeline.status = "paused";
    state.timeline.currentEvent = "模拟已暂停";
    state.ui.alert = "模拟已暂停";
  } else if (state.timeline.status === "paused") {
    state.timeline.status = "running";
    state.timeline.currentEvent = "模拟继续";
    state.ui.alert = "模拟继续";
  } else if (state.game.status !== "idle") {
    state.ui.alert = state.game.status === "victory" ? "本局已完成，可点击重置模拟重新开始" : "当前没有正在运行的自动时间轴";
  } else {
    state.ui.alert = "请先点击开始模拟";
  }
  render();
}

function stopTimeline(message) {
  if (state.timeline.status === "running" || state.timeline.status === "paused") {
    state.timeline.runId += 1;
  }
  state.timeline.status = "idle";
  state.timeline.elapsedSeconds = 0;
  state.timeline.currentEvent =
    message || "准备好后点击开始模拟，系统会按时间轴触发座舱事件。";
}

function finishTimelineSilently() {
  if (state.timeline.status === "running" || state.timeline.status === "paused") {
    state.timeline.runId += 1;
  }
  state.timeline.status = "finished";
  state.timeline.currentEvent = `${state.timeline.name}已完成`;
}

function applyGoldenLineDefaults(timeline = getActiveGoldenLine(), announce = false) {
  if (state.workflow.activityTimer) {
    clearTimeout(state.workflow.activityTimer);
    state.workflow.activityTimer = null;
  }
  const index = GOLDEN_TIMELINES.findIndex((item) => item.id === timeline.id);
  state.scenarioIndex = index >= 0 ? index : 0;
  state.timeline.id = timeline.id;
  state.timeline.name = timeline.name;
  state.car.speed = timeline.speed;
  state.car.destination = timeline.destination;
  state.car.environment = timeline.environment;
  state.passengers.relationship = timeline.relationship;
  state.passengers.selectedSeat = "front";
  state.game.currentRiddleIndex = timeline.riddleIndex;
  state.game.status = "idle";
  state.game.questionCount = 0;
  state.game.history = [];
  state.ui.showAnswer = false;
  state.ui.correctSeat = null;
  state.ui.cabinMode = "normal";
  state.ui.alert = announce ? `已切换至${timeline.name}` : "";
  state.host.text = getPrestartHostText(timeline);
  state.host.targetSeat = "front";
  state.workflow.lastPassengerActionKey = "";
  state.perception.driverState = "normal";
  state.perception.gameProgress = "normal";
  clearPassengerBubbles();
  Object.values(state.passengers.seats).forEach((seat) => {
    seat.mood = "普通";
    seat.activity = "idle";
    seat.activityLabel = "";
  });
  updateDecisionTrace(timeline.trace);
}

function getPrestartHostText(timeline) {
  const sceneLead = {
    family_highway_disney: "各位大小侦探，去迪士尼的路上要不要先玩一局猜谜？",
    rainy_city_hotpot_friends: "朋友局已就位，去火锅店的路上来一局轻松猜谜吧。",
    scenic_snow_family: "窗外雪景正好适合开一局猜谜，大家一起动动脑。",
  };
  const lead = sceneLead[timeline.id] || "大家好，欢迎来到车内 AI 猜谜。";
  return `${lead} 规则很简单：我藏一个谜底，大家轮流问“是/否”问题，15 问内猜出来就算赢。我来当主持人，准备好了我们就开始。`;
}

async function runScriptedQuestion(seat, text) {
  if (seat === "front") {
    cueRealUser(text);
    return;
  }
  if (state.game.status === "paused") return;
  state.passengers.selectedSeat = seat;
  clearPassengerBubbles(seat);
  state.passengers.seats[seat].bubble = text;
  scheduleBubbleClear();
  state.host.targetSeat = seat;
  state.game.status = state.game.status === "idle" ? "playing" : state.game.status;
  state.game.questionCount += 1;
  state.host.text = `${SEATS[seat]}发起了一问，我来判断。`;
  state.ui.alert = `${SEATS[seat]}：${text}`;
  updateDecisionTrace({
    perception: `${SEATS[seat]}参与提问`,
    decision: seat === "rearRight" ? "允许后排小朋友短句参与" : "允许模拟乘客补充提问",
    execution: "显示乘客气泡，并交给 AI 主持人回答",
    strategyId: seat === "rearRight" ? "S12" : "S00",
    priority: "P3",
  });
  render();
  await dispatchWorkflow("chat", null, text);
  ensureScriptedVictory(seat, text);
  restoreRealUserSeat();
}

function cueRealUser(text) {
  state.passengers.selectedSeat = "front";
  state.host.targetSeat = "front";
  state.host.text = text;
  state.ui.alert = "";
  updateDecisionTrace({
    perception: "时间轴轮到副驾真实用户",
    decision: "不模拟副驾发言，等待真实用户输入",
    execution: "AI 主持人 cue 副驾，输入框保持可用",
    strategyId: "S00",
    priority: "P3",
  });
  clearPassengerBubbles();
  render();
}

function restoreRealUserSeat() {
  if (state.game.status === "victory") return;
  state.passengers.selectedSeat = "front";
  render();
}

function ensureScriptedVictory(seat, text) {
  const riddle = getCurrentRiddle();
  if (!text.includes(riddle.answer) || state.game.status === "victory") return;

  state.game.status = "victory";
  state.ui.cabinMode = "victory";
  state.ui.showAnswer = true;
  state.ui.correctSeat = seat;
  state.host.targetSeat = seat;
  state.host.emotion = "excited";
  state.host.text = `${SEATS[seat]}一锤定音，答案就是“${riddle.answer}”。本局 MVP 出现，安全感拉满！`;
  playVictorySound();
  updateDecisionTrace({
    perception: `${SEATS[seat]}猜中谜底`,
    decision: "进入胜利收尾，给足情绪价值",
    execution: "揭晓谜底并切换胜利氛围",
    strategyId: "S14",
    priority: "P3",
  });
  render();
}

async function runScriptedEvent(type, label, targetSeat = state.passengers.selectedSeat) {
  const seat = targetSeat;
  if (type === "hard_brake") {
    applyImmediateSafetyPause();
  }
  if (type === "driver_tired") {
    applyImmediateDriverTired();
  }
  if (type === "passenger_sleep") {
    applyImmediatePassengerSleep(seat);
  }
  if (type === "near_destination") {
    applyImmediateNearDestination();
  }
  if (type === "passenger_inactive") {
    state.ui.alert = `${SEATS[seat]}长时间未参与`;
  }
  if (type === "game_stuck" || type === "near_answer") {
    state.perception.gameProgress = type === "game_stuck" ? "stuck" : "near_answer";
  }
  if (type === "cabin_laughing") {
    state.passengers.seats[seat].mood = "大笑";
    state.passengers.seats[seat].activity = "celebrating";
  }
  if (type === "resume_game") {
    if (!canResumeGame()) return;
    state.game.status = "playing";
    state.ui.cabinMode = "normal";
    state.ui.alert = "正在确认安全状态";
    state.host.text = "收到，正在确认座舱状态，马上继续游戏。";
    clearPassengerBubbles();
    state.workflow.lastResumeAt = Date.now();
    updateDecisionTrace({
      perception: "安全风险解除",
      decision: "恢复猜谜，但保持轻节奏",
      execution: "游戏状态切回进行中",
      strategyId: "S01",
      priority: "P1",
    });
    render();
  }
  state.timeline.currentEvent = label;
  scheduleEventRecovery(type);
  await dispatchWorkflow("event", { type, seat });
  scheduleEventRecovery(type);
}

async function runScriptedSpeed(speed) {
  state.car.speed = speed;
  state.ui.alert = `车速已更新为 ${speed} km/h`;
  render();
  await dispatchWorkflow("event", { type: "speed_change", value: speed });
}

async function runScriptedEnvironment(environment) {
  setEnvironment(environment);
  updateDecisionTrace({
    perception: `车外环境切换为${environment}`,
    decision: "将环境变化融入当前谜题和主持话术",
    execution: "同步环境背景，并通知 Workflow 调整主持策略",
    strategyId: "S07",
    priority: "P2",
  });
  await dispatchWorkflow("event", { type: "environment_change", value: environment });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prepareAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  if (!audioContext) {
    audioContext = new AudioContextClass();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
}

function playVictorySound() {
  if (!audioContext || audioContext.state !== "running") return;

  const now = audioContext.currentTime;
  [523.25, 659.25, 783.99].forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const startAt = now + index * 0.1;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.22);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.24);
  });
}

async function waitWhileTimelinePaused(runId) {
  while (state.timeline.runId === runId && state.timeline.status === "paused") {
    await sleep(300);
  }
}

async function waitForWorkflowIdle(runId) {
  while (state.timeline.runId === runId && state.workflow.inFlight) {
    await sleep(300);
  }
}

function getCurrentRiddle() {
  return RIDDLES[state.game.currentRiddleIndex];
}

async function startGame() {
  if (!canStartWorkflowAction("AI 正在开场，请稍等")) return;
  if (!["idle", "victory", "failed"].includes(state.game.status)) {
    state.ui.alert = "本局已经开始，不需要重复开场";
    render();
    return;
  }
  clearPassengerBubbles();
  state.game.status = "opening";
  state.ui.showAnswer = false;
  state.ui.correctSeat = null;
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

  const seat = "front";
  state.passengers.selectedSeat = seat;
  clearPassengerBubbles(seat);
  state.passengers.seats[seat].bubble = text;
  scheduleBubbleClear();
  state.host.targetSeat = seat;
  state.game.status = state.game.status === "idle" ? "playing" : state.game.status;
  state.game.questionCount += 1;
  els.playerInput.value = "";
  state.host.text = "收到，我来判断一下这个问题。";
  if (state.workflow.inFlight) {
    state.workflow.pendingChats.push({ seat, text });
    state.host.text = "这条问题我先记下，等上一轮回答结束马上接上。";
    state.ui.alert = "玩家提问已加入队列";
    render();
    return;
  }
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
  abortActiveWorkflow();
  if (state.workflow.recoveryTimer) {
    clearTimeout(state.workflow.recoveryTimer);
    state.workflow.recoveryTimer = null;
  }
  state.game.status = "paused";
  state.ui.cabinMode = "safety_pause";
  state.ui.alert = "急刹车：游戏已暂停";
  state.host.text = "大家坐稳，游戏先暂停。";
  updateDecisionTrace({
    perception: "检测到急刹打断",
    decision: "安全优先，立即暂停游戏",
    execution: "切换安全暂停，停止乘客发言",
    strategyId: "S01",
    priority: "P0",
  });
  clearPassengerBubbles();
  render();
}

function scheduleEventRecovery(type) {
  if (type !== "hard_brake") {
    return;
  }

  if (state.workflow.recoveryTimer) {
    return;
  }

  state.workflow.recoveryTimer = setTimeout(() => {
    state.workflow.recoveryTimer = null;
    if (state.game.status !== "paused" || state.ui.cabinMode !== "safety_pause") return;
    state.game.status = "playing";
    state.ui.cabinMode = "normal";
    state.ui.alert = "安全状态恢复，游戏继续";
    state.host.text = "安全状态恢复，刚才的线索还在，我们继续。";
    updateDecisionTrace({
      perception: "急刹风险已解除",
      decision: "恢复猜谜并保留上下文",
      execution: "游戏状态自动恢复进行中",
      strategyId: "S01",
      priority: "P1",
    });
    render();
  }, 4500);
}

function applyImmediatePassengerSleep(seat) {
  state.passengers.seats[seat].mood = "睡着";
  state.ui.cabinMode = "soft";
  state.ui.alert = `${SEATS[seat]}已睡着，降低打扰`;
  state.host.targetSeat = seat;
  state.host.text = `${SEATS[seat]}好像睡着了，我们先不 cue TA，声音也放轻一点。`;
  updateDecisionTrace({
    perception: `检测到${SEATS[seat]}睡着`,
    decision: "轻声继续，并避免 cue 睡着乘客",
    execution: "切换轻声互动模式，排除该座位发言",
    strategyId: "S04",
    priority: "P2",
  });
  clearPassengerBubbles();
  render();
}

function applyImmediateDriverTired() {
  state.perception.driverState = "fatigued";
  state.ui.cabinMode = "driver_focus";
  state.ui.alert = "主驾疲惫：降低驾驶员互动";
  state.host.targetSeat = "front";
  state.host.text = "主驾先专心看路，接下来的问题交给副驾和后排。";
  updateDecisionTrace({
    perception: "检测到主驾疲惫",
    decision: "降低主驾互动，副驾和后排接管",
    execution: "切换主驾专注模式",
    strategyId: "S03",
    priority: "P1",
  });
  clearPassengerBubbles();
  render();
}

function applyImmediateNearDestination() {
  state.ui.cabinMode = "final_round";
  state.ui.alert = "快到目的地：准备收尾";
  state.host.targetSeat = null;
  state.host.text = "前方快到目的地，我们准备进入收尾局。";
  updateDecisionTrace({
    perception: "检测到快到目的地",
    decision: "收束游戏节奏，进入绝杀局",
    execution: "切换 final_round 状态",
    strategyId: "S09",
    priority: "P2",
  });
  clearPassengerBubbles();
  render();
}

async function dispatchWorkflow(triggerType, event, playerInput = "") {
  const eventType = event?.type;
  const isSafetyInterrupt = eventType === "hard_brake";
  if (state.workflow.inFlight && !isSafetyInterrupt) {
    state.ui.alert = "AI 正在处理上一条信息，请稍等";
    render();
    return;
  }

  if (isSafetyInterrupt) {
    abortActiveWorkflow();
  }

  const input = buildWorkflowInput(triggerType, event, playerInput);
  const requestId = beginWorkflowRequest(input);
  let output;

  try {
    output = await requestWorkflow(input, state.workflow.activeController.signal);
  } catch (error) {
    if (error?.name === "AbortError" || requestId !== state.workflow.activeRequestId) {
      return;
    }
    output = localDecision(input, error);
  }

  if (requestId !== state.workflow.activeRequestId) {
    return;
  }

  output = applyAnswerHitGuard(output, input);
  applyWorkflowOutput(output, input);
  endWorkflowRequest(requestId);
  render();
}

function beginWorkflowRequest(input) {
  const requestId = state.workflow.activeRequestId + 1;
  state.workflow.inFlight = true;
  state.workflow.activeRequestId = requestId;
  state.workflow.activeController = new AbortController();
  state.workflow.activeLabel = getWorkflowPendingLabel(input);
  state.ui.alert = state.workflow.activeLabel;
  render();
  return requestId;
}

function endWorkflowRequest(requestId) {
  if (requestId !== state.workflow.activeRequestId) return;
  state.workflow.inFlight = false;
  state.workflow.activeLabel = "";
  state.workflow.activeController = null;
  window.setTimeout(processNextPendingChat, 0);
}

function abortActiveWorkflow() {
  if (state.workflow.activeController) {
    state.workflow.activeController.abort();
  }
  state.workflow.inFlight = false;
  state.workflow.activeLabel = "";
  state.workflow.activeController = null;
  state.workflow.activeRequestId += 1;
}

async function processNextPendingChat() {
  if (state.workflow.inFlight || state.workflow.pendingChats.length === 0) return;
  if (state.game.status === "paused") return;

  const nextChat = state.workflow.pendingChats.shift();
  state.passengers.selectedSeat = nextChat.seat;
  clearPassengerBubbles(nextChat.seat);
  state.passengers.seats[nextChat.seat].bubble = nextChat.text;
  scheduleBubbleClear();
  state.host.targetSeat = nextChat.seat;
  state.host.text = "刚才那条问题接上了，我来判断。";
  state.ui.alert = `处理已排队问题：${SEATS[nextChat.seat]}`;
  render();
  await dispatchWorkflow("chat", null, nextChat.text);
}

function getWorkflowPendingLabel(input) {
  if (input.event?.type === "hard_brake") return "安全事件处理中";
  if (input.event?.type === "resume_game") return "正在恢复游戏";
  if (input.event?.type === "start_game") return "AI 正在主持开局";
  if (input.trigger_type === "chat") return "AI 正在判断";
  return "AI 正在同步座舱状态";
}

function canStartWorkflowAction(message) {
  if (!state.workflow.inFlight) return true;
  state.ui.alert = message;
  render();
  return false;
}

function canResumeGame() {
  if (state.game.status !== "paused") {
    state.ui.alert = "游戏已经在进行中";
    return false;
  }
  if (Date.now() - state.workflow.lastResumeAt < 1500) {
    state.ui.alert = "恢复指令已发送，请稍等";
    return false;
  }
  return true;
}

function buildWorkflowInput(triggerType, event, playerInput) {
  const selectedSeat = state.passengers.selectedSeat;
  const perception = buildPerceptionSnapshot(event, triggerType, playerInput);
  const normalizedEvent = event
    ? {
        ...event,
        seat_label: event.seat ? SEATS[event.seat] : undefined,
      }
    : null;

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
    perception,
    timeline: {
      id: state.timeline.id,
      name: state.timeline.name,
      status: state.timeline.status,
      elapsed_seconds: state.timeline.elapsedSeconds,
      current_event: event
        ? {
            type: event.type,
            description: state.timeline.currentEvent,
            priority: getEventPriority(event.type),
          }
        : null,
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
      progress: perception.game_progress,
      asked_questions: getAskedQuestions(),
    },
    interaction: {
      current_speaker: selectedSeat,
      current_speaker_label: SEATS[selectedSeat],
      recent_messages: getRecentMessages(),
      last_passenger_action_key: state.workflow.lastPassengerActionKey,
      suppress_passenger_action: shouldSuppressPassengerAction(triggerType, event),
    },
    player_seat: SEATS[selectedSeat],
    player_input: playerInput,
    event: normalizedEvent,
  };
}

function buildPerceptionSnapshot(event, triggerType, playerInput) {
  return {
    vehicle_state: getVehicleState(event),
    driver_state: getDriverState(event),
    sleeping_seats: getSleepingSeats(),
    inactive_seat: getInactiveSeat(
      triggerType === "chat" && playerInput ? state.passengers.selectedSeat : null,
      event,
    ),
    cabin_mood: getCabinMood(event),
    game_progress: getGameProgress(event),
    environment_hook: state.car.environment,
  };
}

function getVehicleState(event) {
  if (event?.type === "hard_brake" || state.ui.cabinMode === "safety_pause") {
    return "hard_brake";
  }
  return state.car.speed >= 100 ? "high_speed" : "normal";
}

function getDriverState(event) {
  if (
    event?.type === "driver_tired" ||
    state.perception.driverState === "fatigued" ||
    state.ui.cabinMode === "driver_focus"
  ) {
    return "fatigued";
  }
  return "normal";
}

function getSleepingSeats() {
  return Object.entries(state.passengers.seats)
    .filter(([, seatState]) => seatState.mood === "睡着")
    .map(([seat]) => seat);
}

function getInactiveSeat(currentSpeaker, event) {
  if (event?.type === "passenger_inactive") {
    const eventSeat = normalizeTargetSeat(event.seat) || event.seat;
    if (["rearLeft", "rearRight"].includes(eventSeat) && !getSleepingSeats().includes(eventSeat)) {
      return eventSeat;
    }
  }
  if (state.game.questionCount < 3) return null;

  const sleepingSeats = new Set(getSleepingSeats());
  const participation = {
    rearLeft: 0,
    rearRight: 0,
  };

  getRecentParticipantSeats().forEach((seat) => {
    if (seat in participation) participation[seat] += 1;
  });
  if (currentSpeaker in participation) participation[currentSpeaker] += 1;

  const candidates = Object.keys(participation)
    .filter((seat) => !sleepingSeats.has(seat))
    .sort((seatA, seatB) => participation[seatA] - participation[seatB]);

  if (!candidates.length || participation[candidates[0]] > 0) return null;
  return candidates[0];
}

function getRecentParticipantSeats() {
  return state.game.history.slice(-6).flatMap((item) => {
    const seats = [];
    if (item.input?.player_input) {
      seats.push(item.input.passengers?.selected_seat);
    }
    if (item.output?.passenger_action?.text) {
      seats.push(normalizeTargetSeat(item.output.passenger_action.seat));
    }
    return seats.filter(Boolean);
  });
}

function getCabinMood(event) {
  if (event?.type === "cabin_laughing") return "laughing";
  return Object.values(state.passengers.seats).some((seatState) => seatState.mood === "大笑")
    ? "laughing"
    : "normal";
}

function getGameProgress(event) {
  if (state.game.status === "victory") return "correct";
  if (event?.type === "game_stuck") return "stuck";
  if (event?.type === "near_answer") return "near_answer";

  const latestOutput = state.game.history.at(-1)?.output;
  const workflowProgress =
    latestOutput?.game_progress ||
    latestOutput?.ui_change?.game_progress ||
    latestOutput?.decision_trace?.game_progress ||
    latestOutput?.debug?.game_progress;
  if (["normal", "stuck", "near_answer", "correct"].includes(workflowProgress)) {
    return workflowProgress;
  }

  const strategyId =
    latestOutput?.decision_trace?.strategy_id || latestOutput?.debug?.strategy_id || "";
  if (strategyId === "S17") return "near_answer";
  if (strategyId === "S18" || state.game.questionCount >= 8) return "stuck";
  return state.perception.gameProgress || "normal";
}

function getAskedQuestions() {
  return state.game.history
    .map((item) => item.input?.player_input?.trim())
    .filter(Boolean)
    .slice(-15);
}

function getRecentMessages() {
  return state.game.history.slice(-6).flatMap((item) => {
    const messages = [];
    if (item.input?.player_input) {
      messages.push({
        role: "player",
        seat: item.input.passengers?.selected_seat,
        seat_label: item.input.passengers?.selected_seat_label,
        text: item.input.player_input,
      });
    }
    if (item.output?.passenger_action?.text) {
      messages.push({
        role: "simulated_passenger",
        seat: normalizeTargetSeat(item.output.passenger_action.seat) || item.output.passenger_action.seat,
        text: item.output.passenger_action.text,
      });
    }
    if (item.output?.ai_reply_text) {
      messages.push({
        role: "ai_host",
        text: item.output.ai_reply_text,
      });
    }
    return messages;
  });
}

function shouldSuppressPassengerAction(triggerType, event) {
  if (triggerType !== "event") return false;
  return ["hard_brake", "resume_game", "passenger_sleep", "driver_tired", "near_destination"].includes(
    event?.type,
  );
}

function getEventPriority(type) {
  const priorities = {
    hard_brake: "P0",
    resume_game: "P1",
    driver_tired: "P1",
    passenger_sleep: "P2",
    passenger_inactive: "P2",
    near_destination: "P2",
    environment_change: "P2",
    speed_change: "P2",
    game_stuck: "P3",
    near_answer: "P3",
    cabin_laughing: "P4",
    start_game: "P3",
  };
  return priorities[type] || "P3";
}

async function requestWorkflow(input, signal) {
  const endpoint = normalizeWorkflowEndpoint(els.workflowUrl.value.trim() || DEFAULT_WORKFLOW_ENDPOINT);
  els.workflowUrl.value = endpoint;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input_payload: JSON.stringify(input),
    }),
    signal,
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

function applyAnswerHitGuard(output, input) {
  if (!isExplicitAnswerHit(input)) {
    return output;
  }

  const answer = input.game?.current_answer || getCurrentRiddle().answer;
  return {
    ...output,
    ai_reply_text: output.ai_reply_text || `${input.passengers.selected_seat_label}答对了，谜底就是${answer}。`,
    game_status: "victory",
    is_correct: true,
    answer,
    ui_change: {
      ...(output.ui_change || {}),
      cabin_mode: "victory",
      target_seat: input.passengers?.selected_seat,
      host_emotion: "celebrating",
      animation: "victory",
      show_answer: true,
    },
  };
}

function isExplicitAnswerHit(input) {
  if (input.trigger_type !== "chat") return false;
  const answer = normalizeAnswerText(input.game?.current_answer || getCurrentRiddle().answer);
  const playerInput = normalizeAnswerText(input.player_input);
  return Boolean(answer && playerInput.includes(answer));
}

function normalizeAnswerText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\s，。！？、,.!?:"'“”‘’（）()【】\[\]-]/g, "");
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
  const isVictoryOutput = Boolean(output.is_correct || output.game_status === "victory");
  const isHardBrakeOutput = input.event?.type === "hard_brake";
  const eventType = input.event?.type;
  const keepRealUserFocus = shouldKeepRealUserFocus(input, output);
  if (!isVictoryOutput && !keepRealUserFocus) {
    applyPassengerVisualStates(output);
  }
  const passengerActionApplied = isVictoryOutput || shouldSuppressPassengerAction(input.trigger_type, input.event)
    || keepRealUserFocus
    ? suppressPassengerActionForEvent()
    : applyPassengerAction(output.passenger_action);
  state.host.text = output.ai_reply_text || state.host.text;
  state.host.text = normalizeHostReplyForRealUser(state.host.text, output, input);
  if (passengerActionApplied && !output.ai_reply_text) {
    state.host.text = "这个问题收到，我来接住这一轮。";
  }
  state.game.status = output.game_status || state.game.status;
  state.ui.cabinMode = uiChange.cabin_mode || state.ui.cabinMode || "normal";
  state.ui.animation = uiChange.animation || "speak";
  state.ui.showAnswer = Boolean(uiChange.show_answer || output.is_correct);
  state.host.emotion = uiChange.host_emotion || state.host.emotion;
  state.host.targetSeat = normalizeTargetSeat(uiChange.target_seat) || state.host.targetSeat;
  if (keepRealUserFocus) {
    clearPassengerActivities();
    state.host.targetSeat = "front";
  }

  if (isHardBrakeOutput) {
    state.game.status = "paused";
    state.ui.cabinMode = "safety_pause";
    state.ui.animation = "pause";
    state.host.emotion = "serious";
    state.host.targetSeat = null;
  }
  if (eventType === "passenger_sleep") {
    state.game.status = "playing";
    state.ui.cabinMode = "soft";
    state.ui.animation = "soft";
    state.host.targetSeat = normalizeTargetSeat(input.event?.seat) || state.host.targetSeat;
  }
  if (eventType === "driver_tired") {
    state.game.status = "playing";
    state.ui.cabinMode = "driver_focus";
    state.ui.animation = "speak";
    state.host.targetSeat = "front";
  }
  if (eventType === "near_destination") {
    state.game.status = "playing";
    state.ui.cabinMode = "final_round";
    state.ui.animation = "final";
    state.host.targetSeat = null;
  }

  if (output.next_answer) {
    const nextIndex = RIDDLES.findIndex((riddle) => riddle.answer === output.next_answer);
    if (nextIndex >= 0 && state.game.status === "idle") {
      state.game.currentRiddleIndex = nextIndex;
    }
  }

  if (isVictoryOutput) {
    const correctSeat = input.passengers?.selected_seat || state.passengers.selectedSeat;
    finishTimelineSilently();
    clearPassengerActivities();
    state.ui.cabinMode = "victory";
    state.ui.showAnswer = true;
    state.ui.correctSeat = correctSeat;
    state.game.status = "victory";
    state.host.text = makeVictoryHostText(correctSeat, output.answer || getCurrentRiddle().answer);
    state.host.targetSeat = correctSeat;
    playVictorySound();
  }

  updateDecisionTrace(normalizeDecisionTrace(output, input));

  state.game.history.push({
    at: new Date().toISOString(),
    input,
    output,
  });
}

function createDecisionTraceFromOutput(output, input) {
  const eventType = input.event?.type;
  if (eventType === "hard_brake") {
    return {
      perception: "检测到急刹打断",
      decision: "安全优先，立即暂停游戏",
      execution: "切换安全暂停，停止乘客发言",
      strategyId: "S01",
      priority: "P0",
    };
  }
  if (eventType === "driver_tired") {
    return {
      perception: "检测到主驾疲惫",
      decision: "降低主驾互动，副驾和后排接管",
      execution: "切换主驾专注模式",
      strategyId: "S03",
      priority: "P1",
    };
  }
  if (eventType === "passenger_sleep") {
    const seatLabel = SEATS[normalizeTargetSeat(input.event?.seat)] || "有乘客";
    return {
      perception: `检测到${seatLabel}睡着`,
      decision: "轻声继续，并避免 cue 睡着乘客",
      execution: "切换轻声互动模式，排除该座位发言",
      strategyId: "S04",
      priority: "P2",
    };
  }
  if (eventType === "near_destination") {
    return {
      perception: "检测到快到目的地",
      decision: "收束游戏节奏，进入绝杀局",
      execution: "切换 final_round 状态",
      strategyId: "S09",
      priority: "P2",
    };
  }
  if (eventType === "resume_game") {
    return {
      perception: "安全风险解除",
      decision: "恢复猜谜并保留上下文",
      execution: "游戏状态恢复进行中",
      strategyId: "S01",
      priority: "P1",
    };
  }
  if (eventType === "start_game") {
    return {
      perception: "副驾发起主持开局",
      decision: "进入高速亲子猜谜局",
      execution: "AI 主持人开场并隐藏谜底",
      strategyId: "S00",
      priority: "P3",
    };
  }
  if (input.trigger_type === "chat" && output.is_correct) {
    return {
      perception: `${input.passengers.selected_seat_label}猜中谜底`,
      decision: "进入胜利收尾，给足情绪价值",
      execution: "揭晓谜底并切换胜利氛围",
      strategyId: "S14",
      priority: "P3",
    };
  }
  if (input.trigger_type === "chat") {
    return {
      perception: `${input.passengers.selected_seat_label}提出问题`,
      decision: "判断问题方向并继续推进游戏",
      execution: "AI 主持人回答并 cue 对应座位",
      strategyId: input.passengers.selected_seat === "rearRight" ? "S12" : "S00",
      priority: "P3",
    };
  }
  return {
    perception: "座舱状态已更新",
    decision: "同步游戏节奏",
    execution: "更新 AI 话术和座舱状态",
    strategyId: output.debug?.strategy_id || "S00",
    priority: output.debug?.priority || "P3",
  };
}

function normalizeDecisionTrace(output, input) {
  const eventType = input.event?.type;
  if (input.trigger_type === "chat" && (output.is_correct || output.game_status === "victory")) {
    return createDecisionTraceFromOutput(output, input);
  }
  if (LOCAL_TRACE_EVENT_TYPES.has(eventType)) {
    return createDecisionTraceFromOutput(output, input);
  }

  if (!output.decision_trace) {
    return createDecisionTraceFromOutput(output, input);
  }

  const trace = {
    ...output.decision_trace,
    strategy_id: output.decision_trace.strategy_id || output.strategy_id,
    priority: output.decision_trace.priority || output.priority,
  };
  const strategyId = trace.strategy_id || trace.strategyId || "";
  const label = STRATEGY_LABELS[strategyId];
  if (label && trace.decision) {
    trace.decision = trace.decision.replace(`策略${strategyId}(未知)`, `策略${strategyId}(${label})`);
  }
  return trace;
}

function updateDecisionTrace(trace = {}) {
  state.decisionTrace.perception =
    trace.perception || trace.sensing || state.decisionTrace.perception || "等待座舱事件";
  state.decisionTrace.decision =
    trace.decision || trace.decision_goal || state.decisionTrace.decision || "等待 Workflow 判断";
  state.decisionTrace.execution =
    trace.execution || trace.action || state.decisionTrace.execution || "等待网页动作";
  state.decisionTrace.strategyId = trace.strategy_id || trace.strategyId || "";
  state.decisionTrace.priority = trace.priority || "";
}

function resetDecisionTrace() {
  updateDecisionTrace({
    perception: "等待座舱事件",
    decision: "等待 Workflow 判断",
    execution: "等待网页动作",
    strategyId: "",
    priority: "",
  });
}

function applyPassengerAction(passengerAction) {
  if (!passengerAction || !passengerAction.seat || !passengerAction.text) {
    return false;
  }

  const seat = normalizeTargetSeat(passengerAction.seat) || passengerAction.seat;
  if (!state.passengers.seats[seat]) {
    return false;
  }

  if (seat === "front") {
    clearPassengerBubbles();
    return false;
  }

  if (state.passengers.seats[seat].mood === "睡着") {
    clearPassengerBubbles();
    return false;
  }

  const actionKey = `${seat}:${passengerAction.text}`;
  if (actionKey === state.workflow.lastPassengerActionKey) {
    clearPassengerBubbles();
    return false;
  }

  clearPassengerBubbles(seat);
  state.passengers.seats[seat].bubble = passengerAction.text;
  if (passengerAction.mood && ["普通", "大笑", "沉默", "睡着"].includes(passengerAction.mood)) {
    state.passengers.seats[seat].mood = passengerAction.mood;
  }
  state.host.targetSeat = seat;
  state.workflow.lastPassengerActionKey = actionKey;
  scheduleBubbleClear();
  return true;
}

function applyPassengerVisualStates(output) {
  const candidates = [];
  if (output.passenger_action) candidates.push(output.passenger_action);

  const passengerStates = output.passenger_states || output.ui_change?.passenger_states;
  if (Array.isArray(passengerStates)) {
    candidates.push(...passengerStates);
  } else if (passengerStates && typeof passengerStates === "object") {
    Object.entries(passengerStates).forEach(([seat, value]) => {
      candidates.push(typeof value === "object" ? { seat, ...value } : { seat, action: value });
    });
  }

  let hasActivity = false;
  candidates.forEach((candidate) => {
    const seat = normalizeTargetSeat(candidate?.seat || candidate?.target_seat);
    if (!seat || !state.passengers.seats[seat]) return;

    const activity = normalizePassengerActivity(
      candidate.action || candidate.activity || candidate.state || candidate.type,
    );
    if (activity) {
      const rawActivityLabel = String(
        candidate.action || candidate.activity || candidate.state || candidate.type || "",
      );
      state.passengers.seats[seat].activity = activity;
      state.passengers.seats[seat].activityLabel = /^[a-z_]+$/i.test(rawActivityLabel)
        ? PASSENGER_ACTIVITY_LABELS[activity]
        : rawActivityLabel.slice(0, 6);
      hasActivity = true;
    }

    const mood = normalizePassengerMood(candidate.mood || candidate.state || candidate.action);
    if (mood) state.passengers.seats[seat].mood = mood;
  });

  if (hasActivity) schedulePassengerActivityClear();
}

function normalizePassengerActivity(value) {
  const text = String(value || "").toLowerCase();
  if (!text) return null;
  if (text.includes("思考")) return "thinking";
  if (text.includes("提问") || text.includes("发问") || text === "asking") return "asking";
  if (text.includes("作答") || text.includes("回答") || text === "answering") return "answering";
  if (text.includes("庆祝") || text.includes("答对") || text === "celebrating") return "celebrating";
  if (text.includes("倾听") || text === "listening") return "listening";
  if (["idle", "normal", "普通"].includes(text)) return "idle";
  if (text.includes("睡") || text.includes("大笑") || text.includes("沉默")) return null;
  return "acting";
}

function normalizePassengerMood(value) {
  const text = String(value || "");
  if (text.includes("睡")) return "睡着";
  if (text.includes("大笑") || text.includes("笑")) return "大笑";
  if (text.includes("沉默") || text.includes("安静")) return "沉默";
  if (text === "普通" || text === "normal") return "普通";
  return null;
}

function schedulePassengerActivityClear() {
  if (state.workflow.activityTimer) clearTimeout(state.workflow.activityTimer);
  state.workflow.activityTimer = setTimeout(() => {
    clearPassengerActivities();
    state.workflow.activityTimer = null;
    render();
  }, 6000);
}

function clearPassengerActivities() {
  Object.values(state.passengers.seats).forEach((seatState) => {
    seatState.activity = "idle";
    seatState.activityLabel = "";
  });
}

function makeVictoryHostText(correctSeat, answer) {
  const seatLabel = SEATS[correctSeat] || "这位侦探";
  return `${seatLabel}答对了，谜底就是${answer}！这一问收得漂亮，全车侦探团本局破案成功。`;
}

function shouldKeepRealUserFocus(input, output) {
  if (input.trigger_type !== "chat") return false;
  if (input.passengers?.selected_seat !== "front") return false;
  if (output.is_correct || output.game_status === "victory") return false;

  const targetSeat = normalizeTargetSeat(output.ui_change?.target_seat);
  if (!targetSeat || targetSeat === "front") return false;

  const passengerSeat = normalizeTargetSeat(output.passenger_action?.seat);
  const hasPassengerSpeech = Boolean(output.passenger_action?.text && passengerSeat === targetSeat);
  return !hasPassengerSpeech;
}

function normalizeHostReplyForRealUser(text, output, input) {
  if (!shouldKeepRealUserFocus(input, output)) {
    return text;
  }

  const targetSeat = SEATS[normalizeTargetSeat(output.ui_change?.target_seat)] || "其他乘客";
  if (/请.*(提问|回答|猜|参与|来问)|交给|轮到|cue/i.test(text)) {
    return `${getAnswerLead(text)}我注意到${targetSeat}还没怎么参与，但这轮先由副驾继续接上，流程不会切走。`;
  }
  return `${text} 副驾继续接上这一问就好。`;
}

function getAnswerLead(text) {
  const normalized = String(text || "").trim();
  if (/^(是|对|正确)/.test(normalized)) return "是的，这个方向有效。";
  if (/^(不是|不对|否)/.test(normalized)) return "不是这个方向。";
  return "";
}

function suppressPassengerActionForEvent() {
  clearPassengerBubbles();
  return false;
}

function clearPassengerBubbles(keepSeat) {
  if (state.workflow.bubbleTimer) {
    clearTimeout(state.workflow.bubbleTimer);
    state.workflow.bubbleTimer = null;
  }
  Object.entries(state.passengers.seats).forEach(([seat, seatState]) => {
    if (seat !== keepSeat) {
      seatState.bubble = "";
    }
  });
}

function scheduleBubbleClear() {
  if (state.workflow.bubbleTimer) {
    clearTimeout(state.workflow.bubbleTimer);
  }
  state.workflow.bubbleTimer = setTimeout(() => {
    clearPassengerBubbles();
    render();
  }, 6500);
}

function normalizeTargetSeat(seat) {
  if (typeof seat === "string" && seat.includes(",")) {
    for (const candidate of seat.split(",").map((item) => item.trim())) {
      const normalized = normalizeTargetSeat(candidate);
      if (normalized) return normalized;
    }
    return null;
  }
  const map = {
    主驾: "driver",
    副驾: "front",
    左后: "rearLeft",
    后排左: "rearLeft",
    右后: "rearRight",
    后排右: "rearRight",
    左后座: "rearLeft",
    右后座: "rearRight",
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
  document.body.classList.toggle("is-working", state.workflow.inFlight);

  els.environmentBackdrop.className = `environment-backdrop ${
    ENVIRONMENT_CLASS[state.car.environment] || "env-highway-day"
  }`;
  els.environmentLabel.textContent = state.car.environment;
  els.speedLabel.textContent = `${state.car.speed} km/h`;
  els.destinationLabel.textContent = `目的地：${state.car.destination}`;

  els.roundProgress.textContent = `${state.game.roundIndex}/${state.game.totalRounds}`;
  els.questionProgress.textContent = `${state.game.questionCount}/${state.game.maxQuestions}`;
  els.stageLabel.textContent = getStageLabel();
  els.riddleTitle.textContent = getRiddleTitle(riddle);
  els.riddleHint.textContent = state.game.status === "idle" && !state.ui.showAnswer ? "" : riddle.hint;
  els.riddleHint.classList.toggle("hidden", state.game.status === "idle" && !state.ui.showAnswer);
  els.answerReveal.textContent = `谜底：${riddle.answer}`;
  els.answerReveal.classList.toggle("visible", state.ui.showAnswer);
  els.hostBubble.textContent = state.host.text;
  els.timelineName.textContent = state.timeline.name;
  els.decisionPerception.textContent = formatDecisionText(
    state.decisionTrace.perception,
    state.decisionTrace.strategyId,
  );
  els.decisionDecision.textContent = formatDecisionText(
    state.decisionTrace.decision,
    state.decisionTrace.priority,
  );
  els.decisionExecution.textContent = state.decisionTrace.execution;

  renderSeats();
  renderControls();
}

function formatDecisionText(text, suffix) {
  if (!suffix) return text;
  return `${text}（${suffix}）`;
}

function renderSeats() {
  els.seats.forEach((seatButton) => {
    const seat = seatButton.dataset.seat;
    const seatState = state.passengers.seats[seat];
    const bubble = seatButton.querySelector("[data-bubble]");
    const avatar = seatButton.querySelector("[data-avatar]");
    const status = seatButton.querySelector("[data-seat-status]");

    seatButton.classList.toggle("correct", state.ui.correctSeat === seat);
    seatButton.classList.toggle("sleeping", seatState.mood === "睡着");
    seatButton.classList.toggle("seat-laughing", seatState.mood === "大笑");
    Object.keys(PASSENGER_ACTIVITY_LABELS).forEach((activity) => {
      seatButton.classList.toggle(`activity-${activity}`, seatState.activity === activity);
    });

    bubble.textContent = seatState.bubble;
    bubble.classList.toggle("visible", Boolean(seatState.bubble));
    status.textContent =
      seatState.activityLabel || PASSENGER_ACTIVITY_LABELS[seatState.activity] || seatState.mood;

    avatar.className = "avatar";
    if (state.passengers.relationship === "年轻朋友") avatar.classList.add("friends");
    if (state.passengers.relationship === "中老年+儿女") avatar.classList.add("elder");
    if (seatState.mood === "大笑") avatar.classList.add("laugh");
    if (seatState.mood === "沉默") avatar.classList.add("quiet");
    if (seatState.mood === "睡着") avatar.classList.add("sleep");
    if (seatState.activity && seatState.activity !== "idle") {
      avatar.classList.add(`activity-${seatState.activity}`);
    }
  });
}

function renderControls() {
  setActive(els.speedChips, "speed", String(state.car.speed));
  setActive(els.environmentChips, "environment", state.car.environment);

  const isBusy = state.workflow.inFlight;
  const isTimelinePaused = state.timeline.status === "paused";
  const hasStarted = state.timeline.status !== "idle" || state.game.status !== "idle";

  document.body.classList.toggle("has-started", hasStarted);
  document.body.classList.toggle("timeline-paused", isTimelinePaused);
  els.prestartPanel.classList.toggle("hidden", hasStarted);
  els.startTimeline.disabled = hasStarted || isBusy;
  els.switchScenario.disabled = hasStarted || isBusy;
  els.resetScenario.disabled = !hasStarted;
  els.pauseTimeline.disabled = !hasStarted;
  els.pauseTimeline.textContent = isTimelinePaused ? "继续模拟" : "暂停模拟";
  els.sendQuestion.disabled = isTimelinePaused;
  els.playerInput.disabled = isTimelinePaused;

  els.eventButtons.forEach((button) => {
    const eventType = button.dataset.event;
    button.disabled = isTimelinePaused || (isBusy && eventType !== "hard_brake");
  });

  [els.speedChips, els.environmentChips].forEach((buttons) => {
    buttons.forEach((button) => {
      button.disabled = isTimelinePaused || isBusy;
    });
  });
}

function setActive(buttons, key, value) {
  buttons.forEach((button) => {
    button.classList.toggle("active", button.dataset[key] === value);
  });
}

function getStageLabel() {
  return "";
}

function getRiddleTitle(riddle) {
  if (state.ui.showAnswer) return riddle.answer;
  if (state.game.status === "idle") return "游戏待开始";
  return "提示";
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
