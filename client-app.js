// Only the demo's time is paused; browser/network clocks remain real.
function createSimulationRuntime(host = globalThis) {
  let pausedAt = null;
  let pausedDuration = 0;
  let parkedId = 0;
  const tasks = new Map();
  const waiters = [];
  const wallNow = () => host.Date.now();
  const now = () => (pausedAt ?? wallNow()) - pausedDuration;
  const frameNow = () => (host.performance?.now?.() ?? wallNow()) - pausedDuration
    - (pausedAt === null ? 0 : wallNow() - pausedAt);
  const native = name => host[name] || host.window?.[name];
  const stop = task => {
    if (task.nativeId == null) return;
    native(task.kind === "frame" ? "cancelAnimationFrame" : "clearTimeout")?.call(host, task.nativeId);
    task.nativeId = null;
  };
  const arm = task => {
    const invoke = () => {
      if (pausedAt !== null || !tasks.has(task.id)) return;
      task.nativeId = null;
      if (task.kind !== "interval") tasks.delete(task.id);
      try {
        if (task.kind === "frame") task.callback(frameNow());
        else task.callback(...task.args);
      } finally {
        if (task.kind === "interval" && tasks.has(task.id)) {
          task.remaining = task.delay;
          task.dueAt = now() + task.delay;
          if (pausedAt === null) arm(task);
        }
      }
    };
    task.dueAt = now() + task.remaining;
    task.nativeId = task.kind === "frame"
      ? native("requestAnimationFrame").call(host, invoke)
      : native("setTimeout").call(host, invoke, task.remaining);
  };
  const schedule = (kind, callback, delay = 0, args = []) => {
    const task = { id: null, nativeId: null, kind, callback, args,
      delay: Math.max(kind === "interval" ? 1 : 0, Number(delay) || 0), remaining: Math.max(0, Number(delay) || 0) };
    if (pausedAt === null) arm(task);
    task.id = task.nativeId != null && !tasks.has(task.nativeId) ? task.nativeId : --parkedId;
    tasks.set(task.id, task);
    return task.id;
  };
  const cancel = id => {
    const task = tasks.get(id);
    if (!task) { native("clearTimeout")?.call(host, id); return; }
    stop(task);
    tasks.delete(id);
  };
  return {
    get paused() { return pausedAt !== null; },
    now, wallNow, frameNow,
    setTimeout: (callback, delay, ...args) => schedule("timeout", callback, delay, args),
    clearTimeout: cancel,
    setInterval: (callback, delay, ...args) => schedule("interval", callback, delay, args),
    clearInterval: cancel,
    requestAnimationFrame: callback => schedule("frame", callback),
    cancelAnimationFrame: cancel,
    waitUntilRunning: () => pausedAt === null ? Promise.resolve() : new Promise(resolve => waiters.push(resolve)),
    defer(callback) {
      if (pausedAt === null) return callback();
      waiters.push(() => { Promise.resolve().then(callback); });
    },
    pause() {
      if (pausedAt !== null) return;
      const current = now();
      pausedAt = wallNow();
      for (const task of tasks.values()) {
        task.remaining = Math.max(0, task.dueAt - current);
        stop(task);
      }
    },
    resume() {
      if (pausedAt === null) return;
      pausedDuration += wallNow() - pausedAt;
      pausedAt = null;
      for (const task of tasks.values()) arm(task);
      waiters.splice(0).forEach(resolve => resolve());
    },
  };
}

const simulationRuntime = createSimulationRuntime();
const simulationFreeze = { previousTimelineStatus: null, animations: [], media: [], audioWasRunning: false, autoPaused: false };
const roundAdvanceDiagnostic = { lastKey: "", lastAt: 0, waitingSince: 0 };

const SEATS = {
  driver: "主驾",
  front: "副驾",
  rearLeft: "左后",
  rearRight: "右后",
};

const DEFAULT_WORKFLOW_ENDPOINT = "/api/workflow";
const DIFY_CONVERSATION_STORAGE_KEY = "smart-cabin-dify-conversation-id";
const DIFY_CONVERSATION_CONTEXT_STORAGE_KEY = "smart-cabin-dify-conversation-context";
const DIFY_ROUND_SCOPE_STORAGE_KEY = "smart-cabin-dify-round-scope";
const DIFY_USER_STORAGE_KEY = "smart-cabin-dify-user-id";
const HOST_PREFERENCES_STORAGE_KEY = "smart-cabin-host-preferences";
const SOUND_ONBOARDING_DISMISSED_KEY = "smart-cabin-sound-onboarding-dismissed-v2";
let fallbackDifyUserId = "";

function getPersistentDifyUserId() {
  try {
    const existing = localStorage.getItem(DIFY_USER_STORAGE_KEY);
    if (existing) return existing;
    const randomId = typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : `${simulationRuntime.now()}-${Math.random().toString(36).slice(2)}`;
    const created = `demo-${randomId}`;
    localStorage.setItem(DIFY_USER_STORAGE_KEY, created);
    return created;
  } catch {
    fallbackDifyUserId ||= `demo-${simulationRuntime.now()}-${Math.random().toString(36).slice(2)}`;
    return fallbackDifyUserId;
  }
}

function getPersistentDifyConversationId() {
  try {
    return localStorage.getItem(DIFY_CONVERSATION_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function savePersistentDifyConversationId(conversationId, scopeKey = getDifyRoundScopeKey()) {
  if (!conversationId) return;
  if (scopeKey !== getDifyRoundScopeKey()) return;
  try {
    localStorage.setItem(DIFY_CONVERSATION_STORAGE_KEY, conversationId);
    localStorage.setItem(DIFY_CONVERSATION_CONTEXT_STORAGE_KEY, JSON.stringify({
      conversation_id: conversationId,
      game_id: state.workflow.gameId,
      round_id: scopeKey,
    }));
  } catch {
    console.warn("Could not persist the Dify conversation ID in local storage.");
  }
}

function getDifyRoundScopeKey() {
  return `${state.workflow.gameId}-round-${state.game.roundIndex}`;
}

function buildDifyRoundContext() {
  const conversationId = getPersistentDifyConversationId();
  let previous = null;
  try {
    previous = JSON.parse(localStorage.getItem(DIFY_CONVERSATION_CONTEXT_STORAGE_KEY) || "null");
  } catch {
    // Older sessions may have a conversation ID without an acknowledged round.
  }
  if (previous?.conversation_id !== conversationId) previous = null;
  const currentRoundId = getDifyRoundScopeKey();
  const transition = !conversationId ? "conversation_start"
    : !previous ? "conversation_resume"
    : previous.game_id !== state.workflow.gameId ? "new_game"
    : previous.round_id !== currentRoundId ? "new_round"
    : "continue_round";
  return {
    transition,
    previous_game_id: previous?.game_id || "",
    previous_round_id: previous?.round_id || "",
    current_game_id: state.workflow.gameId,
    current_round_id: currentRoundId,
    current_snapshot_is_authoritative: true,
  };
}

function loadDifyRoundScope() {
  try {
    const value = JSON.parse(localStorage.getItem(DIFY_ROUND_SCOPE_STORAGE_KEY) || "null");
    if (!value || typeof value.gameId !== "string" || !value.gameId) return null;
    if (!Number.isInteger(value.roundIndex) || value.roundIndex < 1) return null;
    if (!Number.isInteger(value.currentRiddleIndex) || value.currentRiddleIndex < 0 || value.currentRiddleIndex >= RIDDLES.length) return null;
    return value;
  } catch {
    return null;
  }
}

function persistDifyRoundScope() {
  try {
    localStorage.setItem(DIFY_ROUND_SCOPE_STORAGE_KEY, JSON.stringify({
      gameId: state.workflow.gameId,
      roundIndex: state.game.roundIndex,
      currentRiddleIndex: state.game.currentRiddleIndex,
    }));
  } catch {
    console.warn("Could not persist the current Dify round scope.");
  }
}

function createRuntimeId(prefix) {
  const random = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${simulationRuntime.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}
const WORKFLOW_CLIENT_TIMEOUT_MS = 65000;
const MIN_BUBBLE_DISPLAY_MS = 1500;
const HOST_MIN_BUBBLE_DISPLAY_MS = 1500;
const PASSENGER_BUBBLE_MS = 8000;
const CORRECT_LIGHT_MS = 5000;
const HOST_SPEECH_P0_LOCK_MS = 6000;
const HOST_SPEECH_P0_GAP_MS = 450;
const NEXT_ROUND_DELAY_MS = HOST_SPEECH_P0_LOCK_MS + HOST_SPEECH_P0_GAP_MS;
const HOST_MIN_THINKING_DISPLAY_MS = 700;
const HOST_SPEECH_MAX_DISPLAY_MS = 6000;
const HOST_THINKING_WAIT_DELAY_MS = 300;
const LOCAL_FALLBACK_REPLY_DELAY_MS = 500;
const PAUSED_ROUND_POLL_MS = 300;
const QUESTION_DURATION_MS = 90_000;
const MIN_TIMELINE_STEP_GAP_MS = 5_000;
const ANSWER_LENGTH_HINT_DELAY_MS = 10_000;
const QUESTION_INTRO_DURATION_MS = 3_000;
const QUESTION_TIMER_TICK_MS = 100;
const QUESTION_TIMER_SIZE_PX = 46;
const QUESTION_TIMER_RADIUS_PX = 19;
const QUESTION_TIMER_STROKE_PX = 8;
const SCREEN_ENVIRONMENT_DELAY_MS = 2000;
const ENVIRONMENT_ANNOUNCEMENT_MS = 3000;
const IMPORTANT_EVENT_DISPLAY_MS = 10000;
const IMPORTANT_EVENT_EXIT_MS = 320;
const ROUND_PLAN_EXTRA_STEPS = 2;
const ENVIRONMENT_RIDDLE_SETTLE_MS = 800;
const GAME_ROUND_COUNT = 6;
const ENVIRONMENT_ROUND_INTRO_WINDOW_MS = 6000;
const PROGRESS_DOT_STEP_PX = 46;
const PROGRESS_RAIL_EDGE_PX = 20;
const STAGE_WIDTH = 1940;
const STAGE_HEIGHT = 1100;
const DEFAULT_DEPLOY_STATUS = "版本检查中";
const HOST_AVATAR_DEFAULT_STATE = "normal";
const HOST_AVATAR_TRANSIENT_MS = 4000;
const HOST_SPRITE_FRAME_WIDTH = 720;
const HOST_SPRITE_FRAME_HEIGHT = 720;
const HOST_SPRITE_COLUMNS = 6;
const HOST_SPRITE_FRAME_DURATION_MS = 100;
const HOST_TTS_MAX_TEXT_CHARS = 600;
const HOST_SPEECH_PRIORITIES = Object.freeze({
  P0: 5,
  P1: 4,
  P2: 3,
  P3: 2,
  P4: 1,
});
const HOST_SPEECH_DEFAULT_LOCK_MS = 6000;
const SUMMARY_HOST_SPEECH_DELAY_MS = 6000;
const DRIVER_SAFETY_HOLD_MS = 15_000;
const REAL_USER_INACTIVE_MS = 20_000;
const PARTICIPATION_DIALOGUE_GAP_MS = 2500;
const PARTICIPATION_MIN_REMAINING_MS = 15_000;
const OVERSPEED_KMH = 120;
const CONFETTI_CONFIG = Object.freeze({
  count: 100,
  durationMs: 5000,
  colors: ["#DE7357", "#7941CD", "#24A7F3", "#5CB437", "#E33077", "#B458AD", "#D84144"],
  launchAngleDeg: 80,
  spreadDeg: 10,
  speed: 19,
  gravity: 0.09,
  drag: 0.999,
  ribbonWidth: 20,
  ribbonHeight: 36,
});
const GAMEPLAY_CONFETTI_SOUND_DELAY_MS = 1600;

// Keep visual asset selection in one place. Runtime state stores semantic
// values such as "大笑" and "城区晴天白天"; renderers resolve them here.
const RESOURCE_CONFIG = {
  host: {
    normal: {
      kind: "sprite",
      meta: "./assets/host-normal.json",
      src: "./assets/host-normal.webp",
      fallback: "./assets/host-normal.png",
      loop: true,
      frameCount: 32,
    },
    speak: {
      kind: "sprite",
      meta: "./assets/host-speak.json",
      src: "./assets/host-speak.webp",
      fallback: "./assets/host-normal.png",
      loop: true,
      playVictorySound: false,
      frameCount: 42,
    },
    thinking: {
      kind: "sprite",
      meta: "./assets/host-thinking.json?v=20260921-drop-empty-final-frame",
      src: "./assets/host-thinking.webp",
      fallback: "./assets/host-thinking.png",
      loop: false,
      playVictorySound: false,
      frameCount: 40,
    },
    smile: {
      kind: "sprite",
      meta: "./assets/host-heart.json?v=20260919-skip-empty-final-frame",
      src: "./assets/host-heart.webp",
      fallback: "./assets/host-heart.png",
      loop: false,
      playVictorySound: false,
      frameCount: 27,
    },
    awkward: { kind: "image", src: "./assets/host-puzzled.png" },
    excited: {
      kind: "sprite",
      meta: "./assets/host-yes.json",
      src: "./assets/host-yes.webp",
      fallback: "./assets/host-yes.png",
      audio: {
        src: "./assets/host-yes.mp3",
        delayMs: 180,
        trimStartMs: 0,
        volume: 0.85,
      },
      frameCount: 40,
    },
    celebration: {
      kind: "sprite",
      meta: "./assets/host-cheer.json",
      src: "./assets/host-cheer.webp",
      fallback: "./assets/host-cheer.png",
      loop: false,
      playVictorySound: false,
      frameCount: 60,
      audio: { src: "./assets/host-cheer.mp3", delayMs: 0, trimStartMs: 0, volume: 0.85 },
    },
    greeting: {
      kind: "sprite",
      meta: "./assets/hi.json?v=d9959ca2053e",
      src: "./assets/hi.webp?v=d9959ca2053e",
      fallback: "./assets/host-normal.png",
      loop: true,
      playVictorySound: false,
      frameCount: 60,
    },
  },
  screenBackgrounds: {
    default: "./assets/screen-default.png?v=20260927-screen-default-v2",
    cityDay: "./assets/screen-city-day.png",
    cityNight: "./assets/screen-city-night.png",
    scenicDay: "./assets/screen-scenic-day.png",
    scenicSunset: "./assets/screen-scenic-sunset.png",
    snowDay: "./assets/screen-snow-day.png",
    deepNight: "./assets/screen-deep-night.png",
    rain: "./assets/screen-rain.png",
  },
  cabinEnvironments: {
    garage: "./assets/cabin-env-garage.png?v=figma-ce-garage-20261022",
    rain: "./assets/cabin-env-rain.png",
    tunnel: "./assets/cabin-env-tunnel.png",
    scenicDay: "./assets/cabin-env-scenic-day.png",
    snowDay: "./assets/cabin-env-snow-day.png",
    cityDay: "./assets/cabin-env-city-day.png",
    cityNight: "./assets/cabin-env-city-night.png",
    scenicSunset: "./assets/cabin-env-scenic-sunset.png",
    deepNight: "./assets/cabin-env-deep-night.png",
  },
  passengers: {
    girl: {
      normal: "./assets/passenger-girl-normal.png",
      laugh: "./assets/passenger-girl-laugh.png",
      sleep: "./assets/passenger-girl-sleep.png",
    },
    boy: {
      normal: "./assets/passenger-boy-normal.png",
      laugh: "./assets/passenger-boy-laugh.png",
      sleep: "./assets/passenger-boy-sleep.png",
    },
    femaleYoung: {
      normal: "./assets/passenger-female-young-normal.png",
      laugh: "./assets/passenger-female-young-laugh.png",
      tired: "./assets/passenger-female-young-tired.png",
      sleep: "./assets/passenger-female-young-sleep.png",
    },
    maleYoung: {
      normal: "./assets/passenger-male-young-normal.png",
      laugh: "./assets/passenger-male-young-laugh.png",
      tired: "./assets/passenger-male-young-tired.png",
      sleep: "./assets/passenger-male-young-sleep.png",
    },
    mom: {
      normal: "./assets/passenger-mom-normal.png",
      laugh: "./assets/passenger-mom-laugh.png",
      tired: "./assets/passenger-mom-tired.png",
      sleep: "./assets/passenger-mom-sleep.png",
    },
    dad: {
      normal: "./assets/passenger-dad-normal.png",
      laugh: "./assets/passenger-dad-laugh.png",
      tired: "./assets/passenger-dad-tired.png",
      sleep: "./assets/passenger-dad-sleep.png",
    },
    grandpa: {
      normal: "./assets/passenger-grandpa-normal.png",
      laugh: "./assets/passenger-grandpa-laugh.png",
      sleep: "./assets/passenger-grandpa-sleep.png",
    },
    grandma: {
      normal: "./assets/passenger-grandma-normal.png",
      laugh: "./assets/passenger-grandma-laugh.png",
      sleep: "./assets/passenger-grandma-sleep.png",
    },
    baby: {
      normal: "./assets/passenger-baby-normal.png",
      laugh: "./assets/passenger-baby-laugh.png",
      sleep: "./assets/passenger-baby-sleep.png",
    },
  },
  relationshipSeats: {
    "年轻朋友": { driver: "maleYoung", front: "femaleYoung", rearLeft: "maleYoung", rearRight: "femaleYoung" },
    "父母+小孩": { driver: "dad", front: "mom", rearLeft: "boy", rearRight: "girl" },
    "中老年+儿女": { driver: "maleYoung", front: "femaleYoung", rearLeft: "grandpa", rearRight: "grandma" },
  },
  environments: {
    高速路晴天白天: { screen: "scenicDay", cabin: "scenicDay", screenClass: "screen-sunny", cabinClass: "env-highway-day" },
    高速路晴天深夜: { screen: "deepNight", cabin: "deepNight", screenClass: "screen-night", cabinClass: "env-highway-night" },
    高速路雨天白天: { screen: "scenicSunset", cabin: "scenicSunset", screenClass: "screen-rain", cabinClass: "env-highway-rain" },
    城区晴天白天: { screen: "cityDay", cabin: "cityDay", screenClass: "screen-sunny", cabinClass: "env-city-day" },
    城区夜晚: { screen: "cityNight", cabin: "cityNight", screenClass: "screen-night", cabinClass: "env-city-night" },
    城区雨天白天: { screen: "cityDay", cabin: "cityDay", screenClass: "screen-rain", cabinClass: "env-city-rain" },
    车库: { screen: "default", cabin: "garage", screenClass: "screen-default", cabinClass: "env-garage" },
    隧道: { screen: "default", cabin: "tunnel", screenClass: "screen-default", cabinClass: "env-tunnel" },
    雨天: { screen: "rain", cabin: "rain", screenClass: "screen-rain", cabinClass: "env-rain" },
    风景区晴天白天: { screen: "scenicDay", cabin: "scenicDay", screenClass: "screen-sunny", cabinClass: "env-scenic-day" },
    风景区傍晚: { screen: "scenicSunset", cabin: "scenicSunset", screenClass: "screen-sunny", cabinClass: "env-scenic-sunset" },
    风景区雪景白天: { screen: "snowDay", cabin: "snowDay", screenClass: "screen-snow", cabinClass: "env-snow-day" },
    风景区晴天深夜: { screen: "deepNight", cabin: "deepNight", screenClass: "screen-night", cabinClass: "env-scenic-night" },
  },
};

const ENVIRONMENT_DESCRIPTIONS = {
  车库: { name: "车库", detail: "室内车库" },
  隧道: { name: "隧道", detail: "室内隧道" },
  雨天: { name: "雨天", detail: "车外下雨，路面湿润" },
  风景区雪景白天: { name: "雪景", detail: "白天雪景" },
  城区晴天白天: { name: "城市白天", detail: "现代城市白天" },
  城区夜晚: { name: "城市夜晚", detail: "赛博城市" },
  风景区晴天白天: { name: "风景区", detail: "白天风景" },
  风景区傍晚: { name: "傍晚", detail: "风景区傍晚" },
  风景区晴天深夜: { name: "深夜", detail: "寂静深夜" },
};

function getEnvironmentDescription(environment) {
  return ENVIRONMENT_DESCRIPTIONS[environment] || { name: environment, detail: environment };
}

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
  direct_answer: "直接回答",
  encourage: "鼓励继续",
  invite_collaboration: "邀请协作",
  soft_response: "柔和回应",
  defer_interruption: "等待合适时机回应",
  bridge_to_game: "自然带回游戏",
  resume_game: "恢复当前游戏",
  closing: "自然收尾",
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

const HOST_EMOTION_AVATAR_STATE = {
  normal: "normal",
  speak: "speak",
  neutral: "normal",
  thinking: "thinking",
  serious: "normal",
  care: "normal",
  comfort: "smile",
  confident: "smile",
  observing: "smile",
  smile: "smile",
  smiling: "smile",
  laugh: "smile",
  happy: "smile",
  awkward: "awkward",
  embarrassed: "awkward",
  sorry: "awkward",
  excited: "excited",
  celebrating: "excited",
  victory: "excited",
  普通: "normal",
  思考: "thinking",
  思考中: "thinking",
  笑: "smile",
  微笑: "smile",
  尴尬: "awkward",
  兴奋: "excited",
};

const RIDDLES = [
  {
    answer: "雨伞",
    theme: "雨天",
    hint: "这题和外面的雨有关，答案是车里很多人都会带的东西。",
  },
  {
    answer: "安全带",
    theme: "高速",
    hint: "它平时很安静，但关键时刻比主持人还可靠。",
  },
  {
    answer: "斧头",
    theme: "朋友",
    hint: "它常出现在故事里，硬核、直接，和砍东西有关。",
  },
  {
    answer: "米老鼠",
    theme: "迪士尼",
    hint: "如果目的地是迪士尼，这位老朋友大概率会第一个出来打招呼。",
  },
  {
    answer: "火锅",
    theme: "家庭",
    hint: "全家人围在一起时，它很容易成为气氛中心。",
  },
  {
    answer: "雪人",
    theme: "雪景",
    hint: "它怕热，但在风景区雪景里特别应景。",
  },
  {
    answer: "红绿灯",
    theme: "城区",
    hint: "城市里最会指挥交通的三色选手。",
  },
  {
    answer: "书包",
    theme: "学校",
    hint: "去学校时，它通常比本人还早进入战备状态。",
  },
  {
    answer: "方向盘",
    theme: "驾驶",
    hint: "主驾最熟悉它，但现在先让副驾和后排来猜。",
  },
  {
    answer: "草原",
    theme: "风景",
    hint: "它很开阔，适合风景区，也适合把心情放大一点。",
  },
];

const PASSENGER_PERSONAS_BY_RELATIONSHIP = {
  "父母+小孩": {
    driver: {
      name: "主驾家长",
      role: "家长",
      age_group: "middle_aged",
      persona: "稳重、关注安全、熟悉家庭出行",
      style: "短句、克制，安全条件允许时偶尔参与",
      can_guess: true,
      is_real_user: false,
    },
    front: {
      name: "副驾真实用户",
      role: "家长",
      age_group: "adult",
      persona: "主要玩家，负责关键提问和猜答案",
      style: "由真实用户决定",
      can_guess: true,
      is_real_user: true,
    },
    rear_left: {
      name: "后排家庭成员",
      role: "青少年",
      age_group: "teen",
      persona: "稳健、愿意补充线索",
      style: "简短、先缩小类别再猜",
      can_guess: true,
      is_real_user: false,
    },
    rear_right: {
      name: "后排小朋友",
      role: "小朋友",
      age_group: "child",
      persona: "好奇、兴奋、喜欢动画和食物",
      style: "短句、直接、偶尔跳脱",
      can_guess: true,
      is_real_user: false,
    },
  },
  年轻朋友: {
    driver: {
      name: "主驾朋友",
      role: "年轻朋友",
      age_group: "young_adult",
      persona: "专注驾驶、偶尔接梗",
      style: "短句、轻松，安全优先",
      can_guess: true,
      is_real_user: false,
    },
    front: {
      name: "副驾真实用户",
      role: "年轻朋友",
      age_group: "young_adult",
      persona: "主要玩家，负责关键提问和猜答案",
      style: "由真实用户决定",
      can_guess: true,
      is_real_user: true,
    },
    rear_left: {
      name: "后排左朋友",
      role: "年轻朋友",
      age_group: "young_adult",
      persona: "脑洞大、喜欢玩梗",
      style: "轻松、直接、偶尔吐槽",
      can_guess: true,
      is_real_user: false,
    },
    rear_right: {
      name: "后排右朋友",
      role: "年轻朋友",
      age_group: "young_adult",
      persona: "观察细、擅长补关键问题",
      style: "简短、有策略",
      can_guess: true,
      is_real_user: false,
    },
  },
  "中老年+儿女": {
    driver: {
      name: "主驾儿女",
      role: "成年儿女",
      age_group: "middle_aged",
      persona: "稳重、照顾家人、重视安全",
      style: "短句、克制，安全条件允许时参与",
      can_guess: true,
      is_real_user: false,
    },
    front: {
      name: "副驾真实用户",
      role: "成年儿女",
      age_group: "adult",
      persona: "主要玩家，负责关键提问和猜答案",
      style: "由真实用户决定",
      can_guess: true,
      is_real_user: true,
    },
    rear_left: {
      name: "后排长辈",
      role: "长辈",
      age_group: "elder",
      persona: "沉稳、有生活经验",
      style: "语气平和、问题务实",
      can_guess: true,
      is_real_user: false,
    },
    rear_right: {
      name: "后排家人",
      role: "长辈",
      age_group: "elder",
      persona: "耐心、善于从生活经验判断",
      style: "稳健、不过度抢话",
      can_guess: true,
      is_real_user: false,
    },
  },
};

const ROUND_GOLDEN_TIMELINES = [
  {
    id: "round_collaborative",
    name: "轮流破题",
    steps: [
      { delay: 10000, type: "passenger_question", label: "乘客开始提问" },
      { delay: 30000, type: "passenger_question", label: "另一位乘客接力提问" },
      { delay: 50000, type: "passenger_question", label: "乘客继续缩小范围" },
      { delay: 70000, type: "passenger_question", label: "乘客补充关键一问" },
    ],
  },
  {
    id: "round_cabin_mood",
    name: "轻松玩梗",
    steps: [
      { delay: 10000, type: "passenger_question", label: "乘客开始提问" },
      { delay: 30000, type: "passenger_question", label: "乘客顺势接力提问" },
      { delay: 70000, type: "passenger_question", label: "乘客换个方向提问" },
    ],
  },
  {
    id: "round_safety_interrupt",
    name: "安全控场",
    steps: [
      { delay: 10000, type: "passenger_question", label: "乘客开始提问" },
      { delay: 50000, type: "passenger_question", label: "安全座位接力提问" },
      { delay: 70000, type: "passenger_question", label: "恢复后乘客继续提问" },
    ],
  },
  {
    id: "round_quiet_care",
    name: "安静照顾",
    steps: [
      { delay: 10000, type: "passenger_question", label: "乘客开始提问" },
      { delay: 30000, type: "passenger_question", label: "清醒乘客继续提问" },
      { delay: 50000, type: "passenger_question", label: "乘客补充关键一问" },
    ],
  },
];

const GOLDEN_TIMELINES = [
  {
    id: "golden_city_scenic_family",
    name: "城市风景亲子游",
    speed: 80,
    destination: "迪士尼",
    relationship: "父母+小孩",
    environment: "车库",
    previewEnvironment: "城区晴天白天",
    personas: { driver: "dad", front: "mom", rear_left: "boy", rear_right: "girl" },
    durationMs: 300_000,
    steps: [
      { delay: 20000, type: "environment_change", value: "城区晴天白天", label: "切换至城市白天" },
      { delay: 120000, type: "environment_change", value: "风景区晴天白天", label: "切换至风景区" },
      { delay: 140000, type: "passenger_sleep", label: "有乘客睡着" },
      { delay: 160000, type: "hard_brake", label: "急刹，安全暂停" },
      { delay: 220000, type: "passenger_wake", label: "有乘客醒来" },
      { delay: 240000, type: "driver_tired", label: "主驾疲惫" },
      { delay: 260000, type: "cabin_laughing", label: "车内欢笑" },
      { delay: 280000, type: "near_destination", label: "快到目的地" },
    ],
    riddleIndex: 1,
    trace: {
      perception: "载入城市风景亲子游体验线",
      decision: "默认副驾为真实用户，后排小朋友可自动加入",
      execution: "从车库出发，先城市白天、再风景区",
      strategyId: "GOLDEN-A",
      priority: "P3",
    },
  },
  {
    id: "golden_cyber_city_friends",
    name: "赛博城市朋友夜游",
    speed: 50,
    destination: "夜市",
    relationship: "年轻朋友",
    environment: "城区夜晚",
    previewEnvironment: "城区夜晚",
    personas: { driver: "maleYoung", front: "femaleYoung", rear_left: "maleYoung", rear_right: "femaleYoung" },
    durationMs: 300_000,
    steps: [
      { delay: 60000, type: "cabin_laughing", label: "车内欢笑" },
      { delay: 120000, type: "environment_change", value: "隧道", label: "进入隧道" },
      { delay: 140000, type: "passenger_sleep", label: "有乘客睡着" },
      { delay: 160000, type: "temporary_interruption", reason: "complex_road", label: "进入复杂路段，暂停互动" },
      { delay: 180000, type: "environment_change", value: "城区夜晚", label: "回到城市夜晚" },
      { delay: 220000, type: "speed_overspeed", label: "超速提醒" },
      { delay: 240000, type: "passenger_wake", label: "有乘客醒来" },
      { delay: 260000, type: "driver_tired", label: "主驾疲惫" },
      { delay: 280000, type: "near_destination", label: "快到目的地" },
    ],
    riddleIndex: 6,
    trace: {
      perception: "载入赛博城市朋友夜游体验线",
      decision: "朋友局采用轻松节奏，同时守住夜间驾驶安全",
      execution: "从城市夜晚出发，经隧道后回到城市夜晚",
      strategyId: "GOLDEN-B",
      priority: "P3",
    },
  },
  {
    id: "golden_snow_rain_elder_family",
    name: "雪景雨天长辈同行",
    speed: 50,
    destination: "草原",
    relationship: "中老年+儿女",
    environment: "风景区雪景白天",
    previewEnvironment: "风景区雪景白天",
    personas: { driver: "maleYoung", front: "femaleYoung", rear_left: "grandpa", rear_right: "grandma" },
    durationMs: 300_000,
    steps: [
      { delay: 40000, type: "passenger_sleep", label: "有乘客睡着" },
      { delay: 120000, type: "environment_change", value: "隧道", label: "进入隧道" },
      { delay: 140000, type: "hard_brake", label: "急刹，安全暂停" },
      { delay: 180000, type: "environment_change", value: "雨天", label: "切换至白天下大雨" },
      { delay: 240000, type: "passenger_wake", label: "有乘客醒来" },
      { delay: 260000, type: "driver_tired", label: "主驾疲惫" },
      { delay: 280000, type: "near_destination", label: "快到目的地" },
    ],
    riddleIndex: 5,
    trace: {
      perception: "载入雪景雨天长辈同行体验线",
      decision: "放慢节奏，优先照顾休息乘员与驾驶安全",
      execution: "从白天雪景出发，经隧道后进入雨天",
      strategyId: "GOLDEN-C",
      priority: "P3",
    },
  },
  {
    id: "golden_sunset_night_family_return",
    name: "傍晚深夜家庭返程",
    speed: 50,
    destination: "观星营地",
    relationship: "父母+小孩",
    environment: "风景区傍晚",
    previewEnvironment: "风景区傍晚",
    personas: { driver: "dad", front: "maleYoung", rear_left: "mom", rear_right: "baby" },
    durationMs: 300_000,
    steps: [
      { delay: 20000, type: "driver_tired", label: "主驾疲惫" },
      { delay: 60000, type: "passenger_sleep", label: "有乘客睡着" },
      { delay: 120000, type: "environment_change", value: "风景区晴天深夜", label: "切换至深夜" },
      { delay: 140000, type: "temporary_interruption", reason: "complex_road", label: "进入复杂路段，暂停互动" },
      { delay: 240000, type: "passenger_wake", label: "有乘客醒来" },
      { delay: 260000, type: "cabin_laughing", label: "车内欢笑" },
      { delay: 280000, type: "near_destination", label: "快到目的地" },
    ],
    riddleIndex: 8,
    trace: {
      perception: "载入傍晚深夜家庭返程体验线",
      decision: "保持安静节奏，保护疲惫主驾和休息乘员",
      execution: "从风景区傍晚出发，夜间继续返程",
      strategyId: "GOLDEN-D",
      priority: "P3",
    },
  },
  {
    id: "golden_scenic_city_family",
    name: "风景归城家人同行",
    speed: 50,
    destination: "草原",
    relationship: "年轻朋友",
    environment: "风景区晴天白天",
    previewEnvironment: "风景区晴天白天",
    personas: { driver: "mom", front: "femaleYoung", rear_left: "maleYoung", rear_right: "femaleYoung" },
    durationMs: 300_000,
    steps: [
      { delay: 20000, type: "cabin_laughing", label: "车内欢笑" },
      { delay: 60000, type: "speed_overspeed", label: "超速提醒" },
      { delay: 80000, type: "environment_change", value: "隧道", label: "进入隧道" },
      { delay: 120000, type: "temporary_interruption", reason: "complex_road", label: "进入复杂路段，暂停互动" },
      { delay: 160000, type: "environment_change", value: "城区晴天白天", label: "切换至城市白天" },
      { delay: 180000, type: "passenger_sleep", label: "有乘客睡着" },
      { delay: 220000, type: "hard_brake", label: "急刹，安全暂停" },
      { delay: 240000, type: "driver_tired", label: "主驾疲惫" },
      { delay: 275000, type: "passenger_wake", label: "有乘客醒来" },
      { delay: 280000, type: "near_destination", label: "快到目的地" },
    ],
    riddleIndex: 9,
    trace: {
      perception: "载入风景归城家人同行体验线",
      decision: "多事件重叠时优先安全并保留有效待答状态",
      execution: "从风景区出发，经隧道后回到城市白天",
      strategyId: "GOLDEN-E",
      priority: "P2",
    },
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
    driverSafetySince: 0,
  },
  game: {
    status: "idle",
    roundIndex: 1,
    totalRounds: GAME_ROUND_COUNT,
    questionCount: 0,
    maxQuestions: 15,
    currentRiddleIndex: 1,
    playedRiddleIndices: [],
    history: [],
    roundQuestionPlan: null,
    usedRoundQuestionStepIds: [],
    coveredFactKeys: [],
    publicClues: [],
    performance: { results: [], contributions: {}, lastFeedbackRound: 0 },
  },
  host: {
    text: "我已经准备好第一道题了，等你发令。",
    emotion: "normal",
    avatarState: HOST_AVATAR_DEFAULT_STATE,
    targetSeat: null,
    preferences: { praise: true, brief: false, invitations: true, independent: false },
  },
  ui: {
    cabinMode: "normal",
    sleepComfortSeats: [],
    zoneLights: { driver: true, front: true, rearLeft: true, rearRight: true },
    lightsBeforeSleep: {},
    animation: "idle",
    screenEnvironment: GOLDEN_TIMELINES[0].environment,
    screenEnvironmentTimer: null,
    screenEnvironmentTransitionId: 0,
    importantEvent: {
      text: "",
      phase: "hidden",
      timer: null,
      hideTimer: null,
      id: 0,
    },
    showAnswer: false,
    correctSeat: null,
    correctLightSeat: null,
    alert: "",
  },
  timeline: {
    id: GOLDEN_TIMELINES[0].id,
    name: GOLDEN_TIMELINES[0].name,
    roundTimelineId: "",
    roundTimelineName: "",
    lastRoundTimelineId: "",
    roundTimelineHistory: [],
    lastPassengerSeat: "",
    goldenSleepingSeat: "",
    currentEventType: "",
    status: "idle",
    runId: 0,
    startedAt: 0,
    elapsedSeconds: 0,
    environmentTransitionTimer: null,
    currentEvent: "准备好后点击开始模拟，系统会按时间轴触发座舱事件。",
  },
  decisionTrace: {
    id: 0,
    receipts: {},
    source: "local",
    debug: null,
    perception: "",
    decision: "",
    execution: "",
    strategyId: "",
    priority: "",
    executionActions: [],
  },
  workflow: {
    inFlight: false,
    activeRequestId: 0,
    activeLabel: "",
    activeController: null,
    timeoutTimer: null,
    lastBubbleShownAt: 0,
    lastResumeAt: 0,
    lastPassengerActionKey: "",
    bubbleTimer: null,
    recoveryTimer: null,
    safetyResumeContext: null,
    playerGamePause: null,
    interruption: null,
    activeChatInput: null,
    activityTimer: null,
    correctLightTimer: null,
    nextRoundTimer: null,
    previewPending: false,
    nextRiddleRefreshTimer: null,
    environmentRoundIntro: null,
    hostThinkingCycleId: 0,
    hostThinkingStartedAt: 0,
    hostThinkingTimer: null,
    hostThinkingActive: false,
    hostAwaitingReply: false,
    hostAvatarTimer: null,
    summarySpeechTimer: null,
    lastChatIntent: "",
    lastChatReplyMode: "",
    lastChatWasBridge: false,
    chatTurnCount: 0,
    driverSafetyTimer: null,
    driverSafetyEpisode: 0,
    driverSafetyAnnouncedEpisode: 0,
    environmentSpeechSequence: 0,
    pendingEnvironmentSpeech: null,
    pendingEnvironmentSpeechTimer: null,
    pendingMinimumSpeech: null,
    pendingMinimumSpeechTimer: null,
    pendingMinimumSpeechSequence: 0,
    previousSpeed: 0,
    situationRequestId: 0,
    situationInFlight: false,
    situationRequests: {},
    situationEventIds: {},
    situationEvents: [],
    situationEventSequence: 0,
    pendingSituationReplies: [],
    deferredHostReplies: [],
    deferredHostRepliesTimer: null,
    participation: {
      roundId: "", revision: 0, lastUserElapsedMs: 0, lastDialogueElapsedMs: 0,
      userTurnCount: 0, analysisRequested: false, invitationDeclined: false,
    },
    lastSituationObservation: null,
    resultFeedback: null,
    gameId: "",
    p0Epoch: 0,
    hostSpeech: {
      id: 0,
      priority: 0,
      source: "",
      expiresAt: 0,
      visibleAt: 0,
      timer: null,
      startActions: null,
      voiceRequested: false,
      voicePending: false,
      voicePlaying: false,
      voiceFinished: false,
    },
    pendingChats: [],
  },
  health: {
    release: "",
    runtime: "",
    focus: "",
    proxyConfigured: null,
    workflowTimeoutMs: WORKFLOW_CLIENT_TIMEOUT_MS,
    workflowReadiness: null,
    statusText: DEFAULT_DEPLOY_STATUS,
    hostVoiceConfigured: false,
  },
};

const state = structuredClone(DEFAULT_STATE);
let goldenExperience = null;
let lastPresetStartedAt = null;
try {
  const preferences = JSON.parse(localStorage.getItem(HOST_PREFERENCES_STORAGE_KEY) || "null");
  for (const key of Object.keys(state.host.preferences)) {
    if (typeof preferences?.[key] === "boolean") state.host.preferences[key] = preferences[key];
  }
} catch { /* Ignore older or malformed preference storage. */ }
const executionRecords = new Map();
const roundQuestionPreparations = new Map();
const scenarioFirstRoundPreparations = new Map();
const scenarioFirstRoundReservations = new Map();
const startupLoading = { initialized: false, active: false, tasks: [], timedOut: false,
  timer: 0, entering: false, backgroundStarted: false };
let nextGamePreparation = null;
const persistedDifyRoundScope = loadDifyRoundScope();
state.workflow.gameId = persistedDifyRoundScope?.gameId || createRuntimeId("game");
if (persistedDifyRoundScope) {
  state.game.roundIndex = persistedDifyRoundScope.roundIndex;
  state.game.currentRiddleIndex = persistedDifyRoundScope.currentRiddleIndex;
}
persistDifyRoundScope();
const els = {};
let fullscreenHintTimer = 0;
let fullscreenAskBarParent = null;
let fullscreenAskBarNextSibling = null;
let soundOnboardingTimer = 0;
let playerInputGuideDismissed = false;
let audioContext = null;
const backgroundMusic = {
  enabled: false,
  volume: 0.25,
};
let lastRenderedScreenMode = "";
const hostSceneMotion = { mode: "", completed: false };
const clientRuntimeDiagnostic = { enabled: false, sessionId: "", lastVoiceSkip: "", startedAt: 0, count: 0, runtimeErrorCount: 0 };
const questionClock = {
  intervalId: 0,
  urgentSoundTimer: 0,
  startedAt: 0,
  pausedAt: 0,
  pausedDurationMs: 0,
  roundIndex: 0,
  active: false,
  expired: false,
  lastUrgentSecond: null,
};
const questionIntro = {
  timerId: 0,
  roundIndex: 0,
  active: false,
};
const hostSprite = {
  source: "",
  frames: [],
  image: null,
  frameIndex: 0,
  elapsedMs: 0,
  totalDurationMs: 0,
  audio: null,
  audioSource: null,
  audioGain: null,
  audioElement: null,
  audioTimerId: 0,
  audioGeneration: 0,
  fallbackTimerId: 0,
  lastTimestamp: 0,
  animationFrameId: 0,
  loading: false,
  playing: false,
  completed: false,
  loop: false,
  fallback: false,
  loadId: 0,
  thinkingCycleId: 0,
};
const hostSpriteImageCache = new Map();
const manualEventCooldowns = new Set();
const confettiAnimation = {
  frameId: 0,
  lastTimestamp: 0,
  particles: [],
  width: 1440,
  height: 810,
  dpr: 1,
};
const summaryConfettiAnimation = {
  frameId: 0,
  lastTimestamp: 0,
  particles: [],
  burstParticles: [],
  width: 1440,
  height: 810,
  dpr: 1,
  startedAt: 0,
  burstStarted: false,
  fallingVisible: false,
};
const SUMMARY_CONFETTI_CONFIG = Object.freeze({
  count: 15,
  fallSpeedMultiplier: 1.2,
  sizeMultiplier: 1.2,
  burstDelayMs: 1500,
  loopStartMs: 2800,
  burstCount: 100,
  burstCenterX: 524,
  burstCenterY: 423,
  burstSpawnRadius: 44,
  burstSpeedMin: 2,
  burstSpeedMax: 14,
  burstGravity: 0.12,
});

function boot() {
  clientRuntimeDiagnostic.enabled = true;
  cacheElements();
  bindEvents();
  resizeStage();
  startupLoading.initialized = true;
  startupLoading.active = true;
  applyGoldenLineDefaults(getActiveGoldenLine(), false);
  render();
  recordClientPageState("boot");
  syncBackgroundMusicToggle();
  startBackgroundMusic();
  loadHealthStatus();
  startStartupLoading();
}

async function waitForPreloadForeground() {
  await simulationRuntime.waitUntilRunning();
  if (document.visibilityState !== "hidden" && document.hasFocus()) return;
  await new Promise(resolve => {
    const resume = () => {
      if (document.visibilityState === "hidden" || !document.hasFocus()) return;
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      resolve();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    resume();
  });
  await simulationRuntime.waitUntilRunning();
}

function loadStartupImage(src) {
  const request = loadHostSpriteImage(src);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("asset_timeout")), 20000);
    request.then(image => image.decode ? image.decode() : undefined)
      .then(resolve, reject).finally(() => window.clearTimeout(timer));
  }).catch(error => {
    if (hostSpriteImageCache.get(src) === request) hostSpriteImageCache.delete(src);
    throw error;
  });
}

async function runPreloadQueue(items, worker, concurrency = 2) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      await waitForPreloadForeground();
      const item = items[index++];
      if (item !== undefined) await worker(item);
    }
  }));
}

function startStartupLoading() {
  const images = new Set([
    RESOURCE_CONFIG.screenBackgrounds.default,
    RESOURCE_CONFIG.host.greeting.src,
    ...[...document.querySelectorAll(".ready-stage img, .cabin-region img, .pencil-game-icon img, .question-counter img")]
      .map(image => image.getAttribute("src")).filter(Boolean),
  ]);
  const preparation = ensureCurrentRoundPreparation();
  const source = preparation.scenarioSource || preparation;
  const imageTasks = [...images].map(src => ({
    id: src, weight: src === RESOURCE_CONFIG.host.greeting.src ? 4 : 1,
    status: "created", attempts: 0, load: () => loadStartupImage(src),
  }));
  const previewTask = { id: "first-preview", weight: 8, status: "created", attempts: 0,
    async load(retry) {
      if (retry && ["failed", "partial"].includes(source.status) && !source.repairPending) {
        source.promise = requestPreparedRound(source);
      }
      await adoptScenarioPreview(preparation, source);
      if (preparation.status !== "ready" || !preparation.plan) throw new Error("preview_not_ready");
    },
  };
  const fontTask = { id: "fonts", weight: 1, status: "created", attempts: 0,
    load: () => document.fonts?.ready || Promise.resolve() };
  startupLoading.tasks = [...imageTasks, fontTask, previewTask];
  armStartupDeadline();
  void runPreloadQueue(imageTasks, runStartupTask, 4);
  void runStartupTask(fontTask);
  void runStartupTask(previewTask);
  updateStartupLoading();
}

function armStartupDeadline() {
  simulationRuntime.clearTimeout(startupLoading.timer);
  startupLoading.timedOut = false;
  startupLoading.timer = simulationRuntime.setTimeout(() => {
    startupLoading.timedOut = true;
    updateStartupLoading();
  }, 20000);
}

async function runStartupTask(task) {
  if (task.status === "pending" || task.status === "ready") return;
  task.status = "pending";
  task.attempts += 1;
  simulationRuntime.defer(updateStartupLoading);
  try {
    await task.load(task.attempts > 1);
    task.status = "ready";
  } catch (error) {
    task.status = "failed";
    task.error = error.message === "asset_timeout" ? "asset_timeout"
      : task.id === "first-preview" ? "preview_not_ready" : "resource_failed";
    console.warn("[game-loading]", { task: task.id, reason: task.error, attempt: task.attempts });
  }
  simulationRuntime.defer(updateStartupLoading);
}

function updateStartupLoading() {
  if (!startupLoading.active || !els.loadingProgress || simulationRuntime.paused) return;
  const tasks = startupLoading.tasks;
  const total = tasks.reduce((sum, task) => sum + task.weight, 0);
  const done = tasks.filter(task => task.status === "ready").reduce((sum, task) => sum + task.weight, 0);
  const percent = total ? Math.floor(done / total * 100) : 0;
  const failed = tasks.some(task => task.status === "failed");
  const complete = tasks.length > 0 && tasks.every(task => task.status === "ready");
  els.loadingProgress.style.width = `${percent}%`;
  els.loadingProgress.parentElement.setAttribute("aria-valuenow", String(percent));
  els.loadingPercent.textContent = `${percent}%`;
  els.loadingActions.hidden = !failed && !startupLoading.timedOut;
  els.loadingRetry.disabled = !failed;
  els.loadingStatus.textContent = complete ? "旅途已就绪"
    : failed ? "部分加载失败，可重试"
      : startupLoading.timedOut ? "加载时间较长，可以先进入"
        : tasks.filter(task => task.id !== "first-preview").every(task => task.status === "ready")
          ? "正在准备首题…" : "正在加载旅途…";
  if (complete && !startupLoading.entering) {
    startupLoading.entering = true;
    simulationRuntime.setTimeout(enterPreparedGame, 180);
  }
}

function retryStartupLoading() {
  if (!startupLoading.active) return;
  armStartupDeadline();
  void runPreloadQueue(startupLoading.tasks.filter(task => task.status === "failed"), runStartupTask, 4);
  updateStartupLoading();
}

function enterPreparedGame() {
  if (!startupLoading.active) return;
  startupLoading.active = false;
  simulationRuntime.clearTimeout(startupLoading.timer);
  render();
  recordClientPageState("ready");
  startBackgroundPreloading();
}

function startBackgroundPreloading() {
  if (startupLoading.backgroundStarted) return;
  startupLoading.backgroundStarted = true;
  const scenarios = GOLDEN_TIMELINES.filter(scenario => scenario.id !== GOLDEN_TIMELINES[0].id);
  void runPreloadQueue(scenarios, async scenario => {
    await getScenarioFirstRoundPreparation(scenario).promise;
  }, 1);
  void preloadHostSpriteImages();
  const images = new Set();
  for (const scenario of GOLDEN_TIMELINES) {
    const environments = [scenario.environment, scenario.previewEnvironment,
      ...(scenario.steps || []).filter(step => step.type === "environment_change").map(step => step.value)];
    for (const environment of new Set(environments.filter(Boolean))) {
      const assets = resolveEnvironmentAssets(environment);
      images.add(assets.screen);
      images.add(assets.cabin);
    }
    for (const persona of getScenarioPersonaKeys(scenario)) {
      images.add(RESOURCE_CONFIG.passengers[persona].normal);
    }
  }
  void runPreloadQueue([...images], src => loadStartupImage(src).catch(() => {}));
}

function cacheElements() {
  [
    "stageViewport",
    "environmentBackdrop",
    "appShell",
    "environmentLabel",
    "speedLabel",
    "destinationLabel",
    "gameRegion",
    "gameScreen",
    "gameFullscreenButton",
    "fullscreenHint",
    "controlAskBar",
    "backgroundMusic",
    "backgroundMusicToggle",
    "backgroundMusicToggleGame",
    "soundOnboarding",
    "confettiCanvas",
    "summaryConfettiCanvas",
    "roundProgress",
    "questionProgress",
    "pencilProgressRail",
    "pencilRailFill",
    "pencilProgressDots",
    "stageLabel",
    "questionTimer",
    "questionTimerProgress",
    "answerLengthHint",
    "riddleTitle",
    "riddleHint",
    "answerReveal",
    "revealAnswerText",
    "revealSeatLabel",
    "revealOutcomeLabel",
    "remainingQuestions",
    "hostBubble",
    "hostAvatar",
    "hostMedia",
    "hostImage",
    "hostCanvas",
    "loadingProgress",
    "loadingPercent",
    "loadingStatus",
    "loadingActions",
    "loadingRetry",
    "loadingContinue",
    "summaryStats",
    "summaryTotal",
    "summarySolved",
    "summaryMvp",
    "summaryContinue",
    "readyStartButton",
    "timelineName",
    "startTimeline",
    "pauseTimeline",
    "inactivePauseOverlay",
    "resumeInactiveSimulation",
    "prestartPanel",
    "decisionPerception",
    "decisionPriority",
    "decisionDecision",
    "decisionExecution",
    "importantEvent",
    "importantEventText",
    "switchScenario",
    "resetScenario",
    "playerInput",
    "playerInputGuide",
    "sendQuestion",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });

  els.speedChips = document.querySelectorAll("[data-speed]");
  els.environmentChips = document.querySelectorAll("[data-environment]");
  els.eventButtons = document.querySelectorAll("[data-event]");
  els.seats = document.querySelectorAll("[data-seat]");
  els.sleepShades = document.querySelectorAll("[data-sleep-shade]");
  els.comfortZones = document.querySelectorAll("[data-comfort-zone]");
}

function bindEvents() {
  const pauseWhenInactive = () => {
    if (document.visibilityState === "hidden" || !document.hasFocus()) {
      if (!simulationRuntime.paused && (startupLoading.active || state.timeline.status !== "idle" || state.game.status !== "idle")) {
        simulationFreeze.autoPaused = true;
        toggleTimelinePause();
      }
    }
  };
  document.addEventListener("visibilitychange", pauseWhenInactive);
  window.addEventListener("blur", pauseWhenInactive);
  window.addEventListener("resize", syncViewportLayout);
  window.addEventListener("pageshow", () => {
    syncViewportLayout();
    recordClientPageState("pageshow");
  });
  window.addEventListener("focus", () => {
    syncViewportLayout();
    recordClientPageState("focus");
  });
  document.addEventListener("pointerdown", () => {
    if (simulationRuntime.paused) return;
    prepareAudioContext();
    startBackgroundMusic();
  });
  els.gameFullscreenButton.addEventListener("click", toggleGameDisplayMode);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.appShell.classList.contains("game-display-expanded")) {
      exitGameDisplayMode();
    }
  });
  els.backgroundMusicToggle.addEventListener("click", () => {
    dismissSoundOnboarding();
    setBackgroundMusicEnabled(!backgroundMusic.enabled);
  });
  els.backgroundMusicToggleGame.addEventListener("click", () => {
    dismissSoundOnboarding();
    setBackgroundMusicEnabled(!backgroundMusic.enabled);
  });
  els.switchScenario.addEventListener("click", nextGoldenLine);
  els.resetScenario.addEventListener("click", resetCurrentGoldenLine);
  els.summaryContinue.addEventListener("click", resetCurrentGoldenLine);
  els.readyStartButton.addEventListener("click", startGoldenTimeline);
  els.loadingRetry.addEventListener("click", retryStartupLoading);
  els.loadingContinue.addEventListener("click", enterPreparedGame);
  els.startTimeline.addEventListener("click", startGoldenTimeline);
  els.pauseTimeline.addEventListener("click", toggleTimelinePause);
  els.resumeInactiveSimulation.addEventListener("click", toggleTimelinePause);
  els.sendQuestion.addEventListener("click", sendQuestion);
  els.playerInput.addEventListener("focus", dismissPlayerInputGuide);
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
      const previousEnvironment = state.car.environment;
      setEnvironment(button.dataset.environment);
      dispatchWorkflow("event", {
        type: "environment_change",
        value: button.dataset.environment,
        previous_value: previousEnvironment,
      });
    });
  });

  els.eventButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      if (!beginManualEventCooldown(els.eventButtons)) return;
      const type = button.dataset.event;
      if (type === "hard_brake") {
        applyImmediateSafetyPause();
      }
      const reason = button.dataset.eventReason;
      if (type === "temporary_interruption") applyTemporaryInterruption({ reason });
      if (type === "driver_distracted") {
        applyImmediateDriverTired("distracted");
        clearDriverSafetyAnnouncement();
      }
      const eventSeat = type === "passenger_wake" ? getManualWakeSeat()
        : ["passenger_sleep", "cabin_laughing"].includes(type) ? "rearRight" : state.passengers.selectedSeat;
      if (!eventSeat) {
        state.ui.alert = "当前没有睡着的乘客";
        render();
        return;
      }
      showImportantEvent(reason === "complex_road" ? "进入复杂路段" : getImportantEventText(type, eventSeat));
      if (type === "passenger_sleep") {
        applyImmediatePassengerSleep(eventSeat);
      }
      if (type === "driver_tired") {
        applyImmediateDriverTired();
        clearDriverSafetyAnnouncement();
        render();
      }
      if (type === "passenger_wake") {
        applyImmediatePassengerWake(eventSeat);
      }
      if (type === "game_stuck" || type === "near_answer") {
        state.perception.gameProgress = type === "game_stuck" ? "stuck" : "near_answer";
      }
      if (type === "cabin_laughing") {
        state.passengers.seats[eventSeat].mood = "大笑";
        state.passengers.seats[eventSeat].activity = "idle";
        state.passengers.seats[eventSeat].activityLabel = "";
      }
      if (type === "near_destination") {
        applyImmediateNearDestination();
      }
      let event = { type, seat: eventSeat, source: "manual_control" };
      if (reason === "complex_road") event = { ...event, reason, description: "进入复杂路段，暂时暂停游戏，保留问答进度" };
      if (type === "driver_tired") {
        event = { ...event, duration_ms: DRIVER_SAFETY_HOLD_MS + 1, state: "fatigued", priority: "P1" };
      }
      if (type === "speed_overspeed") {
        const previousSpeed = state.car.speed;
        state.car.speed = Math.max(130, Number(state.car.speed) || 0);
        state.ui.alert = `车速已更新为 ${state.car.speed} km/h`;
        event = {
          ...event,
          value: state.car.speed,
          previous_value: Math.min(previousSpeed, 120),
          threshold_kmh: 120,
          priority: "P1",
        };
      }
      scheduleEventRecovery(type);
      render();
      await dispatchWorkflow("event", event);
      scheduleEventRecovery(type);
    });
  });
}

function syncViewportLayout() {
  syncGameFullscreenScale();
  resizeStage();
  if (simulationRuntime.paused) return;
  resizeConfettiCanvas();
  resizeSummaryConfettiCanvas();
}

function resizeStage() {
  if (els.appShell?.classList.contains("game-display-expanded")) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    recordClientPageState("layout_invalid");
    return;
  }
  const scale = Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT);
  if (els.appShell) {
    const previous = els.appShell.getBoundingClientRect();
    const top = Math.round((height - STAGE_HEIGHT * scale) / 2);
    const left = Math.round((width - STAGE_WIDTH * scale) / 2);
    els.appShell.style.transform = `scale(${scale})`;
    els.appShell.style.top = `${top}px`;
    els.appShell.style.left = `${left}px`;
    if (!previous.width || !previous.height) recordClientPageState("layout_recovered");
  }
}

function syncGameFullscreenScale() {
  if (!els.appShell?.classList.contains("game-display-expanded") || !els.gameScreen) return;
  const scale = Math.min(window.innerWidth / 1440, Math.max(0, window.innerHeight - 84) / 810);
  if (!Number.isFinite(scale) || scale <= 0) return;
  els.gameScreen.style.setProperty("--fullscreen-scale", String(scale));
}

function toggleGameDisplayMode() {
  if (els.appShell.classList.contains("game-display-expanded")) {
    exitGameDisplayMode();
    return;
  }
  fullscreenAskBarParent = els.controlAskBar.parentElement;
  fullscreenAskBarNextSibling = els.controlAskBar.nextSibling;
  els.stageViewport.appendChild(els.controlAskBar);
  els.controlAskBar.classList.add("fullscreen-control-bar");
  els.appShell.classList.add("game-display-expanded");
  els.gameFullscreenButton.setAttribute("aria-pressed", "true");
  syncGameFullscreenScale();
  if (fullscreenHintTimer) {
    window.clearTimeout(fullscreenHintTimer);
    fullscreenHintTimer = 0;
  }
  els.fullscreenHint.hidden = false;
  fullscreenHintTimer = window.setTimeout(() => {
    els.fullscreenHint.hidden = true;
    fullscreenHintTimer = 0;
  }, 3000);
  resizeConfettiCanvas();
  resizeSummaryConfettiCanvas();
}

function exitGameDisplayMode() {
  if (fullscreenHintTimer) {
    window.clearTimeout(fullscreenHintTimer);
    fullscreenHintTimer = 0;
  }
  els.fullscreenHint.hidden = true;
  els.controlAskBar.classList.remove("fullscreen-control-bar");
  if (fullscreenAskBarParent) {
    fullscreenAskBarParent.insertBefore(
      els.controlAskBar,
      fullscreenAskBarNextSibling?.parentElement === fullscreenAskBarParent ? fullscreenAskBarNextSibling : null,
    );
  }
  fullscreenAskBarParent = null;
  fullscreenAskBarNextSibling = null;
  els.appShell.classList.remove("game-display-expanded");
  els.gameFullscreenButton.setAttribute("aria-pressed", "false");
  els.gameScreen?.style.removeProperty("--fullscreen-scale");
  resizeStage();
  resizeConfettiCanvas();
  resizeSummaryConfettiCanvas();
}

function beginManualEventCooldown(buttons) {
  if (simulationRuntime.paused) return false;
  if (!buttons?.length || manualEventCooldowns.size) return false;
  for (const button of buttons) {
    manualEventCooldowns.add(button);
    button.disabled = true;
  }
  simulationRuntime.setTimeout(() => {
    for (const button of buttons) {
      manualEventCooldowns.delete(button);
      button.disabled = false;
    }
    renderControls();
  }, 4000);
  return true;
}

function resizeConfettiCanvas() {
  const canvas = els.confettiCanvas;
  if (!canvas) return;

  const width = els.gameScreen?.clientWidth || 1440;
  const height = els.gameScreen?.clientHeight || 810;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const physicalWidth = Math.max(1, Math.round(width * dpr));
  const physicalHeight = Math.max(1, Math.round(height * dpr));

  if (canvas.width !== physicalWidth || canvas.height !== physicalHeight) {
    canvas.width = physicalWidth;
    canvas.height = physicalHeight;
  }

  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  confettiAnimation.width = width;
  confettiAnimation.height = height;
  confettiAnimation.dpr = dpr;
}

function resizeSummaryConfettiCanvas() {
  const canvas = els.summaryConfettiCanvas;
  if (!canvas) return;

  const width = els.gameScreen?.clientWidth || 1440;
  const height = els.gameScreen?.clientHeight || 810;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const physicalWidth = Math.max(1, Math.round(width * dpr));
  const physicalHeight = Math.max(1, Math.round(height * dpr));

  if (canvas.width !== physicalWidth || canvas.height !== physicalHeight) {
    canvas.width = physicalWidth;
    canvas.height = physicalHeight;
  }

  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  summaryConfettiAnimation.width = width;
  summaryConfettiAnimation.height = height;
  summaryConfettiAnimation.dpr = dpr;
}

function createConfettiParticle(side, width, height) {
  const fromLeft = side === "left";
  const speed = CONFETTI_CONFIG.speed * (0.86 + Math.random() * 0.28);
  const launchAngle = (
    CONFETTI_CONFIG.launchAngleDeg
    + (Math.random() - 0.5) * CONFETTI_CONFIG.spreadDeg
  ) * Math.PI / 180;
  return {
    x: fromLeft ? -180 - Math.random() * 140 : width + 180 + Math.random() * 140,
    y: height + 1200 + Math.random() * 100,
    vx: (fromLeft ? 1 : -1) * Math.cos(launchAngle) * speed,
    vy: -Math.sin(launchAngle) * speed,
    width: CONFETTI_CONFIG.ribbonWidth,
    height: CONFETTI_CONFIG.ribbonHeight,
    rotation: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.24,
    wobble: Math.random() * Math.PI * 2,
    wobbleSpeed: 0.08 + Math.random() * 0.1,
    color: CONFETTI_CONFIG.colors[
      Math.floor(Math.random() * CONFETTI_CONFIG.colors.length)
    ],
    age: 0,
    life: CONFETTI_CONFIG.durationMs * (0.88 + Math.random() * 0.18),
    gravity: CONFETTI_CONFIG.gravity * (0.88 + Math.random() * 0.24),
  };
}

function startConfetti() {
  clearConfetti();
  const canvas = els.confettiCanvas;
  if (!canvas) return;

  canvas.hidden = false;
  resizeConfettiCanvas();
  const { width, height } = confettiAnimation;
  const leftCount = Math.ceil(CONFETTI_CONFIG.count / 2);
  const rightCount = CONFETTI_CONFIG.count - leftCount;
  confettiAnimation.particles = [
    ...Array.from({ length: leftCount }, () => createConfettiParticle("left", width, height)),
    ...Array.from({ length: rightCount }, () => createConfettiParticle("right", width, height)),
  ];
  playConfettiBurstSound(GAMEPLAY_CONFETTI_SOUND_DELAY_MS);
  confettiAnimation.lastTimestamp = simulationRuntime.frameNow();

  const animate = (timestamp) => {
    const context = canvas.getContext("2d");
    if (!context) {
      clearConfetti();
      return;
    }

    const delta = Math.min(34, Math.max(1, timestamp - confettiAnimation.lastTimestamp));
    const step = delta / 16.667;
    confettiAnimation.lastTimestamp = timestamp;
    context.clearRect(0, 0, confettiAnimation.width, confettiAnimation.height);

    const activeParticles = [];
    for (const particle of confettiAnimation.particles) {
      particle.age += delta;
      if (particle.age >= particle.life) continue;

      particle.vx *= Math.pow(CONFETTI_CONFIG.drag, step);
      particle.vy += particle.gravity * step;
      particle.x += particle.vx * step;
      particle.y += particle.vy * step;
      particle.rotation += particle.spin * step;
      particle.wobble += particle.wobbleSpeed * step;

      const fadeStart = particle.life - 420;
      const opacity = particle.age > fadeStart
        ? Math.max(0, (particle.life - particle.age) / 420)
        : 1;
      const flutter = 0.72 + Math.abs(Math.sin(particle.wobble)) * 0.28;

      context.save();
      context.globalAlpha = opacity;
      context.translate(particle.x, particle.y);
      context.rotate(particle.rotation);
      context.scale(flutter, 1);
      context.fillStyle = particle.color;
      context.fillRect(
        -particle.width / 2,
        -particle.height / 2,
        particle.width,
        particle.height,
      );
      context.restore();
      activeParticles.push(particle);
    }

    confettiAnimation.particles = activeParticles;
    if (activeParticles.length) {
      confettiAnimation.frameId = simulationRuntime.requestAnimationFrame(animate);
    } else {
      clearConfetti();
    }
  };

  confettiAnimation.frameId = simulationRuntime.requestAnimationFrame(animate);
}

function clearConfetti() {
  if (confettiAnimation.frameId) {
    simulationRuntime.cancelAnimationFrame(confettiAnimation.frameId);
    confettiAnimation.frameId = 0;
  }
  confettiAnimation.particles = [];
  confettiAnimation.lastTimestamp = 0;
  const canvas = els.confettiCanvas;
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, confettiAnimation.width, confettiAnimation.height);
  }
  canvas.hidden = true;
  clearSummaryConfetti();
}

function createSummaryConfettiParticle(width, height, initial = false) {
  return {
    x: Math.random() * width,
    y: initial
      ? Math.random() * height
      : -CONFETTI_CONFIG.ribbonHeight - Math.random() * height * 0.35,
    vx: (Math.random() - 0.5) * 0.22,
    vy: (1.2 + Math.random() * 0.9) * SUMMARY_CONFETTI_CONFIG.fallSpeedMultiplier,
    width: CONFETTI_CONFIG.ribbonWidth * SUMMARY_CONFETTI_CONFIG.sizeMultiplier,
    height: CONFETTI_CONFIG.ribbonHeight * SUMMARY_CONFETTI_CONFIG.sizeMultiplier,
    rotation: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.045,
    wobble: Math.random() * Math.PI * 2,
    wobbleSpeed: 0.025 + Math.random() * 0.03,
    wobbleAmount: 0.18 + Math.random() * 0.2,
    color: CONFETTI_CONFIG.colors[
      Math.floor(Math.random() * CONFETTI_CONFIG.colors.length)
    ],
  };
}

function createSummaryBurstParticle() {
  const angle = Math.random() * Math.PI * 2;
  const speed = SUMMARY_CONFETTI_CONFIG.burstSpeedMin
    + Math.random() * (
      SUMMARY_CONFETTI_CONFIG.burstSpeedMax - SUMMARY_CONFETTI_CONFIG.burstSpeedMin
    );
  const spawnRadius = Math.sqrt(Math.random()) * SUMMARY_CONFETTI_CONFIG.burstSpawnRadius;
  return {
    x: SUMMARY_CONFETTI_CONFIG.burstCenterX + Math.cos(angle) * spawnRadius,
    y: SUMMARY_CONFETTI_CONFIG.burstCenterY + Math.sin(angle) * spawnRadius,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    width: CONFETTI_CONFIG.ribbonWidth * SUMMARY_CONFETTI_CONFIG.sizeMultiplier,
    height: CONFETTI_CONFIG.ribbonHeight * SUMMARY_CONFETTI_CONFIG.sizeMultiplier,
    rotation: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.24,
    gravity: SUMMARY_CONFETTI_CONFIG.burstGravity * (0.85 + Math.random() * 0.3),
    drag: 0.985 + Math.random() * 0.01,
    wobble: Math.random() * Math.PI * 2,
    wobbleSpeed: 0.08 + Math.random() * 0.08,
    color: CONFETTI_CONFIG.colors[
      Math.floor(Math.random() * CONFETTI_CONFIG.colors.length)
    ],
  };
}

function drawSummaryConfettiParticle(context, particle, opacity) {
  const flutter = 0.72 + Math.abs(Math.sin(particle.wobble)) * 0.28;
  context.save();
  context.globalAlpha = opacity;
  context.translate(particle.x, particle.y);
  context.rotate(particle.rotation);
  context.scale(flutter, 1);
  context.fillStyle = particle.color;
  context.fillRect(
    -particle.width / 2,
    -particle.height / 2,
    particle.width,
    particle.height,
  );
  context.restore();
}

function startSummaryConfetti() {
  clearSummaryConfetti();
  const canvas = els.summaryConfettiCanvas;
  if (!canvas) return;

  canvas.hidden = false;
  resizeSummaryConfettiCanvas();
  summaryConfettiAnimation.startedAt = simulationRuntime.frameNow();
  summaryConfettiAnimation.lastTimestamp = summaryConfettiAnimation.startedAt;
  summaryConfettiAnimation.burstStarted = false;
  summaryConfettiAnimation.fallingVisible = false;

  const animate = (timestamp) => {
    const context = canvas.getContext("2d");
    if (!context) {
      clearSummaryConfetti();
      return;
    }

    const delta = Math.min(34, Math.max(1, timestamp - summaryConfettiAnimation.lastTimestamp));
    const step = delta / 16.667;
    summaryConfettiAnimation.lastTimestamp = timestamp;
    context.clearRect(0, 0, summaryConfettiAnimation.width, summaryConfettiAnimation.height);

    const elapsed = timestamp - summaryConfettiAnimation.startedAt;
    if (
      !summaryConfettiAnimation.burstStarted
      && elapsed >= SUMMARY_CONFETTI_CONFIG.burstDelayMs
    ) {
      const { width, height } = summaryConfettiAnimation;
      summaryConfettiAnimation.burstParticles = Array.from(
        { length: SUMMARY_CONFETTI_CONFIG.burstCount },
        createSummaryBurstParticle,
      );
      summaryConfettiAnimation.particles = Array.from(
        { length: SUMMARY_CONFETTI_CONFIG.count },
        () => createSummaryConfettiParticle(width, height, true),
      );
      summaryConfettiAnimation.burstStarted = true;
      playConfettiBurstSound();
    }

    const activeBurstParticles = [];
    for (const particle of summaryConfettiAnimation.burstParticles) {
      particle.vx *= Math.pow(particle.drag, step);
      particle.vy += particle.gravity * step;
      particle.x += particle.vx * step;
      particle.y += particle.vy * step;
      particle.rotation += particle.spin * step;
      particle.wobble += particle.wobbleSpeed * step;

      const isOutside = particle.x < -particle.width
        || particle.x > summaryConfettiAnimation.width + particle.width
        || particle.y < -particle.height
        || particle.y > summaryConfettiAnimation.height + particle.height;
      if (isOutside) continue;

      drawSummaryConfettiParticle(context, particle, 1);
      activeBurstParticles.push(particle);
    }
    summaryConfettiAnimation.burstParticles = activeBurstParticles;

    if (
      !summaryConfettiAnimation.fallingVisible
      && elapsed >= SUMMARY_CONFETTI_CONFIG.loopStartMs
    ) {
      summaryConfettiAnimation.fallingVisible = true;
      els.gameScreen?.classList.add("summary-confetti-loop");
    }

    const fallOpacity = summaryConfettiAnimation.fallingVisible ? 0.9 : 0;

    for (const particle of summaryConfettiAnimation.particles) {
      if (!summaryConfettiAnimation.fallingVisible) continue;
      particle.wobble += particle.wobbleSpeed * step;
      particle.x += (
        particle.vx + Math.sin(particle.wobble) * particle.wobbleAmount
      ) * step;
      particle.y += particle.vy * step;
      particle.rotation += particle.spin * step;

      if (particle.y > summaryConfettiAnimation.height + particle.height) {
        Object.assign(
          particle,
          createSummaryConfettiParticle(
            summaryConfettiAnimation.width,
            summaryConfettiAnimation.height,
          ),
        );
      }

      if (fallOpacity > 0) {
        drawSummaryConfettiParticle(context, particle, fallOpacity);
      }
    }

    summaryConfettiAnimation.frameId = simulationRuntime.requestAnimationFrame(animate);
  };

  summaryConfettiAnimation.frameId = simulationRuntime.requestAnimationFrame(animate);
}

function clearSummaryConfetti() {
  if (summaryConfettiAnimation.frameId) {
    simulationRuntime.cancelAnimationFrame(summaryConfettiAnimation.frameId);
    summaryConfettiAnimation.frameId = 0;
  }
  summaryConfettiAnimation.particles = [];
  summaryConfettiAnimation.burstParticles = [];
  summaryConfettiAnimation.lastTimestamp = 0;
  summaryConfettiAnimation.startedAt = 0;
  summaryConfettiAnimation.burstStarted = false;
  summaryConfettiAnimation.fallingVisible = false;
  els.gameScreen?.classList.remove("summary-confetti-loop");
  const canvas = els.summaryConfettiCanvas;
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(
      0,
      0,
      summaryConfettiAnimation.width,
      summaryConfettiAnimation.height,
    );
  }
  canvas.hidden = true;
}

async function loadHealthStatus() {
  try {
    const response = await fetch("/api/health", {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Health request failed: ${response.status}`);
    }
    const payload = await response.json();
    await simulationRuntime.waitUntilRunning();
    state.health.release = payload.release || "";
    state.health.runtime = payload.runtime || "";
    state.health.focus = payload.focus || "";
    state.health.proxyConfigured = Boolean(payload.workflow_proxy?.configured);
    state.health.workflowTimeoutMs = Math.max(1000, Math.min(120000,
      Number(payload.workflow_proxy?.timeout_ms) || 60000)) + 5000;
    state.health.hostVoiceConfigured = Boolean(payload.host_voice_configured);
    state.health.statusText = formatDeployStatus(payload);
  } catch {
    await simulationRuntime.waitUntilRunning();
    state.health.release = "";
    state.health.runtime = "";
    state.health.focus = "";
    state.health.proxyConfigured = null;
    state.health.hostVoiceConfigured = false;
    state.health.statusText = "版本状态不可用";
  }
  render();
  void loadWorkflowReadiness();
}

async function loadWorkflowReadiness() {
  try {
    const response = await fetch("/api/readiness", { cache: "no-store" });
    const readiness = await response.json();
    if (!readiness.routes || typeof readiness.ok !== "boolean") return;
    await simulationRuntime.waitUntilRunning();
    state.health.workflowReadiness = readiness;
    state.health.statusText = formatDeployStatus({ runtime: state.health.runtime, release: state.health.release,
      workflow_proxy: { configured: state.health.proxyConfigured } });
    render();
  } catch { /* Older servers may not expose the separate readiness endpoint yet. */ }
}

function formatDeployStatus(payload) {
  const release = payload.release || "unknown";
  const runtime = payload.runtime === "vercel" ? "公网" : payload.runtime === "local" ? "本地" : "未知";
  const readiness = state.health.workflowReadiness;
  const proxyState = !payload.workflow_proxy?.configured ? "代理未配置"
    : readiness ? readiness.ok ? "Dify 已连通" : "Dify 连接异常" : "代理已配置";
  return `${runtime} · ${release} · ${proxyState}`;
}

function getActiveGoldenLine() {
  return GOLDEN_TIMELINES[state.scenarioIndex] || GOLDEN_TIMELINES[0];
}

function nextGoldenLine() {
  if (startupLoading.active) return;
  stopTimeline("已切换黄金体验线");
  const nextIndex = (state.scenarioIndex + 1) % GOLDEN_TIMELINES.length;
  applyGoldenLineDefaults(GOLDEN_TIMELINES[nextIndex], true);
  render();
}

function resetCurrentGoldenLine() {
  if (simulationRuntime.paused && !simulationFreeze.autoPaused) toggleTimelinePause();
  stopTimeline("已重置当前模拟");
  applyGoldenLineDefaults(getActiveGoldenLine(), true);
  render();
}

async function startGoldenTimeline() {
  if (startupLoading.active) return;
  if (state.timeline.status === "running" || state.timeline.status === "paused") {
    state.ui.alert = "模拟正在进行中";
    render();
    return;
  }
  if (state.workflow.hostSpeech.source === "ready_welcome") {
    clearHostSpeechLock("ready_welcome");
    state.host.text = "";
  }

  resetPlayerInputGuide();
  if (state.game.status !== "idle") {
    applyGoldenLineDefaults(getActiveGoldenLine(), false);
  }
  await startRoundGoldenTimeline();
}

function dismissPlayerInputGuide() {
  playerInputGuideDismissed = true;
  if (els.playerInputGuide) els.playerInputGuide.hidden = true;
}

function resetPlayerInputGuide() {
  playerInputGuideDismissed = false;
}

function shouldShowPlayerInputGuide(screenMode) {
  return screenMode === "playing" && !playerInputGuideDismissed;
}

function presetStepWaitMs(dueAt) {
  const earliestStart = lastPresetStartedAt === null ? dueAt
    : Math.max(dueAt, lastPresetStartedAt + MIN_TIMELINE_STEP_GAP_MS);
  return Math.max(0, earliestStart - simulationRuntime.now());
}

function stopGoldenExperience() {
  if (goldenExperience?.timer != null) simulationRuntime.clearTimeout(goldenExperience.timer);
  goldenExperience = null;
  lastPresetStartedAt = null;
}

// Cabin events follow the trip clock, not question boundaries or host/network latency.
function startGoldenExperience() {
  const line = getActiveGoldenLine();
  if (goldenExperience?.gameId === state.workflow.gameId && goldenExperience.lineId === line.id) return;
  stopGoldenExperience();
  const session = { gameId: state.workflow.gameId, lineId: line.id,
    startedAt: simulationRuntime.now(), nextIndex: 0, timer: null, completed: false };
  goldenExperience = session;
  const scheduleNext = () => {
    const step = line.steps[session.nextIndex];
    const dueAt = session.startedAt + (step?.delay ?? line.durationMs);
    session.timer = simulationRuntime.setTimeout(() => {
      session.timer = null;
      if (goldenExperience !== session) return;
      if (session.gameId !== state.workflow.gameId || session.lineId !== getActiveGoldenLine().id
        || state.game.status === "summary") {
        stopGoldenExperience();
        return;
      }
      if (presetStepWaitMs(dueAt) > 0) {
        scheduleNext();
        return;
      }
      if (!step) {
        session.completed = true;
        return;
      }
      lastPresetStartedAt = simulationRuntime.now();
      session.nextIndex += 1;
      state.timeline.elapsedSeconds = Math.round((lastPresetStartedAt - session.startedAt) / 1000);
      state.timeline.currentEventType = step.type;
      state.timeline.currentEvent = step.label;
      render();
      void runRoundTimelineStep(step).catch(() => console.warn("Golden event dispatch failed:", step.type));
      scheduleNext();
    }, presetStepWaitMs(dueAt));
  };
  scheduleNext();
}

async function startRoundGoldenTimeline() {
  const preparation = ensureCurrentRoundPreparation();
  const roundTimeline = ROUND_GOLDEN_TIMELINES.find((item) => item.id === preparation.timelineId);
  const runId = state.timeline.runId + 1;
  state.timeline.runId = runId;
  state.timeline.roundTimelineId = roundTimeline.id;
  state.timeline.roundTimelineName = roundTimeline.name;
  state.timeline.lastRoundTimelineId = roundTimeline.id;
  state.timeline.roundTimelineHistory.push({
    round: state.game.roundIndex,
    id: roundTimeline.id,
    name: roundTimeline.name,
  });
  state.timeline.status = "running";
  state.timeline.startedAt = simulationRuntime.now();
  state.timeline.elapsedSeconds = goldenExperience
    ? Math.round((simulationRuntime.now() - goldenExperience.startedAt) / 1000) : 0;
  state.timeline.currentEventType = "start_game";
  state.timeline.currentEvent = `第 ${state.game.roundIndex} 题 · ${roundTimeline.name}`;
  render();

  await startGame();
  await waitUntilRoundTimelineReady(runId);
  if (state.timeline.runId !== runId || state.game.status !== "playing") return;

  startQuestionClock();
  startQuestionIntro();
  state.timeline.startedAt = simulationRuntime.now();
  startGoldenExperience();
  const steps = roundTimeline.steps;
  for (let index = 0; index < steps.length;) {
    const step = steps[index];
    if (state.timeline.runId !== runId) return;
    for (;;) {
      await waitUntilRoundTimelineReady(runId);
      if (state.timeline.runId !== runId || ["victory", "summary", "failed"].includes(state.game.status)) return;
      const waitMs = presetStepWaitMs(state.timeline.startedAt + step.delay);
      if (waitMs <= 0) break;
      await sleep(waitMs);
    }
    if (state.timeline.runId !== runId) return;
    if (["victory", "summary", "failed"].includes(state.game.status)) return;
    index += 1;
    state.timeline.elapsedSeconds = Math.round((simulationRuntime.now() - goldenExperience.startedAt) / 1000);
    lastPresetStartedAt = simulationRuntime.now();
    state.timeline.currentEventType = step.type;
    state.timeline.currentEvent = step.label;
    render();
    await runRoundTimelineStep(step);
  }

  if (state.timeline.runId === runId) {
    state.timeline.currentEventType = "awaiting_player";
    state.timeline.currentEvent = `${roundTimeline.name}已完成，等待本题继续`;
    render();
  }
}

function scheduleGoldenEnvironmentTransition(runId, timeline) {
  clearGoldenEnvironmentTransition();
  if (!timeline?.environmentAfter) return;

  const delay = Math.max(0, Number(timeline.environmentChangeDelay) || 20000);
  state.timeline.environmentTransitionTimer = simulationRuntime.setTimeout(async () => {
    state.timeline.environmentTransitionTimer = null;
    if (
      state.timeline.runId !== runId
      || !["opening", "playing"].includes(state.game.status)
    ) {
      return;
    }

    await waitUntilRoundTimelineReady(runId);
    if (
      state.timeline.runId !== runId
      || !["opening", "playing"].includes(state.game.status)
    ) {
      return;
    }

    state.timeline.currentEventType = "environment_change";
    state.timeline.currentEvent = `车库环境结束，切换至${timeline.environmentAfter}`;
    render();
    await runScriptedEnvironment(timeline.environmentAfter);
  }, delay);
}

function clearGoldenEnvironmentTransition() {
  simulationRuntime.clearTimeout(state.timeline.environmentTransitionTimer);
  state.timeline.environmentTransitionTimer = null;
}

function pickRoundGoldenTimeline(previousTimelineId = state.timeline.lastRoundTimelineId) {
  const candidates = ROUND_GOLDEN_TIMELINES.length > 1
    ? ROUND_GOLDEN_TIMELINES.filter(
        (timeline) => timeline.id !== previousTimelineId,
      )
    : ROUND_GOLDEN_TIMELINES;
  return candidates[Math.floor(Math.random() * candidates.length)] || ROUND_GOLDEN_TIMELINES[0];
}

async function runRoundTimelineStep(step) {
  if (step.type === "environment_change") {
    await runScriptedEnvironment(step.value);
    return;
  }
  if (step.type === "speed_overspeed") {
    await runScriptedSpeed(130);
    return;
  }
  if (step.type === "passenger_question") {
    await runRandomTimelinePassengerQuestion();
    return;
  }
  if (["passenger_sleep", "passenger_wake", "cabin_laughing"].includes(step.type)) {
    const rearSeat = step.type === "passenger_wake"
      ? (state.timeline.goldenSleepingSeat && state.passengers.seats[state.timeline.goldenSleepingSeat]?.mood === "睡着"
        ? state.timeline.goldenSleepingSeat : getManualWakeSeat())
      : selectRandomSimulatedSeat({ rearOnly: true, includeNonSpeakers: step.type === "passenger_sleep" });
    if (!rearSeat) return;
    await runScriptedEvent(step.type, step.label, rearSeat, step.reason);
    return;
  }
  await runScriptedEvent(step.type, step.label, "driver", step.reason);
}

async function runRandomTimelinePassengerQuestion() {
  if (state.game.questionCount >= state.game.maxQuestions) return;
  applyPreparedRoundPlan(roundQuestionPreparations.get(getDifyRoundScopeKey()));
  if (!state.game.roundQuestionPlan) return;
  const seat = selectRandomSimulatedSeat();
  if (!seat) return;
  const preparedQuestion = pickPreparedRoundQuestion(seat);
  if (!preparedQuestion) return;
  await runScriptedQuestion(seat, preparedQuestion.text, preparedQuestion.step);
}

function selectRandomSimulatedSeat({ rearOnly = false, includeNonSpeakers = false } = {}) {
  const sleepingSeats = new Set(getSleepingSeats());
  const driverUnavailable =
    state.car.speed >= 100
    || state.perception.driverState === "fatigued"
    || ["疲惫", "睡着"].includes(state.passengers.seats.driver.mood)
    || ["safety_pause", "driver_focus"].includes(state.ui.cabinMode);
  const baseSeats = rearOnly ? ["rearLeft", "rearRight"] : ["driver", "rearLeft", "rearRight"];
  let candidates = baseSeats.filter((seat) => !sleepingSeats.has(seat)
    && (seat !== "driver" || !driverUnavailable)
    && (includeNonSpeakers || getPassengerPersona(seat)?.can_guess !== false));
  if (!rearOnly) {
    const rearSeats = candidates.filter((seat) => seat === "rearLeft" || seat === "rearRight");
    if (rearSeats.length) candidates = rearSeats;
  }
  if (candidates.length > 1 && state.timeline.lastPassengerSeat) {
    candidates = candidates.filter((seat) => seat !== state.timeline.lastPassengerSeat);
  }
  if (!candidates.length) return "";

  const seat = candidates[Math.floor(Math.random() * candidates.length)];
  state.timeline.lastPassengerSeat = seat;
  return seat;
}

function pickPreparedRoundQuestion(seat) {
  const plan = state.game.roundQuestionPlan;
  if (!plan?.steps?.length) return null;

  const usedStepIds = new Set(state.game.usedRoundQuestionStepIds);
  const coveredFactKeys = new Set(state.game.coveredFactKeys);
  const askedQuestions = new Set(getAskedQuestions().map(normalizeAnswerText));
  plan.steps
    .filter((step) => usedStepIds.has(step.id)
      || Object.values(step.variants).some((question) => askedQuestions.has(normalizeAnswerText(question))))
    .forEach((step) => {
      usedStepIds.add(step.id);
      coveredFactKeys.add(step.factKey);
    });

  const unusedSteps = plan.steps.filter(
    (step) => !usedStepIds.has(step.id) && !coveredFactKeys.has(step.factKey),
  );
  const dependencyReadySteps = unusedSteps.filter((step) =>
    step.dependsOn.every((factKey) => coveredFactKeys.has(String(factKey))),
  );
  const step = dependencyReadySteps[0] || unusedSteps[0];
  if (!step) return null;

  const text = pickQuestionVariantForSeat(step, seat);
  if (!text) return null;

  return { text, step };
}

function pickQuestionVariantForSeat(step, seat) {
  const variants = step.variants || {};
  const ageGroup = getPassengerPersona(seat)?.age_group || "adult";
  const variantKeysByAge = {
    child: ["child", "kid"],
    teen: ["teen", "child", "young_adult"],
    young_adult: ["young_adult", "adult"],
    adult: ["adult", "middle_aged"],
    middle_aged: ["middle_aged", "adult"],
    elder: ["elder", "senior", "adult"],
  };
  const preferredKeys = [
    ...(variantKeysByAge[ageGroup] || [ageGroup]),
    "default",
    "neutral",
    "all",
  ];
  const askedQuestions = new Set(getAskedQuestions().map(normalizeAnswerText));
  const preferredQuestions = preferredKeys
    .map((key) => variants[key])
    .filter(Boolean);
  const allQuestions = [...new Set([...preferredQuestions, ...Object.values(variants)])];
  return allQuestions.find((question) => !askedQuestions.has(normalizeAnswerText(question))) || "";
}

function toggleTimelinePause() {
  if (simulationRuntime.paused) {
    simulationFreeze.autoPaused = false;
    state.timeline.status = simulationFreeze.previousTimelineStatus;
    document.body.classList.remove("simulation-frozen");
    simulationRuntime.resume();
    for (const animation of simulationFreeze.animations) {
      try { animation.play(); } catch {}
    }
    for (const media of simulationFreeze.media) {
      if (media.isConnected || media === hostSprite.audioElement) media.play()?.catch(() => {});
    }
    if (simulationFreeze.audioWasRunning && audioContext?.state === "suspended") audioContext.resume().catch(() => {});
    simulationFreeze.animations = [];
    simulationFreeze.media = [];
    render();
    resizeStage();
    resizeConfettiCanvas();
    resizeSummaryConfettiCanvas();
    return;
  }
  if (state.timeline.status === "idle" && state.game.status === "idle") {
    state.ui.alert = "请先点击开始模拟";
    render();
    return;
  }
  simulationFreeze.previousTimelineStatus = state.timeline.status;
  simulationRuntime.pause();
  state.timeline.status = "paused";
  renderControls();
  simulationFreeze.animations = document.getAnimations().filter(animation =>
    animation.effect?.target !== els.pauseTimeline && (animation.playState === "running" || animation.pending)
  );
  simulationFreeze.animations.forEach(animation => animation.pause());
  simulationFreeze.media = [...new Set([...document.querySelectorAll("audio, video"), hostSprite.audioElement])]
    .filter(media => media && !media.paused && !media.ended);
  simulationFreeze.media.forEach(media => media.pause());
  simulationFreeze.audioWasRunning = audioContext?.state === "running";
  if (simulationFreeze.audioWasRunning) audioContext.suspend().catch(() => {});
  document.body.classList.add("simulation-frozen");
}

function stopTimeline(message) {
  stopGoldenExperience();
  if (state.timeline.status === "running" || state.timeline.status === "paused") {
    state.timeline.runId += 1;
  }
  clearGoldenEnvironmentTransition();
  clearScreenEnvironmentTransition();
  clearEnvironmentAnnouncement();
  clearImportantEvent();
  clearConfetti();
  clearSummarySpeechTimer();
  clearHostSpeechLock();
  state.timeline.status = "idle";
  state.timeline.elapsedSeconds = 0;
  state.timeline.currentEventType = "";
  state.timeline.currentEvent =
    message || "准备好后点击开始模拟，系统会按时间轴触发座舱事件。";
}

function finishTimelineSilently() {
  if (state.timeline.status === "running" || state.timeline.status === "paused") {
    state.timeline.runId += 1;
  }
  clearGoldenEnvironmentTransition();
  state.timeline.status = "finished";
  state.timeline.currentEventType = "round_finished";
  state.timeline.currentEvent = `${state.timeline.roundTimelineName || state.timeline.name}已完成`;
}

function applyGoldenLineDefaults(timeline = getActiveGoldenLine(), announce = false) {
  stopGoldenExperience();
  const preparedGame = state.game.status === "summary"
    && nextGamePreparation?.scenarioId === timeline.id
    ? nextGamePreparation
    : null;
  invalidateAsyncHostResults();
  clearNextRiddleRefresh();
  cancelPreviewWorkflow(preparedGame?.gameId);
  nextGamePreparation = null;
  clearGoldenEnvironmentTransition();
  clearScreenEnvironmentTransition();
  clearEnvironmentAnnouncement();
  clearImportantEvent();
  clearSummarySpeechTimer();
  clearHostSpeechLock();
  clearDriverSafetyAnnouncement();
  clearQuestionClock();
  if (state.workflow.activityTimer) {
    simulationRuntime.clearTimeout(state.workflow.activityTimer);
    state.workflow.activityTimer = null;
  }
  clearCorrectLightTimer();
  clearConfetti();
  clearNextRoundTimer();
  clearHostAvatarTimer();
  const index = GOLDEN_TIMELINES.findIndex((item) => item.id === timeline.id);
  state.scenarioIndex = index >= 0 ? index : 0;
  state.timeline.id = timeline.id;
  state.timeline.name = timeline.name;
  state.timeline.roundTimelineId = "";
  state.timeline.roundTimelineName = "";
  state.timeline.lastRoundTimelineId = "";
  state.timeline.roundTimelineHistory = [];
  state.timeline.lastPassengerSeat = "";
  state.timeline.goldenSleepingSeat = "";
  state.timeline.currentEventType = "";
  state.timeline.status = "idle";
  state.timeline.elapsedSeconds = 0;
  state.car.speed = timeline.speed;
  state.car.destination = timeline.destination;
  state.car.environment = timeline.environment;
  state.passengers.relationship = timeline.relationship;
  state.passengers.selectedSeat = "front";
  state.game.currentRiddleIndex = timeline.riddleIndex;
  state.game.status = "idle";
  state.game.roundIndex = 1;
  state.game.totalRounds = GAME_ROUND_COUNT;
  state.game.questionCount = 0;
  state.game.history = [];
  state.game.playedRiddleIndices = [];
  state.game.performance = structuredClone(DEFAULT_STATE.game.performance);
  state.game.roundQuestionPlan = null;
  state.game.usedRoundQuestionStepIds = [];
  state.game.coveredFactKeys = [];
  state.ui.showAnswer = false;
  state.ui.correctSeat = null;
  state.ui.correctLightSeat = null;
  state.ui.sleepComfortSeats = [];
  state.ui.zoneLights = { ...DEFAULT_STATE.ui.zoneLights };
  state.ui.lightsBeforeSleep = {};
  state.game.publicClues = [];
  state.ui.cabinMode = "normal";
  state.ui.screenEnvironment = timeline.previewEnvironment || timeline.environment;
  state.ui.alert = announce ? `已切换至${timeline.name}` : "";
  state.host.text = "";
  hostSceneMotion.mode = "";
  hostSceneMotion.completed = false;
  resetHostSprite();
  state.host.emotion = "normal";
  state.host.avatarState = HOST_AVATAR_DEFAULT_STATE;
  state.host.targetSeat = "front";
  state.workflow.lastPassengerActionKey = "";
  state.workflow.pendingChats = [];
  state.workflow.gameId = preparedGame?.gameId || createRuntimeId("game");
  persistDifyRoundScope();
  resetRealtimeConversationState();
  state.perception.driverState = "normal";
  state.perception.gameProgress = "normal";
  clearPassengerBubbles();
  Object.values(state.passengers.seats).forEach((seat) => {
    seat.mood = "普通";
    seat.activity = "idle";
    seat.activityLabel = "";
  });
  resetDecisionTrace();
  ensureCurrentRoundPreparation();
}

function getPrestartHostText(timeline) {
  const sceneLead = {
    family_highway_disney: "各位大小侦探，去迪士尼的路上要不要先玩一局猜谜？",
    rainy_city_hotpot_friends: "朋友局已就位，去火锅店的路上来一局轻松猜谜吧。",
    scenic_snow_family: "窗外雪景正好适合开一局猜谜，大家一起动动脑。",
  };
  const lead = sceneLead[timeline.id] || "大家好，欢迎来到车内 AI 猜谜。";
  return lead;
}

async function runScriptedQuestion(seat, text, preparedStep = null) {
  if (seat === "front") return;
  if (state.game.status === "paused") return;
  const questionRoundIndex = state.game.roundIndex;
  state.passengers.selectedSeat = seat;
  showPassengerBubble(seat, text);
  state.host.targetSeat = seat;
  state.game.status = ["idle", "opening"].includes(state.game.status) ? "playing" : state.game.status;
  state.ui.alert = `${SEATS[seat]}：${text}`;
  showPassengerQuestionPerception(seat, text);
  render();
  const speechIdBeforeReply = state.workflow.hostSpeech.id;
  await dispatchWorkflow(
    "chat",
    {
      type: "passenger_question",
      source: preparedStep ? "round_question_plan" : "timeline",
      seat,
      ...(preparedStep ? {
        plan_id: state.game.roundQuestionPlan?.id || "",
        step_id: preparedStep.id,
        fact_key: preparedStep.factKey,
      } : {}),
    },
    text,
  );
  if (state.game.roundIndex !== questionRoundIndex || state.game.status !== "playing") return;
  if (preparedStep && state.workflow.hostSpeech.id !== speechIdBeforeReply
    && state.workflow.hostSpeech.source === "passenger_question") {
    state.game.usedRoundQuestionStepIds = [
      ...new Set([...state.game.usedRoundQuestionStepIds, preparedStep.id]),
    ];
    state.game.coveredFactKeys = [
      ...new Set([...state.game.coveredFactKeys, preparedStep.factKey]),
    ];
  }
  ensureScriptedVictory(seat, text);
  restoreRealUserSeat();
}

function recordParticipationActivity(seat = null, text = "") {
  const activity = state.workflow.participation;
  if (!questionClock.active || activity.roundId !== getDifyRoundScopeKey()) return;
  const elapsedMs = getQuestionElapsedMs();
  activity.revision += 1;
  activity.lastDialogueElapsedMs = elapsedMs;
  if (seat === "front") {
    activity.lastUserElapsedMs = elapsedMs;
    activity.userTurnCount += 1;
    activity.invitationDeclined ||= /让我.{0,4}想想|自己猜|先别帮|不用帮|别催|不要催|先别叫我/.test(text);
  }
}

function buildParticipationSnapshot() {
  const activity = state.workflow.participation;
  const elapsedMs = getQuestionElapsedMs();
  return {
    seat: "front",
    version: activity.revision,
    inactive_duration_ms: Math.max(0, elapsedMs - activity.lastUserElapsedMs),
    dialogue_silence_ms: Math.max(0, elapsedMs - activity.lastDialogueElapsedMs),
    remaining_ms: Math.max(0, QUESTION_DURATION_MS - elapsedMs),
    real_user_turn_count: activity.userTurnCount,
    invitation_declined: activity.invitationDeclined,
  };
}

function canOfferParticipationInvitation() {
  if (!state.host.preferences.invitations || state.host.preferences.independent) return false;
  const observation = buildParticipationSnapshot();
  return questionClock.active && !questionClock.expired && !questionClock.pausedAt
    && state.workflow.participation.roundId === getDifyRoundScopeKey()
    && state.game.status === "playing" && state.timeline.status !== "paused"
    && !isQuestionIntroVisible() && !getSleepingSeats().includes("front")
    && !isHostBusy() && !state.workflow.situationInFlight && !state.workflow.pendingChats.length
    && !state.workflow.hostThinkingActive && !state.workflow.pendingEnvironmentSpeech
    && !state.workflow.pendingMinimumSpeech && state.workflow.hostSpeech.expiresAt <= simulationRuntime.now()
    && !String(state.host.text || "").trim()
    && !Object.values(state.passengers.seats).some((seat) => seat.bubble)
    && !observation.invitation_declined
    && observation.inactive_duration_ms >= REAL_USER_INACTIVE_MS
    && observation.dialogue_silence_ms >= PARTICIPATION_DIALOGUE_GAP_MS
    && observation.remaining_ms > PARTICIPATION_MIN_REMAINING_MS;
}

function maybeAnalyzeRealUserParticipation() {
  if (state.workflow.participation.analysisRequested || !canOfferParticipationInvitation()) return;
  state.workflow.participation.analysisRequested = true;
  void dispatchSituationWorkflow({
    id: createRuntimeId("event"), type: "passenger_inactive", seat: "front", priority: "P4",
    source: "participation_monitor",
    duration_ms: buildParticipationSnapshot().inactive_duration_ms,
  });
}

function restoreRealUserSeat() {
  if (state.game.status === "victory") return;
  state.passengers.selectedSeat = "front";
  render();
}

function ensureScriptedVictory(seat, text) {
  const riddle = getCurrentRiddle();
  if (!text.includes(riddle.answer) || state.game.status !== "playing") return;

  invalidateAsyncHostResults({ preserveSituationEvents: true });
  clearQuestionClock();
  state.game.status = "victory";
  finishTimelineSilently();
  state.ui.cabinMode = "victory";
  state.ui.showAnswer = true;
  state.ui.correctSeat = seat;
  state.passengers.seats[seat].mood = "大笑";
  showCorrectSeatLight(seat);
  startConfetti();
  state.host.targetSeat = seat;
  state.host.emotion = "excited";
  publishHostLine(
    `${SEATS[seat]}一锤定音，答案就是“${riddle.answer}”。本局 MVP 出现，安全感拉满！`,
    { priority: "P0", source: "victory", durationMs: HOST_SPEECH_P0_LOCK_MS },
  );
  updateDecisionTrace({
    perception: `${SEATS[seat]}猜中谜底`,
    decision: "进入胜利收尾，给足情绪价值",
    execution: "揭晓谜底并切换胜利氛围",
    strategyId: "S14",
    priority: "P3",
  });
  scheduleNextRound();
  render();
  notifyP0Situation("answer_correct", { seat });
  startResultFeedback(recordRoundOutcome(seat));
}

async function runScriptedEvent(type, label, targetSeat = state.passengers.selectedSeat, reason = "") {
  const seat = targetSeat;
  showImportantEvent(getImportantEventText(type, seat));
  if (type === "hard_brake") {
    applyImmediateSafetyPause();
  }
  if (type === "temporary_interruption") {
    applyTemporaryInterruption({ reason });
  }
  if (type === "driver_tired") {
    applyImmediateDriverTired();
    scheduleDriverSafetyAnnouncement();
    render();
    return;
  }
  if (type === "passenger_sleep") {
    state.timeline.goldenSleepingSeat = seat;
    applyImmediatePassengerSleep(seat);
  }
  if (type === "passenger_wake") {
    applyImmediatePassengerWake(seat);
    if (state.timeline.goldenSleepingSeat === seat) state.timeline.goldenSleepingSeat = "";
  }
  if (type === "near_destination") {
    applyImmediateNearDestination();
  }
  if (type === "game_stuck" || type === "near_answer") {
    state.perception.gameProgress = type === "game_stuck" ? "stuck" : "near_answer";
  }
  if (type === "cabin_laughing") {
    state.passengers.seats[seat].mood = "大笑";
    state.passengers.seats[seat].activity = "idle";
    state.passengers.seats[seat].activityLabel = "";
  }
  if (type === "resume_game") {
    if (!canResumeGame()) return;
    resumeQuestionClock();
    state.game.status = "playing";
    state.ui.cabinMode = "normal";
    state.ui.alert = "正在确认安全状态";
    publishHostLine("收到，正在确认座舱状态，马上继续游戏。", {
      priority: "P0",
      source: "resume_game",
    });
    clearPassengerBubbles();
    state.workflow.lastResumeAt = simulationRuntime.now();
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
  await dispatchWorkflow("event", { type, seat, ...(reason ? { reason } : {}), source: "timeline" });
  scheduleEventRecovery(type);
}

async function runScriptedSpeed(speed) {
  const previousSpeed = state.car.speed;
  state.car.speed = speed;
  state.ui.alert = `车速已更新为 ${speed} km/h`;
  render();
  await handleSpeedStateChange(previousSpeed, speed, "timeline");
}

async function runScriptedEnvironment(environment) {
  const previousEnvironment = state.car.environment;
  setEnvironment(environment);
  await dispatchWorkflow(
    "event",
    { type: "environment_change", value: environment, previous_value: previousEnvironment, source: "timeline" },
  );
}

function sleep(ms) {
  return new Promise((resolve) => simulationRuntime.setTimeout(resolve, ms));
}

function prepareAudioContext() {
  if (simulationRuntime.paused) return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioContext) {
    audioContext = new AudioContextClass();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

function syncBackgroundMusicToggle() {
  for (const button of [els.backgroundMusicToggle, els.backgroundMusicToggleGame]) {
    if (!button) continue;
    button.setAttribute("aria-pressed", String(backgroundMusic.enabled));
    button.setAttribute(
      "aria-label",
      backgroundMusic.enabled ? "关闭背景音乐和主持人语音" : "打开背景音乐和主持人语音",
    );
    button.title = backgroundMusic.enabled ? "关闭背景音乐和主持人语音" : "打开背景音乐和主持人语音";
    const icon = button.querySelector(".ready-sound-icon");
    if (icon) icon.textContent = backgroundMusic.enabled ? "🔊" : "🔇";
  }
}

function startBackgroundMusic() {
  if (simulationRuntime.paused) return;
  const audio = els.backgroundMusic;
  if (!audio || !backgroundMusic.enabled) return;
  const requestId = backgroundMusic.requestId;
  const traceId = backgroundMusic.traceId;
  audio.loop = true;
  audio.volume = backgroundMusic.volume;
  recordExecutionReceipt(traceId, "music", "pending", "背景音乐：等待播放器启动");
  let playback;
  try {
    playback = audio.play();
  } catch (error) {
    playback = Promise.reject(error);
  }
  Promise.resolve(playback).then(() => {
    if (simulationRuntime.paused) { audio.pause(); return; }
    if (requestId !== backgroundMusic.requestId || !backgroundMusic.enabled) return;
    recordExecutionReceipt(traceId, "music", audio.paused ? "pending" : "playing", audio.paused ? "背景音乐：尚未开始播放" : "背景音乐：播放中");
  }).catch((error) => {
    if (requestId !== backgroundMusic.requestId || !backgroundMusic.enabled) return;
    recordExecutionReceipt(traceId, "music", "failed", error?.name === "NotAllowedError"
      ? "音乐被浏览器拦截：等待点击页面重试" : "背景音乐：播放失败");
  });
}

function resetBackgroundMusicForReadyEntry() {
  const audio = els.backgroundMusic;
  if (!audio) return;

  audio.pause();
  try {
    audio.currentTime = 0;
  } catch {
    // The media may not have loaded metadata yet; a later user gesture retries.
  }
  startBackgroundMusic();
}

function setBackgroundMusicEnabled(enabled, traceId = null) {
  backgroundMusic.requestId = (backgroundMusic.requestId || 0) + 1;
  backgroundMusic.traceId = traceId;
  backgroundMusic.enabled = Boolean(enabled);
  recordClientRuntimeDiagnostic("host_voice", { stage: "toggle" });
  if (!backgroundMusic.enabled) {
    stopHostSpriteAudio();
    cancelHostVoiceSpeech();
    const speech = state.workflow.hostSpeech;
    speech.voiceRequested = true;
    speech.voicePending = false;
    speech.voicePlaying = false;
    speech.voiceFinished = true;
    refreshHostSpeechMedia();
  }
  const audio = els.backgroundMusic;
  if (audio) {
    audio.volume = backgroundMusic.volume;
    if (backgroundMusic.enabled) {
      startBackgroundMusic();
    } else {
      audio.pause();
      recordExecutionReceipt(traceId, "music", audio.paused ? "stopped" : "failed", audio.paused ? "背景音乐：已关闭" : "背景音乐：未能停止播放");
    }
  } else {
    recordExecutionReceipt(traceId, "music", "failed", "背景音乐：播放器不可用");
  }
  syncBackgroundMusicToggle();
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

function playSummarySound() {
  const context = prepareAudioContext();
  if (!context) return;

  const play = () => {
    if (context.state !== "running") return;

    const startAt = context.currentTime;
    [392, 523.25, 659.25, 783.99].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const noteStart = startAt + index * 0.1;
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.12, noteStart + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.34);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + 0.36);
    });
  };

  if (context.state === "running") {
    play();
  } else {
    context.resume().then(play).catch(() => {});
  }
}

function playConfettiBurstSound(delayMs = 0) {
  const context = prepareAudioContext();
  if (!context) return;

  const play = () => {
    if (context.state !== "running") return;

    const startAt = context.currentTime + Math.max(0, delayMs) / 1000;
    const noiseBuffer = context.createBuffer(
      1,
      Math.floor(context.sampleRate * 0.36),
      context.sampleRate,
    );
    const noiseData = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noiseData.length; index += 1) {
      noiseData[index] = (Math.random() * 2 - 1) * (1 - index / noiseData.length);
    }

    const noise = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1100, startAt);
    filter.Q.setValueAtTime(0.8, startAt);
    noiseGain.gain.setValueAtTime(0.0001, startAt);
    noiseGain.gain.exponentialRampToValueAtTime(0.25, startAt + 0.018);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.34);
    noise.buffer = noiseBuffer;
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(context.destination);
    noise.start(startAt);
    noise.stop(startAt + 0.36);
  };

  if (context.state === "running") {
    play();
  } else {
    context.resume().then(play).catch(() => {});
  }
}

function playQuestionIntroSound() {
  const context = prepareAudioContext();
  if (!context) return;

  const play = () => {
    if (context.state !== "running") return;
    const startAt = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.08, startAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.18);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.2);
  };

  if (context.state === "running") {
    play();
  } else {
    context.resume().then(play).catch(() => {});
  }
}

function playQuestionCountdownSound() {
  const context = prepareAudioContext();
  if (!context) return;

  const play = () => {
    if (context.state !== "running") return;
    const startAt = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(880, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.056, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.12);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.14);
  };

  if (context.state === "running") {
    play();
  } else {
    context.resume().then(play).catch(() => {});
  }
}

function playNoWinnerRevealSound(delayMs = 0) {
  const context = prepareAudioContext();
  if (!context) return;

  const play = () => {
    if (context.state !== "running") return;
    const startAt = context.currentTime + Math.max(0, delayMs) / 1000;
    [440, 329.63, 246.94, 185].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const noteStart = startAt + index * 0.15;
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.08, noteStart + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.34);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + 0.36);
    });
  };

  if (context.state === "running") {
    play();
  } else {
    context.resume().then(play).catch(() => {});
  }
}

function playPassengerBubbleSound() {
  const context = prepareAudioContext();
  if (!context) return;

  const play = () => {
    if (context.state !== "running") return;
    const startAt = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(560, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(820, startAt + 0.075);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.35, startAt + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.12);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.13);
  };

  if (context.state === "running") {
    play();
  } else {
    context.resume().then(play).catch(() => {});
  }
}

async function waitUntilRoundTimelineReady(runId) {
  while (
    state.timeline.runId === runId
    && (
      state.timeline.status === "paused"
      || state.game.status === "paused"
      || isHostBusy()
      || state.workflow.pendingChats.length > 0
    )
  ) {
    await sleep(PAUSED_ROUND_POLL_MS);
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
  state.game.status = "opening";
  state.ui.screenEnvironment = state.car.environment;
  if (!state.game.playedRiddleIndices.includes(state.game.currentRiddleIndex)) {
    state.game.playedRiddleIndices.push(state.game.currentRiddleIndex);
  }
  state.ui.showAnswer = false;
  state.ui.correctSeat = null;
  render();
  await dispatchWorkflow("event", { type: "start_game", source: "timeline" });
}

async function sendQuestion() {
  if (simulationRuntime.paused) return;
  const text = els.playerInput.value.trim();
  if (!text) {
    state.ui.alert = "请输入提问或答案";
    render();
    return;
  }

  if (state.game.status === "idle" && authorizedGamePause(text) !== null) {
    state.ui.alert = "请先开始游戏，再使用暂停或继续指令";
    els.playerInput.value = "";
    render();
    return;
  }

  if (state.game.status === "paused"
    && !(isPlayerGamePaused() && authorizedGamePause(text) !== null)) {
    publishHostLine("游戏还在暂停中，先恢复再继续问。", {
      priority: isPlayerGamePaused() ? "P2" : "P0",
      source: isPlayerGamePaused() ? "game_control" : "paused_input",
    });
    render();
    return;
  }

  const seat = "front";
  updateHostPreferences(text);
  if (isExplicitPraiseRequest(text)) clearResultFeedback();
  state.passengers.selectedSeat = seat;
  if (!isExplicitAnswerHit(buildWorkflowInput("chat", null, text))) {
    showPassengerQuestionPerception(seat, text);
  }
  showPassengerBubble(seat, text);
  state.host.targetSeat = seat;
  state.game.status = state.game.status === "idle" ? "playing" : state.game.status;
  els.playerInput.value = "";
  const input = buildWorkflowInput("chat", null, text);
  recordClientRuntimeDiagnostic("player_submission", { stage: "submitted" });
  // A trusted answer hit must not wait behind dialogue playback or remote work.
  if (state.game.status === "playing" && authorizedGamePause(text) === null && isExplicitAnswerHit(input)) {
    applyWorkflowOutput(applyAnswerHitGuard({}, input), input, "local");
    recordClientRuntimeDiagnostic("player_submission", { stage: "resolved", elapsed_ms: 0 });
    return;
  }
  if (isHostBusy() || state.workflow.situationEvents.some(record => ["pending_analysis", "analyzing", "ready"].includes(record.status))) {
    state.workflow.pendingChats.push({ seat, text, bubbleShown: true, submittedAt: simulationRuntime.now(),
      sequence: ++state.workflow.situationEventSequence });
    recordClientRuntimeDiagnostic("player_submission", { stage: "queued" });
    state.ui.alert = "玩家提问已加入队列";
    render();
    void processNextPendingChat();
    return;
  }
  render();

  recordClientRuntimeDiagnostic("player_submission", { stage: "dispatched", elapsed_ms: 0 });
  await dispatchWorkflow("chat", null, text);
}

function setSpeed(speed) {
  const previousSpeed = state.car.speed;
  state.car.speed = speed;
  if (speed >= 100) {
    state.ui.alert = "高速安全模式：减少主驾互动";
    state.host.targetSeat = "front";
  }
  handleSpeedStateChange(previousSpeed, speed, "manual");
  render();
}

function setDestination(destination) {
  state.car.destination = destination;
  render();
}

function setEnvironment(environment) {
  const environmentChanged = state.car.environment !== environment;
  if (environmentChanged) cancelEnvironmentRoundIntro("开题环境已变化");
  clearGoldenEnvironmentTransition();
  clearScreenEnvironmentTransition();
  const previousScreenEnvironment = state.ui.screenEnvironment || state.car.environment;
  state.car.environment = environment;
  const matchedIndex = findRiddleForEnvironment(environment);
  if (state.game.status === "idle") {
    state.game.currentRiddleIndex = matchedIndex;
    persistDifyRoundScope();
    ensureCurrentRoundPreparation();
  }
  if (environmentChanged) scheduleNextRiddleRefresh();
  const shouldDelayScreen = ["opening", "playing"].includes(state.game.status);
  if (shouldDelayScreen && previousScreenEnvironment !== environment) {
    state.ui.alert = `${environment} 已同步到座舱，中控屏将在2秒后切换`;
    scheduleScreenEnvironmentTransition(environment);
  } else {
    state.ui.screenEnvironment = environment;
    state.ui.alert = `${environment} 已同步到座舱`;
  }
  render();
}

async function handleSpeedStateChange(previousSpeed, speed, source) {
  if (previousSpeed <= OVERSPEED_KMH && speed > OVERSPEED_KMH) {
    await dispatchWorkflow("event", {
      type: "speed_overspeed",
      value: speed,
      previous_value: previousSpeed,
      threshold_kmh: OVERSPEED_KMH,
      priority: "P1",
      source,
    });
    return;
  }
}

function scheduleDriverSafetyAnnouncement() {
  simulationRuntime.clearTimeout(state.workflow.driverSafetyTimer);
  state.workflow.driverSafetyEpisode += 1;
  const episode = state.workflow.driverSafetyEpisode;
  state.workflow.driverSafetyAnnouncedEpisode = 0;
  state.perception.driverSafetySince = simulationRuntime.now();
  state.workflow.driverSafetyTimer = simulationRuntime.setTimeout(() => {
    state.workflow.driverSafetyTimer = null;
    const driverMood = state.passengers.seats.driver.mood;
    if (!state.perception.driverState || !["fatigued", "asleep"].includes(state.perception.driverState)) {
      if (!["疲惫", "睡着"].includes(driverMood)) return;
    }
    if (episode !== state.workflow.driverSafetyEpisode) return;
    state.workflow.driverSafetyAnnouncedEpisode = episode;
    dispatchWorkflow("event", {
      type: "driver_tired",
      duration_ms: simulationRuntime.now() - state.perception.driverSafetySince,
      state: driverMood === "睡着" || state.perception.driverState === "asleep" ? "asleep" : "fatigued",
      priority: "P1",
      source: "persistent_driver_state",
    });
  }, DRIVER_SAFETY_HOLD_MS);
}

function clearDriverSafetyAnnouncement() {
  simulationRuntime.clearTimeout(state.workflow.driverSafetyTimer);
  state.workflow.driverSafetyTimer = null;
  state.workflow.driverSafetyEpisode += 1;
  state.workflow.driverSafetyAnnouncedEpisode = 0;
  state.perception.driverSafetySince = 0;
}

function clearEnvironmentAnnouncement() {
  recordExecutionReceipt(state.workflow.pendingEnvironmentSpeech?.traceId, "speech", "cancelled", "待显示环境话术：已取消");
  simulationRuntime.clearTimeout(state.workflow.pendingEnvironmentSpeechTimer);
  state.workflow.pendingEnvironmentSpeechTimer = null;
  state.workflow.pendingEnvironmentSpeech = null;
  clearHostSpeechLock("environment");
}

const IMPORTANT_EVENT_LABELS = {
  hard_brake: () => "发生急刹",
  temporary_interruption: () => "临时事件打断",
  driver_distracted: () => "主驾分心",
  driver_tired: () => "主驾疲惫",
  passenger_sleep: (seat) => `${getSeatDisplayLabel(seat)}睡着`,
  passenger_wake: (seat) => `${getSeatDisplayLabel(seat)}醒来`,
  passenger_inactive: (seat) => `${getSeatDisplayLabel(seat)}暂时沉默`,
  speed_overspeed: () => "车速超限",
  cabin_laughing: () => "舱内出现笑声",
  near_destination: () => "快到目的地",
  game_stuck: () => "游戏进入僵局",
  near_answer: () => "接近答案",
};

function getSeatDisplayLabel(seat) {
  return {
    driver: "主驾",
    front: "副驾",
    rearLeft: "后排左",
    rearRight: "后排右",
  }[seat] || "乘客";
}

function getImportantEventText(type, seat) {
  return IMPORTANT_EVENT_LABELS[type]?.(seat) || String(type || "").trim();
}

function showImportantEvent(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return;

  const eventState = state.ui.importantEvent;
  simulationRuntime.clearTimeout(eventState.timer);
  simulationRuntime.clearTimeout(eventState.hideTimer);
  eventState.id += 1;
  eventState.text = normalized;
  eventState.phase = "visible";
  eventState.timer = simulationRuntime.setTimeout(() => {
    hideImportantEvent(eventState.id);
  }, IMPORTANT_EVENT_DISPLAY_MS);
  render();
}

function hideImportantEvent(eventId) {
  const eventState = state.ui.importantEvent;
  if (eventState.id !== eventId || eventState.phase === "hidden") return;

  eventState.timer = null;
  eventState.phase = "hiding";
  eventState.hideTimer = simulationRuntime.setTimeout(() => {
    if (eventState.id !== eventId) return;
    eventState.hideTimer = null;
    eventState.text = "";
    eventState.phase = "hidden";
    render();
  }, IMPORTANT_EVENT_EXIT_MS);
  render();
}

function clearImportantEvent() {
  const eventState = state.ui.importantEvent;
  simulationRuntime.clearTimeout(eventState.timer);
  simulationRuntime.clearTimeout(eventState.hideTimer);
  eventState.timer = null;
  eventState.hideTimer = null;
  eventState.id += 1;
  eventState.text = "";
  eventState.phase = "hidden";
}

function scheduleScreenEnvironmentTransition(environment) {
  const transitionId = state.ui.screenEnvironmentTransitionId + 1;
  state.ui.screenEnvironmentTransitionId = transitionId;
  state.ui.screenEnvironmentTimer = simulationRuntime.setTimeout(() => {
    if (
      state.ui.screenEnvironmentTransitionId !== transitionId
      || state.car.environment !== environment
    ) return;
    state.ui.screenEnvironmentTimer = null;
    state.ui.screenEnvironment = environment;
    render();
  }, SCREEN_ENVIRONMENT_DELAY_MS);
}

function clearScreenEnvironmentTransition() {
  if (state.ui.screenEnvironmentTimer) {
    simulationRuntime.clearTimeout(state.ui.screenEnvironmentTimer);
    state.ui.screenEnvironmentTimer = null;
  }
  state.ui.screenEnvironmentTransitionId += 1;
}

function findRiddleForEnvironment(environment) {
  if (environment.includes("雨")) return 0;
  if (environment.includes("雪")) return 5;
  if (environment.includes("城区")) return 6;
  if (environment.includes("风景区")) return 9;
  if (environment.includes("高速")) return 1;
  return state.game.currentRiddleIndex;
}

function getEnvironmentRiddleCandidates(environment) {
  const rules = [
    { keyword: "雨", theme: "雨天" },
    { keyword: "雪", theme: "雪景" },
    { keyword: "城区", theme: "城区" },
    { keyword: "风景区", theme: "风景" },
    { keyword: "高速", theme: "高速" },
  ];
  return rules.filter(rule => String(environment).includes(rule.keyword))
    .flatMap(rule => RIDDLES.flatMap((riddle, index) => riddle.theme === rule.theme ? [index] : []));
}

function selectNextRiddleIndex(previousIndex, environment = state.car.environment) {
  const played = new Set([...state.game.playedRiddleIndices, previousIndex]);
  const matching = getEnvironmentRiddleCandidates(environment).find(index => !played.has(index));
  if (matching !== undefined) return matching;
  for (let offset = 1; offset < RIDDLES.length; offset += 1) {
    const index = (previousIndex + offset) % RIDDLES.length;
    if (!played.has(index)) return index;
  }
  return null;
}

function clearNextRiddleRefresh() {
  simulationRuntime.clearTimeout(state.workflow.nextRiddleRefreshTimer);
  state.workflow.nextRiddleRefreshTimer = null;
}

function refreshFollowingRoundPreparation() {
  clearNextRiddleRefresh();
  if (!["opening", "playing", "paused", "victory", "failed"].includes(state.game.status)) return null;
  return prepareFollowingRound({
    roundIndex: state.game.roundIndex,
    riddleIndex: state.game.currentRiddleIndex,
    timelineId: state.timeline.roundTimelineId || state.timeline.lastRoundTimelineId,
  });
}

function scheduleNextRiddleRefresh() {
  clearNextRiddleRefresh();
  if (state.game.status === "idle" || state.game.status === "summary"
    || state.game.roundIndex >= state.game.totalRounds) return;
  const gameId = state.workflow.gameId;
  const roundId = getDifyRoundScopeKey();
  state.workflow.nextRiddleRefreshTimer = simulationRuntime.setTimeout(() => {
    state.workflow.nextRiddleRefreshTimer = null;
    if (gameId !== state.workflow.gameId || roundId !== getDifyRoundScopeKey()) return;
    refreshFollowingRoundPreparation();
  }, ENVIRONMENT_RIDDLE_SETTLE_MS);
}

function applyImmediateSafetyPause() {
  const previous = state.game.status === "paused" && state.ui.cabinMode === "safety_pause"
    ? state.workflow.safetyResumeContext : null;
  const resumeContext = previous || {
    gameId: state.workflow.gameId,
    roundId: getDifyRoundScopeKey(),
    status: state.game.status === "paused" && !isPlayerGamePaused() ? "playing" : state.game.status,
    cabinMode: state.ui.cabinMode === "temporary_interruption" ? "normal" : state.ui.cabinMode,
    animation: state.ui.animation,
    showAnswer: state.ui.showAnswer,
    correctSeat: state.ui.correctSeat,
    startedAt: simulationRuntime.now(),
  };
  invalidateAsyncHostResults({ preserveSituationEvents: true });
  state.workflow.safetyResumeContext = resumeContext;
  pauseQuestionClock();
  clearNextRoundTimer();
  state.game.status = "paused";
  state.ui.cabinMode = "safety_pause";
  state.ui.alert = "急刹车：游戏已暂停";
  publishHostLine("大家坐稳，游戏先暂停。", {
    priority: "P0",
    source: "hard_brake",
    durationMs: HOST_SPEECH_P0_LOCK_MS,
  });
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

function invalidateAsyncHostResults({ preserveSituationEvents = false, reason = "P0打断：保留事件，恢复后按最新状态重新分析" } = {}) {
  cancelEnvironmentRoundIntro("P0或游戏状态已变化");
  for (const record of state.workflow.situationEvents) {
    if (isSituationEventFinished(record)) continue;
    setSituationEventStatus(record, preserveSituationEvents ? "pending_analysis" : "cancelled",
      preserveSituationEvents ? reason : "游戏或会话已重置");
  }
  simulationRuntime.clearTimeout(state.workflow.recoveryTimer);
  state.workflow.recoveryTimer = null;
  state.workflow.safetyResumeContext = null;
  if (state.workflow.interruption) simulationRuntime.clearTimeout(state.workflow.interruption.timer);
  state.workflow.interruption = null;
  clearResultFeedback();
  state.workflow.p0Epoch += 1;
  abortActiveWorkflow();
  state.workflow.situationRequestId += 1;
  state.workflow.situationInFlight = false;
  state.workflow.situationRequests = {};
  state.workflow.situationEventIds = {};
  if (preserveSituationEvents) {
    for (const record of state.workflow.situationEvents.filter(row => !isSituationEventFinished(row))) {
      state.workflow.situationEventIds[record.key] = record.event.id;
    }
  }
  state.workflow.pendingSituationReplies = [];
  clearDeferredHostReplies("P0或游戏状态已变化");
  state.workflow.pendingChats = [];
  if (!preserveSituationEvents) state.workflow.playerGamePause = null;
  clearEnvironmentAnnouncement();
}

function applyTemporaryInterruption(event = {}) {
  if (state.workflow.interruption || state.game.status !== "playing") return;
  const active = state.workflow.activeChatInput;
  const pending = [...state.workflow.pendingChats];
  const previousSpeech = state.workflow.hostSpeech;
  const replies = state.workflow.deferredHostReplies.filter(entry => isChatSpeechSource(entry.options.source))
    .map(entry => ({ text: entry.text, options: entry.options }));
  const minimum = state.workflow.pendingMinimumSpeech;
  if (minimum && isChatSpeechSource(minimum.source)) replies.push({ text: minimum.text, options: minimum });
  if (previousSpeech.expiresAt > simulationRuntime.now() && isChatSpeechSource(previousSpeech.source)) {
    replies.unshift({ text: state.host.text, options: { priority: "P2", source: previousSpeech.source,
      durationMs: HOST_SPEECH_MAX_DISPLAY_MS, traceId: previousSpeech.traceId,
      startActions: previousSpeech.startActions, publicClue: previousSpeech.publicClue } });
  }
  const spokenReplies = [];
  for (const reply of replies) {
    const planInput = reply.options.startActions?.input;
    if (planInput) pending.push({ seat: planInput.passengers.selected_seat, text: planInput.player_input, event: planInput.event });
    else spokenReplies.push(reply);
  }
  if (active) pending.unshift({ seat: active.passengers.selected_seat, text: active.player_input, event: active.event });
  pauseQuestionClock();
  invalidateAsyncHostResults({ preserveSituationEvents: true });
  clearHostSpeechLock();
  state.workflow.pendingChats = pending;
  const interruption = { gameId: state.workflow.gameId, roundId: getDifyRoundScopeKey(),
    startedAt: simulationRuntime.now(), replies: spokenReplies, timer: null };
  state.workflow.interruption = interruption;
  state.game.status = "paused";
  state.ui.cabinMode = "temporary_interruption";
  const complexRoad = event.reason === "complex_road";
  publishHostLine(complexRoad ? "进入复杂路段，游戏先暂停，问题和进度都保留。"
    : "先暂停一下，刚才的问题和进度都保留，稍后接着来。", { priority: "P0", source: "temporary_interruption" });
  updateDecisionTrace({ perception: complexRoad ? "进入复杂路段" : "临时事件打断", decision: "暂停4.5秒，保留本题与待回答问题",
    execution: "答题计时冻结；未改变题目、提问次数或已确认事实", priority: "P0" });
  interruption.timer = simulationRuntime.setTimeout(() => {
    if (state.workflow.interruption !== interruption || interruption.gameId !== state.workflow.gameId
      || interruption.roundId !== getDifyRoundScopeKey() || state.game.status !== "paused") return;
    state.workflow.interruption = null;
    state.game.status = "playing";
    state.ui.cabinMode = ["fatigued", "distracted", "asleep"].includes(state.perception.driverState) ? "driver_focus" : "normal";
    state.timeline.startedAt += simulationRuntime.now() - interruption.startedAt;
    resumeQuestionClock();
    clearHostSpeechLock();
    interruption.replies.forEach(reply => deferHostReply(reply.text, reply.options));
    publishHostLine("我们接着刚才这题，之前的问题和线索都还在。", { priority: "P2", source: "interruption_recovery", durationMs: 1500 });
    render();
    void dispatchWorkflow("event", { type: "resume_game", source: "temporary_interruption" });
    void processNextPendingChat();
  }, 4500);
  render();
}

function notifyP0Situation(type, details = {}) {
  void dispatchSituationWorkflow({
    ...details,
    id: createRuntimeId("event"),
    type,
    priority: "P0",
    source: "local_rule",
  }, { observationOnly: true });
}

function scheduleEventRecovery(type) {
  if (type !== "hard_brake") {
    return;
  }

  if (state.workflow.recoveryTimer) {
    return;
  }

  const resumeContext = state.workflow.safetyResumeContext;
  const recoveryEpoch = state.workflow.p0Epoch;
  const timer = simulationRuntime.setTimeout(() => {
    if (state.workflow.recoveryTimer !== timer) return;
    state.workflow.recoveryTimer = null;
    if (!resumeContext || state.workflow.safetyResumeContext !== resumeContext
      || recoveryEpoch !== state.workflow.p0Epoch
      || resumeContext.gameId !== state.workflow.gameId || resumeContext.roundId !== getDifyRoundScopeKey()
      || state.game.status !== "paused" || state.ui.cabinMode !== "safety_pause") return;
    state.workflow.safetyResumeContext = null;
    state.game.status = resumeContext.status === "opening" ? "playing" : resumeContext.status;
    state.ui.cabinMode = resumeContext.cabinMode;
    state.ui.animation = resumeContext.animation;
    state.ui.showAnswer = resumeContext.showAnswer;
    state.ui.correctSeat = resumeContext.correctSeat;
    const isReveal = ["failed", "victory"].includes(state.game.status);
    state.ui.alert = isReveal ? "安全状态恢复，继续本题揭晓后进入下一题" : "安全状态恢复";
    const recoveryText = isReveal
      ? state.game.status === "victory"
        ? makeVictoryHostText(state.ui.correctSeat, getCurrentRiddle().answer)
        : `时间到啦，这题没有人答对，答案是“${getCurrentRiddle().answer}”。`
      : state.game.status === "paused" && state.workflow.playerGamePause ? "安全状态已恢复，游戏仍按你的要求暂停。"
        : state.game.status === "idle" ? "安全状态恢复，准备好后再开始。"
        : "安全状态恢复，刚才的线索还在，我们继续。";
    publishHostLine(recoveryText, {
      priority: "P0",
      source: "safety_recovery",
    });
    if (isReveal) {
      const completedRound = state.game.roundIndex;
      state.workflow.nextRoundTimer = simulationRuntime.setTimeout(() => {
        if (resumeContext.gameId !== state.workflow.gameId || resumeContext.roundId !== getDifyRoundScopeKey()) return;
        if (resumeContext.status === "failed") advanceAfterTimeout(completedRound);
        else advanceAfterVictory(completedRound);
      }, NEXT_ROUND_DELAY_MS);
    } else if (state.game.status === "playing") {
      state.timeline.startedAt += simulationRuntime.now() - resumeContext.startedAt;
      if (state.timeline.status !== "paused") resumeQuestionClock();
    }
    updateDecisionTrace({
      perception: "急刹风险已解除",
      decision: isReveal ? "恢复原揭晓状态，不重新开启已结束题目" : "恢复打断前的游戏状态并保留上下文",
      execution: isReveal ? "重新安排揭晓后的下一题切换" : "恢复原流程",
      strategyId: "S01",
      priority: "P1",
    });
    render();
    void processNextPendingChat();
  }, 4500);
  state.workflow.recoveryTimer = timer;
}

function applyImmediatePassengerSleep(seat) {
  state.passengers.seats[seat].mood = "睡着";
  if (state.game.status === "paused") { render(); return; }
  state.ui.cabinMode = "soft";
  state.ui.alert = `${SEATS[seat]}已睡着，降低打扰`;
  state.host.targetSeat = seat;
  updateDecisionTrace({
    perception: `检测到${SEATS[seat]}睡着`,
    decision: "轻声继续，并避免 cue 睡着乘客",
    execution: "切换轻声互动模式，排除该座位发言",
    strategyId: "S04",
    priority: "P2",
  });
  render();
}

function applyImmediatePassengerWake(seat) {
  state.passengers.seats[seat].mood = "普通";
  state.passengers.seats[seat].activity = "idle";
  state.passengers.seats[seat].activityLabel = "";
  state.ui.alert = `${SEATS[seat]}已醒来，恢复互动`;
  render();
}

function applyImmediateDriverTired(driverState = "fatigued") {
  state.perception.driverState = driverState;
  state.passengers.seats.driver.mood = "疲惫";
  if (state.game.status === "paused") { render(); return; }
  state.ui.cabinMode = "driver_focus";
  state.ui.alert = `主驾${driverState === "distracted" ? "分心" : "疲惫"}：关注车辆安全提醒`;
  state.host.targetSeat = "front";
  updateDecisionTrace({
    perception: `检测到主驾${driverState === "distracted" ? "分心" : "疲惫"}`,
    decision: "交由车辆安全策略处理，不用游戏干预主驾",
    execution: "停止向主驾发起游戏邀请；仅模拟安全提醒",
    strategyId: "S03",
    priority: "P1",
  });
  render();
}

function applyImmediateNearDestination() {
  if (state.game.status === "paused") return;
  state.ui.cabinMode = "final_round";
  state.ui.alert = "快到目的地：准备收尾";
  state.host.targetSeat = null;
  updateDecisionTrace({
    perception: "检测到快到目的地",
    decision: "收束游戏节奏，进入绝杀局",
    execution: "切换 final_round 状态",
    strategyId: "S09",
    priority: "P2",
  });
  render();
}

async function dispatchWorkflow(triggerType, event, playerInput = "") {
  if (simulationRuntime.paused) await simulationRuntime.waitUntilRunning();
  const normalizedEvent = event
    ? { ...event, id: event.id || createRuntimeId("event"), priority: event.priority || getEventPriority(event.type) }
    : null;
  const eventType = normalizedEvent?.type;
  if (triggerType === "chat") cancelEnvironmentRoundIntro("乘客已开始问答，不再补播开场");
  if (triggerType === "event" && eventType === "start_game") {
    const input = buildWorkflowInput(triggerType, normalizedEvent, playerInput);
    applyWorkflowOutput(localDecision(input), input, "local");
    const preparation = ensureCurrentRoundPreparation();
    applyPreparedRoundPlan(preparation);
    prepareFollowingRound(preparation);
    void processNextPendingChat();
    return;
  }
  if (triggerType === "event") {
    if (eventType === "temporary_interruption") applyTemporaryInterruption(normalizedEvent);
    if ((eventType === "hard_brake" || eventType === "safety_pause")
      && state.ui.cabinMode !== "safety_pause") {
      applyImmediateSafetyPause();
      scheduleEventRecovery("hard_brake");
    }
    void dispatchSituationWorkflow(normalizedEvent, { observationOnly: normalizedEvent.priority === "P0" || eventType === "temporary_interruption" });
    return;
  }
  if (isHostBusy()) {
    state.ui.alert = "AI 正在处理上一条信息，请稍等";
    render();
    return;
  }

  const input = buildWorkflowInput(triggerType, normalizedEvent, playerInput);
  const requestId = beginWorkflowRequest(input);

  try {
    let output = await requestWorkflow(input, state.workflow.activeController.signal);
    if (requestId !== state.workflow.activeRequestId) return;
    stopWaitingForHostReply(requestId);

    const outputDelayMs = getBubbleOutputDelayMs(input);
    if (outputDelayMs > 0) {
      await sleep(outputDelayMs);
      if (requestId !== state.workflow.activeRequestId) return;
    }

    output = applyAnswerHitGuard(output, input);
    applyWorkflowOutput(output, input, "chat");
  } catch (error) {
    if (requestId !== state.workflow.activeRequestId) return;
    stopWaitingForHostReply(requestId);
    console.warn("Workflow exchange failed; using fallback reply.", error);
    if (input.trigger_type === "chat" && input.game?.status === "victory") {
      console.warn("Victory-period chat failed; skipping unrelated local fallback.");
      return;
    }
    try {
      if (input.trigger_type === "chat") {
        await sleep(LOCAL_FALLBACK_REPLY_DELAY_MS);
        if (requestId !== state.workflow.activeRequestId) return;
      }
      const fallback = localDecision(input, error);
      fallback.knowhow_status = "failed";
      fallback.retrieved_knowhow = [];
      fallback.applied_knowhow_ids = [];
      fallback.strategy = "soft_response";
      fallback.target_seat = null;
      fallback.reason_codes = ["workflow_unavailable"];
      fallback.decision_trace = {
        ...fallback.decision_trace,
        schema_version: 2, layer: "fallback", decision: `${describeWorkflowFailure(error)}，使用本地兜底话术`,
      };
      applyWorkflowOutput(fallback, input, "local");
      recordClientRuntimeDiagnostic("workflow_failure", { stage: "local_fallback", reason: "workflow_error", request_id: error.workflowDiagnosticId });
    } catch (fallbackError) {
      console.error("Fallback workflow exchange failed.", fallbackError);
      if (isCurrentWorkflowInput(input)) {
        const fallbackText = getDefaultHostReply({}, input);
        if (fallbackText) publishHostLine(fallbackText, {
          priority: "P2",
          source: "workflow_fallback",
        });
        state.host.emotion = "normal";
      }
    }
  } finally {
    if (requestId === state.workflow.activeRequestId) {
      const elapsedMs = simulationRuntime.now() - state.workflow.hostThinkingStartedAt;
      const remainingMs = state.workflow.hostThinkingActive
        ? Math.max(0, HOST_MIN_THINKING_DISPLAY_MS - elapsedMs)
        : 0;
      if (remainingMs > 0) await sleep(remainingMs);
      if (requestId !== state.workflow.activeRequestId) return;
      finishWorkflowRequest(requestId);
      render();
    }
  }
}

function ensureRoundPreparation({
  gameId = state.workflow.gameId,
  roundIndex = state.game.roundIndex,
  riddleIndex = state.game.currentRiddleIndex,
  scenario = getActiveGoldenLine(),
  relationship = state.passengers.relationship,
  previousTimelineId = state.timeline.lastRoundTimelineId,
  newGame = false,
  scenarioTemplate = false,
  preferredTimelineId = "",
} = {}) {
  const roundId = `${gameId}-round-${roundIndex}`;
  const existing = roundQuestionPreparations.get(roundId);
  if (existing && existing.riddleIndex === riddleIndex
    && existing.scenarioId === scenario.id && existing.relationship === relationship) return existing;
  if (existing) discardRoundPreparation(existing);

  const cleanScenario = newGame || (state.car.environment === scenario.environment
    && state.car.speed === scenario.speed && state.car.destination === scenario.destination
    && getSleepingSeats().length === 0 && state.perception.driverState === "normal");
  const scenarioSource = startupLoading.initialized && !scenarioTemplate && roundIndex === 1
    && riddleIndex === scenario.riddleIndex && relationship === scenario.relationship
    && !previousTimelineId && cleanScenario ? getScenarioFirstRoundPreparation(scenario, true) : null;

  const preparation = {
    gameId, roundId, roundIndex, riddleIndex,
    scenarioId: scenario.id,
    relationship,
    timelineId: scenarioSource?.timelineId || preferredTimelineId || (existing?.scenarioId === scenario.id && existing.relationship === relationship
      ? existing.timelineId : pickRoundGoldenTimeline(previousTimelineId).id),
    newGame,
    scenarioTemplate,
    scenarioSource,
    status: "created",
    plan: null,
    controller: null,
    repairPending: false,
    diagnostics: [],
    input: null,
    promise: null,
  };
  preparation.input = buildRoundPreviewInput(preparation);
  roundQuestionPreparations.set(roundId, preparation);
  preparation.promise = scenarioSource
    ? adoptScenarioPreview(preparation, scenarioSource)
    : scenarioTemplate
      ? waitForPreloadForeground().then(() => requestPreparedRound(preparation))
      : requestPreparedRound(preparation);
  return preparation;
}

function getScenarioFirstRoundPreparation(scenario, forGame = false) {
  const scenarioKey = `${scenario.id}:${scenario.relationship}:${scenario.riddleIndex}`;
  const reservation = scenarioFirstRoundReservations.get(scenarioKey);
  if (reservation && (!forGame || !reservation.claimed)) {
    if (forGame) reservation.claimed = true;
    return reservation.source;
  }
  const timelineId = pickRoundGoldenTimeline("").id;
  const key = `${scenarioKey}:${timelineId}`;
  if (!scenarioFirstRoundPreparations.has(key)) {
    scenarioFirstRoundPreparations.set(key, ensureRoundPreparation({
      gameId: createRuntimeId("preview-cache"), roundIndex: 1,
      riddleIndex: scenario.riddleIndex, scenario, relationship: scenario.relationship,
      previousTimelineId: "", newGame: true, scenarioTemplate: true, preferredTimelineId: timelineId,
    }));
  }
  const source = scenarioFirstRoundPreparations.get(key);
  if (!reservation) scenarioFirstRoundReservations.set(scenarioKey, { source, claimed: forGame });
  return source;
}

function copyScenarioPreview(preparation, source) {
  if (roundQuestionPreparations.get(preparation.roundId) !== preparation) return;
  preparation.status = source.status;
  preparation.error = source.error;
  preparation.repairPending = source.repairPending;
  if (source.plan) {
    preparation.plan = structuredClone(source.plan);
    preparation.plan.id = preparation.roundId;
    applyPreparedRoundPlan(preparation);
  }
}

async function adoptScenarioPreview(preparation, source) {
  preparation.status = "pending";
  await source.promise;
  copyScenarioPreview(preparation, source);
}

function ensureCurrentRoundPreparation() {
  const preparation = ensureRoundPreparation();
  for (const entry of roundQuestionPreparations.values()) {
    if (entry.gameId === state.workflow.gameId && entry.roundIndex < state.game.roundIndex) {
      discardRoundPreparation(entry);
    }
  }
  return preparation;
}

function prepareFollowingRound(preparation) {
  if (preparation.roundIndex >= state.game.totalRounds) return null;
  const riddleIndex = selectNextRiddleIndex(preparation.riddleIndex);
  if (riddleIndex === null) return null;
  const roundId = `${state.workflow.gameId}-round-${preparation.roundIndex + 1}`;
  const previous = roundQuestionPreparations.get(roundId);
  const next = ensureRoundPreparation({
    roundIndex: preparation.roundIndex + 1,
    riddleIndex,
    previousTimelineId: preparation.timelineId,
  });
  next.environmentSelection = {
    environment: state.car.environment,
    matched: getEnvironmentRiddleCandidates(state.car.environment).includes(riddleIndex),
  };
  if (previous !== next) console.info("[next-riddle]", {
    game_id: next.gameId, round_id: next.roundId, environment: state.car.environment,
    riddle_index: riddleIndex, theme: RIDDLES[riddleIndex].theme,
    reason: getEnvironmentRiddleCandidates(state.car.environment).includes(riddleIndex) ? "environment_match" : "unused_sequence",
  });
  return next;
}

function isCurrentEnvironmentRoundIntro(entry) {
  return Boolean(entry && state.workflow.environmentRoundIntro === entry
    && !["cancelled", "skipped", "completed"].includes(entry.status)
    && entry.gameId === state.workflow.gameId && entry.roundId === getDifyRoundScopeKey()
    && entry.riddleIndex === state.game.currentRiddleIndex && entry.environment === state.car.environment
    && entry.p0Epoch === state.workflow.p0Epoch && entry.expiresAt > simulationRuntime.now()
    && ["opening", "playing"].includes(state.game.status) && state.game.questionCount === 0
    && !state.workflow.pendingChats.length
    && !Object.values(state.passengers.seats).some(seat => seat.bubble));
}

function cancelEnvironmentRoundIntro(reason) {
  const entry = state.workflow.environmentRoundIntro;
  if (!entry || ["cancelled", "skipped", "completed"].includes(entry.status)) return;
  const wasShown = entry.status === "shown";
  simulationRuntime.clearTimeout(entry.timer);
  entry.timer = null;
  entry.status = wasShown ? "completed" : "cancelled";
  entry.reason = reason;
  state.workflow.deferredHostReplies = state.workflow.deferredHostReplies.filter(reply =>
    reply.options.sceneScope?.environmentRoundIntroId !== entry.id);
  if (entry.requestId === state.workflow.activeRequestId && state.workflow.inFlight) {
    abortActiveWorkflow();
    simulationRuntime.setTimeout(() => { render(); void processNextPendingChat(); }, 0);
  }
  if (!wasShown) recordExecutionReceipt(entry.traceId, "speech", "cancelled", `应景开场：${reason}`);
}

function hasHigherPendingEnvironmentIntro(priority) {
  const entry = state.workflow.environmentRoundIntro;
  return ["pending", "generating", "ready"].includes(entry?.status) && isCurrentEnvironmentRoundIntro(entry)
    && normalizeHostSpeechPriority(priority) < HOST_SPEECH_PRIORITIES.P3;
}

function queueEnvironmentRoundIntro() {
  const preparation = roundQuestionPreparations.get(getDifyRoundScopeKey());
  const selection = preparation?.environmentSelection;
  if (state.game.roundIndex < 2 || !selection?.matched || selection.environment !== state.car.environment
    || !getEnvironmentRiddleCandidates(state.car.environment).includes(state.game.currentRiddleIndex)
    || state.workflow.environmentRoundIntro?.roundId === getDifyRoundScopeKey()) return;
  cancelEnvironmentRoundIntro("已切换题目");
  const entry = { id: createRuntimeId("round-intro"), gameId: state.workflow.gameId, roundId: getDifyRoundScopeKey(),
    riddleIndex: state.game.currentRiddleIndex, environment: state.car.environment, p0Epoch: state.workflow.p0Epoch,
    sequence: ++state.workflow.situationEventSequence,
    expiresAt: simulationRuntime.now() + ENVIRONMENT_ROUND_INTRO_WINDOW_MS, status: "pending", timer: null,
    traceId: null, requestId: null };
  state.workflow.environmentRoundIntro = entry;
  entry.timer = simulationRuntime.setTimeout(() => {
    entry.timer = null;
    if (entry.status !== "shown") cancelEnvironmentRoundIntro("已错过开题窗口，不再补播");
  }, ENVIRONMENT_ROUND_INTRO_WINDOW_MS);
  void processNextPendingChat();
}

async function dispatchEnvironmentRoundIntro(entry) {
  if (!isCurrentEnvironmentRoundIntro(entry) || entry.status !== "pending") return;
  entry.status = "generating";
  const event = { id: entry.id, type: "round_changed", source: "environment_riddle", priority: "P3", value: entry.environment };
  const input = { ...buildRealtimeChatInput(buildFullWorkflowInput("event", event, "")), trigger_type: "event",
    dialogue_request: { kind: "environment_round_intro" } };
  entry.traceId = updateDecisionTrace({ perception: `第${state.game.roundIndex}题已按当前环境应景选定：${entry.environment}`,
    decision: "请求一句应景开场，不增加线索；乘客提问与重要事件优先", execution: "等待Chatflow生成开场串词", priority: "P3" });
  const requestId = beginWorkflowRequest(input);
  entry.requestId = requestId;
  try {
    const output = await requestWorkflow(input, state.workflow.activeController.signal);
    if (requestId !== state.workflow.activeRequestId || !isCurrentEnvironmentRoundIntro(entry) || !isCurrentWorkflowInput(input)) return;
    const bff = output._bff || {};
    const text = sanitizeHostReplyText(output.ai_reply_text || "");
    if (bff.route !== "chat" || bff.operation !== "environment_round_intro" || bff.event_id !== entry.id
      || bff.game_id !== input.game_id || bff.round_id !== input.round_id || bff.scene_version !== input.scene_version
      || output.decision_trace?.guard_status !== "passed" || output.intent !== "event" || !text || text.length > 100
      || text.includes(input.game.current_answer) || output.is_correct || output.ui_change?.show_answer
      || output.game_status && output.game_status !== input.game.status
      || output.passenger_action || output.execution?.actions?.length || output.covered_fact_keys?.length) {
      entry.status = "skipped";
      recordExecutionReceipt(entry.traceId, "speech", "skipped", "应景开场未通过校验，不补固定话术");
      return;
    }
    entry.status = "ready";
    publishHostLine(text, { priority: "P3", source: "environment_round_intro", traceId: entry.traceId,
      sceneScope: { environmentRoundIntroId: entry.id } });
    render();
  } catch (error) {
    if (requestId === state.workflow.activeRequestId && isCurrentEnvironmentRoundIntro(entry)) {
      entry.status = "skipped";
      recordExecutionReceipt(entry.traceId, "speech", "skipped", "应景开场请求失败，不补通用话术");
      console.warn("Environment round intro unavailable.", error.message);
    }
  } finally {
    if (requestId === state.workflow.activeRequestId) {
      finishWorkflowRequest(requestId);
      render();
    }
  }
}

function prepareNextGameFirstRound() {
  const scenario = getActiveGoldenLine();
  if (nextGamePreparation?.scenarioId === scenario.id) return;
  nextGamePreparation = ensureRoundPreparation({
    gameId: createRuntimeId("game"),
    roundIndex: 1,
    riddleIndex: scenario.riddleIndex,
    scenario,
    relationship: scenario.relationship,
    previousTimelineId: "",
    newGame: true,
  });
  cancelPreviewWorkflow(nextGamePreparation.gameId);
}

function cancelPreviewWorkflow(keepGameId = "") {
  for (const preparation of roundQuestionPreparations.values()) {
    if (preparation.gameId !== keepGameId && !preparation.scenarioTemplate) discardRoundPreparation(preparation);
  }
  if (nextGamePreparation?.gameId !== keepGameId) nextGamePreparation = null;
  state.workflow.previewPending = [...roundQuestionPreparations.values()]
    .some((entry) => entry.status === "pending" || entry.repairPending);
}

function discardRoundPreparation(preparation) {
  roundQuestionPreparations.delete(preparation.roundId);
  preparation.status = "cancelled";
  preparation.repairPending = false;
  preparation.controller?.abort();
}

async function requestPreparedRound(preparation) {
  preparation.status = "pending";
  preparation.controller = new AbortController();
  state.workflow.previewPending = true;
  const startedAt = simulationRuntime.now();
  let requestInput = preparation.input;
  if (preparation.plan && preparation.repairRequest) {
    requestInput = structuredClone(preparation.input);
    requestInput.round_question_plan_request.repair = preparation.repairRequest;
  }
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const output = await requestWorkflow(requestInput, preparation.controller.signal);
      if (roundQuestionPreparations.get(preparation.roundId) !== preparation) return;
      preparation.diagnostics.push(output.preview_diagnostic || { status: "legacy_response" });
      preparation.repairRequest = output.preview_repair || null;
      const minimumSteps = ["partial", "ready"].includes(output.preview_status) ? 1 : 2;
      const plan = normalizeRoundQuestionPlan(output.round_question_plan, preparation.roundId, minimumSteps);
      if (plan && plan.steps.length >= (preparation.plan?.steps.length || 0)) {
        preparation.plan = plan;
        preparation.status = output.preview_status === "partial" ? "partial" : "ready";
        if (applyPreparedRoundPlan(preparation)) render();
      } else {
        preparation.status = preparation.plan ? "partial" : "failed";
      }
      if (attempt === 1 || !output.preview_diagnostic?.repairable || !output.preview_repair) break;

      preparation.repairPending = true;
      requestInput = structuredClone(preparation.input);
      requestInput.event.id = createRuntimeId("preview-repair");
      requestInput.round_question_plan_request.repair = output.preview_repair;
    }
  } catch (error) {
    if (roundQuestionPreparations.get(preparation.roundId) !== preparation) return;
    preparation.status = preparation.plan ? "partial" : "failed";
    preparation.error = String(error.message || error);
    preparation.diagnostics.push({
      status: preparation.status,
      repair_attempted: preparation.repairPending,
      validation_errors: ["preview_transport_error"],
      error: preparation.error,
    });
    console.warn("Question preview unavailable; simulated passenger questions are skipped.", {
      round_id: preparation.roundId,
      error: preparation.error,
    });
  } finally {
    preparation.repairPending = false;
    if (preparation.scenarioTemplate) {
      for (const entry of roundQuestionPreparations.values()) {
        if (entry.scenarioSource === preparation) copyScenarioPreview(entry, preparation);
      }
      simulationRuntime.defer(() => { if (startupLoading.initialized) render(); });
    }
    state.workflow.previewPending = [...roundQuestionPreparations.values()]
      .some((entry) => entry.status === "pending" || entry.repairPending);
    console.info("[question-preview]", {
      game_id: preparation.gameId,
      round_id: preparation.roundId,
      status: preparation.status,
      elapsed_ms: simulationRuntime.now() - startedAt,
      diagnostics: preparation.diagnostics,
    });
  }
}

function applyPreparedRoundPlan(preparation) {
  if (!preparation || !["ready", "partial"].includes(preparation.status)
    || roundQuestionPreparations.get(preparation.roundId) !== preparation
    || preparation.gameId !== state.workflow.gameId
    || preparation.roundId !== getDifyRoundScopeKey()
    || preparation.riddleIndex !== state.game.currentRiddleIndex
    || preparation.relationship !== state.passengers.relationship
    || (state.timeline.roundTimelineId && state.timeline.roundTimelineId !== preparation.timelineId)
    || !["opening", "playing"].includes(state.game.status)
    || state.timeline.status === "paused") return false;
  if (state.game.roundQuestionPlan === preparation.plan) return false;
  state.game.roundQuestionPlan = preparation.plan;
  return true;
}

function getSituationEventKey(event) {
  if (["passenger_sleep", "passenger_wake"].includes(event?.type)) return `sleep_state:${event.seat}`;
  return event?.seat && ["passenger_inactive", "cabin_laughing"].includes(event.type)
    ? `${event.type}:${event.seat}` : event?.type;
}

function getSituationEventDependency(event) {
  if (["passenger_sleep", "passenger_wake", "cabin_laughing"].includes(event.type)) {
    return JSON.stringify([event.seat, state.passengers.seats[event.seat]?.mood]);
  }
  if (event.type === "environment_change") return state.car.environment;
  if (["driver_tired", "driver_distracted"].includes(event.type)) {
    return JSON.stringify([state.perception.driverState, state.passengers.seats.driver.mood]);
  }
  if (event.type === "speed_overspeed") return String(Number(state.car.speed) > OVERSPEED_KMH);
  if (event.type === "near_destination") return state.car.destination;
  if (event.type === "passenger_inactive") return String(state.workflow.participation.revision);
  return state.perception.gameProgress;
}

function isSituationEventFinished(record) {
  return ["completed", "silent", "superseded", "cancelled", "failed"].includes(record.status);
}

function setSituationEventStatus(record, status, reason = "") {
  if (!record || record.status === status && record.reason === reason) return;
  record.status = status;
  record.reason = reason;
  record.updatedAt = simulationRuntime.now();
  recordExecutionReceipt(record.traceId, "event", status, reason || `事件：${status}`);
  console.info("[situation-event]", { event_id: record.event.id, event_type: record.event.type,
    seat: record.event.seat, priority: record.event.priority, status, reason });
  renderDecisionTrace();
}

function findSituationEvent(eventId) {
  return state.workflow.situationEvents.find(record => record.event.id === eventId);
}

function getSituationEventInvalidReason(record) {
  if (!record || record.gameId !== state.workflow.gameId) return "所属游戏已结束";
  if (["superseded", "cancelled", "failed", "silent"].includes(record.status)) return record.reason || "事件已结束";
  if (state.workflow.situationEventIds[record.key] !== record.event.id) return "已被同一目标的新状态替代";
  if (record.dependency !== getSituationEventDependency(record.event)) return "事件目标状态已变化";
  if (record.expiresAt <= simulationRuntime.now()) return "氛围或邀请事件已过期";
  if (record.roundBound && record.roundId !== getDifyRoundScopeKey()) return "题目已切换，旧题事件不再适用";
  if (record.event.type === "passenger_inactive"
    && (!state.host.preferences.invitations || state.host.preferences.independent
      || state.workflow.participation.invitationDeclined || state.workflow.pendingChats.length
      || getSleepingSeats().includes("front") || buildParticipationSnapshot().remaining_ms <= PARTICIPATION_MIN_REMAINING_MS)) {
    return "当前不再适合邀请乘客";
  }
  return "";
}

function registerSituationEvent(event) {
  if (normalizeHostSpeechPriority(event.priority) > HOST_SPEECH_PRIORITIES.P3
    && state.workflow.environmentRoundIntro?.status === "generating") {
    cancelEnvironmentRoundIntro("更高优先级事件先行，取消未播开场");
  }
  const existing = findSituationEvent(event.id);
  if (existing) return existing;
  const key = getSituationEventKey(event);
  for (const previous of state.workflow.situationEvents) {
    if (previous.key === key && !isSituationEventFinished(previous)) {
      setSituationEventStatus(previous, "superseded", "已被同一目标的新状态替代");
    }
  }
  const roundBound = ["passenger_inactive", "near_answer", "game_stuck", "cabin_laughing", "post_result_feedback"].includes(event.type);
  const record = { event: { ...event }, key, gameId: state.workflow.gameId, roundId: getDifyRoundScopeKey(),
    sequence: ++state.workflow.situationEventSequence, occurredAt: simulationRuntime.now(), dependency: getSituationEventDependency(event),
    roundBound, expiresAt: roundBound ? simulationRuntime.now() + 30000 : Infinity, status: "pending_analysis", traceId: null,
    executedActions: [] };
  const pending = state.workflow.situationEvents.filter(row => !isSituationEventFinished(row));
  const recent = state.workflow.situationEvents.filter(row => isSituationEventFinished(row)
    && row.updatedAt > simulationRuntime.now() - 120000).slice(-100);
  state.workflow.situationEvents = [...recent, ...pending];
  state.workflow.situationEvents.push(record);
  state.workflow.situationEventIds[key] = event.id;
  renderDecisionTrace();
  return record;
}

function compareSituationEvents(a, b) {
  return normalizeHostSpeechPriority(b.event.priority) - normalizeHostSpeechPriority(a.event.priority)
    || a.sequence - b.sequence;
}

function shouldProcessSituationBeforeChat(record) {
  if (!state.workflow.pendingChats.length) return true;
  const priority = normalizeHostSpeechPriority(record.event.priority);
  return priority > HOST_SPEECH_PRIORITIES.P2 || priority === HOST_SPEECH_PRIORITIES.P2
    && record.sequence < (state.workflow.pendingChats[0].sequence || 0);
}

function refreshSituationEvent(record, reason) {
  if (!record || isSituationEventFinished(record)) return;
  const invalid = getSituationEventInvalidReason(record);
  if (invalid) { setSituationEventStatus(record, "cancelled", invalid); return; }
  state.workflow.pendingSituationReplies = state.workflow.pendingSituationReplies.filter(entry => entry.input.event.id !== record.event.id);
  setSituationEventStatus(record, "pending_analysis", reason);
  simulationRuntime.setTimeout(processNextPendingChat, 0);
}

async function dispatchSituationWorkflow(event, { observationOnly = false, eventRecord = null } = {}) {
  const tracked = !observationOnly && event.priority !== "P0" && event.type !== "post_result_feedback";
  const record = tracked ? eventRecord || registerSituationEvent(event) : null;
  if (record && (isSituationEventFinished(record) || !eventRecord && record.status !== "pending_analysis")) return;
  if (record && !["opening", "playing"].includes(state.game.status)) return;
  if (record) setSituationEventStatus(record, "analyzing", "事件已排队，正在分析");
  const requestId = state.workflow.situationRequestId + 1;
  state.workflow.situationRequestId = requestId;
  const requestSlot = getSituationEventKey(event);
  state.workflow.situationRequests[requestSlot] = requestId;
  state.workflow.situationEventIds[requestSlot] = event.id;
  state.workflow.situationInFlight = true;
  const input = buildWorkflowInput("event", event, "");
  try {
    const output = await requestWorkflow(input);
    if (state.workflow.situationRequests[requestSlot] !== requestId) return;
    if (!output || !isCurrentWorkflowInput(input)) return;
    const scene = output.scene_output;
    if (!isCurrentSituationResult(scene, input, output._bff)) return;
    delete state.workflow.situationRequests[requestSlot];
    state.workflow.situationInFlight = Object.keys(state.workflow.situationRequests).length > 0;
    if (input.event?.type === "passenger_inactive"
      && input.participation?.version !== state.workflow.participation.revision) return;
    if (observationOnly || input.event?.priority === "P0") {
      state.workflow.lastSituationObservation = {
        event_type: input.event?.type,
        event_id: input.event?.id,
        scene,
      };
      return;
    }
    const traceId = updateDecisionTrace(normalizeDecisionTrace(output, input));
    if (record) record.traceId = traceId;
    if ((scene.request_proactive_speech === true || scene.request_host_decision === true)
      && scene.analysis_status === "ready") {
      queueSituationReply(input, output, traceId);
    } else {
      setSituationEventStatus(record, "silent", "情境分析未申请发言或设备决策");
      recordExecutionReceipt(traceId, "speech", "none", "情境分析完成：本次未申请发言");
    }
    render();
  } catch (error) {
    if (state.workflow.situationRequests[requestSlot] !== requestId) return;
    console.warn("Situation Workflow exchange failed; keeping frontend state.", error);
    if (observationOnly || !isCurrentWorkflowInput(input)) return;
    setSituationEventStatus(record, "failed", "情境分析请求失败，未执行设备动作");
    updateDecisionTrace({
      source: "bff_situation",
      perception: describeRequestObservation(input),
      decision: `${describeWorkflowFailure(error)}，情境分析未完成，保留当前状态`,
      execution: "未新增主持人话术或车辆动作",
      strategyId: "",
      priority: event?.priority || "P2",
    });
    render();
  } finally {
    const ownsRequest = state.workflow.situationRequests[requestSlot] === requestId;
    if (ownsRequest) delete state.workflow.situationRequests[requestSlot];
    state.workflow.situationInFlight = Object.keys(state.workflow.situationRequests).length > 0;
    if (ownsRequest && record && record.status === "analyzing") {
      const invalid = getSituationEventInvalidReason(record);
      setSituationEventStatus(record, invalid ? "cancelled" : "failed", invalid || "情境未返回有效交接结果");
    }
    simulationRuntime.setTimeout(processNextPendingChat, 0);
  }
}

function queueSituationReply(input, output, traceId, feedbackEntry = null) {
  if (!output._bff?.situation_handoff) {
    recordExecutionReceipt(traceId, "speech", "skipped", "情境结果没有有效的Chatflow交接凭据");
    return;
  }
  const entry = { input, scene: output.scene_output, handoff: output._bff.situation_handoff, traceId, feedbackEntry };
  const record = findSituationEvent(input.event.id);
  setSituationEventStatus(record, "ready", "分析完成，等待按优先级生成话术");
  const key = getSituationEventKey(input.event);
  const previous = state.workflow.pendingSituationReplies.filter(row => getSituationEventKey(row.input.event) === key);
  previous.forEach(row => recordExecutionReceipt(row.traceId, "speech", "superseded", "被同类型的新事件替代"));
  state.workflow.pendingSituationReplies = state.workflow.pendingSituationReplies.filter(row => getSituationEventKey(row.input.event) !== key);
  state.workflow.pendingSituationReplies.push(entry);
  state.workflow.pendingSituationReplies.sort((a, b) => normalizeHostSpeechPriority(b.input.event.priority) - normalizeHostSpeechPriority(a.input.event.priority)
    || (findSituationEvent(a.input.event.id)?.sequence || 0) - (findSituationEvent(b.input.event.id)?.sequence || 0));
  recordExecutionReceipt(traceId, "speech", "queued", entry.scene.request_proactive_speech
    ? "情境分析完成，等待Chatflow生成回应" : "等待主持人生成睡眠关怀或醒来恢复话术");
  void processNextPendingChat();
}

function isCurrentSituationReply(entry) {
  if (entry.feedbackEntry) return currentResultFeedback(entry.feedbackEntry) && !entry.feedbackEntry.shown
    && simulationRuntime.now() < entry.feedbackEntry.expiresAt && Number(entry.scene.expires_at_ms) > simulationRuntime.wallNow();
  return isCurrentWorkflowInput(entry.input)
    && state.workflow.situationEventIds[getSituationEventKey(entry.input.event)] === entry.input.event.id
    && isCurrentSituationScope(getSituationScope(entry.input, entry.scene));
}

async function dispatchSituationReply(entry) {
  if (!isCurrentSituationReply(entry)) return;
  const record = findSituationEvent(entry.input.event.id);
  if (record && entry.input.scene_version !== getSceneVersion()) {
    refreshSituationEvent(record, "轮到回应时快照已更新，重新分析后再生成话术");
    return;
  }
  const input = {
    ...buildRealtimeChatInput(buildFullWorkflowInput("event", entry.input.event, "")),
    trigger_type: "event",
    dialogue_request: { kind: "situation_event", event_id: entry.input.event.id },
    ...(entry.feedbackEntry ? { host_feedback: entry.input.host_feedback } : {}),
  };
  const requestId = beginWorkflowRequest(input);
  setSituationEventStatus(record, "generating", "正在依据最新快照生成事件回应");
  recordExecutionReceipt(entry.traceId, "speech", "generating", entry.scene.request_proactive_speech
    ? "Chatflow正在生成情境回应" : "主持人正在生成睡眠关怀或醒来恢复话术");
  try {
    const output = await requestWorkflow(input, state.workflow.activeController.signal, { situationHandoff: entry.handoff });
    if (requestId !== state.workflow.activeRequestId || !isCurrentSituationReply(entry)) return;
    if (output._bff?.route !== "chat" || output._bff.operation !== "situation_reply"
      || output._bff.event_id !== input.event.id || output._bff.game_id !== input.game_id
      || output._bff.round_id !== input.round_id || output._bff.scene_version !== input.scene_version) return;
    const text = sanitizeHostReplyText(output.ai_reply_text || "");
    const actions = Array.isArray(output.execution?.actions) ? output.execution.actions : [];
    const comfortDecision = entry.scene.request_host_decision === true
      && ["passenger_sleep", "passenger_wake"].includes(input.event.type)
      && entry.scene.host_decision_seat === input.event.seat;
    if ((!text && (!comfortDecision || actions.length)) || output.intent === "fallback" || output.decision_trace?.guard_status !== "passed"
      || (input.game?.current_answer && text.includes(input.game.current_answer))
      || output.is_correct || output.ui_change?.show_answer
      || actions.some((action) => !canApplySleepComfortAction(action, input))
      || (text && shouldMuteHostReplyForEvent(input.event.type, text))) {
      recordExecutionReceipt(entry.traceId, "speech", "skipped", describeSituationReplyFailure(output));
      setSituationEventStatus(record, "failed", describeSituationReplyFailure(output));
      return;
    }
    if (entry.feedbackEntry) {
      entry.feedbackEntry.output = output;
      return;
    }
    if (comfortDecision && state.decisionTrace.id === entry.traceId) {
      state.decisionTrace.decision += actions.length
        ? input.event.type === "passenger_wake" ? "\n主持人决定恢复该座位的环境设置" : "\n主持人决定启用该座位睡眠关怀"
        : "\n主持人本次未调整分区设置";
    }
    if ((entry.scene.request_proactive_speech === true || actions.length) && text) {
      setSituationEventStatus(record, "waiting_speech", "话术已生成，等待前序气泡结束");
      const sceneScope = getSituationScope(entry.input, entry.scene);
      if (actions.length) recordExecutionReceipt(entry.traceId, `sleep-comfort-${input.event.seat}`, "pending_speech", "分区设置：等待主持人话术开始显示");
      publishHostLine(text, {
        priority: input.event.priority,
        source: input.event.type === "environment_change" ? "environment" : input.event.type,
        eventValue: input.event.value || "",
        traceId: entry.traceId,
        sceneScope,
        startActions: actions.length ? { text, actions, input, sceneScope, traceId: entry.traceId } : null,
      });
    } else {
      setSituationEventStatus(record, "silent", "本次仅做设备决策，无需重复发言");
      recordExecutionReceipt(entry.traceId, "speech", "none", "本次仅做睡眠关怀决策，不主动发言");
    }
    if (input.event.type === "passenger_inactive") state.host.targetSeat = "front";
    render();
  } catch (error) {
    if (requestId === state.workflow.activeRequestId && isCurrentSituationReply(entry)) {
      recordExecutionReceipt(entry.traceId, "speech", "failed", "情境Chatflow请求失败，本次不补通用话术");
      setSituationEventStatus(record, "failed", "情境Chatflow请求失败");
      console.warn("Situation Chatflow reply unavailable.", error.message);
      render();
    }
  } finally {
    if (requestId === state.workflow.activeRequestId && record?.status === "generating") {
      const invalid = getSituationEventInvalidReason(record);
      if (invalid) setSituationEventStatus(record, "cancelled", invalid);
      else if (Number(entry.scene.expires_at_ms) <= simulationRuntime.wallNow()) refreshSituationEvent(record, "模型返回时交接已过期，重新分析");
      else setSituationEventStatus(record, "failed", "回应与当前交接凭据不匹配，未执行");
    }
    if (requestId === state.workflow.activeRequestId) {
      finishWorkflowRequest(requestId);
      render();
    }
  }
}

function describeSituationReplyFailure(output) {
  const diagnostic = output._diagnostic || {};
  if (diagnostic.event_context?.valid === false) return "当前事件校验未通过，本次未播出";
  if ((diagnostic.model_output_status || output.debug?.model_output_status) === "retry_exhausted") {
    const reasons = diagnostic.model_failure_reason_codes || output.debug?.model_failure_reason_codes || [];
    if (reasons.some(reason => String(reason).includes("content_guard:"))) return "主持人回复存在内容或字段冲突，重试后仍未通过";
    const formatError = diagnostic.model_nodes?.some(node => node.error_code === "structured_output_parse_failed");
    return formatError ? "主持人回复格式错误，重试后仍失败" : "主持人两次生成失败，本次未播出";
  }
  if (!output.ai_reply_text || output.intent === "fallback") return "主持人未生成有效回应，本次未播出";
  return "主持人话术未通过内容或动作校验，本次未播出";
}

function isHostBusy() {
  const speech = state.workflow.hostSpeech;
  return Boolean(state.workflow.inFlight || speech.voicePending || speech.voicePlaying);
}

function beginWorkflowRequest(input) {
  state.workflow.activeChatInput = input?.trigger_type === "chat" ? input : null;
  const requestId = state.workflow.activeRequestId + 1;
  state.workflow.inFlight = true;
  state.workflow.hostAwaitingReply = input?.trigger_type === "chat";
  state.workflow.activeRequestId = requestId;
  state.workflow.activeController = new AbortController();
  state.workflow.activeLabel = getWorkflowPendingLabel(input);
  state.workflow.timeoutTimer = simulationRuntime.setTimeout(() => {
    if (state.workflow.activeRequestId === requestId && state.workflow.activeController) {
      state.workflow.activeController.abort();
    }
  }, state.health.workflowTimeoutMs || WORKFLOW_CLIENT_TIMEOUT_MS);
  scheduleHostThinkingForRequest(requestId, input);
  state.ui.alert = state.workflow.activeLabel;
  render();
  return requestId;
}

function scheduleHostThinkingForRequest(requestId, input) {
  clearHostThinkingTimer();
  if (!isHostThinkingSpritePlaying()) {
    state.workflow.hostThinkingActive = false;
    state.workflow.hostThinkingStartedAt = 0;
  }
  if (input?.trigger_type !== "chat") return;
  if (authorizedGamePause(input.player_input) !== null) return;
  if (input.game?.status === "victory") return;

  const hasVisibleHostBubble = Boolean(String(state.host.text || "").trim());
  const visibleForMs = hasVisibleHostBubble && state.workflow.hostSpeech.visibleAt
    ? simulationRuntime.now() - state.workflow.hostSpeech.visibleAt
    : HOST_MIN_BUBBLE_DISPLAY_MS;
  const voiceActive = state.workflow.hostSpeech.voicePending || state.workflow.hostSpeech.voicePlaying;
  const thinkingDelayMs = voiceActive ? HOST_THINKING_WAIT_DELAY_MS : Math.max(
    HOST_THINKING_WAIT_DELAY_MS,
    HOST_MIN_BUBBLE_DISPLAY_MS - visibleForMs,
    hasVisibleHostBubble ? state.workflow.hostSpeech.expiresAt - simulationRuntime.now() : 0,
  );

  state.workflow.hostThinkingTimer = simulationRuntime.setTimeout(() => {
    if (
      state.workflow.activeRequestId !== requestId
      || !state.workflow.inFlight
      || !state.workflow.hostAwaitingReply
    ) {
      return;
    }
    state.workflow.hostThinkingTimer = null;
    if (isHostBubbleProtectedFromThinking()) {
      scheduleHostThinkingForRequest(requestId, input);
      return;
    }
    beginHostThinkingCycle();
  }, thinkingDelayMs);
}

function isHostBubbleProtectedFromThinking() {
  const speech = state.workflow.hostSpeech;
  return Boolean(
    String(state.host.text || "").trim()
    && ((speech.visibleAt > 0 && simulationRuntime.now() - speech.visibleAt < HOST_MIN_BUBBLE_DISPLAY_MS)
      || speech.expiresAt > simulationRuntime.now() || speech.voicePending || speech.voicePlaying),
  );
}

function clearHostThinkingTimer() {
  if (!state.workflow.hostThinkingTimer) return;
  simulationRuntime.clearTimeout(state.workflow.hostThinkingTimer);
  state.workflow.hostThinkingTimer = null;
}

function isHostThinkingSpritePlaying() {
  return hostSprite.source === RESOURCE_CONFIG.host.thinking.src
    && hostSprite.thinkingCycleId === state.workflow.hostThinkingCycleId
    && hostSprite.playing && !hostSprite.completed;
}

function stopWaitingForHostReply(requestId) {
  if (requestId !== state.workflow.activeRequestId) return;
  state.workflow.hostAwaitingReply = false;
  clearHostThinkingTimer();
  // Preserve an actual playback, not a delayed timer or unfinished image load.
  if (isHostThinkingSpritePlaying()) return;
  state.workflow.hostThinkingActive = false;
  state.workflow.hostThinkingStartedAt = 0;
  if (hostSprite.source === RESOURCE_CONFIG.host.thinking.src) resetHostSprite();
}

function beginHostThinkingCycle() {
  const thinkingSpriteAlreadyPlaying =
    hostSprite.source === RESOURCE_CONFIG.host.thinking.src
    && hostSprite.thinkingCycleId === state.workflow.hostThinkingCycleId
    && !hostSprite.completed
    && (hostSprite.loading || hostSprite.playing);
  if (thinkingSpriteAlreadyPlaying) {
    state.workflow.hostThinkingActive = true;
    return;
  }
  state.workflow.hostThinkingCycleId += 1;
  state.workflow.hostThinkingStartedAt = simulationRuntime.now();
  state.workflow.hostThinkingActive = true;
  setHostAvatarState("thinking", { transient: false });
  resetHostSprite();
  hostSprite.thinkingCycleId = state.workflow.hostThinkingCycleId;
  render();
}

function finishWorkflowRequest(requestId) {
  if (requestId !== state.workflow.activeRequestId) return;
  clearWorkflowTimeout();
  stopWaitingForHostReply(requestId);
  state.workflow.inFlight = false;
  state.workflow.activeLabel = "";
  state.workflow.activeController = null;
  state.workflow.activeChatInput = null;
  simulationRuntime.setTimeout(processNextPendingChat, 0);
  simulationRuntime.setTimeout(resolveExpiredQuestion, 0);
}

function abortActiveWorkflow() {
  if (state.workflow.activeController) {
    state.workflow.activeController.abort();
  }
  clearWorkflowTimeout();
  clearHostThinkingTimer();
  state.workflow.hostAwaitingReply = false;
  state.workflow.hostThinkingActive = false;
  state.workflow.hostThinkingStartedAt = 0;
  resetHostSprite();
  state.workflow.inFlight = false;
  state.workflow.activeLabel = "";
  state.workflow.activeController = null;
  state.workflow.activeChatInput = null;
  state.workflow.activeRequestId += 1;
}

function clearWorkflowTimeout() {
  if (!state.workflow.timeoutTimer) return;
  simulationRuntime.clearTimeout(state.workflow.timeoutTimer);
  state.workflow.timeoutTimer = null;
}

async function processNextPendingChat() {
  if (simulationRuntime.paused) return;
  if (isHostBusy()) return;
  if (state.game.status === "paused") {
    if (!isPlayerGamePaused()) return;
    const controlIndex = state.workflow.pendingChats.findIndex(chat => authorizedGamePause(chat.text) !== null);
    if (controlIndex >= 0) await dispatchPendingChat(state.workflow.pendingChats.splice(controlIndex, 1)[0]);
    return;
  }

  for (const record of state.workflow.situationEvents) {
    if (isSituationEventFinished(record)) continue;
    const invalid = getSituationEventInvalidReason(record);
    if (invalid) setSituationEventStatus(record, "cancelled", invalid);
  }
  const eventTask = state.workflow.situationEvents.filter(record => ["pending_analysis", "analyzing", "ready"].includes(record.status))
    .sort(compareSituationEvents)[0];
  const intro = state.workflow.environmentRoundIntro;
  if (intro?.status === "pending" && isCurrentEnvironmentRoundIntro(intro)
    && state.workflow.hostSpeech.expiresAt <= simulationRuntime.now()
    && !state.workflow.hostSpeech.voicePending && !state.workflow.hostSpeech.voicePlaying
    && !state.workflow.deferredHostReplies.some(reply => normalizeHostSpeechPriority(reply.options.priority) >= HOST_SPEECH_PRIORITIES.P3)
    && (!eventTask || normalizeHostSpeechPriority(eventTask.event.priority) < HOST_SPEECH_PRIORITIES.P3
      || normalizeHostSpeechPriority(eventTask.event.priority) === HOST_SPEECH_PRIORITIES.P3 && eventTask.sequence > intro.sequence)) {
    await dispatchEnvironmentRoundIntro(intro);
    return;
  }
  if (eventTask && ["opening", "playing"].includes(state.game.status)
    && shouldProcessSituationBeforeChat(eventTask)) {
    if (eventTask.status === "pending_analysis") {
      await dispatchSituationWorkflow(eventTask.event, { eventRecord: eventTask });
      return;
    }
    if (eventTask.status === "analyzing") return;
  }

  state.workflow.pendingSituationReplies = state.workflow.pendingSituationReplies.filter(entry => {
    if (isCurrentSituationReply(entry)) return true;
    const record = findSituationEvent(entry.input.event.id);
    refreshSituationEvent(record, "分析凭据过期或题目已切换，重新获取当前有效分析");
    return false;
  });
  const eventReply = state.workflow.pendingSituationReplies[0];
  if (eventReply && (findSituationEvent(eventReply.input.event.id)
    ? shouldProcessSituationBeforeChat(findSituationEvent(eventReply.input.event.id))
    : eventReply.input.event.priority === "P1" || !state.workflow.pendingChats.length)) {
    state.workflow.pendingSituationReplies.shift();
    await dispatchSituationReply(eventReply);
    return;
  }
  if (!state.workflow.pendingChats.length) return;

  const nextChat = state.workflow.pendingChats.shift();
  await dispatchPendingChat(nextChat);
}

async function dispatchPendingChat(nextChat) {
  state.passengers.selectedSeat = nextChat.seat;
  if (!nextChat.bubbleShown) showPassengerBubble(nextChat.seat, nextChat.text);
  if (Number.isFinite(nextChat.submittedAt)) recordClientRuntimeDiagnostic("player_submission", {
    stage: "dispatched", elapsed_ms: simulationRuntime.now() - nextChat.submittedAt,
  });
  state.host.targetSeat = nextChat.seat;
  state.ui.alert = `处理已排队问题：${SEATS[nextChat.seat]}`;
  render();
  await dispatchWorkflow("chat", nextChat.event || null, nextChat.text);
}

function getWorkflowPendingLabel(input) {
  if (input.dialogue_request?.kind === "environment_round_intro") return "正在准备应景开场";
  if (input.event?.type === "hard_brake") return "安全事件处理中";
  if (input.event?.type === "resume_game") return "正在恢复游戏";
  if (input.event?.type === "start_game") return "AI 正在主持开局";
  if (input.trigger_type === "chat") return "AI 正在判断";
  return "AI 正在同步座舱状态";
}

function canStartWorkflowAction(message) {
  if (!isHostBusy()) return true;
  state.ui.alert = message;
  render();
  return false;
}

function canResumeGame() {
  if (state.game.status !== "paused") {
    state.ui.alert = "游戏已经在进行中";
    return false;
  }
  if (simulationRuntime.now() - state.workflow.lastResumeAt < 1500) {
    state.ui.alert = "恢复指令已发送，请稍等";
    return false;
  }
  return true;
}

function getPersonaSeatKey(seat) {
  const seatKeys = {
    driver: "driver",
    front: "front",
    rearLeft: "rear_left",
    rearRight: "rear_right",
  };
  return seatKeys[seat] || seat;
}

function getPassengerPersonas(relationship = state.passengers.relationship, scenario = getActiveGoldenLine()) {
  const base = (
    PASSENGER_PERSONAS_BY_RELATIONSHIP[relationship]
    || PASSENGER_PERSONAS_BY_RELATIONSHIP["父母+小孩"]
  );
  if (!scenario?.personas || scenario.relationship !== relationship) return base;
  const profiles = {
    dad: { role: "爸爸", age_group: "adult", persona: "稳重、关注家人和驾驶安全", can_guess: true },
    mom: { role: "妈妈", age_group: "adult", persona: "细心、善于照顾家人", can_guess: true },
    boy: { role: "小男孩", age_group: "child", persona: "好奇、喜欢直接提问", can_guess: true },
    girl: { role: "小女孩", age_group: "child", persona: "好奇、表达简短自然", can_guess: true },
    maleYoung: { role: "男青年", age_group: "young_adult", persona: "轻松、善于观察", can_guess: true },
    femaleYoung: { role: "女青年", age_group: "young_adult", persona: "表达自然、观察细致", can_guess: true },
    grandpa: { role: "爷爷", age_group: "elder", persona: "沉稳、有生活经验", can_guess: true },
    grandma: { role: "奶奶", age_group: "elder", persona: "耐心、善于从生活经验判断", can_guess: true },
    baby: { role: "婴儿", age_group: "infant", persona: "只展示状态和表情，不生成完整发言", can_guess: false },
  };
  const seatLabels = { driver: "主驾", front: "副驾", rear_left: "后排左", rear_right: "后排右" };
  const personas = structuredClone(base);
  for (const [seat, personaKey] of Object.entries(scenario.personas)) {
    const seatKey = getPersonaSeatKey(seat);
    const profile = profiles[personaKey];
    if (!profile) continue;
    const isRealUser = seatKey === "front";
    personas[seatKey] = {
      ...personas[seatKey],
      name: isRealUser ? "副驾真实用户" : `${seatLabels[seatKey]}${profile.role}`,
      role: isRealUser ? `真实用户（${profile.role}形象）` : profile.role,
      age_group: profile.age_group,
      persona: isRealUser ? "真实用户自行决定发言，不自动模拟" : profile.persona,
      style: isRealUser ? "由真实用户决定" : personas[seatKey]?.style,
      can_guess: isRealUser || profile.can_guess,
      is_real_user: isRealUser,
    };
  }
  return personas;
}

function getPassengerPersona(seat) {
  return getPassengerPersonas()[getPersonaSeatKey(seat)] || null;
}

function getScenarioPersonaKeys(scenario) {
  return [...new Set(Object.values(scenario.personas || {}))];
}

function getCurrentRoundTimelineTemplate() {
  return (
    ROUND_GOLDEN_TIMELINES.find(
      (timeline) => timeline.id === state.timeline.roundTimelineId,
    ) || null
  );
}

function buildRoundQuestionPlanRequest(event, timeline = getCurrentRoundTimelineTemplate(), personas = getPassengerPersonas()) {
  if (event?.type !== "start_game") return null;

  const passengerSlots = (timeline?.steps || []).filter(
    (step) => step.type === "passenger_question",
  );
  const personaAgeGroups = [
    ...new Set(
      ["driver", "rearLeft", "rearRight"]
        .map((seat) => personas[getPersonaSeatKey(seat)])
        .filter((persona) => persona?.can_guess !== false)
        .map((persona) => persona?.age_group)
        .filter(Boolean),
    ),
  ];

  return {
    enabled: true,
    step_count: passengerSlots.length + ROUND_PLAN_EXTRA_STEPS,
    reasoning_stages: ["category", "location", "function", "feature", "near_answer"],
    persona_age_groups: personaAgeGroups,
    generate_question_variants: true,
    generate_host_replies: false,
    passenger_slots: passengerSlots.map((step, index) => ({
      slot: index + 1,
      delay_ms: step.delay,
      label: step.label,
    })),
    rules: [
      "问题之间必须形成逐步缩小范围的逻辑链",
      "每个问题必须可以用是或否回答",
      "不要在前两个步骤直接说出或猜中谜底",
      "为不同年龄人群提供自然的措辞变体",
      "只生成乘客问题，不生成主持人回答；主持人将实时回复",
    ],
  };
}

function buildRoundPreviewInput(preparation) {
  const event = {
    type: "start_game",
    id: createRuntimeId("preview"),
    priority: "P3",
    source: "question_preview",
  };
  const input = buildFullWorkflowInput("event", event, "");
  const riddle = RIDDLES[preparation.riddleIndex];
  const timeline = ROUND_GOLDEN_TIMELINES.find((item) => item.id === preparation.timelineId);
  const scenario = GOLDEN_TIMELINES.find((item) => item.id === preparation.scenarioId);
  const personas = getPassengerPersonas(preparation.relationship, scenario);
  const car = preparation.newGame
    ? { speed: scenario.speed, destination: scenario.destination, environment: scenario.environment }
    : { ...input.car };
  car.environment_name = getEnvironmentDescription(car.environment).name;
  car.environment_detail = getEnvironmentDescription(car.environment).detail;
  const passengers = {
    ...input.passengers,
    relationship: preparation.relationship,
    selected_seat: "front",
    selected_seat_label: SEATS.front,
    selected_persona: personas.front,
    personas,
    states: preparation.newGame
      ? { driver: "普通", front: "普通", rear_left: "普通", rear_right: "普通" }
      : input.passengers.states,
  };

  // Future questions get a fresh puzzle snapshot, never the current round's history.
  return {
    ...input,
    game_id: preparation.gameId,
    round_id: preparation.roundId,
    car,
    passengers,
    player_seat: SEATS.front,
    perception: {
      ...input.perception,
      vehicle_state: car.speed >= 100 ? "high_speed" : "normal",
      ...(preparation.newGame ? { driver_state: "normal", sleeping_seats: [], cabin_mood: "normal" } : {}),
      inactive_seat: null,
      game_progress: "normal",
      environment_hook: car.environment,
    },
    round_question_plan_request: buildRoundQuestionPlanRequest(event, timeline, personas),
    timeline: {
      id: scenario.id,
      name: scenario.name,
      round_timeline_id: timeline.id,
      round_timeline_name: timeline.name,
      round_index: preparation.roundIndex,
      status: "idle",
      elapsed_seconds: 0,
      current_event: { type: "start_game", description: "提前准备乘客提问", priority: "P3" },
    },
    game: {
      ...input.game,
      status: "playing",
      round_index: preparation.roundIndex,
      question_count: 0,
      current_answer: riddle.answer,
      current_theme: riddle.theme,
      progress: "normal",
      asked_questions: [],
      covered_fact_keys: [],
    },
    interaction: {
      user_seat: "front",
      current_speaker: "front",
      current_speaker_label: SEATS.front,
      current_speaker_persona: personas.front,
      speaker_source: "system_event",
      recent_messages: [],
      last_passenger_action_key: "",
      suppress_passenger_action: true,
    },
  };
}

function buildWorkflowInput(triggerType, event, playerInput) {
  if (triggerType === "chat") {
    applyPreparedRoundPlan(roundQuestionPreparations.get(getDifyRoundScopeKey()));
  }
  const fullInput = buildFullWorkflowInput(triggerType, event, playerInput);
  return triggerType === "chat"
    ? buildRealtimeChatInput(fullInput)
    : fullInput;
}

function buildFullWorkflowInput(triggerType, event, playerInput) {
  const selectedSeat = state.passengers.selectedSeat;
  const personas = getPassengerPersonas();
  const selectedPersona = getPassengerPersona(selectedSeat);
  const speakerSource =
    triggerType !== "chat"
      ? "system_event"
      : selectedSeat === "front"
        ? "real_user"
        : "timeline_simulation";
  const perception = buildPerceptionSnapshot(event, triggerType, playerInput);
  const normalizedEvent = event
      ? {
        ...event,
        id: event.id || createRuntimeId("event"),
        source: event.source || "manual",
        seat_label: event.seat ? SEATS[event.seat] : undefined,
      }
    : null;
  const currentTimelineEventType =
    event?.type || (triggerType === "event" ? state.timeline.currentEventType : "");
  const roundQuestionPlanRequest = buildRoundQuestionPlanRequest(event);

  return {
    game_id: state.workflow.gameId,
    round_id: `${state.workflow.gameId}-round-${state.game.roundIndex}`,
    p0_epoch: state.workflow.p0Epoch,
    scene_version: getSceneVersion(),
    performance: getPerformanceSnapshot(),
    host_preferences: { ...state.host.preferences },
    ...(event?.type === "post_result_feedback" ? { host_feedback: event.feedback } : {}),
    participation: buildParticipationSnapshot(),
    trigger_type: triggerType,
    plugin_id: state.plugin,
    car: {
      speed: state.car.speed,
      destination: state.car.destination,
      environment: state.car.environment,
      environment_name: getEnvironmentDescription(state.car.environment).name,
      environment_detail: getEnvironmentDescription(state.car.environment).detail,
      sleep_comfort_seats: [...state.ui.sleepComfortSeats],
      zone_lights: { ...state.ui.zoneLights },
    },
    passengers: {
      relationship: state.passengers.relationship,
      selected_seat: selectedSeat,
      selected_seat_label: SEATS[selectedSeat],
      selected_persona: selectedPersona,
      user_seat: "front",
      states: {
        driver: state.passengers.seats.driver.mood,
        front: state.passengers.seats.front.mood,
        rear_left: state.passengers.seats.rearLeft.mood,
        rear_right: state.passengers.seats.rearRight.mood,
      },
      personas,
    },
    perception,
    round_question_plan_request: roundQuestionPlanRequest,
    timeline: {
      id: state.timeline.id,
      name: state.timeline.name,
      round_timeline_id: state.timeline.roundTimelineId,
      round_timeline_name: state.timeline.roundTimelineName,
      round_index: state.game.roundIndex,
      status: state.timeline.status,
      elapsed_seconds: state.timeline.elapsedSeconds,
      current_event: currentTimelineEventType
        ? {
            type: currentTimelineEventType,
            description: state.timeline.currentEvent,
            priority: getEventPriority(currentTimelineEventType),
          }
        : null,
    },
    game: {
      status: state.game.status,
      round_index: state.game.roundIndex,
      total_rounds: state.game.totalRounds,
      pause_reason: isPlayerGamePaused() ? "user" : state.game.status === "paused" ? "safety" : "",
      question_count: state.game.questionCount,
      max_questions: state.game.maxQuestions,
      current_answer: getCurrentRiddle().answer,
      current_theme: getCurrentRiddle().theme,
      progress: perception.game_progress,
      asked_questions: getAskedQuestions(),
      public_clues: getPublicClues(),
      covered_fact_keys: state.game.coveredFactKeys,
    },
    interaction: {
      user_seat: "front",
      current_speaker: selectedSeat,
      current_speaker_label: SEATS[selectedSeat],
      current_speaker_persona: selectedPersona,
      speaker_source: speakerSource,
      recent_messages: getRecentMessages(),
      last_passenger_action_key: state.workflow.lastPassengerActionKey,
      suppress_passenger_action: shouldSuppressPassengerAction(triggerType, event),
    },
    player_seat: SEATS[selectedSeat],
    player_input: playerInput,
    event: normalizedEvent,
  };
}

function buildRealtimeChatInput(fullInput) {
  const planSteps = (state.game.roundQuestionPlan?.steps || [])
    .slice(0, 8)
    .map((step) => ({
      fact_key: String(step.factKey || "").trim(),
      depends_on: Array.isArray(step.dependsOn) ? step.dependsOn.slice(0, 4) : [],
      stage: String(step.stage || "").trim(),
      expected_answer: String(step.expectedAnswer || "").trim(),
      question: String(step.variants?.default || "").trim().slice(0, 80),
    }))
    .filter((step) => step.fact_key);

  const recentMessages = (fullInput.interaction?.recent_messages || [])
    .slice(-6)
    .map((message) => ({
      role: String(message.role || "").slice(0, 32),
      seat: String(message.seat || "").slice(0, 32),
      seat_label: String(message.seat_label || "").slice(0, 16),
      text: String(message.text || "").trim().slice(0, 160),
    }))
    .filter((message) => message.text);

  const justHadSmalltalk =
    state.workflow.lastChatIntent === "smalltalk"
    || state.workflow.lastChatReplyMode === "chat_only";
  const wasGuidedBackToGame =
    state.workflow.lastChatWasBridge
    || state.workflow.lastChatReplyMode === "chat_then_bridge";

  return {
    game_id: fullInput.game_id,
    round_id: fullInput.round_id,
    round_context: buildDifyRoundContext(),
    p0_epoch: fullInput.p0_epoch,
    scene_version: fullInput.scene_version,
    performance: fullInput.performance,
    host_preferences: fullInput.host_preferences,
    trigger_type: "chat",
    player_input: String(fullInput.player_input || "").trim().slice(0, 800),
    passengers: {
      relationship: fullInput.passengers.relationship,
      selected_seat: fullInput.passengers.selected_seat,
      selected_seat_label: fullInput.passengers.selected_seat_label,
      selected_persona: fullInput.passengers.selected_persona,
      user_seat: "front",
      states: fullInput.passengers.states,
    },
    game: {
      status: fullInput.game.status,
      round_index: fullInput.game.round_index,
      question_count: fullInput.game.question_count,
      max_questions: fullInput.game.max_questions,
      current_answer: fullInput.game.current_answer,
      current_theme: fullInput.game.current_theme,
      pause_reason: fullInput.game.pause_reason,
      covered_fact_keys: (Array.isArray(fullInput.game.covered_fact_keys)
        ? fullInput.game.covered_fact_keys
        : []).slice(-12),
      asked_questions: (Array.isArray(fullInput.game.asked_questions)
        ? fullInput.game.asked_questions
        : []).slice(-6),
      public_clues: fullInput.game.public_clues,
    },
    car: fullInput.car,
    perception: fullInput.perception,
    event: fullInput.event,
    ...(fullInput.event?.type === "passenger_inactive" && fullInput.participation
      ? { participation: fullInput.participation }
      : {}),
    round_question_plan: planSteps.length ? { steps: planSteps } : null,
    interaction: {
      current_speaker: fullInput.interaction.current_speaker,
      current_speaker_label: fullInput.interaction.current_speaker_label,
      current_speaker_persona: fullInput.interaction.current_speaker_persona,
      speaker_source: fullInput.interaction.speaker_source,
      recent_messages: recentMessages,
    },
    conversation_context: {
      just_had_smalltalk: justHadSmalltalk,
      last_response_guided_back_to_game: wasGuidedBackToGame,
      should_gently_bridge_if_natural: justHadSmalltalk && !wasGuidedBackToGame,
      turn_count: state.workflow.chatTurnCount,
    },
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
  if (event?.type === "driver_distracted" || state.perception.driverState === "distracted") return "distracted";
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

function getManualWakeSeat() {
  const sleeping = getSleepingSeats();
  if (sleeping.includes(state.passengers.selectedSeat)) return state.passengers.selectedSeat;
  return ["rearRight", "rearLeft", "front", "driver"].find((seat) => sleeping.includes(seat)) || null;
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

  const currentRoundId = `${state.workflow.gameId}-round-${state.game.roundIndex}`;
  const latestOutput = state.game.history
    .filter((item) => item.input?.round_id === currentRoundId)
    .at(-1)?.output;
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
  const currentRoundId = `${state.workflow.gameId}-round-${state.game.roundIndex}`;
  return state.game.history
    .filter((item) => item.input?.round_id === currentRoundId)
    .filter((item) => !item.output?.intent || ["answer_question", "guess", "repeat_question"].includes(item.output.intent))
    .map((item) => item.input?.player_input?.trim())
    .filter(Boolean)
    .slice(-15);
}

function getPublicClues() {
  return [...new Set(state.game.publicClues)].slice(-12);
}

function publicClueRecap(input) {
  const answer = input.game?.current_answer || "";
  const clue = [...(input.game?.public_clues || [])].reverse().find(line => typeof line === "string"
    && line.trim() && line.length <= 54 && (!answer || !line.includes(answer)));
  return clue ? `已公开：${clue}` : "目前没有可重述的公开线索，可以继续问是或否问题。";
}

function getRecentMessages() {
  const currentRoundId = `${state.workflow.gameId}-round-${state.game.roundIndex}`;
  return state.game.history
    .filter((item) => item.input?.round_id === currentRoundId)
    .slice(-6)
    .flatMap((item) => {
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
  return !(
    triggerType === "simulation"
    && event?.type === "request_passenger_action"
  );
}

function getEventPriority(type) {
  const priorities = {
    hard_brake: "P0",
    safety_pause: "P0",
    answer_correct: "P0",
    round_timeout: "P0",
    game_end: "P0",
    resume_game: "P1",
    driver_tired: "P1",
    driver_distracted: "P1",
    temporary_interruption: "P0",
    passenger_sleep: "P2",
    passenger_question: "P2",
    passenger_inactive: "P4",
    near_destination: "P2",
    environment_change: "P1",
    speed_overspeed: "P1",
    speed_change: "P2",
    game_stuck: "P3",
    near_answer: "P3",
    cabin_laughing: "P4",
    start_game: "P3",
  };
  return priorities[type] || "P3";
}

function getSceneVersion() {
  const seats = state.passengers.seats;
  const snapshot = JSON.stringify({
    environment: state.car.environment,
    destination: state.car.destination,
    overspeed: Number(state.car.speed) > OVERSPEED_KMH,
    driver: [state.perception.driverState, seats.driver?.mood],
    front: seats.front?.mood,
    rear_left: seats.rearLeft?.mood,
    rear_right: seats.rearRight?.mood,
    game_status: state.game.status,
    game_progress: state.perception.gameProgress,
    p0_epoch: state.workflow.p0Epoch,
  });
  let hash = 2166136261;
  for (let index = 0; index < snapshot.length; index += 1) {
    hash ^= snapshot.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `sv-${(hash >>> 0).toString(36)}`;
}

function isCurrentWorkflowInput(input) {
  if (input.game_id !== state.workflow.gameId) return false;
  if (input.round_id !== `${state.workflow.gameId}-round-${state.game.roundIndex}`) return false;
  if (input.p0_epoch !== state.workflow.p0Epoch) return false;
  if (input.trigger_type === "chat" && input.game?.status === "paused" && isPlayerGamePaused()
    && authorizedGamePause(input.player_input) !== null) {
    return input.game.current_answer === getCurrentRiddle().answer;
  }
  if (state.game.status === "victory" && input.trigger_type === "chat" && input.game?.status === "victory") {
    return true;
  }
  if (input.dialogue_request?.kind === "situation_event" && input.event?.type === "post_result_feedback"
    && state.game.status === "victory" && input.game?.status === "victory") return true;
  const eventRecord = input.trigger_type === "event" && input.event?.priority !== "P0" ? findSituationEvent(input.event?.id) : null;
  if (eventRecord) return !getSituationEventInvalidReason(eventRecord) && ["opening", "playing"].includes(state.game.status);
  if (input.trigger_type === "chat" && input.game?.status === "playing" && state.game.status === "playing") {
    return input.game.current_answer === getCurrentRiddle().answer;
  }
  if (input.scene_version !== getSceneVersion()) return false;
  if (["paused", "victory", "failed", "summary"].includes(state.game.status)) {
    return input.event?.priority === "P0" && input.trigger_type === "event";
  }
  return true;
}

function getSituationScope(input, scene) {
  return {
    gameId: input.game_id,
    roundId: input.round_id,
    sceneVersion: input.scene_version,
    eventId: input.event?.id,
    eventType: input.event?.type,
    environment: input.car?.environment,
    expiresAt: Number(scene.expires_at_ms),
    participationVersion: input.event?.type === "passenger_inactive" ? input.participation?.version : null,
    managedEvent: Boolean(findSituationEvent(input.event?.id)),
    p0Epoch: input.p0_epoch,
  };
}

function isCurrentSituationResult(scene, input, bff) {
  if (!scene || typeof scene !== "object" || !isCurrentWorkflowInput(input)) return false;
  if (bff?.route !== "situation" || bff.event_id !== input.event?.id) return false;
  if (bff.game_id !== input.game_id || bff.round_id !== input.round_id
    || bff.scene_version !== input.scene_version) return false;
  if (scene.game_id !== input.game_id || scene.round_id !== input.round_id
    || scene.scene_version !== input.scene_version || scene.event_id !== input.event?.id) return false;
  if (input.event?.type === "passenger_inactive"
    && scene.participation_version !== input.participation?.version) return false;
  return Number.isFinite(Number(scene.expires_at_ms))
    && Number(scene.expires_at_ms) > simulationRuntime.wallNow();
}

async function requestWorkflow(input, signal, { situationHandoff = null } = {}) {
  if (simulationRuntime.paused) await simulationRuntime.waitUntilRunning();
  const diagnostic = { stage: "fetch", route: input.trigger_type === "chat" ? "chat" : "situation" };
  try {
    const output = await exchangeWorkflow(input, signal, { situationHandoff, diagnostic });
    if (simulationRuntime.paused) await simulationRuntime.waitUntilRunning();
    return output;
  } catch (error) {
    const reasons = {
      "BFF returned the wrong workflow route.": "route_mismatch",
      "BFF returned a different dialogue operation.": "operation_mismatch",
      "BFF returned a different round intro operation.": "operation_mismatch",
      "BFF returned a different event.": "event_mismatch",
      "BFF returned a response for a different round.": "round_mismatch",
    };
    error.workflowDiagnosticId = diagnostic.request_id;
    recordClientRuntimeDiagnostic("workflow_failure", { ...diagnostic,
      reason: reasons[error.message] || (error.name === "AbortError" ? "timeout_or_cancel"
        : diagnostic.http_status >= 400 ? "http_error" : diagnostic.stage === "fetch" ? "network_error"
          : diagnostic.stage === "parse" ? "invalid_json" : "normalize_error") });
    void loadWorkflowReadiness();
    if (simulationRuntime.paused) await simulationRuntime.waitUntilRunning();
    throw error;
  }
}

function describeWorkflowFailure(error) {
  if (/_TIMEOUT$/.test(error.workflowCode || "") || error.name === "AbortError") return "Dify 回复超时";
  if (/_PROXY_ERROR$/.test(error.workflowCode || "")) return "Dify 连接中断";
  const categories = {
    conversation_not_found: "Dify 会话已失效", authentication_failed: "Dify 应用授权异常",
    model_authentication_failed: "模型授权异常", rate_or_quota_limit: "模型额度或调用频率受限",
    structured_output_failed: "模型输出格式校验失败", upstream_timeout: "模型响应超时",
    workflow_failed: "Dify 工作流节点执行失败", resource_not_found: "Dify 应用或资源不存在",
    empty_response: "Dify 未返回有效回复",
  };
  return categories[error.workflowCategory] || "实时回复失败";
}

async function exchangeWorkflow(input, signal, { situationHandoff = null, diagnostic = {} } = {}) {
  const situationReply = input.dialogue_request?.kind === "situation_event";
  const roundIntro = input.dialogue_request?.kind === "environment_round_intro";
  const expectedRoute = input.trigger_type === "chat" || situationReply || roundIntro
    ? "chat"
    : input.event?.type === "start_game" ? "preview" : "situation";
  diagnostic.route = expectedRoute;
  const submittedConversationId = expectedRoute === "chat" ? getPersistentDifyConversationId() : "";
  const response = await fetch(DEFAULT_WORKFLOW_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input_payload: JSON.stringify(input),
      route: expectedRoute,
      ...(situationReply ? { operation: "situation_reply", situation_handoff: situationHandoff } : {}),
      ...(roundIntro ? { operation: "environment_round_intro" } : {}),
      query: input.trigger_type === "chat" ? input.player_input : "",
      conversation_id: submittedConversationId,
      user_id: getPersistentDifyUserId(),
    }),
    signal,
  });

  diagnostic.http_status = response.status;
  diagnostic.stage = "parse";
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    diagnostic.request_id = detail.diagnostic_id;
    const error = new Error(detail.message || `Chatflow request failed: ${response.status}`);
    error.workflowCode = detail.error;
    error.workflowCategory = detail.upstream_failure?.category;
    if (detail.conversation_recovered && submittedConversationId
      && getPersistentDifyConversationId() === submittedConversationId) {
      try {
        localStorage.setItem(DIFY_CONVERSATION_STORAGE_KEY, "");
        localStorage.setItem(DIFY_CONVERSATION_CONTEXT_STORAGE_KEY, "");
      } catch { /* The next request can still recover a stale ID when storage is unavailable. */ }
    }
    throw error;
  }

  const payload = await response.json();
  diagnostic.request_id = payload.diagnostic_id;
  diagnostic.stage = "validate";
  if (simulationRuntime.paused) await simulationRuntime.waitUntilRunning();
  if (signal?.aborted) {
    const error = new Error("Workflow request was cancelled.");
    error.name = "AbortError";
    throw error;
  }
  if (payload.route === "skipped" && expectedRoute === "situation") return null;
  if (payload.route !== expectedRoute) throw new Error("BFF returned the wrong workflow route.");
  if (situationReply && payload.operation !== "situation_reply") throw new Error("BFF returned a different dialogue operation.");
  if (roundIntro && payload.operation !== "environment_round_intro") throw new Error("BFF returned a different round intro operation.");
  if (input.event && (payload.event_type !== input.event.type || payload.event_id !== input.event.id)) {
    throw new Error("BFF returned a different event.");
  }
  if (["preview", "chat"].includes(expectedRoute) && (
    payload.game_id !== input.game_id
    || payload.round_id !== input.round_id
    || payload.scene_version !== input.scene_version
  )) {
    throw new Error("BFF returned a response for a different round.");
  }
  diagnostic.stage = "normalize";
  const output = normalizeWorkflowPayload(payload);
  output._diagnostic = payload.diagnostic || null;
  if (expectedRoute === "chat" && payload.conversation_id && input.round_id === getDifyRoundScopeKey()) {
    savePersistentDifyConversationId(payload.conversation_id, input.round_id);
  }
  output._bff = {
    route: payload.route,
    operation: payload.operation || "",
    situation_handoff: payload.situation_handoff || null,
    event_type: payload.event_type || "",
    event_id: payload.event_id || "",
    game_id: payload.game_id || "",
    round_id: payload.round_id || "",
    scene_version: payload.scene_version || "",
  };
  if (input.trigger_type === "chat" && !output.ai_reply_text) {
    recordClientRuntimeDiagnostic("workflow_failure", { ...diagnostic, stage: "local_fallback", reason: "reply_missing" });
    output.ai_reply_text = getDefaultHostReply(output, input);
  }
  return output;
}

function normalizeWorkflowPayload(payload) {
  const candidates = [
    payload?.workflow_output,
    payload?.data?.workflow_output,
    payload?.answer,
    payload?.data?.answer,
    payload?.outputs?.answer,
    payload?.data?.outputs?.answer,
    payload,
    payload?.data,
    payload?.output,
    payload?.result,
    payload?.data?.output,
    payload?.data?.result,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const parsed = parseWorkflowOutputCandidate(candidate);
    if (isPublicWorkflowOutput(parsed)) {
      return normalizeWorkflowOutput(parsed);
    }
  }

  throw new Error("Dify Chatflow response did not include a valid public JSON workflow output.");
}

function parseWorkflowOutputCandidate(candidate) {
  if (candidate && typeof candidate === "object") return candidate;
  if (typeof candidate !== "string") return null;

  const text = candidate.trim();
  if (!text) return null;

  const candidates = [
    text,
    text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim(),
  ];
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(text.slice(objectStart, objectEnd + 1));
  }

  for (const value of candidates) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Dify may wrap the JSON answer in a markdown code fence.
    }
  }
  return null;
}

function isPublicWorkflowOutput(candidate) {
  return Boolean(
    candidate
    && typeof candidate === "object"
    && (
      typeof candidate.ai_reply_text === "string"
      || candidate.round_question_plan
      || candidate.round_content?.round_question_plan
      || candidate.round_content?.question_plan
    ),
  );
}

function normalizeWorkflowOutput(output) {
  const normalized = {
    ...output,
    ui_change: {
      ...(output.ui_change || {}),
    },
  };

  if (normalized.game_status === "selecting_theme") {
    normalized.game_status = "playing";
  }

  if (!normalized.answer && normalized.game_status !== "failed") {
    normalized.answer = getCurrentRiddle().answer;
  }

  normalized.ai_reply_text = normalizeThemeSelectionCopy(normalized.ai_reply_text || "");
  return normalized;
}

function parseJsonValue(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeRoundQuestionPlan(rawPlan, fallbackId = `${state.timeline.roundTimelineId || "round"}-${state.game.roundIndex}`, minimumSteps = 2) {
  const parsedPlan = parseJsonValue(rawPlan);
  if (!parsedPlan || typeof parsedPlan !== "object") return null;

  const rawSteps =
    parsedPlan.steps
    || parsedPlan.question_steps
    || parsedPlan.questions
    || [];
  if (!Array.isArray(rawSteps)) return null;

  const steps = rawSteps
    .map((rawStep, index) => normalizeRoundQuestionStep(rawStep, index))
    .filter(Boolean)
    .sort((stepA, stepB) => stepA.order - stepB.order);
  if (steps.length < minimumSteps) return null;

  const reasoningPath =
    parsedPlan.reasoning_path
    || parsedPlan.reasoningPath
    || steps.map((step) => step.factKey);

  return {
    id:
      parsedPlan.plan_id
      || parsedPlan.id
      || fallbackId,
    source: "workflow",
    reasoningPath: Array.isArray(reasoningPath) ? reasoningPath.filter(Boolean) : [],
    steps,
  };
}

function normalizeRoundQuestionStep(rawStep, index) {
  const parsedStep = parseJsonValue(rawStep);
  if (!parsedStep || typeof parsedStep !== "object") return null;

  const rawVariants =
    parsedStep.variants
    || parsedStep.question_variants
    || parsedStep.questionVariants
    || {};
  const variants =
    rawVariants && typeof rawVariants === "object" && !Array.isArray(rawVariants)
      ? Object.fromEntries(
          Object.entries(rawVariants)
            .map(([key, value]) => [key, String(value || "").trim()])
            .filter(([, value]) => value),
        )
      : {};
  const defaultQuestion = String(
    parsedStep.question_text
      || parsedStep.question
      || parsedStep.text
      || "",
  ).trim();
  if (defaultQuestion && !variants.default) {
    variants.default = defaultQuestion;
  }

  if (!Object.keys(variants).length) return null;

  const factKey = String(
    parsedStep.fact_key
      || parsedStep.factKey
      || parsedStep.intent
      || `step_${index + 1}`,
  ).trim();
  const dependsOnRaw = parsedStep.depends_on || parsedStep.dependsOn || [];
  const personaTagsRaw = parsedStep.persona_tags || parsedStep.personaTags || [];

  return {
    id: String(parsedStep.id || parsedStep.step_id || `step_${index + 1}`),
    order: Number(parsedStep.order) || index + 1,
    factKey,
    dependsOn: Array.isArray(dependsOnRaw) ? dependsOnRaw.filter(Boolean) : [],
    stage: String(parsedStep.stage || ""),
    expectedAnswer: String(
      parsedStep.expected_answer || parsedStep.expectedAnswer || "",
    ),
    variants,
    personaTags: Array.isArray(personaTagsRaw) ? personaTagsRaw.filter(Boolean) : [],
  };
}

function mergeCoveredFactKeysFromOutput(output) {
  const factKeys =
    output.covered_fact_keys
    || output.game_progress?.covered_fact_keys
    || output.debug?.covered_fact_keys
    || [];
  if (!Array.isArray(factKeys)) return;

  const merged = new Set(state.game.coveredFactKeys);
  factKeys.filter(Boolean).forEach((key) => merged.add(String(key)));
  state.game.coveredFactKeys = [...merged];
}

function normalizeThemeSelectionCopy(text) {
  return String(text || "")
    .replace(/请选择一个主题[。！!？?]?/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeHostSpeechPriority(priority) {
  if (typeof priority === "number") return priority;
  return HOST_SPEECH_PRIORITIES[String(priority || "P2").toUpperCase()] || HOST_SPEECH_PRIORITIES.P2;
}

function isCurrentSituationScope(scope) {
  if (scope?.environmentRoundIntroId) {
    const entry = state.workflow.environmentRoundIntro;
    return entry?.id === scope.environmentRoundIntroId && isCurrentEnvironmentRoundIntro(entry);
  }
  if (scope?.managedEvent) {
    const record = findSituationEvent(scope.eventId);
    return Boolean(record && !getSituationEventInvalidReason(record)
      && scope.gameId === state.workflow.gameId && scope.roundId === getDifyRoundScopeKey()
      && scope.p0Epoch === state.workflow.p0Epoch && Number(scope.expiresAt) > simulationRuntime.wallNow()
      && ["opening", "playing"].includes(state.game.status));
  }
  return !scope || (
    scope.gameId === state.workflow.gameId
    && scope.roundId === `${state.workflow.gameId}-round-${state.game.roundIndex}`
    && scope.sceneVersion === getSceneVersion()
    && scope.environment === state.car.environment
    && (!scope.eventType || !state.workflow.situationEventIds[scope.eventType]
      || state.workflow.situationEventIds[scope.eventType] === scope.eventId)
    && Number(scope.expiresAt) > simulationRuntime.wallNow()
    && !["paused", "victory", "failed", "summary"].includes(state.game.status)
    && (scope.participationVersion == null
      || (scope.participationVersion === state.workflow.participation.revision
        && state.host.preferences.invitations && !state.host.preferences.independent
        && !state.workflow.participation.invitationDeclined && !state.workflow.pendingChats.length
        && !getSleepingSeats().includes("front")
        && buildParticipationSnapshot().remaining_ms > PARTICIPATION_MIN_REMAINING_MS))
  );
}

function publishHostLine(text, {
  priority = "P2",
  source = "workflow",
  durationMs = null,
  force = false,
  eventValue = "",
  traceId = null,
  sceneScope = null,
  startActions = null,
  publicClue = null,
} = {}) {
  if (!isCurrentSituationScope(sceneScope)) return false;
  const normalizedText = String(text || "").trim();
  if (!normalizedText) return false;

  const speech = state.workflow.hostSpeech;
  const nextPriority = normalizeHostSpeechPriority(priority);
  const requestedLockDurationMs = durationMs == null
    ? nextPriority === HOST_SPEECH_PRIORITIES.P1
      ? ENVIRONMENT_ANNOUNCEMENT_MS
      : HOST_SPEECH_MAX_DISPLAY_MS
    : durationMs;
  const lockDurationMs = requestedLockDurationMs === 0
    ? HOST_SPEECH_MAX_DISPLAY_MS
    : Math.min(
      HOST_SPEECH_MAX_DISPLAY_MS,
      Math.max(HOST_MIN_BUBBLE_DISPLAY_MS, Number(requestedLockDurationMs) || HOST_SPEECH_DEFAULT_LOCK_MS),
    );
  const now = simulationRuntime.now();
  const activeLock = speech.expiresAt > now || speech.voicePending || speech.voicePlaying;
  const earlier = state.workflow.deferredHostReplies[0];
  const higherTask = !(source === "game_control" && isPlayerGamePaused()) && (hasHigherPendingEnvironmentIntro(nextPriority) || state.workflow.situationEvents.some(record => record.event.id !== sceneScope?.eventId
    && ["pending_analysis", "analyzing", "ready", "generating"].includes(record.status)
    && !getSituationEventInvalidReason(record) && normalizeHostSpeechPriority(record.event.priority) > nextPriority));
  if (nextPriority !== HOST_SPEECH_PRIORITIES.P0 && (activeLock || higherTask
    || !force && earlier && normalizeHostSpeechPriority(earlier.options.priority) >= nextPriority)) {
    return deferHostReply(normalizedText, { priority, source, durationMs: lockDurationMs, traceId,
      sceneScope, eventValue, startActions, publicClue });
  }

  cancelHostVoiceSpeech();
  if (speech.timer) {
    recordExecutionReceipt(speech.traceId, "speech", "interrupted", "主持话术：被P0话术替换");
    simulationRuntime.clearTimeout(speech.timer);
    speech.timer = null;
  }
  if (speech.source === "environment" && nextPriority > speech.priority) {
    recordExecutionReceipt(state.workflow.pendingEnvironmentSpeech?.traceId, "speech", "cancelled", "待显示环境话术：已取消");
    simulationRuntime.clearTimeout(state.workflow.pendingEnvironmentSpeechTimer);
    state.workflow.pendingEnvironmentSpeechTimer = null;
    state.workflow.pendingEnvironmentSpeech = null;
  }
  speech.id += 1;
  speech.priority = nextPriority;
  speech.source = source;
  speech.traceId = traceId;
  speech.wasVisible = false;
  speech.visibleAt = 0;
  speech.startActions = startActions;
  speech.sceneScope = sceneScope;
  speech.publicClue = publicClue;
  speech.voiceRequested = false;
  speech.voicePending = false;
  speech.voicePlaying = false;
  speech.voiceFinished = false;
  recordExecutionReceipt(traceId, "speech", "pending_render", "主持话术：等待显示");
  speech.expiresAt = lockDurationMs === Infinity
    ? Infinity
    : lockDurationMs > 0
      ? now + lockDurationMs
      : 0;
  state.host.text = normalizedText;
  recordParticipationActivity();

  if (lockDurationMs > 0 && lockDurationMs !== Infinity) scheduleHostSpeechExpiration(speech, speech.id, lockDurationMs);
  return true;
}

function scheduleHostSpeechExpiration(speech, speechId, delayMs) {
  speech.timer = simulationRuntime.setTimeout(() => {
    if (speech.id !== speechId) return;
    if (speech.voicePending || speech.voicePlaying) {
      scheduleHostSpeechExpiration(speech, speechId, 200);
      return;
    }
    const completedReadyWelcome = speech.source === "ready_welcome";
    recordExecutionReceipt(speech.traceId, "speech", speech.wasVisible ? "completed" : "expired", speech.wasVisible ? "主持话术：显示结束" : "主持话术：未显示，已到期");
    speech.timer = null;
    speech.priority = 0;
    speech.source = "";
    speech.expiresAt = 0;
    speech.startActions = null;
    const eventRecord = findSituationEvent(speech.sceneScope?.eventId);
    if (eventRecord && !isSituationEventFinished(eventRecord)) setSituationEventStatus(eventRecord, "completed", "事件回应已显示结束");
    speech.sceneScope = null;
    state.host.text = "";
    recordParticipationActivity();
    resumeDeferredHostReply();
    simulationRuntime.setTimeout(processNextPendingChat, 0);
    render();
    if (completedReadyWelcome) scheduleSoundOnboarding();
  }, delayMs);
}

function startHostSpeechActions() {
  const speech = state.workflow.hostSpeech;
  const plan = speech.startActions;
  if (!plan || speech.wasVisible || speech.expiresAt <= simulationRuntime.now()
    || !getHostPresentation().hostSpeechVisible || String(state.host.text || "").trim() !== plan.text) return false;
  speech.startActions = null;
  if (!isCurrentSituationScope(plan.sceneScope)
    || !plan.actions.every((action) => canApplySpeechAction(action, plan.input))) {
    recordExecutionReceipt(plan.traceId, `device-${plan.input.event?.seat || plan.actions[0]?.seat || ""}`, "cancelled", "分区设置：话术开始前条件已变化，未执行");
    return false;
  }
  applyWorkflowActions(plan.actions, plan.input, { traceId: plan.traceId });
  return true;
}

function isChatSpeechSource(source) {
  return source === "chat" || source === "passenger_question" || source === "workflow_fallback";
}

function deferHostReply(text, options, first = false) {
  if (state.workflow.deferredHostReplies.some((entry) => entry.text === text && entry.traceId === options.traceId)) return true;
  const entry = { text, options, traceId: options.traceId, gameId: state.workflow.gameId,
    roundId: getDifyRoundScopeKey(), p0Epoch: state.workflow.p0Epoch,
    sequence: findSituationEvent(options.sceneScope?.eventId)?.sequence || ++state.workflow.situationEventSequence,
    expiresAt: options.sceneScope?.managedEvent ? Infinity : simulationRuntime.now() + 30000 };
  if (first) state.workflow.deferredHostReplies.unshift(entry);
  else state.workflow.deferredHostReplies.push(entry);
  state.workflow.deferredHostReplies.sort((a, b) => normalizeHostSpeechPriority(b.options.priority) - normalizeHostSpeechPriority(a.options.priority)
    || a.sequence - b.sequence);
  recordExecutionReceipt(options.traceId, "speech", "queued", options.startActions
    ? "设备话术：按优先级等待，设备暂不调整" : "主持话术：按优先级排队，等待当前气泡结束");
  simulationRuntime.clearTimeout(state.workflow.deferredHostRepliesTimer);
  state.workflow.deferredHostRepliesTimer = simulationRuntime.setTimeout(resumeDeferredHostReply, getDeferredReplyDelay());
  return true;
}

function resumeDeferredHostReply() {
  simulationRuntime.clearTimeout(state.workflow.deferredHostRepliesTimer);
  state.workflow.deferredHostRepliesTimer = null;
  const playerPaused = isPlayerGamePaused();
  if (playerPaused) {
    const controlIndex = state.workflow.deferredHostReplies.findIndex(entry => entry.options.source === "game_control");
    if (controlIndex < 0) return;
    if (controlIndex > 0) state.workflow.deferredHostReplies.unshift(state.workflow.deferredHostReplies.splice(controlIndex, 1)[0]);
  }
  const first = state.workflow.deferredHostReplies[0];
  const higherTask = !playerPaused && first && (hasHigherPendingEnvironmentIntro(first.options.priority) || state.workflow.situationEvents.some(record => ["pending_analysis", "analyzing", "ready", "generating"].includes(record.status)
    && !getSituationEventInvalidReason(record)
    && normalizeHostSpeechPriority(record.event.priority) > normalizeHostSpeechPriority(first.options.priority)));
  if (state.workflow.hostSpeech.expiresAt > simulationRuntime.now()
    || state.workflow.hostSpeech.voicePending || state.workflow.hostSpeech.voicePlaying
    || higherTask || state.game.status === "paused" && !playerPaused) {
    if (state.workflow.deferredHostReplies.length) state.workflow.deferredHostRepliesTimer = simulationRuntime.setTimeout(
      resumeDeferredHostReply, getDeferredReplyDelay());
    return;
  }
  while (state.workflow.deferredHostReplies.length) {
    const entry = state.workflow.deferredHostReplies.shift();
    if (entry.gameId !== state.workflow.gameId || entry.roundId !== getDifyRoundScopeKey()
      || entry.p0Epoch !== state.workflow.p0Epoch || entry.expiresAt <= simulationRuntime.now()
      || !isCurrentSituationScope(entry.options.sceneScope)
      || !["opening", "playing", "victory"].includes(state.game.status)
        && !(playerPaused && entry.options.source === "game_control")) {
      recordExecutionReceipt(entry.traceId, "speech", "skipped", "乘客回答已失效：未显示旧内容");
      const record = findSituationEvent(entry.options.sceneScope?.eventId);
      refreshSituationEvent(record, "待播话术凭据已过期或P0已发生，保留事件并重新分析");
      continue;
    }
    if (entry.options.source === "environment" && entry.options.eventValue && entry.options.eventValue !== state.car.environment) {
      recordExecutionReceipt(entry.traceId, "speech", "superseded", "环境已再次变化，仅回应最新环境");
      continue;
    }
    publishHostLine(entry.text, { ...entry.options, force: true });
    render();
    return;
  }
}

function getDeferredReplyDelay() {
  const speech = state.workflow.hostSpeech;
  if (speech.voicePending || speech.voicePlaying) return 250;
  return Math.max(250, speech.expiresAt - simulationRuntime.now()) + 40;
}

function clearDeferredHostReplies(reason) {
  simulationRuntime.clearTimeout(state.workflow.deferredHostRepliesTimer);
  state.workflow.deferredHostRepliesTimer = null;
  for (const entry of state.workflow.deferredHostReplies) recordExecutionReceipt(entry.traceId, "speech", "cancelled", reason);
  state.workflow.deferredHostReplies = [];
}

function queueHostLineUntilMinimumDisplay(text, options, delayMs) {
  const pending = state.workflow.pendingMinimumSpeech;
  if (pending) {
    recordExecutionReceipt(pending.traceId, "speech", "superseded", "待显示话术：被更新的话术替代");
  }
  const id = ++state.workflow.pendingMinimumSpeechSequence;
  const queued = {
    id,
    text,
    ...options,
    gameId: state.workflow.gameId,
    roundId: `${state.workflow.gameId}-round-${state.game.roundIndex}`,
    sceneVersion: getSceneVersion(),
  };
  state.workflow.pendingMinimumSpeech = queued;
  recordExecutionReceipt(options.traceId, "speech", "queued", "主持话术：等待当前气泡显示满1.5秒");
  simulationRuntime.clearTimeout(state.workflow.pendingMinimumSpeechTimer);
  state.workflow.pendingMinimumSpeechTimer = simulationRuntime.setTimeout(() => {
    const current = state.workflow.pendingMinimumSpeech;
    state.workflow.pendingMinimumSpeechTimer = null;
    if (!current || current.id !== id) return;
    state.workflow.pendingMinimumSpeech = null;
    if (
      current.gameId !== state.workflow.gameId
      || current.roundId !== `${state.workflow.gameId}-round-${state.game.roundIndex}`
      || current.sceneVersion !== getSceneVersion()
      || !isCurrentSituationScope(current.sceneScope)
      || (current.source === "environment" && current.eventValue !== state.car.environment)
    ) {
      recordExecutionReceipt(current.traceId, "speech", "skipped", "话术作用域已变化：未显示过期内容");
      return;
    }
    publishHostLine(current.text, current);
    render();
  }, Math.max(0, delayMs) + 20);
  return true;
}

function clearPendingMinimumSpeech(reason = "") {
  const pending = state.workflow.pendingMinimumSpeech;
  if (!pending) return;
  simulationRuntime.clearTimeout(state.workflow.pendingMinimumSpeechTimer);
  state.workflow.pendingMinimumSpeechTimer = null;
  state.workflow.pendingMinimumSpeech = null;
  if (reason) recordExecutionReceipt(pending.traceId, "speech", "superseded", `待显示话术：${reason}`);
}

function clearHostSpeechLock(source = "") {
  const speech = state.workflow.hostSpeech;
  if (source && speech.source !== source) return;
  if (!source) clearDeferredHostReplies("主持话术状态重置");
  if (!source || state.workflow.pendingMinimumSpeech?.source === source) {
    clearPendingMinimumSpeech("主持话术状态重置");
  }
  cancelHostVoiceSpeech();
  if (speech.timer || speech.expiresAt > simulationRuntime.now()) {
    recordExecutionReceipt(speech.traceId, "speech", "cancelled", "主持话术：已取消");
  }
  if (speech.timer) simulationRuntime.clearTimeout(speech.timer);
  speech.timer = null;
  speech.id += 1;
  speech.priority = 0;
  speech.source = "";
  speech.expiresAt = 0;
  speech.startActions = null;
  speech.voiceRequested = false;
  speech.voicePending = false;
  speech.voicePlaying = false;
  speech.voiceFinished = false;
}

function clearSummarySpeechTimer() {
  if (!state.workflow.summarySpeechTimer) return;
  simulationRuntime.clearTimeout(state.workflow.summarySpeechTimer);
  state.workflow.summarySpeechTimer = null;
}

function getWorkflowHostSpeechPriority(output, input) {
  if (output?.is_correct || output?.game_status === "victory" || output?.game_status === "failed") {
    return "P0";
  }

  const eventType = input?.event?.type;
  if (eventType) return input.event?.priority || getEventPriority(eventType);
  if (input?.trigger_type === "chat") return "P2";
  return "P2";
}

function getDefaultHostReply(output, input) {
  if (input?.event?.priority === "P0") {
    return input.event.type === "hard_brake" ? "大家坐稳，游戏先暂停。" : "";
  }
  if (input?.game?.status === "victory") return "";
  if (input?.event?.type === "environment_change" || input?.trigger_type === "event") return "";
  if (isHintRequestInput(input)) {
    return publicClueRecap(input);
  }
  if (input?.trigger_type === "chat" && isExplicitAnswerHit(input)) {
    return `${SEATS[state.passengers.selectedSeat] || "这位侦探"}答对了，谜底揭晓。`;
  }
  return "收到，我们继续沿着这个方向推进。";
}

function isExplicitPraiseRequest(text) {
  return !/(?:别|不要|不用|少).{0,5}(?:夸|表扬)/u.test(String(text || ""))
    && /夸(?:夸|一下)?我|表扬(?:一下)?我|夸奖我|说我厉害/u.test(String(text || ""));
}

function getVictoryPraiseReply() {
  return "这题被你稳稳拿下了，判断很漂亮，当然值得好好夸一句！";
}

function updateHostPreferences(text) {
  const preferences = state.host.preferences;
  if (/(?:别|不要|不用|少).{0,5}(?:夸|表扬)/u.test(text)) preferences.praise = false;
  if (/可以多夸|恢复夸奖|可以主动夸/u.test(text)) preferences.praise = true;
  if (/少说|简短|安静一点|别催|不要催/u.test(text)) preferences.brief = true;
  if (/多说一点|详细一点|恢复正常说话/u.test(text)) preferences.brief = false;
  if (/别邀请|不要邀请|不用叫别人|别叫别人|别催|不要催/u.test(text)) preferences.invitations = false;
  if (/可以邀请|叫大家一起|请大家一起/u.test(text)) preferences.invitations = true;
  if (/让我.{0,4}想想|我想自己猜|先别帮|不用帮我/u.test(text)) preferences.independent = true;
  if (/不用自己想了|不想自己猜了|可以帮我|一起想|帮帮我/u.test(text)) preferences.independent = false;
  if (!preferences.praise) clearResultFeedback();
  try { localStorage.setItem(HOST_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences)); } catch { /* Session preferences still apply. */ }
}

function getPerformanceSnapshot() {
  const results = state.game.performance.results;
  const counts = Object.fromEntries(Object.keys(SEATS).map(seat => [seat, 0]));
  for (const row of results) if (row.correct_seat) counts[row.correct_seat] += 1;
  const last = results.at(-1);
  let streak = 0;
  if (last?.correct_seat) {
    for (const row of [...results].reverse()) {
      if (row.correct_seat !== last.correct_seat) break;
      streak += 1;
    }
  }
  let missed = 0;
  for (const row of [...results].reverse()) {
    if (row.correct_seat) break;
    missed += 1;
  }
  return {
    completed_rounds: results.length, team_correct: results.filter(row => row.correct_seat).length,
    per_seat_correct: counts, streak_seat: last?.correct_seat || null, streak_count: streak,
    consecutive_unsolved: missed,
    last_result: last ? { round_index: last.round_index, correct_seat: last.correct_seat, contributors: last.contributors } : null,
    recent_results: results.slice(-3).map(row => ({ round_index: row.round_index, correct_seat: row.correct_seat })),
  };
}

function recordQuestionContribution(output, input) {
  if (input.trigger_type !== "chat" || input.game?.status !== "playing") return;
  const seat = input.passengers?.selected_seat;
  if (!Object.hasOwn(SEATS, seat)) return;
  const catalog = new Set((state.game.roundQuestionPlan?.steps || []).map(step => step.factKey));
  const confirmed = (Array.isArray(output.covered_fact_keys) ? output.covered_fact_keys : [])
    .filter(key => catalog.has(key) && !state.game.coveredFactKeys.includes(key));
  if (!confirmed.length) return;
  const round = state.game.performance.contributions[input.round_id] ||= {};
  round[seat] = [...new Set([...(round[seat] || []), ...confirmed])];
}

function recordRoundOutcome(correctSeat = null) {
  const performance = state.game.performance;
  const roundId = getDifyRoundScopeKey();
  if (performance.results.some(row => row.round_id === roundId)) return null;
  const before = getPerformanceSnapshot();
  const contributors = Object.keys(performance.contributions[roundId] || {});
  if (correctSeat && !contributors.includes(correctSeat)) contributors.push(correctSeat);
  performance.results.push({ round_id: roundId, round_index: state.game.roundIndex,
    correct_seat: Object.hasOwn(SEATS, correctSeat) ? correctSeat : null, contributors });
  if (!correctSeat || !state.host.preferences.praise) return null;
  const after = getPerformanceSnapshot();
  const candidates = [];
  if (after.per_seat_correct[correctSeat] === 6) candidates.push("HK12");
  if (after.team_correct === 6) candidates.push("HK10");
  if ([2, 3].includes(after.streak_count)) candidates.push("HK11");
  if (before.consecutive_unsolved >= 2) candidates.push("HK14");
  if (contributors.length >= 2) candidates.push("HK17");
  if (after.per_seat_correct[correctSeat] === 1) candidates.push("HK13");
  if (!candidates.length) return null;
  const rare = candidates.some(id => ["HK10", "HK12", "HK14"].includes(id));
  if (!rare && performance.lastFeedbackRound && state.game.roundIndex - performance.lastFeedbackRound < 2) return null;
  return { id: `${roundId}-feedback`, subject_seat: correctSeat, candidate_ids: candidates.slice(0, 3),
    selected_id: candidates[0], contributors, previous_unsolved: before.consecutive_unsolved,
    team_correct: after.team_correct, personal_correct: after.per_seat_correct[correctSeat],
    streak_count: after.streak_count };
}

function clearResultFeedback() {
  const feedback = state.workflow.resultFeedback;
  if (!feedback) return;
  simulationRuntime.clearTimeout(feedback.timer);
  feedback.controller?.abort();
  state.workflow.resultFeedback = null;
}

function currentResultFeedback(entry) {
  return state.workflow.resultFeedback === entry && entry.gameId === state.workflow.gameId
    && entry.roundId === getDifyRoundScopeKey() && entry.p0Epoch === state.workflow.p0Epoch
    && state.game.status === "victory" && state.host.preferences.praise;
}

function resultFeedbackFallback(feedback) {
  const seat = SEATS[feedback.subject_seat] || "这位侦探";
  if (state.host.preferences.brief) return `${seat}，这题答得漂亮！`;
  const lines = {
    HK12: `${seat}已经拿下六题了，这份战报值得给你单独记一笔。`,
    HK10: "已经拿下六题了，今天这车侦探团状态不错啊。",
    HK11: `${seat}连续${feedback.streak_count}题答对，判断很稳。`,
    HK14: "这一题拿回来了，刚才的坚持没白费。",
    HK17: "这题是大家接力破的，提问和收尾都接上了。",
    HK13: `这题被${seat}拿下了，破案名单又多了一位。`,
  };
  return lines[feedback.selected_id] || "";
}

function startResultFeedback(feedback) {
  if (!feedback) return;
  clearResultFeedback();
  const entry = { feedback, gameId: state.workflow.gameId, roundId: getDifyRoundScopeKey(),
    p0Epoch: state.workflow.p0Epoch, expiresAt: simulationRuntime.now() + 12000, modelDeadline: simulationRuntime.now() + 7500, shown: false,
    output: null, controller: new AbortController(), timer: null };
  state.workflow.resultFeedback = entry;
  entry.timer = simulationRuntime.setTimeout(() => showResultFeedback(entry), HOST_SPEECH_P0_LOCK_MS + 40);
  const event = { id: createRuntimeId("feedback"), type: "post_result_feedback", priority: "P4",
    source: "performance_monitor", feedback };
  const input = buildWorkflowInput("event", event, "");
  void requestWorkflow(input, entry.controller.signal).then(output => {
    const scene = output.scene_output;
    if (!currentResultFeedback(entry) || entry.shown || simulationRuntime.now() >= entry.expiresAt) return;
    if (output._bff?.route !== "situation" || output._bff.event_id !== event.id
      || output._bff.game_id !== input.game_id || output._bff.round_id !== input.round_id
      || output._bff.scene_version !== input.scene_version
      || scene?.event_id !== event.id || scene.game_id !== input.game_id || scene.round_id !== input.round_id
      || scene.scene_version !== input.scene_version || scene.feedback_id !== feedback.id
      || !Number.isFinite(Number(scene.expires_at_ms)) || Number(scene.expires_at_ms) <= simulationRuntime.wallNow() || scene.analysis_status !== "ready"
      || scene.request_proactive_speech !== true || output.decision_trace?.guard_status !== "passed"
      || output.target_seat || output.execution?.actions?.length) return;
    queueSituationReply(input, output, updateDecisionTrace(normalizeDecisionTrace(output, input)), entry);
  }).catch(error => {
    if (error.name !== "AbortError") console.warn("Post-result analysis unavailable; using verified achievement copy.", error.message);
  });
}

function showResultFeedback(entry) {
  if (!currentResultFeedback(entry) || entry.shown || simulationRuntime.now() >= entry.expiresAt) {
    if (state.workflow.resultFeedback === entry) clearResultFeedback();
    return;
  }
  if (state.timeline.status === "paused" || state.workflow.inFlight || state.workflow.pendingChats.length
    || state.workflow.deferredHostReplies.length || state.workflow.pendingMinimumSpeech
    || state.workflow.hostSpeech.expiresAt > simulationRuntime.now()
    || state.workflow.hostSpeech.voicePending || state.workflow.hostSpeech.voicePlaying) {
    entry.timer = simulationRuntime.setTimeout(() => showResultFeedback(entry), 150);
    return;
  }
  if (!entry.output && simulationRuntime.now() < entry.modelDeadline) {
    entry.timer = simulationRuntime.setTimeout(() => showResultFeedback(entry), 150);
    return;
  }
  const output = entry.output;
  const hostText = output ? sanitizeHostReplyText(output.ai_reply_text) : resultFeedbackFallback(entry.feedback);
  const traceId = updateDecisionTrace(output ? normalizeDecisionTrace(output, buildWorkflowInput("event", {
    type: "post_result_feedback", feedback: entry.feedback, priority: "P4" }, "")) : {
    source: "local", decision: "按可信成绩生成揭晓后短反馈", priority: "P4",
    feedback_id: entry.feedback.id, selected_knowhow_id: entry.feedback.selected_id,
  });
  if (hostText && publishHostLine(hostText, { priority: "P4", source: "post_result_feedback", traceId })) {
    entry.shown = true;
    state.game.performance.lastFeedbackRound = state.game.roundIndex;
    entry.controller.abort();
    render();
  } else clearResultFeedback();
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
    decision_trace: output.is_correct || output.game_status === "victory" ? output.decision_trace : {
      schema_version: 2, layer: "rule", matched_rule: "frontend_answer_hit",
      decision: "本地命中校验通过，进入答对揭晓", upstream: output.decision_trace,
    },
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

function isHintRequestInput(input) {
  if (input?.trigger_type !== "chat" || input.game?.status !== "playing") {
    return false;
  }
  return /给.{0,8}(提示|线索|暗示)|(提示|线索|暗示).{0,5}(一下|一点|吧|吗)|太难|好难|帮帮我|没头绪|重述.*线索|复述.*线索/.test(String(input.player_input || ""));
}

function localDecision(input, error) {
  const pauseCommand = input.trigger_type === "chat" ? authorizedGamePause(input.player_input) : null;
  if (pauseCommand !== null) return {
    intent: "game_related_chat", reply_mode: "chat_only", game_status: input.game.status,
    ai_reply_text: pauseCommand ? "游戏先暂停，这题和进度都保留。" : "接着玩，刚才的题目和进度都还在。",
    is_correct: false, covered_fact_keys: [], execution: { actions: [{ type: "game.set_paused", paused: pauseCommand }] },
    decision_trace: { guard_status: "passed", matched_rule: "explicit_game_control", decision: "明确游戏暂停/继续请求，由前端校验执行" },
  };
  const riddle = getCurrentRiddle();
  const eventType = input.event?.type;
  const selectedSeat = input.passengers.selected_seat;
  const selectedSeatLabel = input.passengers.selected_seat_label;

  if (eventType === "start_game") {
    return {
      ai_reply_text: "",
      game_status: "playing",
      is_correct: false,
      answer: riddle.answer,
      ui_change: {
        cabin_mode: "normal",
        target_seat: selectedSeat,
        host_emotion: "normal",
        animation: "idle",
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
      ai_reply_text: "",
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

    if (isHintRequestInput(input)) {
      return {
        ai_reply_text: publicClueRecap(input),
        game_status: "playing",
        is_correct: false,
        ui_change: {
          cabin_mode: "normal",
          target_seat: selectedSeat,
          host_emotion: "normal",
          animation: "speak",
          show_answer: false,
        },
        intent: "game_related_chat",
        reply_mode: "chat_then_bridge",
        covered_fact_keys: [],
        debug_fallback_reason: error?.message || "",
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
    ai_reply_text: "",
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

function applyWorkflowOutput(output, input, source = "chat") {
  if (!isCurrentWorkflowInput(input)) return;
  if (source === "chat" && output._bff?.route !== "chat") return;
  if (source === "chat" && (output._bff.game_id !== input.game_id
    || output._bff.round_id !== input.round_id
    || output._bff.scene_version !== input.scene_version)) return;
  if (source === "local" && input.event?.priority === "P0") return;
  if (source !== "local" && input.event?.priority === "P0") return;
  if (applyGameControlOutput(output, input, source)) return;
  if (input.trigger_type === "chat" && input.game?.status === "victory" && state.game.status === "victory") {
    if (source !== "chat") return;
    const traceId = updateDecisionTrace(normalizeDecisionTrace(output, input));
    updateRealtimeConversationState(output, input);
    const hostText = sanitizeHostReplyText(output.ai_reply_text || "")
      || (isExplicitPraiseRequest(input.player_input) ? getVictoryPraiseReply() : "");
    if (hostText) {
      publishHostLine(normalizeHostReplyForRealUser(hostText, output, input), {
        priority: "P2",
        source: "chat",
        traceId,
      });
    } else {
      recordExecutionReceipt(traceId, "speech", "none", "揭晓期间的聊天没有可显示话术");
    }
    render();
    return;
  }
  const localAnswerHit = input.trigger_type === "chat" && isExplicitAnswerHit(input);
  if (!localAnswerHit && source === "chat") {
    const attemptedProtectedOutcome = output.is_correct
      || ["victory", "failed", "summary", "paused"].includes(output.game_status)
      || output.ui_change?.show_answer;
    output = {
      ...output,
      ai_reply_text: attemptedProtectedOutcome ? getDefaultHostReply({}, input) : output.ai_reply_text,
      is_correct: false,
      game_status: state.game.status,
      next_answer: "",
      ui_change: {
        ...output.ui_change,
        show_answer: false,
        animation: attemptedProtectedOutcome ? "speak" : output.ui_change?.animation,
        host_emotion: attemptedProtectedOutcome ? "normal" : output.ui_change?.host_emotion,
        cabin_mode: ["safety_pause", "victory", "reveal", "summary"].includes(output.ui_change?.cabin_mode)
          ? state.ui.cabinMode
          : output.ui_change?.cabin_mode,
      },
    };
  }
  const passengerQuestionTrace = input.trigger_type === "chat"
    && input.game?.status === "playing"
    && !isExplicitAnswerHit(input);
  const responseTrace = input.event?.type === "start_game"
    ? {
      source: "local",
      perception: `游戏开始：第 ${input.game?.round_index || state.game.roundIndex} 题已就绪`,
      decision: "启动本题答题流程",
      execution: "题目已下发，答题倒计时开始",
      priority: "P3",
    }
    : normalizeDecisionTrace(output, input);
  if (passengerQuestionTrace) responseTrace.execution = "";
  const traceId = updateDecisionTrace(responseTrace);
  const uiChange = output.ui_change || {};
  const isVictoryOutput = Boolean(output.is_correct || output.game_status === "victory");
  if (isVictoryOutput) invalidateAsyncHostResults({ preserveSituationEvents: true });
  const isHardBrakeOutput = input.event?.type === "hard_brake";
  const eventType = input.event?.type;
  const keepRealUserFocus = shouldKeepRealUserFocus(input, output);
  const isHintRefusal =
    isHintRequestInput(input)
    && output.reply_mode === "chat_then_bridge";
  if (!isHintRefusal && !isHintRequestInput(input)) {
    recordQuestionContribution(output, input);
    mergeCoveredFactKeysFromOutput(output);
  }
  updateRealtimeConversationState(output, input);
  if (!isVictoryOutput) {
    clearPassengerActivities();
  }
  if (!isVictoryOutput && !keepRealUserFocus) {
    applyPassengerVisualStates(output);
  }
  const passengerActionApplied = isVictoryOutput || shouldSuppressPassengerAction(input.trigger_type, input.event)
    || keepRealUserFocus
    ? suppressPassengerActionForEvent(eventType)
    : applyPassengerAction(output.passenger_action);
  const previousHostText = state.host.text;
  const sanitizedHostText = sanitizeHostReplyText(output.ai_reply_text || "");
  const hostSpeechPriority = getWorkflowHostSpeechPriority(output, input);
  const staleEnvironmentReply =
    eventType === "environment_change"
    && input.event?.value
    && input.event.value !== state.car.environment;
  if (staleEnvironmentReply || shouldMuteHostReplyForEvent(eventType, sanitizedHostText)) {
    state.host.text = previousHostText;
    recordExecutionReceipt(traceId, "speech", "skipped", staleEnvironmentReply ? "环境已再次变化：旧话术未显示" : "本轮话术已静默处理");
  } else if (sanitizedHostText) {
    publishHostLine(
      normalizeHostReplyForRealUser(sanitizedHostText, output, input),
      {
        priority: hostSpeechPriority,
        source: eventType === "environment_change" ? "environment" : input.event?.type || input.trigger_type,
        eventValue: input.event?.value || "",
        traceId,
        startActions: output.execution?.actions?.some(action => action.type === "cabin.set_zone_light")
          ? { text: normalizeHostReplyForRealUser(sanitizedHostText, output, input),
            actions: output.execution.actions.filter(action => action.type === "cabin.set_zone_light"), input, traceId } : null,
        publicClue: input.trigger_type === "chat" && ["answer_question", "repeat_question"].includes(output.intent)
          && output.decision_trace?.guard_status === "passed" && !output.is_correct
          ? `问：${input.player_input} 答：${sanitizedHostText}` : null,
      },
    );
  } else {
    state.host.text = previousHostText;
    recordExecutionReceipt(traceId, "speech", "none", "本轮没有主持人话术");
  }
  if (passengerActionApplied && !output.ai_reply_text && !staleEnvironmentReply) {
    publishHostLine("这个问题收到，我来接住这一轮。", {
      priority: hostSpeechPriority,
      source: input.event?.type || input.trigger_type,
      traceId,
    });
  }
  state.game.status = output.game_status || state.game.status;
  state.ui.cabinMode = uiChange.cabin_mode || state.ui.cabinMode || "normal";
  state.ui.animation = uiChange.animation || "speak";
  state.ui.showAnswer = Boolean(uiChange.show_answer || output.is_correct);
  if (!isVictoryOutput) {
    state.ui.correctSeat = null;
  }
  state.host.emotion = uiChange.host_emotion || state.host.emotion;
  applyHostAvatarState(output, uiChange, isVictoryOutput);
  state.host.targetSeat = normalizeTargetSeat(uiChange.target_seat) || state.host.targetSeat;
  if (keepRealUserFocus) {
    clearPassengerActivities();
    state.host.targetSeat = "front";
  }

  if (isHardBrakeOutput) {
    state.game.status = "paused";
    pauseQuestionClock();
    state.ui.cabinMode = "safety_pause";
    state.ui.animation = "pause";
    state.host.emotion = "serious";
    setHostAvatarState(HOST_AVATAR_DEFAULT_STATE);
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
    clearQuestionClock();
    const correctSeat = input.passengers?.selected_seat || state.passengers.selectedSeat;
    finishTimelineSilently();
    clearPassengerActivities();
    state.ui.cabinMode = "victory";
    state.ui.showAnswer = true;
    state.ui.correctSeat = correctSeat;
    if (state.passengers.seats[correctSeat]) {
      state.passengers.seats[correctSeat].mood = "大笑";
    }
    showCorrectSeatLight(correctSeat, traceId);
    startConfetti();
    state.game.status = "victory";
    publishHostLine(
      makeVictoryHostText(correctSeat, output.answer || getCurrentRiddle().answer),
      { priority: "P0", source: "victory", durationMs: HOST_SPEECH_P0_LOCK_MS, traceId },
    );
    setHostAvatarState("excited", { transient: false });
    state.host.targetSeat = correctSeat;
    startResultFeedback(recordRoundOutcome(correctSeat));
  }

  if (isHardBrakeOutput) recordExecutionReceipt(traceId, "game", "paused", "游戏：已暂停");
  if (state.ui.showAnswer) recordExecutionReceipt(traceId, "answer", "revealed", "答案：已进入揭晓状态");
  applyWorkflowActions(output.execution?.actions?.filter(action => action.type !== "cabin.set_zone_light"), input, { correctLightAlreadyExecuted: isVictoryOutput, traceId });
  if (input.trigger_type === "chat" && !output._counted
    && ["answer_question", "guess", "repeat_question"].includes(output.intent) && state.game.status === "playing") {
    state.game.questionCount += 1;
    output._counted = true;
  }

  state.game.history.push({
    at: new Date().toISOString(),
    input,
    output,
    execution_receipts: state.decisionTrace.receipts,
  });

  if (isVictoryOutput) {
    scheduleNextRound();
    notifyP0Situation("answer_correct", { seat: state.ui.correctSeat });
    render();
  }
}

function applyWorkflowActions(actions, input, { correctLightAlreadyExecuted = false, traceId = null } = {}) {
  const allowed = Array.isArray(actions) ? actions : [];
  for (const action of allowed) {
    if (!action || typeof action !== "object") continue;
    const eventRecord = input?.trigger_type === "event" ? findSituationEvent(input.event?.id) : null;
    const actionKey = `${action.type}:${action.seat || ""}`;
    if (eventRecord?.executedActions.includes(actionKey)) {
      recordExecutionReceipt(traceId, "device", "deduplicated", "该事件的设备动作已执行，不重复执行");
      continue;
    }
    if (action.type === "cabin.set_zone_light") {
      if (canApplySpeechAction(action, input)) {
        state.ui.zoneLights[action.seat] = action.enabled;
        recordExecutionReceipt(traceId, `zone-light-${action.seat}`, "simulated", `${getSeatDisplayLabel(action.seat)}分区灯光：已${action.enabled ? "开启" : "关闭"}（模拟）`);
      } else recordExecutionReceipt(traceId, "zone-light", "rejected", "分区灯光：未获明确授权或请求已失效");
      continue;
    }
    if (["cabin.apply_sleep_comfort", "cabin.restore_sleep_comfort"].includes(action.type)) {
      if (canApplySleepComfortAction(action, input)) {
        if (eventRecord) eventRecord.executedActions.push(actionKey);
        const restoring = action.type === "cabin.restore_sleep_comfort";
        if (!restoring && !state.ui.sleepComfortSeats.includes(action.seat)) state.ui.lightsBeforeSleep[action.seat] = state.ui.zoneLights[action.seat];
        state.ui.zoneLights[action.seat] = restoring ? state.ui.lightsBeforeSleep[action.seat] !== false : false;
        if (restoring) delete state.ui.lightsBeforeSleep[action.seat];
        state.ui.sleepComfortSeats = restoring
          ? state.ui.sleepComfortSeats.filter((seat) => seat !== action.seat)
          : [...new Set([...state.ui.sleepComfortSeats, action.seat])];
        recordExecutionReceipt(traceId, `sleep-comfort-${action.seat}`, "simulated",
          restoring
            ? `${getSeatDisplayLabel(action.seat)}环境恢复：区域灯光、分区音量与空调恢复原设置（模拟）`
            : `${getSeatDisplayLabel(action.seat)}睡眠关怀：区域关灯、分区音量0、空调调至用户记忆值（模拟）`);
      } else {
        recordExecutionReceipt(traceId, "sleep-comfort", "rejected", "睡眠关怀：当前座位或事件条件已变化，未执行");
      }
      continue;
    }
    if (action.type === "ambient_light.play_preset") {
      if (action.preset === "cabin-correct-light" && correctLightAlreadyExecuted) {
        // The correctness branch owns the actual simulated light and its receipt.
      } else {
        recordExecutionReceipt(traceId, "light", "skipped", "条件不满足：未播放氛围灯");
      }
      continue;
    }
    if (action.type === "music.set_enabled" && typeof action.enabled === "boolean"
      && input?.trigger_type === "chat" && isCurrentWorkflowInput(input)
      && authorizedMusicToggle(input.player_input) === action.enabled) {
      setBackgroundMusicEnabled(action.enabled, traceId);
      continue;
    }
    recordExecutionReceipt(traceId, "unsupported", "rejected", "未授权动作：未执行");
  }
}

function authorizedZoneLight(text, speaker = "front") {
  const line = String(text || "");
  if (/(它|谜底|答案|假如|如果|假设|能不能用|能关灯吗|会关灯吗)|(不要|别|先别).{0,5}(关|开)|[“”"‘’]|怎么|如何|为什么|是不是|是否/.test(line)) return null;
  const command = line.match(/(关掉|关闭|关一下|关了|关上|打开|开启|开一下|开了).{0,12}灯|灯.{0,8}(关掉|关闭|关一下|关了|关上|打开|开启|开一下|开了)/);
  if (!command) return null;
  const seats = [["主驾", "driver"], ["副驾", "front"], ["后排左", "rearLeft"], ["后排右", "rearRight"]].filter(([label]) => line.includes(label)).map(([, seat]) => seat);
  if (!seats.length && /我这|我的|我这边|这边/.test(line)) seats.push(speaker);
  if (new Set(seats).size !== 1 || /全车|全部|所有|大家|后排两/.test(line)) return null;
  return { type: "cabin.set_zone_light", seat: seats[0], enabled: /打开|开启|开一下|开了/.test(command[0]) };
}

function authorizedMusicToggle(text) {
  const line = String(text || "");
  if (/它|谜底|答案|假如|如果|假设|[“”"‘’]|怎么|为什么|(不要|别|先别).{0,4}(关闭|关掉|停止|暂停|打开|开启|启动)/.test(line)) return null;
  const target = "(?:背景音乐|音乐)";
  const off = "(?:关闭|关掉|停止|暂停|静音|不要放|别放|不放|不要播|别播|关)";
  const on = "(?:打开|开启|播放|启动|开一下|放一下|开)";
  if (new RegExp(`${off}.{0,6}${target}|${target}.{0,6}${off}`).test(line)) return false;
  if (new RegExp(`${on}.{0,6}${target}|${target}.{0,6}${on}`).test(line)) return true;
  return null;
}

function authorizedGamePause(text) {
  const line = String(text || "").trim();
  if (/它|谜底|答案|假如|如果|假设|[“”"‘’]|怎么|如何|为什么|是否|是不是|要不要|该不该|音乐|歌曲|视频|导航|(?:不要|别|先别|不用|不想|不愿).{0,6}(?:暂停|停|继续|恢复|接着)/.test(line)) return null;
  const pause = /(?:暂停|先停|停下|停一停|停一下).{0,5}(?:游戏|猜谜)|(?:游戏|猜谜).{0,5}(?:暂停|先停|停一下)|^(?:请|帮我|先)?暂停(?:一下|吧|下)?[。！!？?]*$/.test(line);
  const resume = /(?:继续|恢复|接着).{0,5}(?:游戏|猜谜|玩)|(?:游戏|猜谜).{0,5}(?:继续|恢复)|^(?:请|帮我)?继续(?:吧|一下)?[。！!？?]*$/.test(line);
  return pause === resume ? null : pause;
}

function isPlayerGamePaused() {
  const pause = state.workflow.playerGamePause;
  return Boolean(pause && state.game.status === "paused" && pause.gameId === state.workflow.gameId
    && pause.roundId === getDifyRoundScopeKey() && !state.workflow.safetyResumeContext && !state.workflow.interruption);
}

function canApplyGameControl(action, input) {
  return action?.type === "game.set_paused" && typeof action.paused === "boolean"
    && Object.keys(action).every(key => ["type", "paused"].includes(key))
    && input?.trigger_type === "chat" && isCurrentWorkflowInput(input)
    && authorizedGamePause(input.player_input) === action.paused
    && questionClock.active && (state.game.status === "playing" || isPlayerGamePaused());
}

function setGamePausedByHost(paused) {
  if (paused && state.game.status === "playing") {
    const pending = [...state.workflow.pendingChats];
    const replies = state.workflow.deferredHostReplies.filter(entry => isChatSpeechSource(entry.options.source)
      && !entry.options.sceneScope);
    const savedReplies = replies.filter(entry => !entry.options.startActions);
    for (const entry of replies.filter(entry => entry.options.startActions)) {
      const input = entry.options.startActions.input;
      pending.push({ seat: input.passengers.selected_seat, text: input.player_input, event: input.event });
    }
    const pause = { gameId: state.workflow.gameId, roundId: getDifyRoundScopeKey(), startedAt: simulationRuntime.now(),
      cabinMode: state.ui.cabinMode, pendingChats: pending.filter(chat => authorizedGamePause(chat.text) === null),
      replies: savedReplies.map(entry => ({ text: entry.text, options: entry.options })) };
    pauseQuestionClock();
    invalidateAsyncHostResults({ preserveSituationEvents: true, reason: "玩家暂停：保留事件，继续后按最新状态重新分析" });
    state.workflow.playerGamePause = pause;
    state.workflow.pendingChats = pending.filter(chat => authorizedGamePause(chat.text) !== null);
    state.game.status = "paused";
    state.ui.cabinMode = "player_pause";
  } else if (!paused && isPlayerGamePaused()) {
    const pause = state.workflow.playerGamePause;
    const pending = [...pause.pendingChats, ...state.workflow.pendingChats];
    invalidateAsyncHostResults({ preserveSituationEvents: true, reason: "游戏继续：按最新状态重新分析待办事件" });
    state.workflow.playerGamePause = null;
    state.game.status = "playing";
    state.ui.cabinMode = ["fatigued", "distracted", "asleep"].includes(state.perception.driverState) ? "driver_focus" : pause.cabinMode;
    state.timeline.startedAt += simulationRuntime.now() - pause.startedAt;
    resumeQuestionClock();
    state.workflow.pendingChats = pending;
    for (const reply of pause.replies) deferHostReply(reply.text, reply.options);
  }
}

function applyGameControlOutput(output, input, source) {
  const actions = output.execution?.actions;
  if (!["chat", "local"].includes(source) || output.decision_trace?.guard_status !== "passed"
    || !Array.isArray(actions) || actions.length !== 1 || !canApplyGameControl(actions[0], input)) return false;
  const paused = actions[0].paused;
  setGamePausedByHost(paused);
  const traceId = updateDecisionTrace({ perception: `${SEATS[input.passengers.selected_seat] || "乘客"}说：${input.player_input}`,
    decision: paused ? "明确暂停请求：保留本题、次数、事实和待回答问题" : "明确继续请求：仅恢复玩家主动暂停，不解除安全暂停",
    execution: paused ? "游戏已暂停，答题计时与自动提问停止" : "游戏已继续，沿用暂停前的题目与剩余时间", priority: "P2" });
  const safeText = sanitizeHostReplyText(output.ai_reply_text || "");
  const text = safeText && !/无法|不能|不支持|不具备|没有.{0,4}权限/.test(safeText) && !safeText.includes(getCurrentRiddle().answer)
    && (paused ? /暂停|先停|停住/.test(safeText) : /继续|接着|恢复/.test(safeText))
    ? safeText : paused ? "游戏已暂停，当前题目和进度都保留。说“继续游戏”就能接着玩。" : "继续游戏，刚才的题目和进度都还在。";
  publishHostLine(text, { priority: "P2", source: "game_control", traceId });
  state.game.history.push({ at: new Date().toISOString(), input, output: { ...output, intent: "game_related_chat", covered_fact_keys: [] } });
  state.ui.alert = paused ? "玩家已暂停游戏" : "游戏已继续";
  render();
  simulationRuntime.setTimeout(processNextPendingChat, 0);
  return true;
}

function canApplySpeechAction(action, input) {
  if (action?.type !== "cabin.set_zone_light") return canApplySleepComfortAction(action, input);
  const authorized = authorizedZoneLight(input?.player_input, input?.passengers?.selected_seat);
  return input?.trigger_type === "chat" && isCurrentWorkflowInput(input)
    && typeof action.enabled === "boolean" && Object.keys(action).every(key => ["type", "seat", "enabled"].includes(key))
    && authorized?.seat === action.seat && authorized.enabled === action.enabled;
}

function canApplySleepComfortAction(action, input) {
  const applying = action?.type === "cabin.apply_sleep_comfort";
  const restoring = action?.type === "cabin.restore_sleep_comfort";
  const mood = state.passengers.seats[action?.seat]?.mood;
  return (applying || restoring)
    && Object.keys(action).every((key) => ["type", "seat"].includes(key))
    && input?.trigger_type === "event"
    && input.dialogue_request?.kind === "situation_event"
    && input.event?.type === (applying ? "passenger_sleep" : "passenger_wake")
    && input.event.priority !== "P0"
    && action.seat === input.event.seat
    && (applying ? mood === "睡着" : mood === "普通" && state.ui.sleepComfortSeats.includes(action.seat))
    && ["opening", "playing"].includes(state.game.status)
    && isCurrentWorkflowInput(input);
}

function updateRealtimeConversationState(output, input) {
  if (input?.trigger_type !== "chat") return;
  state.workflow.lastChatIntent = String(output.intent || "").trim();
  state.workflow.lastChatReplyMode = String(output.reply_mode || "").trim();
  state.workflow.lastChatWasBridge = state.workflow.lastChatReplyMode === "chat_then_bridge";
  state.workflow.chatTurnCount += 1;
}

function resetRealtimeConversationState() {
  state.workflow.lastChatIntent = "";
  state.workflow.lastChatReplyMode = "";
  state.workflow.lastChatWasBridge = false;
  state.workflow.chatTurnCount = 0;
}

const DECISION_TRACE_LABELS = {
  rule: {
    environment_change: "车外环境变化", speed_overspeed: "车速超限", speed_change: "车速变化",
    hard_brake: "急刹", safety_pause: "安全暂停", driver_tired: "主驾疲惫", driver_distracted: "主驾分心", temporary_interruption: "临时事件打断",
    passenger_sleep: "乘客睡着", passenger_inactive: "乘客暂未参与", near_destination: "即将到达",
    near_answer: "接近答案", game_stuck: "猜谜遇到困难", cabin_laughing: "车内欢笑",
    start_game: "开始游戏", resume_game: "恢复游戏", timeout: "本题超时", round_timeout: "本题超时",
    game_end: "整局结束", correct_answer: "答对揭晓", answer_correct: "答对揭晓",
    correct_answer_reveal: "答对揭晓", timeout_reveal: "超时揭晓", hard_brake_safety: "急刹安全接管",
    answer_reveal: "答案揭晓", realtime_director: "实时互动",
  },
};

function readableTraceValue(value, labels, fallback = "") {
  const text = typeof value === "string" ? value.trim() : "";
  const key = text.toLowerCase().replace(/\s+/g, "_");
  return labels[text] || labels[key] || STRATEGY_LABELS[text] || (/\p{Script=Han}/u.test(text) ? text : fallback);
}

function normalizeDecisionTrace(output, input) {
  const decision = output.decision_trace || {};
  const signals = output.perception?.schema_version === 2 && Array.isArray(output.perception.signals)
    ? output.perception.signals : [];
  const knowhowStatusLabels = {
    used: "已检索",
    not_relevant: "本次无需检索",
    empty: "检索无匹配",
    failed: "检索不可用，已走兜底",
  };
  const retrievedKnowhow = Array.isArray(output.retrieved_knowhow) ? output.retrieved_knowhow : [];
  const reasonLabels = {
    ordinary_yes_no: "普通问答",
    repeated_wrong_guesses: "连续猜错",
    explicit_help_request: "明确求助",
    independent_thinking_requested: "希望独立思考",
    eligible_collaborator_available: "存在合格协作对象",
    sleeping_passenger_excluded: "排除睡着乘员",
    environment_change: "环境变化",
    smalltalk_continuity: "闲聊承接",
    interruption_recovery: "中断恢复",
    near_destination: "临近目的地",
    hint_request_blocked: "已拦截额外提示",
    paused_state: "游戏暂停中",
    no_relevant_knowhow: "无适用经验",
    workflow_unavailable: "Chatflow 未返回，使用本地兜底",
  };
  const seat = output.target_seat ? (SEATS[output.target_seat] || output.target_seat) : "";
  const applied = Array.isArray(output.applied_knowhow_ids) ? output.applied_knowhow_ids : [];
  const strategy = output.strategy ? STRATEGY_LABELS[output.strategy] || output.strategy : "";
  const reasons = (Array.isArray(output.reason_codes) ? output.reason_codes : [])
    .map((code) => reasonLabels[code] || "")
    .filter(Boolean);
  const perceptionLines = [
    signals.map(formatObservedSignal).filter(Boolean).join("\n") || describeRequestObservation(input),
  ];
  const decisionLines = [
    decision.schema_version === 2 ? String(decision.decision || "未提供具体处理选择") : "该回复未提供可核验的决策记录",
    ...(output.knowhow_status ? [`经验库检索：${knowhowStatusLabels[output.knowhow_status] || output.knowhow_status}`] : []),
    ...(retrievedKnowhow.length ? [`检索到：${retrievedKnowhow.map((item) => `${item.title || item.knowhow_id}（${item.knowhow_id}）`).join("、")}`] : []),
    ...(strategy ? [`策略：${strategy}`] : []),
    ...(reasons.length ? [`依据：${reasons.join("、")}`] : []),
    ...(seat ? [`协作目标：${seat}`] : []),
    ...(applied.length ? [`采用经验编号：${applied.join("、")}`] : []),
  ];
  return {
    source: "response",
    perception: perceptionLines.filter(Boolean).join("\n"),
    decision: decisionLines.join("\n"),
    execution: "正在核对本轮执行状态",
    execution_actions: Array.isArray(output.execution?.actions) ? output.execution.actions : [],
    priority: getWorkflowHostSpeechPriority(output, input),
    debug: {
      input, perception: output.perception, decision_trace: decision,
      execution_plan: output.execution, knowhow_status: output.knowhow_status,
      retrieved_knowhow: retrievedKnowhow, strategy: output.strategy,
      reason_codes: output.reason_codes, target_seat: output.target_seat,
      applied_knowhow_ids: applied,
    },
  };
}

function formatObservedSignal(signal) {
  if (!signal || signal.value === null || signal.value === undefined || signal.value === "") return "";
  if (!["string", "number", "boolean"].includes(typeof signal.value)) return "";
  const value = String(signal.value).slice(0, 160);
  const before = signal.previous_value == null ? "" : `${String(signal.previous_value).slice(0, 80)} → `;
  const unit = signal.unit === "km/h" ? " km/h" : "";
  const duration = Number.isFinite(signal.duration_ms) ? `（持续 ${Math.floor(signal.duration_ms / 1000)} 秒）` : "";
  return `${String(signal.label || "收到信号").slice(0, 20)}：${before}${value}${unit}${duration}`;
}

function describeRequestObservation(input) {
  if (input.player_input) return `${input.passengers?.selected_seat_label || SEATS[input.interaction?.current_speaker] || "乘客"}说：${input.player_input}`;
  const event = input.event || {};
  if (event.type === "environment_change") {
    return `车外环境：${event.previous_value ? `${event.previous_value} → ` : ""}${event.value || "未提供"}`;
  }
  return event.type
    ? `收到事件：${readableTraceValue(event.type, DECISION_TRACE_LABELS.rule, "其他座舱事件")}`
    : "本轮未提供感知信号";
}

function updateDecisionTrace(trace = {}) {
  state.decisionTrace.id += 1;
  state.decisionTrace.receipts = {};
  executionRecords.set(state.decisionTrace.id, state.decisionTrace.receipts);
  if (executionRecords.size > 100) executionRecords.delete(executionRecords.keys().next().value);
  state.decisionTrace.source = trace.source || "local";
  state.decisionTrace.debug = trace.debug || { local_trace: trace };
  state.decisionTrace.perception = String(trace.perception || "").trim();
  state.decisionTrace.decision = String(trace.decision || "").trim();
  state.decisionTrace.execution = String(trace.execution || "").trim();
  state.decisionTrace.strategyId = trace.strategy_id || trace.strategyId || "";
  state.decisionTrace.priority = trace.priority || "";
  state.decisionTrace.executionActions = Array.isArray(trace.execution_actions)
    ? trace.execution_actions : [];
  renderDecisionTrace();
  return state.decisionTrace.id;
}

function getDecisionPriorityLabel(priority) {
  return { P0: "立即处理", P1: "重要事件", P2: "乘客互动", P3: "一般事件", P4: "氛围信息" }[priority] || "";
}

function getDecisionSpeechLabel(source, event = null) {
  if (event?.type === "environment_change") return `环境切换${event.value ? `：${event.value}` : ""}`;
  if (event) return getImportantEventText(event.type, event.seat);
  return { chat: "乘客提问回答", passenger_question: "乘客提问回答", workflow_fallback: "乘客提问回答",
    victory: "答对揭晓", question_timeout: "超时揭晓", game_summary: "整局结束", hard_brake: "安全暂停",
    safety_recovery: "安全恢复", queued_question: "接收乘客问题", post_result_feedback: "成绩反馈" }[source]
    || IMPORTANT_EVENT_LABELS[source]?.() || "主持人回应";
}

function getDecisionQueuePresentation() {
  const trace = state.decisionTrace;
  const empty = { perception: "", decision: "", execution: "", priority: "" };
  if (!trace.perception.trim()) return empty;
  const records = state.workflow.situationEvents.filter(record => !isSituationEventFinished(record)
    && !getSituationEventInvalidReason(record));
  const focus = state.workflow.situationEvents.find(record => record.traceId === trace.id);
  const speech = state.workflow.hostSpeech;
  const active = (speech.expiresAt > simulationRuntime.now() || speech.voicePending || speech.voicePlaying)
    && String(state.host.text || "").trim();
  const activeRecord = active ? findSituationEvent(speech.sceneScope?.eventId) : null;
  const activePriority = Object.keys(HOST_SPEECH_PRIORITIES).find(key => HOST_SPEECH_PRIORITIES[key] === speech.priority);
  const pending = records.filter(record => record.event.id !== activeRecord?.event.id && record.status !== "showing")
    .map(record => ({ label: getDecisionSpeechLabel("", record.event), priority: record.event.priority,
      sequence: record.sequence, record }));
  for (const reply of state.workflow.deferredHostReplies) {
    if (reply.options.sceneScope?.managedEvent || reply.gameId !== state.workflow.gameId
      || reply.p0Epoch !== state.workflow.p0Epoch || reply.expiresAt <= simulationRuntime.now()
      || !isCurrentSituationScope(reply.options.sceneScope)) continue;
    const priority = typeof reply.options.priority === "number"
      ? Object.keys(HOST_SPEECH_PRIORITIES).find(key => HOST_SPEECH_PRIORITIES[key] === reply.options.priority) || "P2"
      : reply.options.priority || "P2";
    pending.push({ label: getDecisionSpeechLabel(reply.options.source), priority, sequence: reply.sequence });
  }
  for (const chat of state.workflow.pendingChats) {
    pending.push({ label: `${getSeatDisplayLabel(chat.seat)}提问`, priority: "P2", sequence: chat.sequence || 0 });
  }
  pending.sort((a, b) => normalizeHostSpeechPriority(b.priority) - normalizeHostSpeechPriority(a.priority)
    || a.sequence - b.sequence);
  const simultaneous = records.filter(record => record !== focus);
  const perception = trace.perception + (records.length > 1
    ? `\n同时事件：${simultaneous.slice(0, 2).map(record => getDecisionSpeechLabel("", record.event)).join("、")}${simultaneous.length > 2 ? `等${simultaneous.length}项` : ""}` : "");
  if (!trace.decision.trim()) return { ...empty, perception };
  const priority = focus?.event.priority || trace.priority;
  const focusIsActive = active && (focus ? activeRecord === focus : speech.traceId === trace.id);
  const higher = pending.find(item => item.record !== focus
    && normalizeHostSpeechPriority(item.priority) > normalizeHostSpeechPriority(priority));
  let arbitration = "";
  if (priority === "P0") arbitration = pending.length ? "P0 立即处理，其他待办保留等待" : "P0 立即处理";
  else if (focus && isSituationEventFinished(focus)) arbitration = focus.reason;
  else if (active && !focusIsActive && activePriority === "P0") arbitration = "等待 P0 处理结束，本事件保留";
  else if (active && !focusIsActive && normalizeHostSpeechPriority(activePriority) > normalizeHostSpeechPriority(priority)) {
    arbitration = `${activePriority} ${getDecisionSpeechLabel(speech.source, activeRecord?.event)}正在回应，本事件排队`;
  }
  else if (higher) arbitration = `${higher.priority} ${higher.label}优先，本事件排队`;
  else if (active && !focusIsActive) arbitration = "当前气泡结束后，再按优先级回应";
  else if (focus?.status === "generating") arbitration = "已轮到本事件，正在生成回应";
  else if (focus?.status === "showing" || activeRecord && activeRecord === focus) arbitration = "已轮到本事件，正在回应";
  else if (pending.filter(item => item.priority === priority).length > 1) arbitration = "同级事件按发生顺序回应";
  const decision = [arbitration, trace.decision].filter(Boolean).join("\n");
  const execution = [];
  if (active) execution.push(`正在回应：${activePriority || "P2"} ${getDecisionSpeechLabel(speech.source, activeRecord?.event)}`);
  if (pending.length) {
    execution.push(`接下来：${pending.slice(0, 2).map(item => `${item.priority} ${item.label}`).join(" → ")}`);
    if (pending.length > 2) execution.push(`另有 ${pending.length - 2} 项待处理`);
  }
  if (trace.execution.trim()) execution.push(trace.execution);
  return { perception, decision, execution: execution.join("\n"), priority: getDecisionPriorityLabel(priority) ? priority : "" };
}

function renderDecisionTrace() {
  if (simulationRuntime.paused) return;
  const view = getDecisionQueuePresentation();
  els.decisionPerception?.closest(".cabin-decision-card")?.classList?.toggle(
    "is-prestart", state.game.status === "idle" && !view.perception,
  );
  if (els.decisionPerception) els.decisionPerception.textContent = formatDecisionText(view.perception);
  if (els.decisionDecision) els.decisionDecision.textContent = formatDecisionText(view.decision);
  if (els.decisionExecution) els.decisionExecution.textContent = formatDecisionText(view.execution);
  if (els.decisionPriority) {
    els.decisionPriority.hidden = !view.priority;
    els.decisionPriority.textContent = view.priority ? `${view.priority} ${getDecisionPriorityLabel(view.priority)}` : "";
    els.decisionPriority.dataset.priority = view.priority;
    els.decisionPriority.title = view.priority ? `前端仲裁优先级：${view.priority}，同级按事件发生顺序处理` : "";
  }
  syncDecisionTraceArrows();
}

function recordExecutionReceipt(traceId, key, status, text) {
  const receipts = executionRecords.get(traceId);
  if (!receipts) return;
  if (receipts[key]?.status === status && receipts[key]?.text === text) return;
  receipts[key] = { status, text, at: simulationRuntime.now() };
  if (traceId !== state.decisionTrace.id) return;
  state.decisionTrace.execution = [...new Set(Object.values(state.decisionTrace.receipts).map((receipt) => receipt.text))].join("\n");
  // Media promises may settle outside the normal render cycle.
  renderDecisionTrace();
}

function syncDecisionTraceArrows() {
  const columns = els.decisionPerception?.closest("dl")?.querySelectorAll(":scope > div");
  if (!columns) return;
  const hasContent = Array.from(columns, (column) =>
    Boolean(column.querySelector("dd")?.textContent.trim()));
  for (const [index, column] of Array.from(columns).entries()) {
    const blocked = index > 0 && !hasContent.slice(0, index).every(Boolean);
    column.classList.toggle("is-blocked", blocked);
    column.classList.toggle("has-content", hasContent[index]);
  }
}

function resetDecisionTrace() {
  updateDecisionTrace({
    perception: "",
    decision: "",
    execution: "",
    strategyId: "",
    priority: "",
  });
}

function showPassengerQuestionPerception(seat, text) {
  return updateDecisionTrace({
    source: "local",
    perception: `${SEATS[seat] || "乘客"}提问：${String(text || "").trim()}`,
    decision: "",
    execution: "",
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
    return false;
  }

  if (state.passengers.seats[seat].mood === "睡着") {
    return false;
  }

  const actionKey = `${seat}:${passengerAction.text}`;
  if (actionKey === state.workflow.lastPassengerActionKey) {
    return false;
  }

  showPassengerBubble(seat, passengerAction.text);
  if (passengerAction.mood && ["普通", "大笑", "沉默", "睡着"].includes(passengerAction.mood)) {
    state.passengers.seats[seat].mood = passengerAction.mood;
  }
  state.host.targetSeat = seat;
  state.workflow.lastPassengerActionKey = actionKey;
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
      if (activity === "celebrating" && !(output.is_correct || output.game_status === "victory")) {
        return;
      }
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
  if (text.includes("疲惫") || text.includes("困") || text.includes("累")) return "疲惫";
  if (text.includes("大笑") || text.includes("笑")) return "大笑";
  if (text.includes("沉默") || text.includes("安静")) return "沉默";
  if (text === "普通" || text === "normal") return "普通";
  return null;
}

function applyHostAvatarState(output, uiChange, isVictoryOutput) {
  const requestedState =
    uiChange.host_avatar_state ||
    output.host_avatar_state ||
    uiChange.host_emotion ||
    output.host_emotion;
  const avatarState = isVictoryOutput ? "excited" : normalizeHostAvatarState(requestedState);
  setHostAvatarState(avatarState, {
    transient: ["smile", "awkward"].includes(avatarState),
  });
}

function normalizeHostAvatarState(value) {
  const key = String(value || "").trim();
  if (!key) return HOST_AVATAR_DEFAULT_STATE;
  return HOST_EMOTION_AVATAR_STATE[key] || HOST_EMOTION_AVATAR_STATE[key.toLowerCase()] || HOST_AVATAR_DEFAULT_STATE;
}

function setHostAvatarState(avatarState, options = {}) {
  const normalized = normalizeHostAvatarState(avatarState);
  state.host.avatarState = normalized;
  clearHostAvatarTimer();

  if (options.transient && normalized !== HOST_AVATAR_DEFAULT_STATE) {
    state.workflow.hostAvatarTimer = simulationRuntime.setTimeout(() => {
      state.workflow.hostAvatarTimer = null;
      if (state.game.status !== "victory") {
        state.host.avatarState = HOST_AVATAR_DEFAULT_STATE;
        render();
      }
    }, HOST_AVATAR_TRANSIENT_MS);
  }
}

function clearHostAvatarTimer() {
  if (!state.workflow.hostAvatarTimer) return;
  simulationRuntime.clearTimeout(state.workflow.hostAvatarTimer);
  state.workflow.hostAvatarTimer = null;
}

function schedulePassengerActivityClear() {
  if (state.workflow.activityTimer) simulationRuntime.clearTimeout(state.workflow.activityTimer);
  state.workflow.activityTimer = simulationRuntime.setTimeout(() => {
    clearPassengerActivities();
    state.workflow.activityTimer = null;
    render();
  }, 6000);
}

function showCorrectSeatLight(seat, traceId = null) {
  clearCorrectLightTimer();
  state.ui.correctLightSeat = seat;
  state.workflow.correctLightTraceId = traceId;
  recordExecutionReceipt(traceId, "light", "simulating", "答对氛围灯：模拟播放中");
  state.workflow.correctLightTimer = simulationRuntime.setTimeout(() => {
    state.workflow.correctLightTimer = null;
    state.ui.correctLightSeat = null;
    recordExecutionReceipt(traceId, "light", "completed", "答对氛围灯：模拟结束");
    const seatState = state.passengers.seats[seat];
    if (seatState) {
      seatState.mood = "普通";
      seatState.activity = "idle";
      seatState.activityLabel = "";
    }
    render();
  }, CORRECT_LIGHT_MS);
}

function clearCorrectLightTimer() {
  if (!state.workflow.correctLightTimer) return;
  recordExecutionReceipt(state.workflow.correctLightTraceId, "light", "cancelled", "答对氛围灯：模拟已停止");
  simulationRuntime.clearTimeout(state.workflow.correctLightTimer);
  state.workflow.correctLightTimer = null;
}

function scheduleNextRound() {
  clearNextRoundTimer();
  const completedRound = state.game.roundIndex;
  roundAdvanceDiagnostic.lastKey = "";
  roundAdvanceDiagnostic.lastAt = 0;
  roundAdvanceDiagnostic.waitingSince = 0;
  logRoundAdvanceDiagnostic("round_advance_started", completedRound, []);
  state.workflow.nextRoundTimer = simulationRuntime.setTimeout(
    () => advanceAfterVictory(completedRound),
    NEXT_ROUND_DELAY_MS,
  );
}

function advanceAfterVictory(completedRound) {
  state.workflow.nextRoundTimer = null;
  if (state.game.status !== "victory" || state.game.roundIndex !== completedRound) return;

  if (state.timeline.status === "paused") {
    logRoundAdvanceDiagnostic("round_advance_wait", completedRound, ["timeline_paused"]);
    state.workflow.nextRoundTimer = simulationRuntime.setTimeout(
      () => advanceAfterVictory(completedRound),
      PAUSED_ROUND_POLL_MS,
    );
    return;
  }

  const currentRoundId = getDifyRoundScopeKey();
  const blockers = [];
  const now = simulationRuntime.now();
  const deferredCurrentRound = state.workflow.deferredHostReplies.filter((entry) => entry.roundId === currentRoundId);
  const speechRemaining = Math.max(0, state.workflow.hostSpeech.expiresAt - now);
  if (state.workflow.hostSpeech.voicePending || state.workflow.hostSpeech.voicePlaying) blockers.push("host_voice_active");
  if (state.workflow.inFlight) blockers.push("workflow_in_flight");
  if (deferredCurrentRound.some((entry) => isChatSpeechSource(entry.options.source))) blockers.push("deferred_chat_reply");
  if (isChatSpeechSource(state.workflow.hostSpeech.source) && speechRemaining > 0) blockers.push("chat_speech_active");
  if (state.workflow.resultFeedback && !state.workflow.resultFeedback.shown) blockers.push("result_feedback_not_shown");
  if (state.workflow.hostSpeech.source === "post_result_feedback" && speechRemaining > 0) blockers.push("post_result_feedback_active");
  if (blockers.length) {
    logRoundAdvanceDiagnostic("round_advance_wait", completedRound, blockers);
    state.workflow.nextRoundTimer = simulationRuntime.setTimeout(
      () => advanceAfterVictory(completedRound),
      PAUSED_ROUND_POLL_MS,
    );
    return;
  }

  logRoundAdvanceDiagnostic("round_advance_completed", completedRound, []);

  if (completedRound >= state.game.totalRounds) {
    finishGameSeries();
    render();
    return;
  }

  clearResultFeedback();

  const nextPreparation = refreshFollowingRoundPreparation();
  if (!nextPreparation) {
    finishGameSeries();
    render();
    return;
  }
  state.game.roundIndex = completedRound + 1;
  state.game.currentRiddleIndex = nextPreparation.riddleIndex;
  persistDifyRoundScope();
  state.game.questionCount = 0;
  state.game.roundQuestionPlan = null;
  state.game.usedRoundQuestionStepIds = [];
  state.game.coveredFactKeys = [];
  state.game.publicClues = [];
  resetRealtimeConversationState();
  state.game.status = "idle";
  state.ui.cabinMode = "normal";
  state.ui.showAnswer = false;
  state.ui.correctSeat = null;
  state.ui.correctLightSeat = null;
  state.ui.animation = "idle";
  clearConfetti();
  state.passengers.selectedSeat = "front";
  clearPassengerActivities();
  clearPassengerBubbles();
  clearCorrectLightTimer();
  setHostAvatarState(HOST_AVATAR_DEFAULT_STATE);
  state.host.targetSeat = null;
  state.host.emotion = "normal";
  // Keep the P0 result bubble visibly cleared during the short handoff gap.
  clearHostSpeechLock();
  state.host.text = "";
  state.ui.alert = `进入第 ${state.game.roundIndex} 题`;
  updateDecisionTrace({
    perception: `第 ${completedRound} 题已答对`,
    decision: "保留揭晓反馈后继续下一题",
    execution: `切换第 ${state.game.roundIndex} 题并重新开场`,
    strategyId: "S06",
    priority: "P3",
  });
  render();
  void startRoundGoldenTimeline();
}

function logRoundAdvanceDiagnostic(type, completedRound, blockers) {
  if (state.health.runtime !== "local" || typeof fetch !== "function") return;
  const now = simulationRuntime.now();
  const speech = state.workflow.hostSpeech;
  const feedback = state.workflow.resultFeedback;
  const safeSource = value => ["victory", "environment", "post_result_feedback", "chat", "passenger_question",
    "workflow_fallback", "game_control", "hard_brake", "passenger_sleep", "passenger_wake", "driver_tired",
    "near_destination", "timeout"].includes(value) ? value : value ? "other" : "";
  if (type === "round_advance_wait") {
    if (!roundAdvanceDiagnostic.waitingSince) roundAdvanceDiagnostic.waitingSince = Date.now();
    const key = blockers.join(",") || "timeline_paused";
    const wallNow = Date.now();
    if (key === roundAdvanceDiagnostic.lastKey && wallNow - roundAdvanceDiagnostic.lastAt < 5000) return;
    roundAdvanceDiagnostic.lastKey = key;
    roundAdvanceDiagnostic.lastAt = wallNow;
  } else {
    roundAdvanceDiagnostic.lastKey = "";
    roundAdvanceDiagnostic.lastAt = 0;
    if (type === "round_advance_completed") roundAdvanceDiagnostic.waitingSince = 0;
  }
  const deferred = state.workflow.deferredHostReplies.filter(entry => entry.roundId === getDifyRoundScopeKey());
  const payload = {
    type,
    game_id: state.workflow.gameId,
    round_id: `${state.workflow.gameId}-round-${completedRound}`,
    game_status: state.game.status,
    timeline_status: state.timeline.status,
    simulation_paused: simulationRuntime.paused,
    workflow_in_flight: Boolean(state.workflow.inFlight),
    deferred_reply_count: deferred.length,
    deferred_reply_sources: deferred.slice(0, 8).map(entry => safeSource(entry.options?.source)),
    pending_chat_count: state.workflow.pendingChats.length,
    host_speech_source: safeSource(speech.source),
    host_speech_remaining_ms: Math.round(Math.max(0, speech.expiresAt - now)),
    host_voice_pending: Boolean(speech.voicePending),
    host_voice_playing: Boolean(speech.voicePlaying),
    result_feedback_state: !feedback ? "none" : feedback.shown ? "shown" : feedback.output ? "output_ready" : "waiting",
    result_feedback_remaining_ms: feedback ? Math.round(Math.max(0, feedback.expiresAt - now)) : 0,
    pending_minimum_speech_source: safeSource(state.workflow.pendingMinimumSpeech?.source),
    next_round_timer_active: Boolean(state.workflow.nextRoundTimer),
    blockers,
    wait_duration_ms: roundAdvanceDiagnostic.waitingSince ? Date.now() - roundAdvanceDiagnostic.waitingSince : 0,
  };
  fetch("/api/client-diagnostic", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload), keepalive: true }).catch(() => {});
}

function finishGameSeries() {
  stopGoldenExperience();
  clearNextRiddleRefresh();
  invalidateAsyncHostResults();
  clearQuestionClock();
  clearNextRoundTimer();
  finishTimelineSilently();
  state.game.status = "summary";
  state.ui.cabinMode = "summary";
  prepareNextGameFirstRound();
  clearConfetti();
  startSummaryConfetti();
  state.ui.showAnswer = false;
  state.ui.correctLightSeat = null;
  state.ui.animation = "summary";
  clearSummarySpeechTimer();
  clearHostSpeechLock();
  state.host.text = "";
  state.host.emotion = "normal";
  state.host.targetSeat = null;
  setHostAvatarState(HOST_AVATAR_DEFAULT_STATE, { transient: false });
  state.ui.alert = "本轮游戏已完成";
  const summaryHostText = makeSummaryHostText();
  state.workflow.summarySpeechTimer = simulationRuntime.setTimeout(() => {
    state.workflow.summarySpeechTimer = null;
    if (state.game.status !== "summary") return;
    publishHostLine(summaryHostText, {
      priority: "P0",
      source: "game_summary",
      durationMs: HOST_SPEECH_P0_LOCK_MS,
    });
    render();
  }, SUMMARY_HOST_SPEECH_DELAY_MS);
  notifyP0Situation("game_end");
}

function clearNextRoundTimer() {
  if (!state.workflow.nextRoundTimer) return;
  simulationRuntime.clearTimeout(state.workflow.nextRoundTimer);
  state.workflow.nextRoundTimer = null;
}

function clearPassengerActivities() {
  Object.values(state.passengers.seats).forEach((seatState) => {
    seatState.activity = "idle";
    seatState.activityLabel = "";
  });
}

function makeVictoryHostText(correctSeat, answer) {
  const seatLabel = SEATS[correctSeat] || "这位侦探";
  return `${seatLabel}答对了，谜底就是${answer}。`;
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

function sanitizeHostReplyText(text) {
  const sanitized = String(text || "")
    .replace(/请(选择|挑选)(一个)?主题[。！!？?]?/g, "")
    .replace(/好的[，,]让我们开始猜谜游戏[。！!]?/g, "好的，我们开始猜谜。")
    .replace(/环境已更新为[^。！!?]*[。！!?]?\s*下一题我会更贴近窗外[^。！!?]*[。！!?]?/g, "")
    .replace(/环境已更新[^。！!?]*[。！!?]?/g, "")
    .replace(/状态已更新[，,]?\s*我会根据新的座舱信息调整主持节奏[。！!?]?/g, "")
    .replace(/会根据新的座舱信息调整主持节奏[。！!?]?/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return sanitized;
}

function shouldMuteHostReplyForEvent(eventType, text) {
  if (!eventType) return false;
  const normalized = String(text || "").trim();
  if (!normalized) return true;

  if (!["environment_change", "speed_change", "cabin_laughing"].includes(eventType)) {
    return false;
  }

  return /状态已更新|环境已更新|调整主持节奏|更贴近窗外|同步座舱/.test(normalized);
}

function getAnswerLead(text) {
  const normalized = String(text || "").trim();
  if (/^(是|对|正确)/.test(normalized)) return "是的，这个方向有效。";
  if (/^(不是|不对|否)/.test(normalized)) return "不是这个方向。";
  return "";
}

function suppressPassengerActionForEvent(eventType) {
  if (eventType === "hard_brake") {
    clearPassengerBubbles();
  }
  return false;
}

function showPassengerBubble(seat, text) {
  if (String(text || "").trim()) cancelEnvironmentRoundIntro("乘客已开始问答，不再补播开场");
  recordParticipationActivity(seat, text);
  clearPassengerBubbles(seat);
  state.passengers.seats[seat].bubble = text;
  state.workflow.lastBubbleShownAt = simulationRuntime.now();
  playPassengerBubbleSound();
  scheduleBubbleClear();
}

function getBubbleOutputDelayMs(input) {
  if (input.trigger_type !== "chat") return 0;
  if (!state.workflow.lastBubbleShownAt) return 0;
  const elapsed = simulationRuntime.now() - state.workflow.lastBubbleShownAt;
  return Math.max(0, MIN_BUBBLE_DISPLAY_MS - elapsed);
}

function clearPassengerBubbles(keepSeat) {
  if (state.workflow.bubbleTimer) {
    simulationRuntime.clearTimeout(state.workflow.bubbleTimer);
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
    simulationRuntime.clearTimeout(state.workflow.bubbleTimer);
  }
  state.workflow.bubbleTimer = simulationRuntime.setTimeout(() => {
    clearPassengerBubbles();
    render();
  }, PASSENGER_BUBBLE_MS);
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

function getHostPresentation() {
  const hostBusy = isHostBusy();
  const requestedHostState = normalizeHostAvatarState(state.host.avatarState);
  // Keep the thinking sprite alive until its own sequence finishes. A new
  // reply may reveal the bubble while the already-started animation continues.
  const hostBubbleProtected = isHostBubbleProtectedFromThinking();
  const hostThinking = state.workflow.hostAwaitingReply && !hostBubbleProtected;
  const currentThinkingSprite =
    hostSprite.source === RESOURCE_CONFIG.host.thinking.src
    && hostSprite.thinkingCycleId === state.workflow.hostThinkingCycleId;
  const thinkingAnimationComplete =
    currentThinkingSprite && hostSprite.completed;
  const shouldShowThinking =
    isHostThinkingSpritePlaying()
    || (state.workflow.hostAwaitingReply
      && !hostBubbleProtected
      && !thinkingAnimationComplete
      && state.workflow.hostThinkingActive);
  const renderedHostState = shouldShowThinking
    ? "thinking"
    : requestedHostState === "thinking"
      ? HOST_AVATAR_DEFAULT_STATE
      : requestedHostState;
  const readyScreen = getGameScreenMode() === "ready";
  const hostBubbleText = readyScreen || hostThinking ? "" : String(state.host.text || "");
  const hostBubbleHidden = readyScreen || hostThinking || !hostBubbleText.trim();
  const hostSpeechVisible = !hostBubbleHidden;
  const mediaHostState =
    hostSpeechVisible && !state.workflow.hostSpeech.voiceFinished && renderedHostState === HOST_AVATAR_DEFAULT_STATE
      ? "speak"
      : renderedHostState === "speak" && state.workflow.hostSpeech.voiceFinished
        ? HOST_AVATAR_DEFAULT_STATE
      : renderedHostState;
  return { hostBusy, hostThinking, renderedHostState, hostBubbleText, hostBubbleHidden, hostSpeechVisible, mediaHostState };
}

function render() {
  if (simulationRuntime.paused) return;
  const riddle = getCurrentRiddle();
  const screenMode = getGameScreenMode();
  if (els.playerInputGuide) els.playerInputGuide.hidden = !shouldShowPlayerInputGuide(screenMode);
  const enteredReadyScreen =
    screenMode === "ready" && lastRenderedScreenMode !== "ready";
  lastRenderedScreenMode = screenMode;
  if (enteredReadyScreen) {
    scheduleSoundOnboarding();
    resetBackgroundMusicForReadyEntry();
    cancelHostVoiceSpeech();
  } else if (screenMode !== "ready") {
    hideSoundOnboarding();
  }
  const { hostBusy, hostThinking, renderedHostState, hostBubbleText, hostBubbleHidden, hostSpeechVisible, mediaHostState } = getHostPresentation();
  const noWinnerReveal = state.game.status === "failed" && state.ui.showAnswer;
  const environmentAssets = resolveEnvironmentAssets(state.car.environment);
  const screenEnvironmentAssets = resolveEnvironmentAssets(
    state.ui.screenEnvironment || state.car.environment,
  );
  const environmentMapping =
    getEnvironmentMapping(state.car.environment)
    || RESOURCE_CONFIG.environments["高速路晴天白天"];
  const screenBackground =
    screenMode === "ready"
      ? RESOURCE_CONFIG.screenBackgrounds.default
      : screenMode === "summary"
        ? RESOURCE_CONFIG.screenBackgrounds.scenicSunset
      : screenEnvironmentAssets.screen;
  document.body.classList.toggle("is-paused", state.game.status === "paused");
  document.body.classList.toggle("is-victory", state.game.status === "victory");
  document.body.classList.toggle("is-working", hostBusy);
  const summaryConfettiLoopClass = screenMode === "summary" && summaryConfettiAnimation.fallingVisible
    ? " summary-confetti-loop"
    : "";
  const summaryHostSpeechClass = screenMode === "summary" && hostSpeechVisible
    ? " summary-host-speech-ready"
    : "";
  els.gameScreen.className = `game-screen screen-${screenMode} ${getScreenEnvironmentClass(screenMode)}${summaryConfettiLoopClass}${summaryHostSpeechClass}`;
  document.body.classList.toggle("startup-loading", startupLoading.active);
  els.gameScreen.classList.toggle("screen-reveal-no-winner", noWinnerReveal);
  renderHostMedia(screenMode, mediaHostState);

  els.environmentBackdrop.className = `environment-backdrop ${
    environmentMapping.cabinClass
  }`;
  setRenderedImageSource(
    els.environmentBackdrop.querySelector(".environment-backdrop-image"),
    environmentAssets.cabin,
    () => {
      // Refresh WebKit's backdrop snapshot together with the new image layer.
      const glass = els.environmentBackdrop.parentElement.querySelector(".cabin-glass");
      if (glass) glass.replaceWith(glass.cloneNode(true));
    },
  );
  if (screenMode !== "summary") {
    setRenderedImageSource(
      els.gameScreen.querySelector(".game-screen-background"),
      screenBackground,
      () => {
        refreshGameScreenBackdrop();
      },
    );
  }
  els.environmentLabel.textContent = `车外环境：${getEnvironmentDescription(state.car.environment).name}`;
  els.speedLabel.textContent = `${state.car.speed} km/h`;
  els.destinationLabel.textContent = `目的地：${state.car.destination}`;

  renderGameProgress();
  els.stageLabel.textContent = getStageLabel();
  els.riddleTitle.textContent = getRiddleTitle(riddle);
  const questionIntroVisible = isQuestionIntroVisible();
  if (state.game.status === "playing" && !questionIntroVisible && !state.ui.showAnswer
    && !state.game.publicClues.includes(riddle.hint)) state.game.publicClues.push(riddle.hint);
  els.riddleTitle.classList.toggle("question-intro", questionIntroVisible);
  if (!questionIntroVisible) {
    scheduleAdaptiveTextFit(els.riddleTitle, els.riddleTitle.textContent, {
      fontSize: 46,
      minFontSize: 38,
      lineHeight: 80,
      maxLines: 3,
    });
  } else {
    els.riddleTitle.style.removeProperty("font-size");
    els.riddleTitle.style.removeProperty("line-height");
  }
  els.riddleHint.textContent = getRiddleSupportText(riddle);
  els.remainingQuestions.parentElement.classList.toggle("hidden", questionIntroVisible);
  renderQuestionClock();
  els.riddleHint.classList.toggle("hidden", state.game.status === "idle" && !state.ui.showAnswer);
  renderRemainingQuestions();
  els.answerReveal.textContent = `谜底：${riddle.answer}`;
  els.answerReveal.classList.toggle("visible", state.ui.showAnswer);
  els.revealAnswerText.textContent = riddle.answer;
  els.revealSeatLabel.textContent = noWinnerReveal
    ? "无人答对"
    : SEATS[state.ui.correctSeat] || "副驾";
  els.revealOutcomeLabel.textContent = noWinnerReveal ? "" : "答对了！";
  els.summaryTotal.textContent = state.game.totalRounds;
  els.summarySolved.textContent = getSummarySolvedCount();
  els.summaryMvp.textContent = SEATS[getSummaryMvpSeat()] || "副驾";
  els.hostBubble.classList.remove("thinking");
  els.hostBubble.classList.toggle("hidden", hostBubbleHidden);
  els.hostBubble.classList.remove("medium-text", "long-text");
  els.hostBubble.style.height = "167px";
  if (!els.hostBubble.dataset.baseTop) {
    els.hostBubble.dataset.baseTop = getComputedStyle(els.hostBubble).top;
  }
  els.hostBubble.style.top = els.hostBubble.dataset.baseTop;
  els.hostBubble.setAttribute("aria-busy", hostBusy ? "true" : "false");
  const hostBubbleTextElement = setHostBubbleText(hostBubbleText);
  if (!hostBubbleHidden) {
    simulationRuntime.requestAnimationFrame(() => {
      if (!hostBubbleTextElement.isConnected || hostBubbleTextElement.textContent !== hostBubbleText) return;
      fitAdaptiveText(hostBubbleTextElement, { fontSize: 34, minFontSize: 28, lineHeight: 52 });
      fitBubbleHeight(els.hostBubble, hostBubbleTextElement, {
        maxHeight: 167,
        minHeight: 100,
        paddingY: 48,
        anchorLines: 2,
        anchorLineHeight: 52,
      });
    });
  } else {
    hostBubbleTextElement.style.removeProperty("font-size");
    hostBubbleTextElement.style.removeProperty("line-height");
  }
  if (hostSpeechVisible && !state.workflow.hostSpeech.wasVisible) {
    state.workflow.hostSpeech.visibleAt = simulationRuntime.now();
    const intro = state.workflow.environmentRoundIntro;
    if (state.workflow.hostSpeech.source === "environment_round_intro"
      && intro?.id === state.workflow.hostSpeech.sceneScope?.environmentRoundIntroId) {
      intro.status = "shown";
      simulationRuntime.clearTimeout(intro.timer);
      intro.timer = null;
    }
    const eventRecord = findSituationEvent(state.workflow.hostSpeech.sceneScope?.eventId);
    if (eventRecord && !isSituationEventFinished(eventRecord)) setSituationEventStatus(eventRecord, "showing", "事件回应已开始显示");
    startHostSpeechActions();
    const clue = state.workflow.hostSpeech.publicClue;
    if (clue && !clue.includes(getCurrentRiddle().answer) && !state.game.publicClues.includes(clue)) state.game.publicClues.push(clue);
  }
  if (hostSpeechVisible) {
    void startHostVoiceSpeech(state.workflow.hostSpeech.id, hostBubbleText);
  }
  if (state.workflow.hostSpeech.expiresAt > simulationRuntime.now()) {
    const speech = state.workflow.hostSpeech;
    speech.wasVisible ||= hostSpeechVisible;
    recordExecutionReceipt(speech.traceId, "speech", hostSpeechVisible ? "showing" : "hidden",
      hostSpeechVisible ? "主持话术：显示中" : "主持话术：等待当前处理完成");
  }
  els.hostAvatar.classList.toggle("thinking", hostThinking);
  els.hostAvatar.dataset.avatarState = mediaHostState;
  els.timelineName.textContent = state.timeline.name;
  renderDecisionTrace();

  const importantEventState = state.ui.importantEvent;
  const importantEventId = String(importantEventState.id);
  if (els.importantEvent.dataset.eventId !== importantEventId) {
    els.importantEvent.classList.remove("visible", "hiding");
    void els.importantEvent.offsetWidth;
    els.importantEvent.dataset.eventId = importantEventId;
  }
  els.importantEventText.textContent = importantEventState.text;
  els.importantEvent.classList.toggle(
    "visible",
    importantEventState.phase === "visible",
  );
  els.importantEvent.classList.toggle(
    "hiding",
    importantEventState.phase === "hiding",
  );
  els.importantEvent.setAttribute(
    "aria-hidden",
    importantEventState.phase === "hidden" ? "true" : "false",
  );

  renderSeats();
  renderControls();
}

function getScreenEnvironmentClass(screenMode) {
  if (screenMode === "ready") return "screen-default";
  const mapping = getEnvironmentMapping(state.ui.screenEnvironment || state.car.environment);
  return mapping ? mapping.screenClass : "screen-default";
}

function getEnvironmentMapping(environment) {
  return RESOURCE_CONFIG.environments[environment] || null;
}

function resolveEnvironmentAssets(environment) {
  const mapping = getEnvironmentMapping(environment);
  const cabinFallback = RESOURCE_CONFIG.cabinEnvironments.scenicDay;
  return {
    screen: mapping
      ? RESOURCE_CONFIG.screenBackgrounds[mapping.screen] || RESOURCE_CONFIG.screenBackgrounds.default
      : RESOURCE_CONFIG.screenBackgrounds.default,
    cabin: mapping
      ? RESOURCE_CONFIG.cabinEnvironments[mapping.cabin] || cabinFallback
      : cabinFallback,
  };
}

function setRenderedImageSource(image, source, onReplace) {
  if (!image || !source || image.dataset.assetSource === source) return;

  image.dataset.assetSource = source;
  if (image.getAttribute("src") === source && image.complete && image.naturalWidth) return;
  const pendingImage = new Image();
  pendingImage.decoding = "async";
  pendingImage.onload = () => simulationRuntime.defer(() => {
    if (!image.isConnected || image.dataset.assetSource !== source) return;
    pendingImage.onload = null;
    pendingImage.onerror = null;
    for (const attribute of image.attributes) {
      if (attribute.name !== "src") pendingImage.setAttribute(attribute.name, attribute.value);
    }
    // A new node invalidates stale image layers under Safari's backdrop filters.
    image.replaceWith(pendingImage);
    onReplace?.();
  });
  pendingImage.onerror = () => simulationRuntime.defer(() => {
    if (image.isConnected && image.dataset.assetSource === source) {
      delete image.dataset.assetSource;
      console.warn("Background image could not be loaded:", source);
    }
  });
  pendingImage.src = source;
}

function refreshGameScreenBackdrop() {
  const panel = els.gameScreen?.querySelector(".riddle-panel");
  if (!panel) return;

  // Rebuild the filtered panel after the background image commits so WebKit
  // does not keep the previous backdrop snapshot for one or more frames.
  panel.replaceWith(panel.cloneNode(true));
  cacheElements();
}

function getGameScreenMode() {
  if (startupLoading.active) return "loading";
  if (state.game.status === "summary") return "summary";
  if (state.game.status === "victory" || state.ui.showAnswer) return "reveal";
  if (state.game.status === "idle" && state.timeline.status === "idle") return "ready";
  return "playing";
}

function renderHostMedia(screenMode, avatarState = state.host.avatarState) {
  if (screenMode === "loading") return;
  if (hostSceneMotion.mode !== screenMode) {
    hostSceneMotion.mode = screenMode;
    hostSceneMotion.completed = false;
  }
  const media = resolveHostMedia(screenMode, avatarState);
  const isSprite = media.kind === "sprite" && media.src && media.frameCount;

  if (isSprite) {
    if (hostSprite.fallback && hostSprite.source === media.src) {
      els.hostCanvas.hidden = true;
      els.hostImage.hidden = false;
      els.hostImage.src = media.fallback || RESOURCE_CONFIG.host.normal.src;
      return;
    }
    els.hostImage.hidden = true;
    els.hostCanvas.hidden = false;
    if (hostSprite.source !== media.src) {
      loadHostSprite(media);
    }
    return;
  }

  resetHostSprite();
  els.hostCanvas.hidden = true;
  els.hostImage.hidden = false;
  els.hostImage.src = media.src;
}

async function loadHostSprite(media) {
  const thinkingCycleId = media.src === RESOURCE_CONFIG.host.thinking.src
    ? state.workflow.hostThinkingCycleId
    : 0;
  resetHostSprite();
  hostSprite.source = media.src;
  hostSprite.thinkingCycleId = thinkingCycleId;
  hostSprite.loading = true;
  const loadId = ++hostSprite.loadId;

  try {
    const image = await loadHostSpriteImage(media.src);
    if (simulationRuntime.paused) await simulationRuntime.waitUntilRunning();
    if (loadId !== hostSprite.loadId || hostSprite.source !== media.src) return;

    hostSprite.frames = createHostSpriteFrames(media);
    hostSprite.image = image;
    hostSprite.totalDurationMs = hostSprite.frames.reduce(
      (total, frame) => total + Math.max(1, Number(frame.duration) || 100),
      0,
    );
    const audio = media.loop || !media.audio ? null : { ...media.audio };
    hostSprite.audio = audio;
    hostSprite.loop = Boolean(media.loop);
    hostSprite.loading = false;
    hostSprite.fallback = false;
    configureHostCanvas();
    drawHostSpriteFrame(0);
    void startHostSprite(loadId, media);
  } catch (error) {
    if (simulationRuntime.paused) await simulationRuntime.waitUntilRunning();
    if (loadId !== hostSprite.loadId || hostSprite.source !== media.src) return;
    hostSprite.loading = false;
    hostSprite.fallback = true;
    els.hostCanvas.hidden = true;
    els.hostImage.hidden = false;
    els.hostImage.src = media.fallback || RESOURCE_CONFIG.host.normal.src;
    if (!media.loop) playHostSpriteAudio(media.audio).catch(() => {});
    if (!media.loop && (media === RESOURCE_CONFIG.host.greeting || media === RESOURCE_CONFIG.host.celebration)) {
      hostSprite.fallbackTimerId = simulationRuntime.setTimeout(() => {
        if (loadId === hostSprite.loadId) finishHostSceneMotion();
      }, Number(media.frameCount) * HOST_SPRITE_FRAME_DURATION_MS);
    }
    console.warn("Host sprite could not be loaded; using static fallback.", error);
  }
}

function createHostSpriteFrames(media) {
  const frameCount = Math.max(1, Number(media.frameCount) || 1);
  return Array.from({ length: frameCount }, (_, index) => ({
    frame: {
      x: (index % HOST_SPRITE_COLUMNS) * HOST_SPRITE_FRAME_WIDTH,
      y: Math.floor(index / HOST_SPRITE_COLUMNS) * HOST_SPRITE_FRAME_HEIGHT,
      w: HOST_SPRITE_FRAME_WIDTH,
      h: HOST_SPRITE_FRAME_HEIGHT,
    },
    duration: HOST_SPRITE_FRAME_DURATION_MS,
  }));
}

function loadHostSpriteImage(src) {
  const cached = hostSpriteImageCache.get(src);
  if (cached) return cached;

  const promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Sprite image request failed: ${src}`));
    image.src = src;
  });
  hostSpriteImageCache.set(src, promise);
  promise.catch(() => {
    if (hostSpriteImageCache.get(src) === promise) hostSpriteImageCache.delete(src);
  });
  return promise;
}

function preloadHostSpriteImages() {
  return runPreloadQueue(Object.values(RESOURCE_CONFIG.host)
    .filter((media) => media?.kind === "sprite" && media.src), async media => {
      await loadHostSpriteImage(media.src).catch((error) => {
        console.warn("Host sprite preload failed:", media.src, error);
      });
    });
}

function configureHostCanvas() {
  const canvas = els.hostCanvas;
  canvas.width = 564;
  canvas.height = 572;
  canvas.dataset.frameCount = String(hostSprite.frames.length);
  canvas.getContext("2d").imageSmoothingEnabled = true;
}

function drawHostSpriteFrame(frameIndex) {
  if (!hostSprite.image || !hostSprite.frames.length) return;
  const frame = hostSprite.frames[frameIndex];
  const source = frame.frame;
  const context = els.hostCanvas.getContext("2d");
  context.clearRect(0, 0, els.hostCanvas.width, els.hostCanvas.height);
  context.drawImage(
    hostSprite.image,
    source.x,
    source.y,
    source.w,
    source.h,
    0,
    0,
    els.hostCanvas.width,
    els.hostCanvas.height,
  );
  hostSprite.frameIndex = frameIndex;
}

async function startHostSprite(loadId, media) {
  if (hostSprite.playing || hostSprite.completed || hostSprite.loading) return;
  if (loadId !== hostSprite.loadId || !hostSprite.image || !hostSprite.frames.length) return;

  if (hostSprite.audio) {
    void playHostSpriteAudio(hostSprite.audio)
      .then((audioReady) => {
        if (
          loadId === hostSprite.loadId &&
          media.playVictorySound !== false &&
          !audioReady
        ) {
          playVictorySound();
        }
      })
      .catch(() => {
        if (loadId === hostSprite.loadId && media.playVictorySound !== false) {
          playVictorySound();
        }
      });
  } else if (media.playVictorySound !== false && !hostSprite.loop) {
    playVictorySound();
  }

  hostSprite.playing = true;
  hostSprite.completed = false;
  hostSprite.elapsedMs = 0;
  hostSprite.lastTimestamp = 0;
  simulationRuntime.cancelAnimationFrame(hostSprite.animationFrameId);
  hostSprite.animationFrameId = simulationRuntime.requestAnimationFrame(stepHostSprite);
}

function stepHostSprite(timestamp) {
  if (!hostSprite.playing) return;
  if (!hostSprite.lastTimestamp) hostSprite.lastTimestamp = timestamp;
  hostSprite.elapsedMs += Math.min(100, timestamp - hostSprite.lastTimestamp);
  hostSprite.lastTimestamp = timestamp;

  if (hostSprite.elapsedMs >= hostSprite.totalDurationMs) {
    if (hostSprite.loop) {
      hostSprite.elapsedMs %= hostSprite.totalDurationMs;
      hostSprite.lastTimestamp = timestamp;
      drawHostSpriteFrame(0);
      hostSprite.animationFrameId = simulationRuntime.requestAnimationFrame(stepHostSprite);
      return;
    }
    drawHostSpriteFrame(hostSprite.frames.length - 1);
    hostSprite.playing = false;
    hostSprite.completed = true;
    hostSprite.animationFrameId = 0;
    if (finishHostSceneMotion()) return;
    if (hostSprite.source === RESOURCE_CONFIG.host.thinking.src) {
      state.workflow.hostThinkingActive = false;
      state.workflow.hostThinkingStartedAt = 0;
      render();
    }
    return;
  }

  let elapsed = hostSprite.elapsedMs;
  let frameIndex = 0;
  for (const frame of hostSprite.frames) {
    elapsed -= Math.max(1, Number(frame.duration) || 100);
    if (elapsed < 0) break;
    frameIndex += 1;
  }
  drawHostSpriteFrame(Math.min(frameIndex, hostSprite.frames.length - 1));
  hostSprite.animationFrameId = simulationRuntime.requestAnimationFrame(stepHostSprite);
}

function finishHostSceneMotion() {
  const mode = hostSceneMotion.mode;
  const matching = mode === "summary" && hostSprite.source === RESOURCE_CONFIG.host.celebration.src;
  if (!matching || hostSceneMotion.completed || getGameScreenMode() !== mode) return false;
  hostSceneMotion.completed = true;
  render();
  return true;
}

function resetHostSprite() {
  hostSprite.loadId += 1;
  simulationRuntime.clearTimeout(hostSprite.fallbackTimerId);
  hostSprite.fallbackTimerId = 0;
  simulationRuntime.cancelAnimationFrame(hostSprite.animationFrameId);
  stopHostSpriteAudio();
  hostSprite.source = "";
  hostSprite.frames = [];
  hostSprite.image = null;
  hostSprite.frameIndex = 0;
  hostSprite.elapsedMs = 0;
  hostSprite.totalDurationMs = 0;
  hostSprite.audio = null;
  hostSprite.loop = false;
  hostSprite.lastTimestamp = 0;
  hostSprite.animationFrameId = 0;
  hostSprite.loading = false;
  hostSprite.playing = false;
  hostSprite.completed = false;
  hostSprite.fallback = false;
  hostSprite.thinkingCycleId = 0;
}

const hostAudioCache = new Map();
const hostVoicePlayback = { speechId: 0, audio: null, mediaSource: null, objectUrl: "", abortController: null };

function recordClientRuntimeDiagnostic(type, detail = {}) {
  if (!clientRuntimeDiagnostic.enabled) return;
  const now = Date.now();
  if (now - clientRuntimeDiagnostic.startedAt >= 60000) {
    clientRuntimeDiagnostic.startedAt = now;
    clientRuntimeDiagnostic.count = 0;
  }
  if (++clientRuntimeDiagnostic.count > 180) return;
  clientRuntimeDiagnostic.sessionId ||= crypto.randomUUID();
  const ua = globalThis.navigator?.userAgent || "";
  const payload = { type, session_id: clientRuntimeDiagnostic.sessionId,
    speech_id: state.workflow.hostSpeech.id, screen_mode: getGameScreenMode(),
    sound_enabled: backgroundMusic.enabled, voice_configured: Boolean(state.health.hostVoiceConfigured),
    simulation_paused: simulationRuntime.paused,
    browser_engine: /Firefox\//.test(ua) ? "firefox" : /Chrome\/|Chromium\/|Edg\//.test(ua) ? "chromium" : /AppleWebKit\//.test(ua) ? "webkit" : "unknown",
    ...detail };
  void fetch("/api/client-diagnostic", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload), keepalive: true }).catch(() => {});
}

function installClientErrorDiagnostics() {
  const allowedNames = new Set(["Error", "TypeError", "ReferenceError", "SyntaxError", "RangeError", "URIError", "EvalError", "SecurityError", "AbortError"]);
  const allowedTags = new Set(["audio", "img", "link", "script", "source", "video"]);
  const errorName = value => allowedNames.has(value) ? value : "other";
  const sourceName = value => {
    try {
      const name = new URL(value, location.href).pathname.split("/").pop();
      return /^[\w.-]{1,100}$/.test(name) ? name : "";
    } catch { return ""; }
  };
  const report = (stage, detail) => {
    if (clientRuntimeDiagnostic.runtimeErrorCount >= 10) return;
    clientRuntimeDiagnostic.runtimeErrorCount++;
    recordClientRuntimeDiagnostic("client_error", { stage, ...detail });
  };

  window.addEventListener("error", event => {
    if (event.target && event.target !== window) {
      const elementType = event.target.tagName?.toLowerCase();
      if (allowedTags.has(elementType)) {
        const source = event.target.currentSrc || event.target.src || event.target.href || "";
        report("resource_error", { element_type: elementType, source: sourceName(source) });
      }
      return;
    }
    report("script_error", { error_name: errorName(event.error?.name), source: sourceName(event.filename || ""),
      line: event.lineno || 0, column: event.colno || 0 });
  }, true);
  window.addEventListener("unhandledrejection", event => {
    report("unhandled_rejection", { error_name: errorName(event.reason?.name) });
  });
}

function recordClientPageState(stage) {
  if (!clientRuntimeDiagnostic.enabled) return;
  const rect = els.appShell?.getBoundingClientRect();
  recordClientRuntimeDiagnostic("page_state", {
    stage, viewport_width: window.innerWidth, viewport_height: window.innerHeight,
    root_width: rect?.width || 0, root_height: rect?.height || 0,
    page_visible: document.visibilityState === "visible", page_focused: document.hasFocus(),
  });
}

function cancelHostVoiceSpeech() {
  if (hostVoicePlayback.abortController || hostVoicePlayback.audio) recordClientRuntimeDiagnostic("host_voice", { stage: "cancelled" });
  hostVoicePlayback.abortController?.abort();
  hostVoicePlayback.abortController = null;
  if (hostVoicePlayback.audio) {
    hostVoicePlayback.audio.pause();
    hostVoicePlayback.audio.removeAttribute("src");
    hostVoicePlayback.audio.load();
    hostVoicePlayback.audio.remove();
  }
  if (hostVoicePlayback.objectUrl) URL.revokeObjectURL(hostVoicePlayback.objectUrl);
  hostVoicePlayback.audio = null;
  hostVoicePlayback.mediaSource = null;
  hostVoicePlayback.objectUrl = "";
}

function setHostVoiceState(speechId, { pending, playing }) {
  const speech = state.workflow.hostSpeech;
  if (speech.id !== speechId) return;
  speech.voicePending = pending;
  speech.voicePlaying = playing;
  speech.voiceFinished = !pending && !playing;
  if (speech.source === "ready_welcome" && speech.voiceFinished) scheduleSoundOnboarding();
  refreshHostSpeechMedia();
}

function isSoundOnboardingDismissed() {
  try {
    return localStorage.getItem(SOUND_ONBOARDING_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function scheduleSoundOnboarding() {
  if (backgroundMusic.enabled || isSoundOnboardingDismissed() || getGameScreenMode() !== "ready"
    || soundOnboardingTimer || !els.soundOnboarding?.hidden) return;
  soundOnboardingTimer = window.setTimeout(() => {
    soundOnboardingTimer = 0;
    if (!backgroundMusic.enabled && !isSoundOnboardingDismissed() && getGameScreenMode() === "ready") {
      els.soundOnboarding.hidden = false;
    }
  }, 4000);
}

function hideSoundOnboarding() {
  if (soundOnboardingTimer) {
    window.clearTimeout(soundOnboardingTimer);
    soundOnboardingTimer = 0;
  }
  if (els.soundOnboarding) els.soundOnboarding.hidden = true;
}

function dismissSoundOnboarding() {
  if (soundOnboardingTimer) {
    window.clearTimeout(soundOnboardingTimer);
    soundOnboardingTimer = 0;
  }
  if (els.soundOnboarding) els.soundOnboarding.hidden = true;
  try {
    localStorage.setItem(SOUND_ONBOARDING_DISMISSED_KEY, "1");
  } catch {
    // Keep the button interaction responsive when storage is unavailable.
  }
}

function refreshHostSpeechMedia() {
  if (simulationRuntime.paused || !els.hostCanvas || !els.hostImage) return;
  const { mediaHostState } = getHostPresentation();
  renderHostMedia(getGameScreenMode(), mediaHostState);
  if (els.hostAvatar) els.hostAvatar.dataset.avatarState = mediaHostState;
}

async function startHostVoiceSpeech(speechId, text) {
  const speech = state.workflow.hostSpeech;
  if (speech.id !== speechId || speech.voiceRequested) return;
  if (!backgroundMusic.enabled) {
    speech.voiceRequested = true;
    recordClientRuntimeDiagnostic("host_voice", { stage: "skipped", reason: "muted" });
    return;
  }
  if (!state.health.hostVoiceConfigured) {
    if (clientRuntimeDiagnostic.lastVoiceSkip !== String(speechId)) {
      clientRuntimeDiagnostic.lastVoiceSkip = String(speechId);
      recordClientRuntimeDiagnostic("host_voice", { stage: "skipped", reason: "not_configured" });
    }
    return;
  }
  speech.voiceRequested = true;
  if (!text || Array.from(text).length > HOST_TTS_MAX_TEXT_CHARS) return;

  speech.voicePending = true;
  const controller = new AbortController();
  hostVoicePlayback.speechId = speechId;
  hostVoicePlayback.abortController = controller;
  const audioChunks = [];
  let audio = null;
  let mediaSource = null;
  let sourceBuffer = null;
  let usingMediaSource = Boolean(window.MediaSource?.isTypeSupported?.("audio/mpeg"));
  let started = false;
  let playbackPromise = null;
  let playbackError = null;
  let idleTimer = null;
  let timeoutReason = "";
  let voiceRequestId = "";
  const voiceStartedAt = Date.now();
  let lastAudioChunkAt = null;
  const voiceMetrics = { audio_chunk_count: 0, audio_bytes: 0, max_chunk_gap_ms: 0, waiting_count: 0, stalled_count: 0 };
  const noteAudioChunk = (bytes) => {
    const now = Date.now();
    if (lastAudioChunkAt !== null) voiceMetrics.max_chunk_gap_ms = Math.max(voiceMetrics.max_chunk_gap_ms, now - lastAudioChunkAt);
    lastAudioChunkAt = now;
    voiceMetrics.audio_chunk_count += 1;
    voiceMetrics.audio_bytes += bytes;
  };
  const logVoice = (stage, detail = {}) => recordClientRuntimeDiagnostic("host_voice", {
    stage, speech_id: speechId, request_id: voiceRequestId, elapsed_ms: Date.now() - voiceStartedAt,
    transport: usingMediaSource ? "mse" : "blob", ...voiceMetrics, ...detail });
  logVoice("requested");
  const refreshIdleTimer = (timeoutMs = 20_000) => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timeoutReason = voiceMetrics.audio_chunk_count ? "stream_idle_timeout" : "first_audio_timeout";
      controller.abort();
    }, timeoutMs);
  };
  const isCurrent = () => !controller.signal.aborted
    && backgroundMusic.enabled
    && hostVoicePlayback.speechId === speechId
    && state.workflow.hostSpeech.id === speechId;

  const readNetworkChunk = async (reader) => {
    refreshIdleTimer();
    try { return await reader.read(); }
    finally { clearTimeout(idleTimer); }
  };

  const waitForAudioEvent = (target, event) => new Promise((resolve, reject) => {
    let timer = null;
    const cleanup = () => {
      simulationRuntime.clearTimeout(timer);
      target.removeEventListener?.(event, complete);
      target.removeEventListener?.("error", fail);
      controller.signal.removeEventListener("abort", abort);
    };
    const complete = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error("tts_media_error")); };
    const abort = () => { cleanup(); reject(Object.assign(new Error("stale_voice_request"), { name: "AbortError" })); };
    if (controller.signal.aborted) return abort();
    target.addEventListener(event, complete, { once: true });
    target.addEventListener("error", fail, { once: true });
    controller.signal.addEventListener("abort", abort, { once: true });
    timer = simulationRuntime.setTimeout(() => { cleanup(); reject(new Error("tts_media_timeout")); }, 15_000);
  });

  const createAudio = () => {
    if (audio) return audio;
    audio = document.createElement("audio");
    audio.hidden = true;
    audio.preload = "auto";
    document.body.append(audio);
    hostVoicePlayback.audio = audio;
    for (const event of ["waiting", "stalled"]) {
      audio.addEventListener(event, () => {
        if (!isCurrent() || !started || simulationRuntime.paused) return;
        voiceMetrics[`${event}_count`] += 1;
        if (voiceMetrics.waiting_count + voiceMetrics.stalled_count > 3) return;
        let bufferedAhead = 0;
        for (let index = 0; index < (audio.buffered?.length || 0); index += 1) {
          if (audio.buffered.start(index) <= audio.currentTime && audio.currentTime <= audio.buffered.end(index)) {
            bufferedAhead = audio.buffered.end(index) - audio.currentTime;
            break;
          }
        }
        logVoice(event, { audio_ready_state: audio.readyState, audio_current_time_ms: audio.currentTime * 1000,
          buffered_ahead_ms: bufferedAhead * 1000 });
      });
    }
    audio.addEventListener("ended", () => {
      if (!isCurrent()) return;
      logVoice("ended");
      setHostVoiceState(speechId, { pending: false, playing: false });
      audio.remove();
    }, { once: true });
    audio.addEventListener("error", () => {
      if (isCurrent()) {
        logVoice("failed", { reason: "media_error", audio_error_code: audio.error?.code || 0, audio_ready_state: audio.readyState });
        setHostVoiceState(speechId, { pending: false, playing: false });
      }
    }, { once: true });
    return audio;
  };

  const playAudio = async () => {
    if (!isCurrent()) throw new Error("stale_voice_request");
    if (simulationRuntime.paused) {
      logVoice("waiting_resume");
      await new Promise((resolve, reject) => {
        const abort = () => reject(new Error("stale_voice_request"));
        controller.signal.addEventListener("abort", abort, { once: true });
        simulationRuntime.waitUntilRunning().then(() => {
          controller.signal.removeEventListener("abort", abort);
          resolve();
        });
      });
    }
    if (!isCurrent()) throw new Error("stale_voice_request");
    await audio.play();
    if (!isCurrent()) {
      audio.pause();
      throw new Error("stale_voice_request");
    }
    started = true;
    logVoice("playing", { audio_ready_state: audio.readyState });
    setHostVoiceState(speechId, { pending: false, playing: true });
  };

  // play() may need later audio chunks before resolving; never block stream reads on it.
  const beginStreamPlayback = (complete = false) => {
    if (playbackPromise) return;
    const buffered = sourceBuffer?.buffered || audio.buffered;
    if (!complete && buffered) {
      let ahead = 0;
      for (let index = 0; index < buffered.length; index += 1) {
        if (buffered.start(index) <= audio.currentTime && audio.currentTime <= buffered.end(index)) {
          ahead = buffered.end(index) - audio.currentTime;
          break;
        }
      }
      if (ahead < 0.8) return;
    }
    playbackPromise ||= playAudio().catch(error => {
      playbackError = error;
      controller.abort();
    });
  };

  try {
    refreshIdleTimer(20_000);
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    clearTimeout(idleTimer);
    voiceRequestId = response.headers.get("x-voice-request-id") || "";
    logVoice("response", { http_status: response.status });
    if (!response.ok || !response.body) throw new Error(`tts_http_${response.status}`);

    if (response.headers.get("content-type")?.startsWith("audio/")) {
      if (usingMediaSource) {
        mediaSource = new MediaSource();
        const player = createAudio();
        hostVoicePlayback.mediaSource = mediaSource;
        hostVoicePlayback.objectUrl = URL.createObjectURL(mediaSource);
        player.src = hostVoicePlayback.objectUrl;
        await waitForAudioEvent(mediaSource, "sourceopen");
        if (!isCurrent()) return;
        sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
        const reader = response.body.getReader();
        while (true) {
          const { value, done } = await readNetworkChunk(reader);
          if (done || !isCurrent()) break;
          noteAudioChunk(value.byteLength);
          if (sourceBuffer.updating) await waitForAudioEvent(sourceBuffer, "updateend");
          sourceBuffer.appendBuffer(value);
          await waitForAudioEvent(sourceBuffer, "updateend");
          beginStreamPlayback();
        }
        clearTimeout(idleTimer);
        if (playbackError) throw playbackError;
        if (!isCurrent()) return;
        if (!voiceMetrics.audio_chunk_count) throw new Error("tts_audio_missing");
        beginStreamPlayback(true);
        if (mediaSource.readyState === "open") mediaSource.endOfStream();
        await playbackPromise;
        if (playbackError) throw playbackError;
      } else {
        let blob;
        if (response.body.getReader) {
          const chunks = [];
          const reader = response.body.getReader();
          while (true) {
            const { value, done } = await readNetworkChunk(reader);
            if (done || !isCurrent()) break;
            noteAudioChunk(value.byteLength);
            chunks.push(value);
          }
          if (!isCurrent()) return;
          blob = new Blob(chunks, { type: "audio/mpeg" });
        } else {
          blob = await response.blob();
          noteAudioChunk(blob.size);
        }
        if (!blob.size) throw new Error("tts_audio_missing");
        const player = createAudio();
        hostVoicePlayback.objectUrl = URL.createObjectURL(blob);
        player.src = hostVoicePlayback.objectUrl;
        clearTimeout(idleTimer);
        await playAudio();
      }
      return;
    }

    if (usingMediaSource) {
      mediaSource = new MediaSource();
      const player = createAudio();
      hostVoicePlayback.mediaSource = mediaSource;
      hostVoicePlayback.objectUrl = URL.createObjectURL(mediaSource);
      player.src = hostVoicePlayback.objectUrl;
      await waitForAudioEvent(mediaSource, "sourceopen");
      if (!isCurrent()) return;
      sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
    }

    const appendAudio = async (encoded) => {
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      noteAudioChunk(bytes.byteLength);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      if (!sourceBuffer) {
        audioChunks.push(bytes);
        return;
      }
      if (sourceBuffer.updating) await waitForAudioEvent(sourceBuffer, "updateend");
      if (!isCurrent()) return;
      sourceBuffer.appendBuffer(bytes);
      await waitForAudioEvent(sourceBuffer, "updateend");
      beginStreamPlayback();
    };

    const decoder = new TextDecoder();
    let pendingText = "";
    const consumeBlock = async (block) => {
      const data = block.split("\n").filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trim()).join("\n");
      if (!data || data === "[DONE]") return;
      let event;
      try { event = JSON.parse(data); } catch { return; }
      const encoded = event?.output?.audio?.data;
      if (typeof encoded === "string" && encoded) {
        await appendAudio(encoded);
      }
    };

    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await readNetworkChunk(reader);
      if (done || !isCurrent()) break;
      pendingText += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      const blocks = pendingText.split("\n\n");
      pendingText = blocks.pop() || "";
      for (const block of blocks) await consumeBlock(block);
    }
    pendingText += decoder.decode();
    if (pendingText.trim()) await consumeBlock(pendingText);

    if (playbackError) throw playbackError;
    if (!isCurrent()) return;
    clearTimeout(idleTimer);
    if (sourceBuffer) {
      if (!voiceMetrics.audio_chunk_count) throw new Error("tts_audio_missing");
      beginStreamPlayback(true);
      if (mediaSource.readyState === "open") mediaSource.endOfStream();
      await playbackPromise;
      if (playbackError) throw playbackError;
    } else if (audioChunks.length) {
      const player = createAudio();
      const blob = new Blob(audioChunks, { type: "audio/mpeg" });
      hostVoicePlayback.objectUrl = URL.createObjectURL(blob);
      player.src = hostVoicePlayback.objectUrl;
      await playAudio();
    } else {
      throw new Error("tts_audio_missing");
    }
  } catch (error) {
    error = playbackError || error;
    clearTimeout(idleTimer);
    logVoice("failed", { reason: timeoutReason || (error.name === "NotAllowedError" ? "browser_blocked" : error.name === "AbortError" || error.message === "stale_voice_request" ? "timeout_or_cancel"
      : /^tts_http_/.test(error.message) ? "http_error" : error.message === "tts_audio_missing" ? "audio_missing"
      : error.message === "tts_media_timeout" ? "media_timeout" : "playback_error"),
      audio_error_code: audio?.error?.code || 0, audio_ready_state: audio?.readyState || 0 });
    if (hostVoicePlayback.speechId === speechId && state.workflow.hostSpeech.id === speechId) {
      setHostVoiceState(speechId, { pending: false, playing: false });
      cancelHostVoiceSpeech();
      if (error.name !== "AbortError" && error.message !== "stale_voice_request") {
        console.warn("Host voice playback unavailable; keeping the text bubble.");
      }
    }
  } finally {
    clearTimeout(idleTimer);
    if (hostVoicePlayback.abortController === controller) hostVoicePlayback.abortController = null;
  }
}

async function playHostSpriteAudio(audioMeta) {
  const loadId = hostSprite.loadId;
  const generation = hostSprite.audioGeneration;
  const isCurrent = () => backgroundMusic.enabled && loadId === hostSprite.loadId && generation === hostSprite.audioGeneration;
  if (!isCurrent()) return false;
  if (simulationRuntime.paused) await simulationRuntime.waitUntilRunning();
  if (!audioMeta?.src || !isCurrent()) return false;
  const context = prepareAudioContext();
  if (!context) return playHostSpriteAudioElement(audioMeta);
  if (context.state === "suspended") {
    await context.resume().catch(() => {});
    if (simulationRuntime.paused) await simulationRuntime.waitUntilRunning();
  }
  if (!isCurrent()) return false;
  if (context.state !== "running") return playHostSpriteAudioElement(audioMeta);

  try {
    const sourceUrl = new URL(audioMeta.src, document.baseURI).href;
    let bufferPromise = hostAudioCache.get(sourceUrl);
    if (!bufferPromise) {
      bufferPromise = fetch(sourceUrl, { cache: "force-cache" })
        .then((response) => {
          if (!response.ok) throw new Error(`Audio request failed: ${response.status}`);
          return response.arrayBuffer();
        })
        .then((arrayBuffer) => context.decodeAudioData(arrayBuffer));
      hostAudioCache.set(sourceUrl, bufferPromise);
    }

    const buffer = await bufferPromise;
    if (simulationRuntime.paused) await simulationRuntime.waitUntilRunning();
    if (!isCurrent() || hostSprite.completed) return false;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const trimStartSeconds = Math.max(0, Number(audioMeta.trimStartMs) || 0) / 1000;
    const delaySeconds = Math.max(0, Number(audioMeta.delayMs) || 0) / 1000;
    const volume = Math.min(1, Math.max(0, Number(audioMeta.volume) || 0.85));
    const startAt = context.currentTime + delaySeconds;
    const availableDuration = Math.max(0, buffer.duration - trimStartSeconds);

    source.buffer = buffer;
    gain.gain.setValueAtTime(volume, startAt);
    source.connect(gain);
    gain.connect(context.destination);
    source.start(startAt, trimStartSeconds, availableDuration || undefined);
    source.addEventListener("ended", () => {
      if (hostSprite.audioSource !== source) return;
      hostSprite.audioSource = null;
      hostSprite.audioGain = null;
      source.disconnect();
      gain.disconnect();
    }, { once: true });
    hostSprite.audioSource = source;
    hostSprite.audioGain = gain;
    return true;
  } catch (error) {
    if (!isCurrent()) return false;
    hostAudioCache.delete(new URL(audioMeta.src, document.baseURI).href);
    console.warn("Host sprite audio could not use Web Audio; using media fallback.", error);
    return playHostSpriteAudioElement(audioMeta);
  }
}

function playHostSpriteAudioElement(audioMeta) {
  if (!backgroundMusic.enabled) return false;
  const loadId = hostSprite.loadId;
  const audio = new Audio(new URL(audioMeta.src, document.baseURI).href);
  audio.preload = "auto";
  audio.volume = Math.min(1, Math.max(0, Number(audioMeta.volume) || 0.85));
  hostSprite.audioElement?.pause();
  hostSprite.audioElement = audio;
  const start = () => {
    hostSprite.audioTimerId = 0;
    if (!backgroundMusic.enabled || loadId !== hostSprite.loadId || hostSprite.audioElement !== audio) return;
    audio.currentTime = Math.max(0, Number(audioMeta.trimStartMs) || 0) / 1000;
    audio.play().catch(() => {});
  };
  hostSprite.audioTimerId = simulationRuntime.setTimeout(start, Math.max(0, Number(audioMeta.delayMs) || 0));
  audio.addEventListener("ended", () => {
    if (hostSprite.audioElement === audio) hostSprite.audioElement = null;
  }, { once: true });
  return true;
}

function stopHostSpriteAudio() {
  hostSprite.audioGeneration += 1;
  simulationRuntime.clearTimeout(hostSprite.audioTimerId);
  hostSprite.audioTimerId = 0;
  if (hostSprite.audioSource) {
    try {
      hostSprite.audioSource.stop();
    } catch {}
    hostSprite.audioSource.disconnect();
    hostSprite.audioGain?.disconnect();
    hostSprite.audioSource = null;
    hostSprite.audioGain = null;
  }
  hostSprite.audioElement?.pause();
  hostSprite.audioElement = null;
}

function resolveHostMedia(screenMode, avatarState) {
  if (screenMode === "ready") return RESOURCE_CONFIG.host.greeting;
  if (screenMode === "summary" && !hostSceneMotion.completed) return RESOURCE_CONFIG.host.celebration;
  const stateKey = normalizeHostAvatarState(avatarState);
  return RESOURCE_CONFIG.host[stateKey] || RESOURCE_CONFIG.host.normal;
}

function startQuestionClock() {
  clearQuestionClock();
  questionClock.active = true;
  questionClock.expired = false;
  questionClock.startedAt = simulationRuntime.now();
  questionClock.roundIndex = state.game.roundIndex;
  state.workflow.participation = {
    roundId: getDifyRoundScopeKey(), revision: 0, lastUserElapsedMs: 0, lastDialogueElapsedMs: 0,
    userTurnCount: 0, analysisRequested: false, invitationDeclined: false,
  };
  questionClock.intervalId = simulationRuntime.setInterval(tickQuestionClock, QUESTION_TIMER_TICK_MS);
  renderQuestionClock(0);
}

function clearQuestionClock() {
  if (questionClock.intervalId) simulationRuntime.clearInterval(questionClock.intervalId);
  if (questionClock.urgentSoundTimer) simulationRuntime.clearTimeout(questionClock.urgentSoundTimer);
  questionClock.intervalId = 0;
  questionClock.urgentSoundTimer = 0;
  questionClock.startedAt = 0;
  questionClock.pausedAt = 0;
  questionClock.pausedDurationMs = 0;
  questionClock.roundIndex = 0;
  questionClock.active = false;
  questionClock.expired = false;
  questionClock.lastUrgentSecond = null;
  clearQuestionIntro();
  if (els.gameScreen) els.gameScreen.classList.remove("is-time-critical");
  if (els.questionTimer) els.questionTimer.hidden = true;
  if (els.questionTimer) els.questionTimer.classList.remove("is-urgent", "is-paused");
  if (els.answerLengthHint) els.answerLengthHint.hidden = true;
}

function startQuestionIntro() {
  clearQuestionIntro();
  questionIntro.roundIndex = state.game.roundIndex;
  questionIntro.active = true;
  playQuestionIntroSound();
  questionIntro.timerId = simulationRuntime.setTimeout(() => {
    questionIntro.timerId = 0;
    if (questionIntro.roundIndex !== state.game.roundIndex) return;
    questionIntro.active = false;
    render();
  }, QUESTION_INTRO_DURATION_MS);
  render();
  queueEnvironmentRoundIntro();
}

function clearQuestionIntro() {
  if (questionIntro.timerId) simulationRuntime.clearTimeout(questionIntro.timerId);
  questionIntro.timerId = 0;
  questionIntro.roundIndex = 0;
  questionIntro.active = false;
}

function isQuestionIntroVisible() {
  return questionIntro.active
    && questionIntro.roundIndex === state.game.roundIndex
    && !state.ui.showAnswer
    && !["victory", "summary"].includes(state.game.status);
}

function pauseQuestionClock() {
  if (!questionClock.active || questionClock.pausedAt) return;
  questionClock.pausedAt = simulationRuntime.now();
  if (questionClock.urgentSoundTimer) {
    simulationRuntime.clearTimeout(questionClock.urgentSoundTimer);
    questionClock.urgentSoundTimer = 0;
  }
  questionClock.lastUrgentSecond = null;
  renderQuestionClock(getQuestionElapsedMs(questionClock.pausedAt));
}

function resumeQuestionClock() {
  if (!questionClock.active || !questionClock.pausedAt) return;
  const resumedAt = simulationRuntime.now();
  questionClock.pausedDurationMs += resumedAt - questionClock.pausedAt;
  questionClock.pausedAt = 0;
  renderQuestionClock(getQuestionElapsedMs(resumedAt));
}

function getQuestionElapsedMs(now = simulationRuntime.now()) {
  if (!questionClock.active) return 0;
  const endAt = questionClock.pausedAt || now;
  return Math.max(0, endAt - questionClock.startedAt - questionClock.pausedDurationMs);
}

function tickQuestionClock() {
  if (!questionClock.active) return;
  if (questionClock.roundIndex !== state.game.roundIndex) {
    clearQuestionClock();
    return;
  }
  if (state.timeline.status === "paused" || state.game.status === "paused") {
    pauseQuestionClock();
    return;
  }
  if (questionClock.pausedAt) resumeQuestionClock();

  const elapsedMs = getQuestionElapsedMs();
  renderQuestionClock(elapsedMs);
  if (elapsedMs >= QUESTION_DURATION_MS) {
    questionClock.expired = true;
    resolveExpiredQuestion();
  } else {
    maybeAnalyzeRealUserParticipation();
  }
}

function renderQuestionClock(elapsedMs = getQuestionElapsedMs()) {
  if (!els.questionTimer || !els.questionTimerProgress) return;
  const isVisible = questionClock.active && !["victory", "summary"].includes(state.game.status);
  els.questionTimer.hidden = !isVisible || isQuestionIntroVisible();
  if (!isVisible) {
    els.answerLengthHint.hidden = true;
    els.gameScreen.classList.remove("is-time-critical");
    return;
  }

  const remainingMs = Math.max(0, QUESTION_DURATION_MS - elapsedMs);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const remainingRatio = remainingMs / QUESTION_DURATION_MS;
  const isUrgent = remainingSeconds <= 10;
  if (isUrgent && remainingSeconds > 0 && !questionClock.pausedAt) {
    if (questionClock.lastUrgentSecond !== remainingSeconds) {
      questionClock.lastUrgentSecond = remainingSeconds;
      if (questionClock.urgentSoundTimer) {
        simulationRuntime.clearTimeout(questionClock.urgentSoundTimer);
      }
      const soundRoundIndex = questionClock.roundIndex;
      questionClock.urgentSoundTimer = simulationRuntime.setTimeout(() => {
        questionClock.urgentSoundTimer = 0;
        if (
          !questionClock.active
          || questionClock.pausedAt
          || questionClock.roundIndex !== soundRoundIndex
          || state.game.status === "summary"
        ) return;
        playQuestionCountdownSound();
      }, 500);
    }
  } else if (!isUrgent) {
    questionClock.lastUrgentSecond = null;
  }
  const answer = String(getCurrentRiddle()?.answer || "").replace(/\s/g, "");
  renderQuestionTimerRing(remainingRatio, Boolean(questionClock.pausedAt), isUrgent);
  els.questionTimer.classList.toggle("is-urgent", isUrgent);
  els.questionTimer.classList.toggle("is-paused", Boolean(questionClock.pausedAt));
  els.gameScreen.classList.toggle("is-time-critical", isUrgent && !questionClock.pausedAt);
  els.questionTimer.setAttribute("aria-label", `本题剩余${remainingSeconds}秒`);
  els.answerLengthHint.textContent = `${Array.from(answer).length}个字`;
  els.answerLengthHint.hidden = elapsedMs < ANSWER_LENGTH_HINT_DELAY_MS || state.ui.showAnswer;
}

function jumpToQuestionSeconds(seconds = 10) {
  if (!questionClock.active) {
    console.warn("请先开始游戏，再执行 jumpToQuestionSeconds(10)。");
    return;
  }

  const remainingSeconds = Math.max(1, Math.min(QUESTION_DURATION_MS / 1000, Number(seconds) || 10));
  questionClock.startedAt = simulationRuntime.now()
    - (QUESTION_DURATION_MS - remainingSeconds * 1000)
    - questionClock.pausedDurationMs;
  questionClock.pausedAt = 0;
  questionClock.expired = false;
  questionClock.lastUrgentSecond = null;
  renderQuestionClock(getQuestionElapsedMs());
  render();
}

window.jumpToQuestionSeconds = jumpToQuestionSeconds;

function renderQuestionTimerRing(remainingRatio, paused, urgent) {
  const canvas = els.questionTimerProgress;
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const size = Math.ceil(QUESTION_TIMER_SIZE_PX * pixelRatio);
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  const context = canvas.getContext("2d");
  context.setTransform(
    size / QUESTION_TIMER_SIZE_PX,
    0,
    0,
    size / QUESTION_TIMER_SIZE_PX,
    0,
    0,
  );
  context.clearRect(0, 0, QUESTION_TIMER_SIZE_PX, QUESTION_TIMER_SIZE_PX);
  context.lineWidth = QUESTION_TIMER_STROKE_PX;
  context.lineCap = "round";
  context.strokeStyle = "rgba(102, 64, 156, 0.22)";
  context.beginPath();
  context.arc(
    QUESTION_TIMER_SIZE_PX / 2,
    QUESTION_TIMER_SIZE_PX / 2,
    QUESTION_TIMER_RADIUS_PX,
    0,
    Math.PI * 2,
  );
  context.stroke();

  const remaining = Math.max(0, Math.min(1, remainingRatio));
  if (remaining === 0) return;
  // The erased edge advances clockwise from 12 o'clock; the far end stays at 12.
  const startAngle = -Math.PI / 2 + (1 - remaining) * Math.PI * 2;
  context.strokeStyle = urgent ? "#cf3345" : paused ? "#8993a4" : "#66409c";
  context.beginPath();
  context.arc(
    QUESTION_TIMER_SIZE_PX / 2,
    QUESTION_TIMER_SIZE_PX / 2,
    QUESTION_TIMER_RADIUS_PX,
    startAngle,
    Math.PI * 1.5,
    false,
  );
  context.stroke();
}

function renderRemainingQuestions() {
  const nextValue = String(Math.max(0, state.game.maxQuestions - state.game.questionCount));
  if (els.remainingQuestions.textContent === nextValue) return;

  els.remainingQuestions.textContent = nextValue;
  els.remainingQuestions.classList.remove("count-roll");
  void els.remainingQuestions.offsetWidth;
  els.remainingQuestions.classList.add("count-roll");
}

function handleQuestionTimeout(completedRound) {
  if (
    !questionClock.active
    || questionClock.roundIndex !== completedRound
    || state.game.roundIndex !== completedRound
    || ["victory", "summary", "paused"].includes(state.game.status)
  ) return;
  clearQuestionClock();
  invalidateAsyncHostResults({ preserveSituationEvents: true });
  clearNextRoundTimer();
  state.workflow.pendingChats = [];
  state.game.status = "failed";
  recordRoundOutcome();
  state.ui.showAnswer = true;
  state.ui.correctSeat = null;
  state.ui.correctLightSeat = null;
  state.ui.cabinMode = "reveal";
  state.ui.animation = "reveal";
  clearConfetti();
  state.host.emotion = "normal";
  state.host.targetSeat = null;
  setHostAvatarState(HOST_AVATAR_DEFAULT_STATE, { transient: false });
  publishHostLine(
    `时间到啦，这题没有人答对，答案是“${getCurrentRiddle().answer}”。`,
    { priority: "P0", source: "question_timeout", durationMs: HOST_SPEECH_P0_LOCK_MS },
  );
  state.ui.alert = "本题无人答对，公布谜底";
  playNoWinnerRevealSound(500);
  finishTimelineSilently();
  render();
  state.workflow.nextRoundTimer = simulationRuntime.setTimeout(
    () => advanceAfterTimeout(completedRound),
    NEXT_ROUND_DELAY_MS,
  );
  notifyP0Situation("round_timeout");
}

function resolveExpiredQuestion() {
  if (!questionClock.active || !questionClock.expired) return;
  if (getQuestionElapsedMs() < QUESTION_DURATION_MS) return;
  handleQuestionTimeout(questionClock.roundIndex);
}

function advanceAfterTimeout(completedRound) {
  state.workflow.nextRoundTimer = null;
  if (state.game.status !== "failed" || state.game.roundIndex !== completedRound) return;
  if (state.workflow.hostSpeech.voicePending || state.workflow.hostSpeech.voicePlaying) {
    logRoundAdvanceDiagnostic("round_advance_wait", completedRound, ["host_voice_active"]);
    state.workflow.nextRoundTimer = simulationRuntime.setTimeout(
      () => advanceAfterTimeout(completedRound), PAUSED_ROUND_POLL_MS,
    );
    return;
  }
  if (completedRound >= state.game.totalRounds) {
    finishGameSeries();
    render();
    return;
  }

  const nextPreparation = refreshFollowingRoundPreparation();
  if (!nextPreparation) {
    finishGameSeries();
    render();
    return;
  }
  state.game.roundIndex = completedRound + 1;
  state.game.currentRiddleIndex = nextPreparation.riddleIndex;
  persistDifyRoundScope();
  state.game.questionCount = 0;
  state.game.roundQuestionPlan = null;
  state.game.usedRoundQuestionStepIds = [];
  state.game.coveredFactKeys = [];
  state.game.publicClues = [];
  state.game.status = "idle";
  state.ui.cabinMode = "normal";
  state.ui.showAnswer = false;
  state.ui.correctSeat = null;
  state.ui.correctLightSeat = null;
  state.ui.animation = "idle";
  state.passengers.selectedSeat = "front";
  clearPassengerActivities();
  clearPassengerBubbles();
  clearCorrectLightTimer();
  setHostAvatarState(HOST_AVATAR_DEFAULT_STATE);
  state.host.targetSeat = null;
  state.host.emotion = "normal";
  clearHostSpeechLock();
  state.host.text = "";
  state.ui.alert = `时间到，进入第 ${state.game.roundIndex} 题`;
  updateDecisionTrace({
    perception: `第 ${completedRound} 题时间结束，未猜中答案`,
    decision: "结束当前题目，保留整局进度并自动继续",
    execution: `切换第 ${state.game.roundIndex} 题并重新开场`,
    strategyId: "S06",
    priority: "P3",
  });
  render();
  void startRoundGoldenTimeline();
}

function getScreenProgressValue() {
  if (state.game.status === "summary") return state.game.totalRounds;
  if (state.game.status === "victory") {
    return Math.max(1, Math.min(state.game.totalRounds, state.game.roundIndex));
  }
  return Math.max(1, Math.min(state.game.totalRounds, state.game.roundIndex));
}

function renderGameProgress() {
  const total = Math.max(1, Number(state.game.totalRounds) || GAME_ROUND_COUNT);
  const current = Math.max(1, Math.min(total, getScreenProgressValue()));
  const currentIndex = current - 1;

  els.roundProgress.textContent = `${current}/${total}`;
  els.questionProgress.textContent = `${current} / ${total}`;
  els.pencilProgressRail.style.width = `${PROGRESS_RAIL_EDGE_PX * 2 + (total - 1) * PROGRESS_DOT_STEP_PX}px`;
  els.pencilRailFill.style.width = `${PROGRESS_RAIL_EDGE_PX + currentIndex * PROGRESS_DOT_STEP_PX}px`;

  els.pencilProgressDots.replaceChildren(
    ...Array.from({ length: total }, (_, index) => {
      const dot = document.createElement("i");
      dot.className = "dot";
      dot.style.left = `${PROGRESS_RAIL_EDGE_PX + index * PROGRESS_DOT_STEP_PX}px`;
      if (index < currentIndex) dot.classList.add("dot-complete");
      if (index === currentIndex) dot.classList.add("dot-current");
      return dot;
    }),
  );
}

function getSummaryStatsText() {
  return `完成 ${state.game.totalRounds} 题     破解 ${getSummarySolvedCount()} 题`;
}

function getSummarySolvedCount() {
  return getPerformanceSnapshot().team_correct;
}

function getSummaryMvpSeat() {
  const counts = getPerformanceSnapshot().per_seat_correct;
  if (!Object.values(counts).some(Boolean)) return "front";
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "front";
}

function makeSummaryHostText() {
  return "本次案件调查圆满收官。全车智商在线，下次上车我们继续开局！";
}

function formatDecisionText(text) {
  const lines = String(text || "").split(/[；;\n]/).map((line) => line.trim()).filter(Boolean);
  return lines.join("\n");
}

function setHostBubbleText(text) {
  let textElement = els.hostBubble.querySelector(".host-bubble-text");
  if (!textElement) {
    textElement = document.createElement("span");
    textElement.className = "host-bubble-text";
    els.hostBubble.textContent = "";
    els.hostBubble.append(textElement);
  }
  textElement.textContent = text;
  return textElement;
}

function scheduleAdaptiveTextFit(element, text, options) {
  simulationRuntime.requestAnimationFrame(() => {
    if (!element.isConnected || element.textContent !== text) return;
    fitAdaptiveText(element, options);
  });
}

function fitAdaptiveText(element, { fontSize, minFontSize, lineHeight, maxLines = Infinity }) {
  const style = getComputedStyle(element);
  const paddingY = (Number.parseFloat(style.paddingTop) || 0)
    + (Number.parseFloat(style.paddingBottom) || 0);
  const availableHeight = Math.max(0, element.clientHeight - paddingY);
  const fits = () => {
    const currentStyle = getComputedStyle(element);
    const currentLineHeight = Number.parseFloat(currentStyle.lineHeight) || fontSize;
    const contentHeight = Math.max(0, element.scrollHeight - paddingY);
    return element.scrollWidth <= element.clientWidth + 1
      && contentHeight <= availableHeight + 1
      && Math.ceil(contentHeight / currentLineHeight) <= maxLines;
  };

  for (let size = fontSize; size >= minFontSize; size -= 0.5) {
    element.style.fontSize = `${size}px`;
    element.style.lineHeight = `${lineHeight * size / fontSize}px`;
    if (fits()) return;
  }

  element.style.fontSize = `${minFontSize}px`;
  const minLineHeight = lineHeight * minFontSize / fontSize;
  if (Number.isFinite(maxLines) && availableHeight > 0) {
    element.style.lineHeight = `${Math.min(minLineHeight, availableHeight / maxLines)}px`;
  } else {
    element.style.lineHeight = `${minLineHeight}px`;
  }
}

function fitBubbleHeight(container, textElement, {
  maxHeight,
  minHeight,
  paddingY,
  anchorLines,
  anchorLineHeight,
}) {
  const range = document.createRange();
  range.selectNodeContents(textElement);
  const lineTops = [...range.getClientRects()]
    .map((rect) => Math.round(rect.top))
    .filter((top, index, tops) => tops.indexOf(top) === index);
  const lineHeight = Number.parseFloat(getComputedStyle(textElement).lineHeight) || 0;
  const contentHeight = lineTops.length * lineHeight;
  const height = Math.min(maxHeight, Math.max(minHeight, contentHeight + paddingY));
  container.style.height = `${height}px`;
  if (anchorLines && anchorLineHeight) {
    const baseTop = Number.parseFloat(container.dataset.baseTop || getComputedStyle(container).top);
    if (Number.isFinite(baseTop)) {
      const anchorHeight = Math.min(maxHeight, Math.max(minHeight, anchorLines * anchorLineHeight + paddingY));
      container.style.top = `${baseTop + anchorHeight - height - 10}px`;
    }
  }
}

function renderSeats() {
  els.seats.forEach((seatButton) => {
    const seat = seatButton.dataset.seat;
    const seatState = state.passengers.seats[seat];
    const bubble = seatButton.querySelector("[data-bubble]");
    const avatar = seatButton.querySelector("[data-avatar]");
    const status = seatButton.querySelector("[data-seat-status]");
    const effectiveActivity =
      state.game.status === "victory" || seatState.activity !== "celebrating"
        ? seatState.activity
        : "idle";

    const isCorrectLightActive = state.ui.correctLightSeat === seat;
    seatButton.classList.toggle("correct", isCorrectLightActive);
    seatButton.classList.toggle("ambient-on", isCorrectLightActive);
    seatButton.classList.toggle("sleeping", seatState.mood === "睡着");
    seatButton.classList.toggle("seat-laughing", seatState.mood === "大笑");
    Object.keys(PASSENGER_ACTIVITY_LABELS).forEach((activity) => {
      seatButton.classList.toggle(`activity-${activity}`, effectiveActivity === activity);
    });

    bubble.textContent = seatState.bubble;
    bubble.classList.toggle("visible", Boolean(seatState.bubble));
    if (seatState.bubble) {
      bubble.style.height = "104px";
      simulationRuntime.requestAnimationFrame(() => {
        if (!bubble.isConnected || bubble.textContent !== seatState.bubble) return;
        fitAdaptiveText(bubble, { fontSize: 20, minFontSize: 18, lineHeight: 26 });
        fitBubbleHeight(bubble, bubble, { maxHeight: 104, minHeight: 58, paddingY: 32 });
      });
    } else {
      bubble.style.removeProperty("height");
      bubble.style.removeProperty("font-size");
      bubble.style.removeProperty("line-height");
    }
    status.textContent =
      (effectiveActivity !== "idle" ? seatState.activityLabel : "")
      || PASSENGER_ACTIVITY_LABELS[effectiveActivity]
      || seatState.mood;

    avatar.className = "passenger-figure";
    avatar.dataset.mood = seatState.mood;
    avatar.dataset.activity = effectiveActivity || "idle";
    avatar.src = resolvePassengerAsset(seat, seatState, effectiveActivity);
  });
  els.sleepShades.forEach((shade) => {
    shade.hidden = state.ui.zoneLights[shade.dataset.sleepShade] !== false;
  });
  els.comfortZones.forEach((zone) => {
    zone.hidden = !state.ui.sleepComfortSeats.includes(zone.dataset.comfortZone);
  });
}

function resolvePassengerAsset(seat, seatState, activity) {
  const relationshipSeats =
    RESOURCE_CONFIG.relationshipSeats[state.passengers.relationship]
    || RESOURCE_CONFIG.relationshipSeats["父母+小孩"];
  const scenarioSeats = getActiveGoldenLine().personas || {};
  const personaKey = scenarioSeats[getPersonaSeatKey(seat)] || relationshipSeats[seat] || "maleYoung";
  const personaAssets = RESOURCE_CONFIG.passengers[personaKey] || RESOURCE_CONFIG.passengers.maleYoung;
  const stateKey = activity === "celebrating" || seatState.mood === "大笑"
    ? "laugh"
    : seatState.mood === "睡着"
      ? "sleep"
      : seatState.mood === "疲惫"
        ? "tired"
        : "normal";
  return personaAssets[stateKey] || personaAssets.normal;
}

function renderControls() {
  setActive(els.speedChips, "speed", String(state.car.speed));
  setActive(els.environmentChips, "environment", state.car.environment);

  const isTimelinePaused = state.timeline.status === "paused";
  const hasStarted = state.timeline.status !== "idle" || state.game.status !== "idle";
  const loading = startupLoading.active;
  for (const region of document.querySelectorAll(".control-region, .cabin-region")) region.inert = loading;

  els.inactivePauseOverlay.hidden = !simulationFreeze.autoPaused;
  document.body.classList.toggle("has-started", hasStarted);
  document.body.classList.toggle("timeline-paused", isTimelinePaused);
  document.body.classList.toggle("game-paused", state.game.status === "paused");
  els.prestartPanel.classList.toggle("hidden", hasStarted);
  els.startTimeline.disabled = hasStarted || loading;
  els.switchScenario.disabled = hasStarted || loading;
  els.resetScenario.disabled = !hasStarted || (simulationRuntime.paused && simulationFreeze.autoPaused);
  els.pauseTimeline.disabled = !hasStarted;
  els.pauseTimeline.textContent = isTimelinePaused ? "继续模拟" : "暂停模拟";
  els.pauseTimeline.classList.toggle("is-paused", isTimelinePaused);
  els.pauseTimeline.setAttribute("aria-pressed", isTimelinePaused ? "true" : "false");
  els.sendQuestion.disabled = isTimelinePaused;
  els.playerInput.disabled = isTimelinePaused;

  els.eventButtons.forEach((button) => {
    button.disabled = simulationRuntime.paused || manualEventCooldowns.has(button);
  });
  for (const button of [els.backgroundMusicToggle, els.backgroundMusicToggleGame, els.summaryContinue, els.readyStartButton, ...els.seats]) {
    if (button) button.disabled = simulationRuntime.paused;
  }

  [els.speedChips, els.environmentChips].forEach((buttons) => {
    buttons.forEach((button) => {
      button.disabled = simulationRuntime.paused;
    });
  });
}

function setActive(buttons, key, value) {
  buttons.forEach((button) => {
    button.classList.toggle("active", button.dataset[key] === value);
  });
}

function getStageLabel() {
  if (state.ui.showAnswer || state.game.status === "victory") return "公布答案";
  if (state.game.status === "idle") return "准备开局";
  return "提示";
}

function getRiddleTitle(riddle) {
  if (state.ui.showAnswer) return riddle.answer;
  if (isQuestionIntroVisible()) return `第 ${state.game.roundIndex} 题`;
  if (state.game.status === "idle") return "游戏待开始";
  return riddle.hint;
}

function getRiddleSupportText(riddle) {
  if (state.game.status === "idle" && !state.ui.showAnswer) return "";
  if (state.ui.showAnswer) return `主题：${riddle.theme}`;
  return "剩余时间提示";
}

function getCabinModeText() {
  const modeText = {
    player_pause: "玩家暂停中",
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

installClientErrorDiagnostics();
boot();
