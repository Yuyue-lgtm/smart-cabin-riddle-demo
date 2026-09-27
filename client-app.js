const SEATS = {
  driver: "主驾",
  front: "副驾",
  rearLeft: "左后",
  rearRight: "右后",
};

const DEFAULT_WORKFLOW_ENDPOINT = "/api/workflow";
const WORKFLOW_CLIENT_TIMEOUT_MS = 25000;
const MIN_BUBBLE_DISPLAY_MS = 3000;
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
const ANSWER_LENGTH_HINT_DELAY_MS = 10_000;
const QUESTION_INTRO_DURATION_MS = 3_000;
const QUESTION_TIMER_TICK_MS = 100;
const QUESTION_TIMER_SIZE_PX = 46;
const QUESTION_TIMER_RADIUS_PX = 19;
const QUESTION_TIMER_STROKE_PX = 8;
const SCREEN_ENVIRONMENT_DELAY_MS = 2000;
const ENVIRONMENT_ANNOUNCEMENT_MS = 3000;
const IMPORTANT_EVENT_DISPLAY_MS = 5000;
const IMPORTANT_EVENT_EXIT_MS = 320;
const PREPARED_REPLY_DELAY_MS = 3000;
const ROUND_PLAN_EXTRA_STEPS = 2;
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
const HOST_SPEECH_PRIORITIES = Object.freeze({
  P0: 5,
  P1: 4,
  P2: 3,
  P3: 2,
  P4: 1,
});
const HOST_SPEECH_DEFAULT_LOCK_MS = 6000;
const CONFETTI_CONFIG = Object.freeze({
  count: 72,
  durationMs: 4200,
  colors: ["#DE7357", "#7941CD", "#1FA6F5", "#5DB538", "#E33077"],
  launchAngleDeg: 75,
  spreadDeg: 30,
  gravity: 0.05,
  drag: 1,
  ribbonWidth: 20,
  ribbonHeight: 36,
});

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
    celebration: { kind: "image", src: "./assets/host-cheer.png" },
    greeting: { kind: "image", src: "./assets/host-wave.png" },
  },
  screenBackgrounds: {
    default: "./assets/screen-default.png?v=20260927-screen-default-v2",
    cityDay: "./assets/screen-city-day.png",
    cityNight: "./assets/screen-city-night.png",
    scenicDay: "./assets/screen-scenic-day.png",
    scenicSunset: "./assets/screen-scenic-sunset.png",
    snowDay: "./assets/screen-snow-day.png",
    deepNight: "./assets/screen-deep-night.png",
  },
  cabinEnvironments: {
    garage: "./assets/cabin-env-garage.png",
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
    风景区晴天白天: { screen: "scenicDay", cabin: "scenicDay", screenClass: "screen-sunny", cabinClass: "env-scenic-day" },
    风景区傍晚: { screen: "scenicSunset", cabin: "scenicSunset", screenClass: "screen-sunny", cabinClass: "env-scenic-sunset" },
    风景区雪景白天: { screen: "snowDay", cabin: "snowDay", screenClass: "screen-snow", cabinClass: "env-snow-day" },
    风景区晴天深夜: { screen: "deepNight", cabin: "deepNight", screenClass: "screen-night", cabinClass: "env-scenic-night" },
  },
};

const ENVIRONMENT_HOST_LINES = {
  车库: "我们回到车库啦，准备出发。",
  隧道: "我们进入隧道啦，马上就出来。",
  高速路晴天白天: "我们上高速啦，阳光正好，大家坐稳哦。",
  高速路晴天深夜: "我们进入深夜高速啦，大家注意休息。",
  高速路雨天白天: "我们遇到雨天啦，路上慢一点，大家坐稳。",
  城区晴天白天: "我们来到市区啦，周围热闹起来了。",
  城区夜晚: "我们来到夜晚的市区啦，灯光很漂亮。",
  城区雨天白天: "我们来到下雨的市区啦，路面有点湿滑。",
  风景区晴天白天: "我们到风景区啦，窗外风景真不错。",
  风景区傍晚: "我们来到风景区傍晚啦，晚霞真漂亮。",
  风景区雪景白天: "我们到雪景里啦，窗外白茫茫的。",
};

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

const PASSENGER_QUESTION_BANK = {
  雨伞: ["它是不是下雨时更常用？", "它能不能被人拿在手里？", "它平时可以折起来吗？"],
  安全带: ["它是不是每个人坐车都要用？", "它和安全有直接关系吗？", "它是不是就在座位旁边？"],
  斧头: ["它是不是一种工具？", "它通常是用金属做的吗？", "它能用来砍东西吗？"],
  米老鼠: ["它是不是一个卡通角色？", "小朋友大多认识它吗？", "它和迪士尼有关吗？"],
  火锅: ["它是不是可以吃的？", "它适合很多人一起分享吗？", "它通常是热的吗？"],
  雪人: ["它是不是冬天更常见？", "它是用雪做出来的吗？", "太阳出来后它会消失吗？"],
  红绿灯: ["它是不是在马路上常见？", "它会不会变换颜色？", "司机需要听它指挥吗？"],
  书包: ["它是不是经常被背在身上？", "学生会经常用到它吗？", "它能装很多东西吗？"],
  方向盘: ["它是不是在主驾附近？", "开车时需要用手操作它吗？", "它能控制车辆方向吗？"],
  草原: ["它是不是在户外？", "它看起来很开阔吗？", "那里通常有很多植物吗？"],
};

const GENERIC_PASSENGER_QUESTIONS = [
  "它是生活中常见的东西吗？",
  "它是人造的吗？",
  "它通常会出现在室内吗？",
  "它和出行有关吗？",
  "它能被人拿起来吗？",
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
      { delay: 4500, type: "passenger_question", label: "乘客开始提问" },
      { delay: 14000, type: "passenger_question", label: "另一位乘客接力提问" },
      { delay: 23000, type: "cue_real_user", label: "邀请副驾真实用户推进" },
      { delay: 32000, type: "passenger_question", label: "乘客继续缩小范围" },
      { delay: 44000, type: "passenger_question", label: "乘客补充关键一问" },
    ],
  },
  {
    id: "round_cabin_mood",
    name: "轻松玩梗",
    steps: [
      { delay: 4500, type: "passenger_question", label: "乘客开始提问" },
      { delay: 12000, type: "cabin_laughing", label: "舱内出现轻松笑声" },
      { delay: 20000, type: "passenger_question", label: "乘客顺势接力提问" },
      { delay: 30000, type: "passenger_question", label: "乘客换个方向提问" },
      { delay: 40000, type: "cue_real_user", label: "邀请副驾真实用户收束" },
    ],
  },
  {
    id: "round_safety_interrupt",
    name: "安全控场",
    steps: [
      { delay: 4500, type: "passenger_question", label: "乘客开始提问" },
      { delay: 13000, type: "driver_tired", label: "检测到主驾疲惫" },
      { delay: 21000, type: "passenger_question", label: "安全座位接力提问" },
      { delay: 30000, type: "hard_brake", label: "突发急刹打断" },
      { delay: 41000, type: "passenger_question", label: "恢复后乘客继续提问" },
    ],
  },
  {
    id: "round_quiet_care",
    name: "安静照顾",
    steps: [
      { delay: 4500, type: "passenger_question", label: "乘客开始提问" },
      { delay: 13000, type: "passenger_sleep", label: "检测到有乘客睡着" },
      { delay: 22000, type: "passenger_question", label: "清醒乘客继续提问" },
      { delay: 31000, type: "passenger_inactive", label: "检测到乘客长时间未参与" },
      { delay: 40000, type: "passenger_question", label: "乘客补充关键一问" },
    ],
  },
];

const GOLDEN_TIMELINES = [
  {
    id: "family_highway_disney",
    name: "高速亲子出行",
    speed: 80,
    destination: "迪士尼",
    relationship: "父母+小孩",
    environment: "车库",
    environmentAfter: "高速路晴天白天",
    environmentChangeDelay: 20000,
    riddleIndex: 1,
    trace: {
      perception: "载入高速亲子出行场景",
      decision: "默认副驾为真实用户，后排小朋友可自动加入",
      execution: "设置高速晴天、目的地迪士尼、谜底安全带",
      strategyId: "V1.2-A",
      priority: "P3",
    },
  },
  {
    id: "city_night_friends",
    name: "城区夜景朋友出行",
    speed: 50,
    destination: "夜市",
    relationship: "年轻朋友",
    environment: "城区夜晚",
    riddleIndex: 6,
    trace: {
      perception: "载入城区夜景朋友出行场景",
      decision: "朋友局采用轻松节奏，结合夜间城市环境出题",
      execution: "切换城市夜景、目的地夜市、谜底红绿灯",
      strategyId: "V1.2-D",
      priority: "P3",
    },
  },
  {
    id: "rainy_city_hotpot_friends",
    name: "雨天朋友聚会",
    speed: 50,
    destination: "火锅店",
    relationship: "年轻朋友",
    environment: "车库",
    environmentAfter: "城区雨天白天",
    environmentChangeDelay: 20000,
    riddleIndex: 0,
    trace: {
      perception: "载入雨天朋友聚会场景",
      decision: "朋友局采用轻松玩梗风格，副驾仍为真实用户",
      execution: "设置城区出行、目的地火锅店、谜底雨伞",
      strategyId: "V1.2-B",
      priority: "P3",
    },
  },
  {
    id: "scenic_sunset_family",
    name: "风景区傍晚家庭出行",
    speed: 50,
    destination: "草原",
    relationship: "中老年+儿女",
    environment: "风景区傍晚",
    riddleIndex: 9,
    trace: {
      perception: "载入风景区傍晚家庭出行场景",
      decision: "以轻松节奏融入风景与家庭出行氛围",
      execution: "切换风景晚霞、目的地草原、谜底草原",
      strategyId: "V1.2-E",
      priority: "P3",
    },
  },
  {
    id: "scenic_snow_family",
    name: "风景区雪景家庭",
    speed: 50,
    destination: "草原",
    relationship: "中老年+儿女",
    environment: "车库",
    environmentAfter: "风景区雪景白天",
    environmentChangeDelay: 20000,
    riddleIndex: 5,
    trace: {
      perception: "载入风景区雪景家庭场景",
      decision: "用更稳重的语气主持，并避免打扰睡着乘客",
      execution: "设置雪景环境、家庭乘客、谜底雪人",
      strategyId: "V1.2-C",
      priority: "P3",
    },
  },
  {
    id: "scenic_deep_night_family",
    name: "风景区深夜家庭出行",
    speed: 50,
    destination: "观星营地",
    relationship: "中老年+儿女",
    environment: "风景区晴天深夜",
    riddleIndex: 8,
    trace: {
      perception: "载入风景区深夜家庭出行场景",
      decision: "保持夜间出行节奏，优先照顾主驾注意力",
      execution: "切换风景区深夜、目的地观星营地、谜底方向盘",
      strategyId: "V1.2-F",
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
  },
  game: {
    status: "idle",
    roundIndex: 1,
    totalRounds: RIDDLES.length,
    questionCount: 0,
    maxQuestions: 15,
    currentRiddleIndex: 1,
    history: [],
    roundQuestionPlan: null,
    usedRoundQuestionStepIds: [],
    coveredFactKeys: [],
  },
  host: {
    text: "我已经准备好第一道题了，等你发令。",
    emotion: "normal",
    avatarState: HOST_AVATAR_DEFAULT_STATE,
    targetSeat: null,
  },
  ui: {
    cabinMode: "normal",
    animation: "idle",
    screenEnvironment: GOLDEN_TIMELINES[0].environment,
    screenEnvironmentTimer: null,
    screenEnvironmentTransitionId: 0,
    environmentAnnouncementTimer: null,
    environmentAnnouncementId: 0,
    environmentAnnouncementText: "",
    environmentAnnouncementBaseText: "",
    environmentAnnouncementPending: "",
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
    currentEventType: "",
    status: "idle",
    runId: 0,
    startedAt: 0,
    elapsedSeconds: 0,
    environmentTransitionTimer: null,
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
    timeoutTimer: null,
    lastBubbleShownAt: 0,
    lastResumeAt: 0,
    lastPassengerActionKey: "",
    bubbleTimer: null,
    recoveryTimer: null,
    activityTimer: null,
    correctLightTimer: null,
    nextRoundTimer: null,
    preparedReplyPending: false,
    preparedReplyRunId: 0,
    hostThinkingCycleId: 0,
    hostThinkingStartedAt: 0,
    hostThinkingTimer: null,
    hostThinkingActive: false,
    hostAvatarTimer: null,
    hostSpeech: {
      id: 0,
      priority: 0,
      source: "",
      expiresAt: 0,
      timer: null,
    },
    pendingChats: [],
  },
  health: {
    release: "",
    runtime: "",
    focus: "",
    proxyConfigured: null,
    statusText: DEFAULT_DEPLOY_STATUS,
  },
};

const state = structuredClone(DEFAULT_STATE);
const els = {};
let audioContext = null;
const questionClock = {
  intervalId: 0,
  startedAt: 0,
  pausedAt: 0,
  pausedDurationMs: 0,
  roundIndex: 0,
  active: false,
  expired: false,
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
const confettiAnimation = {
  frameId: 0,
  lastTimestamp: 0,
  particles: [],
  width: 1440,
  height: 810,
  dpr: 1,
};

function boot() {
  cacheElements();
  bindEvents();
  resizeStage();
  applyGoldenLineDefaults(getActiveGoldenLine(), false);
  render();
  preloadHostSpriteImages();
  loadHealthStatus();
}

function cacheElements() {
  [
    "environmentBackdrop",
    "appShell",
    "environmentLabel",
    "speedLabel",
    "destinationLabel",
    "gameScreen",
    "confettiCanvas",
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
    "summaryStats",
    "summaryTotal",
    "summarySolved",
    "summaryMvp",
    "summaryContinue",
    "readyStartButton",
    "timelineName",
    "startTimeline",
    "pauseTimeline",
    "prestartPanel",
    "decisionPerception",
    "decisionDecision",
    "decisionExecution",
    "importantEvent",
    "importantEventText",
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
  window.addEventListener("resize", () => {
    resizeStage();
    resizeConfettiCanvas();
  });
  document.addEventListener("pointerdown", () => {
    prepareAudioContext();
  });
  els.switchScenario.addEventListener("click", nextGoldenLine);
  els.resetScenario.addEventListener("click", resetCurrentGoldenLine);
  els.summaryContinue.addEventListener("click", resetCurrentGoldenLine);
  els.readyStartButton.addEventListener("click", startGoldenTimeline);
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
      if (type !== "hard_brake" && isHostBusy()) {
        state.ui.alert = "AI 正在处理上一条信息，请稍等";
        render();
        return;
      }
      if (type === "hard_brake") {
        applyImmediateSafetyPause();
      }
      const eventSeat = type === "passenger_sleep" ? "rearRight" : state.passengers.selectedSeat;
      showImportantEvent(getImportantEventText(type, eventSeat));
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

function createConfettiParticle(side, width, height) {
  const fromLeft = side === "left";
  const speed = 13 + Math.random() * 4;
  const launchAngle = (
    CONFETTI_CONFIG.launchAngleDeg
    + (Math.random() - 0.5) * CONFETTI_CONFIG.spreadDeg
  ) * Math.PI / 180;
  return {
    x: fromLeft ? -180 - Math.random() * 60 : width + 180 + Math.random() * 60,
    y: height + 140 + Math.random() * 80,
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
  confettiAnimation.lastTimestamp = performance.now();

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
      confettiAnimation.frameId = requestAnimationFrame(animate);
    } else {
      clearConfetti();
    }
  };

  confettiAnimation.frameId = requestAnimationFrame(animate);
}

function clearConfetti() {
  if (confettiAnimation.frameId) {
    cancelAnimationFrame(confettiAnimation.frameId);
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
    state.health.release = payload.release || "";
    state.health.runtime = payload.runtime || "";
    state.health.focus = payload.focus || "";
    state.health.proxyConfigured = Boolean(payload.workflow_proxy?.configured);
    state.health.statusText = formatDeployStatus(payload);
  } catch {
    state.health.release = "";
    state.health.runtime = "";
    state.health.focus = "";
    state.health.proxyConfigured = null;
    state.health.statusText = "版本状态不可用";
  }
  render();
}

function formatDeployStatus(payload) {
  const release = payload.release || "unknown";
  const runtime = payload.runtime === "vercel" ? "公网" : payload.runtime === "local" ? "本地" : "未知";
  const proxyState = payload.workflow_proxy?.configured ? "代理就绪" : "代理未配置";
  return `${runtime} · ${release} · ${proxyState}`;
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
  if (state.timeline.status === "running" || state.timeline.status === "paused") {
    state.ui.alert = "模拟正在进行中";
    render();
    return;
  }

  applyGoldenLineDefaults(getActiveGoldenLine(), false);
  await startRoundGoldenTimeline();
}

async function startRoundGoldenTimeline() {
  const roundTimeline = pickRoundGoldenTimeline();
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
  state.timeline.startedAt = Date.now();
  state.timeline.elapsedSeconds = 0;
  state.timeline.currentEventType = "start_game";
  state.timeline.currentEvent = `第 ${state.game.roundIndex} 题 · ${roundTimeline.name}`;
  startQuestionClock();
  startQuestionIntro();
  render();

  await startGame();
  if (state.timeline.runId !== runId || state.game.status === "victory") return;

  state.timeline.startedAt = Date.now();
  scheduleGoldenEnvironmentTransition(runId, getActiveGoldenLine());
  for (const step of roundTimeline.steps) {
    if (state.timeline.runId !== runId) return;
    const waitMs = state.timeline.startedAt + step.delay - Date.now();
    await sleep(Math.max(0, waitMs));
    await waitUntilRoundTimelineReady(runId);
    if (state.timeline.runId !== runId) return;
    if (["victory", "summary", "failed"].includes(state.game.status)) return;
    state.timeline.elapsedSeconds = Math.round((Date.now() - state.timeline.startedAt) / 1000);
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
  state.timeline.environmentTransitionTimer = setTimeout(async () => {
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
  clearTimeout(state.timeline.environmentTransitionTimer);
  state.timeline.environmentTransitionTimer = null;
}

function pickRoundGoldenTimeline() {
  const candidates = ROUND_GOLDEN_TIMELINES.length > 1
    ? ROUND_GOLDEN_TIMELINES.filter(
        (timeline) => timeline.id !== state.timeline.lastRoundTimelineId,
      )
    : ROUND_GOLDEN_TIMELINES;
  return candidates[Math.floor(Math.random() * candidates.length)] || ROUND_GOLDEN_TIMELINES[0];
}

async function runRoundTimelineStep(step) {
  if (step.type === "passenger_question") {
    await runRandomTimelinePassengerQuestion();
    return;
  }
  if (step.type === "cue_real_user") {
    cueRealUser("副驾也可以随时接上，试着从类别、用途或所在位置继续缩小范围。");
    return;
  }

  if (["passenger_sleep", "passenger_inactive", "cabin_laughing"].includes(step.type)) {
    const rearSeat = selectRandomSimulatedSeat({ rearOnly: true });
    if (!rearSeat) return;
    await runScriptedEvent(step.type, step.label, rearSeat);
    return;
  }
  await runScriptedEvent(step.type, step.label, "driver");
}

async function runRandomTimelinePassengerQuestion() {
  if (state.game.questionCount >= state.game.maxQuestions) return;
  const seat = selectRandomSimulatedSeat();
  if (!seat) {
    cueRealUser("其他乘客暂时不适合发言，副驾可以继续这一问。");
    return;
  }
  const preparedQuestion = pickPreparedRoundQuestion(seat);
  const question = preparedQuestion?.text || pickTimelinePassengerQuestion();
  await runScriptedQuestion(seat, question, preparedQuestion?.step || null);
}

function selectRandomSimulatedSeat({ rearOnly = false } = {}) {
  const sleepingSeats = new Set(getSleepingSeats());
  const driverUnavailable =
    state.car.speed >= 100
    || state.perception.driverState === "fatigued"
    || ["疲惫", "睡着"].includes(state.passengers.seats.driver.mood)
    || ["safety_pause", "driver_focus"].includes(state.ui.cabinMode);
  const baseSeats = rearOnly ? ["rearLeft", "rearRight"] : ["driver", "rearLeft", "rearRight"];
  let candidates = baseSeats.filter(
    (seat) => !sleepingSeats.has(seat) && (seat !== "driver" || !driverUnavailable),
  );
  if (candidates.length > 1 && state.timeline.lastPassengerSeat) {
    candidates = candidates.filter((seat) => seat !== state.timeline.lastPassengerSeat);
  }
  if (!candidates.length) return "";

  const seat = candidates[Math.floor(Math.random() * candidates.length)];
  state.timeline.lastPassengerSeat = seat;
  return seat;
}

function pickTimelinePassengerQuestion() {
  const riddle = getCurrentRiddle();
  const specificQuestions = PASSENGER_QUESTION_BANK[riddle.answer] || [];
  const askedQuestions = new Set(getAskedQuestions());
  const availableSpecific = specificQuestions.filter((question) => !askedQuestions.has(question));
  const availableGeneric = GENERIC_PASSENGER_QUESTIONS.filter(
    (question) => !askedQuestions.has(question),
  );
  const candidates = availableSpecific.length
    ? availableSpecific
    : availableGeneric.length
      ? availableGeneric
      : [...specificQuestions, ...GENERIC_PASSENGER_QUESTIONS];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function pickPreparedRoundQuestion(seat) {
  const plan = state.game.roundQuestionPlan;
  if (!plan?.steps?.length) return null;

  const usedStepIds = new Set(state.game.usedRoundQuestionStepIds);
  const coveredFactKeys = new Set(state.game.coveredFactKeys);
  plan.steps
    .filter((step) => usedStepIds.has(step.id))
    .forEach((step) => coveredFactKeys.add(step.factKey));

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
  const askedQuestions = new Set(getAskedQuestions());
  const preferredQuestions = preferredKeys
    .map((key) => variants[key])
    .filter(Boolean);
  const allQuestions = [...new Set([...preferredQuestions, ...Object.values(variants)])];
  return allQuestions.find((question) => !askedQuestions.has(question)) || allQuestions[0] || "";
}

function toggleTimelinePause() {
  if (state.timeline.status === "running") {
    state.timeline.status = "paused";
    pauseQuestionClock();
    state.timeline.currentEvent = "模拟已暂停";
    state.ui.alert = "模拟已暂停";
  } else if (state.timeline.status === "paused") {
    state.timeline.status = "running";
    resumeQuestionClock();
    state.timeline.currentEvent = "模拟继续";
    state.ui.alert = "模拟继续";
  } else if (["opening", "playing", "victory"].includes(state.game.status)) {
    state.timeline.status = "paused";
    pauseQuestionClock();
    state.timeline.currentEvent = "模拟已暂停";
    state.ui.alert = "模拟已暂停";
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
  clearGoldenEnvironmentTransition();
  clearScreenEnvironmentTransition();
  clearEnvironmentAnnouncement();
  clearImportantEvent();
  clearConfetti();
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
  cancelPreparedHostReply();
  state.timeline.status = "finished";
  state.timeline.currentEventType = "round_finished";
  state.timeline.currentEvent = `${state.timeline.roundTimelineName || state.timeline.name}已完成`;
}

function applyGoldenLineDefaults(timeline = getActiveGoldenLine(), announce = false) {
  clearGoldenEnvironmentTransition();
  clearScreenEnvironmentTransition();
  clearEnvironmentAnnouncement();
  clearImportantEvent();
  clearHostSpeechLock();
  clearQuestionClock();
  if (state.workflow.activityTimer) {
    clearTimeout(state.workflow.activityTimer);
    state.workflow.activityTimer = null;
  }
  clearCorrectLightTimer();
  clearConfetti();
  clearNextRoundTimer();
  cancelPreparedHostReply();
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
  state.game.totalRounds = RIDDLES.length;
  state.game.questionCount = 0;
  state.game.history = [];
  state.game.roundQuestionPlan = null;
  state.game.usedRoundQuestionStepIds = [];
  state.game.coveredFactKeys = [];
  state.ui.showAnswer = false;
  state.ui.correctSeat = null;
  state.ui.correctLightSeat = null;
  state.ui.cabinMode = "normal";
  state.ui.screenEnvironment = timeline.environment;
  state.ui.alert = announce ? `已切换至${timeline.name}` : "";
  publishHostLine(getPrestartHostText(timeline), {
    priority: "P2",
    source: "scenario_reset",
    durationMs: 0,
  });
  state.host.emotion = "normal";
  state.host.avatarState = HOST_AVATAR_DEFAULT_STATE;
  state.host.targetSeat = "front";
  state.workflow.lastPassengerActionKey = "";
  state.workflow.pendingChats = [];
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
  state.game.questionCount += 1;
  state.ui.alert = `${SEATS[seat]}：${text}`;
  const persona = getPassengerPersona(seat);
  const isChild = persona?.age_group === "child";
  updateDecisionTrace({
    perception: `${SEATS[seat]}参与提问`,
    decision: isChild ? "允许小朋友用短句参与" : "允许模拟乘客补充提问",
    execution: "显示乘客气泡，并交给 AI 主持人回答",
    strategyId: isChild ? "S12" : "S00",
    priority: "P3",
  });
  render();
  if (preparedStep) {
    await playPreparedPassengerExchange(seat, text, preparedStep);
  } else {
    await dispatchWorkflow(
      "chat",
      { type: "passenger_question", source: "timeline", seat },
      text,
    );
  }
  if (state.game.roundIndex !== questionRoundIndex || state.game.status === "failed") return;
  ensureScriptedVictory(seat, text);
  restoreRealUserSeat();
}

async function playPreparedPassengerExchange(seat, text, step) {
  const input = buildWorkflowInput(
    "chat",
    {
      type: "passenger_question",
      source: "round_question_plan",
      seat,
      plan_id: state.game.roundQuestionPlan?.id || "",
      step_id: step.id,
      fact_key: step.factKey,
    },
    text,
  );
  const runId = beginPreparedHostReply();

  try {
    await sleep(PREPARED_REPLY_DELAY_MS);
    while (
      runId === state.workflow.preparedReplyRunId
      && state.timeline.status === "paused"
      && state.game.status !== "paused"
    ) {
      await sleep(PAUSED_ROUND_POLL_MS);
    }
    if (
      runId !== state.workflow.preparedReplyRunId
      || state.game.status === "paused"
      || ["victory", "summary", "failed"].includes(state.game.status)
    ) {
      return;
    }

    const replyText = interpolatePreparedReply(step.hostReplyText, seat);
    const output = {
      passenger_action: null,
      ai_reply_text: replyText,
      game_status: "playing",
      is_correct: false,
      answer: "",
      covered_fact_keys: [step.factKey],
      ui_change: {
        cabin_mode: "game",
        target_seat: seat,
        host_emotion: step.hostEmotion === "thinking" ? "normal" : (step.hostEmotion || "normal"),
        animation: "answer",
        show_answer: false,
      },
      decision_trace: {
        perception: `${SEATS[seat]}按逻辑提问链推进到“${step.stage || step.factKey}”`,
        decision: "使用本题开场时预生成的连续问答，避免逐问等待模型",
        execution: "显示乘客问题，并即时播放对应主持回答",
        strategy_id: "S00",
        priority: "P3",
      },
      strategy_id: "S00",
      priority: "P3",
      debug: {
        source: "round_question_plan",
        plan_id: state.game.roundQuestionPlan?.id || "",
        step_id: step.id,
      },
    };

    publishHostLine(sanitizeHostReplyText(replyText) || state.host.text, {
      priority: "P2",
      source: "prepared_reply",
    });
    state.host.targetSeat = seat;
    state.host.emotion = step.hostEmotion === "thinking" ? "normal" : (step.hostEmotion || "normal");
    applyHostAvatarState(output, output.ui_change, false);
    state.game.usedRoundQuestionStepIds = [
      ...new Set([...state.game.usedRoundQuestionStepIds, step.id]),
    ];
    mergeCoveredFactKeysFromOutput(output);
    updateDecisionTrace(output.decision_trace);
    state.game.history.push({
      at: new Date().toISOString(),
      input,
      output,
    });
  } catch (error) {
    console.warn("Prepared passenger exchange failed; using fallback reply.", error);
    if (runId === state.workflow.preparedReplyRunId) {
      publishHostLine("收到，我们继续沿着这个方向推进。", {
        priority: "P2",
        source: "prepared_reply_fallback",
      });
      state.host.targetSeat = seat;
      state.host.emotion = "normal";
    }
  } finally {
    finishPreparedHostReply(runId);
    render();
  }
}

function interpolatePreparedReply(text, seat) {
  const seatLabel = SEATS[seat] || "这位乘客";
  return String(text || "")
    .replace(/\{\{\s*(speaker_label|seat_label|passenger_label)\s*\}\}/g, seatLabel)
    .trim();
}

function cueRealUser(text) {
  state.passengers.selectedSeat = "front";
  state.host.targetSeat = "front";
  publishHostLine(text, {
    priority: "P2",
    source: "real_user_cue",
  });
  state.ui.alert = "";
  updateDecisionTrace({
    perception: "时间轴轮到副驾真实用户",
    decision: "不模拟副驾发言，等待真实用户输入",
    execution: "AI 主持人 cue 副驾，输入框保持可用",
    strategyId: "S00",
    priority: "P3",
  });
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
}

async function runScriptedEvent(type, label, targetSeat = state.passengers.selectedSeat) {
  const seat = targetSeat;
  showImportantEvent(getImportantEventText(type, seat));
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
    state.passengers.seats[seat].mood = "沉默";
    state.passengers.seats[seat].activity = "listening";
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
  await dispatchWorkflow("event", { type, seat, source: "timeline" });
  scheduleEventRecovery(type);
}

async function runScriptedSpeed(speed) {
  state.car.speed = speed;
  state.ui.alert = `车速已更新为 ${speed} km/h`;
  render();
  await dispatchWorkflow("event", { type: "speed_change", value: speed, source: "timeline" });
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
  await dispatchWorkflow(
    "event",
    { type: "environment_change", value: environment, source: "timeline" },
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prepareAudioContext() {
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
  state.ui.showAnswer = false;
  state.ui.correctSeat = null;
  publishHostLine("各位侦探请就位，我要开始出题了。", {
    priority: "P2",
    source: "start_game",
  });
  render();
  await dispatchWorkflow("event", { type: "start_game", source: "timeline" });
}

async function sendQuestion() {
  const text = els.playerInput.value.trim();
  if (!text) {
    state.ui.alert = "请输入提问或答案";
    render();
    return;
  }

  if (state.game.status === "paused") {
    publishHostLine("游戏还在暂停中，先恢复再继续问。", {
      priority: "P0",
      source: "paused_input",
    });
    render();
    return;
  }

  const seat = "front";
  state.passengers.selectedSeat = seat;
  showPassengerBubble(seat, text);
  state.host.targetSeat = seat;
  state.game.status = state.game.status === "idle" ? "playing" : state.game.status;
  state.game.questionCount += 1;
  els.playerInput.value = "";
  if (isHostBusy()) {
    state.workflow.pendingChats.push({ seat, text });
    publishHostLine("这条问题我先记下，等上一轮回答结束马上接上。", {
      priority: "P2",
      source: "queued_question",
    });
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
  clearGoldenEnvironmentTransition();
  clearScreenEnvironmentTransition();
  const previousScreenEnvironment = state.ui.screenEnvironment || state.car.environment;
  state.car.environment = environment;
  const matchedIndex = findRiddleForEnvironment(environment);
  if (state.game.status === "idle") {
    state.game.currentRiddleIndex = matchedIndex;
  }
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

function getEnvironmentHostLine(environment) {
  return ENVIRONMENT_HOST_LINES[environment] || `我们来到${environment}啦。`;
}

function showEnvironmentAnnouncement(environment) {
  const announcement = getEnvironmentHostLine(environment);
  const currentText = String(state.host.text || "");
  const baseText = state.ui.environmentAnnouncementText === currentText
    ? state.ui.environmentAnnouncementBaseText
    : currentText;
  clearEnvironmentAnnouncement();
  const announcementId = state.ui.environmentAnnouncementId;
  state.ui.environmentAnnouncementText = announcement;
  state.ui.environmentAnnouncementBaseText = baseText;
  const published = publishHostLine(announcement, {
    priority: "P1",
    source: "environment",
    durationMs: ENVIRONMENT_ANNOUNCEMENT_MS,
  });
  if (!published) {
    const retryId = state.ui.environmentAnnouncementId;
    state.ui.environmentAnnouncementText = "";
    state.ui.environmentAnnouncementBaseText = "";
    state.ui.environmentAnnouncementPending = environment;
    state.ui.environmentAnnouncementTimer = window.setTimeout(() => {
      if (state.ui.environmentAnnouncementId !== retryId) return;
      state.ui.environmentAnnouncementTimer = null;
      state.ui.environmentAnnouncementPending = "";
      showEnvironmentAnnouncement(environment);
    }, 500);
    return;
  }
  state.ui.environmentAnnouncementTimer = window.setTimeout(() => {
    if (
      state.ui.environmentAnnouncementId !== announcementId
      || state.host.text !== announcement
    ) return;
    state.ui.environmentAnnouncementTimer = null;
    state.ui.environmentAnnouncementText = "";
    clearHostSpeechLock("environment");
    // The environment speech lock timer only releases priority; clear the
    // rendered text here so the announcement cannot remain on screen.
    state.host.text = "";
    if (state.ui.environmentAnnouncementBaseText) {
      publishHostLine(state.ui.environmentAnnouncementBaseText, {
        priority: "P2",
        source: "environment_restore",
      });
    }
    state.ui.environmentAnnouncementBaseText = "";
    render();
  }, ENVIRONMENT_ANNOUNCEMENT_MS);
  render();
}

function clearEnvironmentAnnouncement() {
  if (state.ui.environmentAnnouncementTimer) {
    window.clearTimeout(state.ui.environmentAnnouncementTimer);
    state.ui.environmentAnnouncementTimer = null;
  }
  state.ui.environmentAnnouncementId += 1;
  state.ui.environmentAnnouncementText = "";
  state.ui.environmentAnnouncementBaseText = "";
  state.ui.environmentAnnouncementPending = "";
  clearHostSpeechLock("environment");
}

const IMPORTANT_EVENT_LABELS = {
  hard_brake: () => "发生急刹",
  driver_tired: () => "主驾疲惫",
  passenger_sleep: (seat) => `${getSeatDisplayLabel(seat)}睡着`,
  passenger_inactive: (seat) => `${getSeatDisplayLabel(seat)}暂时沉默`,
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
  window.clearTimeout(eventState.timer);
  window.clearTimeout(eventState.hideTimer);
  eventState.id += 1;
  eventState.text = normalized;
  eventState.phase = "visible";
  eventState.timer = window.setTimeout(() => {
    hideImportantEvent(eventState.id);
  }, IMPORTANT_EVENT_DISPLAY_MS);
  render();
}

function hideImportantEvent(eventId) {
  const eventState = state.ui.importantEvent;
  if (eventState.id !== eventId || eventState.phase === "hidden") return;

  eventState.timer = null;
  eventState.phase = "hiding";
  eventState.hideTimer = window.setTimeout(() => {
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
  window.clearTimeout(eventState.timer);
  window.clearTimeout(eventState.hideTimer);
  eventState.timer = null;
  eventState.hideTimer = null;
  eventState.id += 1;
  eventState.text = "";
  eventState.phase = "hidden";
}

function scheduleScreenEnvironmentTransition(environment) {
  const transitionId = state.ui.screenEnvironmentTransitionId + 1;
  state.ui.screenEnvironmentTransitionId = transitionId;
  state.ui.screenEnvironmentTimer = window.setTimeout(() => {
    if (
      state.ui.screenEnvironmentTransitionId !== transitionId
      || state.car.environment !== environment
    ) return;
    state.ui.screenEnvironmentTimer = null;
    state.ui.screenEnvironment = environment;
    state.ui.environmentAnnouncementPending = environment;
    render();
  }, SCREEN_ENVIRONMENT_DELAY_MS);
}

function clearScreenEnvironmentTransition() {
  if (state.ui.screenEnvironmentTimer) {
    window.clearTimeout(state.ui.screenEnvironmentTimer);
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

function applyImmediateSafetyPause() {
  abortActiveWorkflow();
  cancelPreparedHostReply();
  pauseQuestionClock();
  clearNextRoundTimer();
  if (state.workflow.recoveryTimer) {
    clearTimeout(state.workflow.recoveryTimer);
    state.workflow.recoveryTimer = null;
  }
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
    publishHostLine("安全状态恢复，刚才的线索还在，我们继续。", {
      priority: "P0",
      source: "safety_recovery",
    });
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
  publishHostLine(`${SEATS[seat]}好像睡着了，我们先不 cue TA，声音也放轻一点。`, {
    priority: "P3",
    source: "passenger_sleep",
  });
  updateDecisionTrace({
    perception: `检测到${SEATS[seat]}睡着`,
    decision: "轻声继续，并避免 cue 睡着乘客",
    execution: "切换轻声互动模式，排除该座位发言",
    strategyId: "S04",
    priority: "P2",
  });
  render();
}

function applyImmediateDriverTired() {
  state.perception.driverState = "fatigued";
  state.passengers.seats.driver.mood = "疲惫";
  state.ui.cabinMode = "driver_focus";
  state.ui.alert = "主驾疲惫：降低驾驶员互动";
  state.host.targetSeat = "front";
  publishHostLine("主驾先专心看路，接下来的问题交给副驾和后排。", {
    priority: "P3",
    source: "driver_tired",
  });
  updateDecisionTrace({
    perception: "检测到主驾疲惫",
    decision: "降低主驾互动，副驾和后排接管",
    execution: "切换主驾专注模式",
    strategyId: "S03",
    priority: "P1",
  });
  render();
}

function applyImmediateNearDestination() {
  state.ui.cabinMode = "final_round";
  state.ui.alert = "快到目的地：准备收尾";
  state.host.targetSeat = null;
  publishHostLine("前方快到目的地，我们准备进入收尾局。", {
    priority: "P3",
    source: "near_destination",
  });
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
  const eventType = event?.type;
  const isSafetyInterrupt = eventType === "hard_brake";
  if (isHostBusy() && !isSafetyInterrupt) {
    state.ui.alert = "AI 正在处理上一条信息，请稍等";
    render();
    return;
  }

  if (isSafetyInterrupt) {
    abortActiveWorkflow();
    cancelPreparedHostReply();
  }

  const input = buildWorkflowInput(triggerType, event, playerInput);
  const requestId = beginWorkflowRequest(input);

  try {
    let output = await requestWorkflow(input, state.workflow.activeController.signal);
    if (requestId !== state.workflow.activeRequestId) return;
    clearHostThinkingTimer();

    const outputDelayMs = getBubbleOutputDelayMs(input);
    if (outputDelayMs > 0) {
      await sleep(outputDelayMs);
      if (requestId !== state.workflow.activeRequestId) return;
    }

    output = applyAnswerHitGuard(output, input);
    applyWorkflowOutput(output, input);
  } catch (error) {
    if (requestId !== state.workflow.activeRequestId) return;
    clearHostThinkingTimer();
    console.warn("Workflow exchange failed; using fallback reply.", error);
    try {
      if (input.trigger_type === "chat") {
        await sleep(LOCAL_FALLBACK_REPLY_DELAY_MS);
        if (requestId !== state.workflow.activeRequestId) return;
      }
      applyWorkflowOutput(localDecision(input, error), input);
    } catch (fallbackError) {
      console.error("Fallback workflow exchange failed.", fallbackError);
      publishHostLine("收到，我们继续沿着这个方向推进。", {
        priority: "P2",
        source: "workflow_fallback",
      });
      state.host.emotion = "normal";
    }
  } finally {
    if (requestId === state.workflow.activeRequestId) {
      const elapsedMs = Date.now() - state.workflow.hostThinkingStartedAt;
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

function isHostBusy() {
  return state.workflow.inFlight || state.workflow.preparedReplyPending;
}

function beginPreparedHostReply() {
  state.workflow.preparedReplyRunId += 1;
  state.workflow.preparedReplyPending = true;
  clearHostThinkingTimer();
  state.workflow.hostThinkingActive = false;
  state.workflow.hostThinkingStartedAt = 0;
  state.workflow.activeLabel = "AI 正在判断";
  state.ui.alert = state.workflow.activeLabel;
  render();
  return state.workflow.preparedReplyRunId;
}

function finishPreparedHostReply(runId) {
  if (runId !== state.workflow.preparedReplyRunId) return;
  state.workflow.preparedReplyPending = false;
  state.workflow.activeLabel = "";
  window.setTimeout(processNextPendingChat, 0);
  window.setTimeout(resolveExpiredQuestion, 0);
  render();
}

function cancelPreparedHostReply() {
  state.workflow.preparedReplyRunId += 1;
  state.workflow.preparedReplyPending = false;
  clearHostThinkingTimer();
  if (!state.workflow.inFlight) {
    state.workflow.activeLabel = "";
  }
}

function beginWorkflowRequest(input) {
  const requestId = state.workflow.activeRequestId + 1;
  state.workflow.inFlight = true;
  state.workflow.activeRequestId = requestId;
  state.workflow.activeController = new AbortController();
  state.workflow.activeLabel = getWorkflowPendingLabel(input);
  state.workflow.timeoutTimer = window.setTimeout(() => {
    if (state.workflow.activeRequestId === requestId && state.workflow.activeController) {
      state.workflow.activeController.abort();
    }
  }, WORKFLOW_CLIENT_TIMEOUT_MS);
  scheduleHostThinkingForRequest(requestId, input);
  state.ui.alert = state.workflow.activeLabel;
  render();
  return requestId;
}

function scheduleHostThinkingForRequest(requestId, input) {
  clearHostThinkingTimer();
  state.workflow.hostThinkingActive = false;
  state.workflow.hostThinkingStartedAt = 0;
  if (input?.trigger_type !== "chat") return;

  state.workflow.hostThinkingTimer = window.setTimeout(() => {
    state.workflow.hostThinkingTimer = null;
    if (
      state.workflow.activeRequestId !== requestId
      || !state.workflow.inFlight
    ) {
      return;
    }
    beginHostThinkingCycle();
  }, HOST_THINKING_WAIT_DELAY_MS);
}

function clearHostThinkingTimer() {
  if (!state.workflow.hostThinkingTimer) return;
  clearTimeout(state.workflow.hostThinkingTimer);
  state.workflow.hostThinkingTimer = null;
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
  state.workflow.hostThinkingStartedAt = Date.now();
  state.workflow.hostThinkingActive = true;
  setHostAvatarState("thinking", { transient: false });
  resetHostSprite();
  hostSprite.thinkingCycleId = state.workflow.hostThinkingCycleId;
  render();
}

function finishWorkflowRequest(requestId) {
  if (requestId !== state.workflow.activeRequestId) return;
  clearWorkflowTimeout();
  clearHostThinkingTimer();
  state.workflow.inFlight = false;
  state.workflow.activeLabel = "";
  state.workflow.activeController = null;
  window.setTimeout(processNextPendingChat, 0);
  window.setTimeout(resolveExpiredQuestion, 0);
}

function abortActiveWorkflow() {
  if (state.workflow.activeController) {
    state.workflow.activeController.abort();
  }
  clearWorkflowTimeout();
  clearHostThinkingTimer();
  state.workflow.hostThinkingActive = false;
  state.workflow.hostThinkingStartedAt = 0;
  resetHostSprite();
  state.workflow.inFlight = false;
  state.workflow.activeLabel = "";
  state.workflow.activeController = null;
  state.workflow.activeRequestId += 1;
}

function clearWorkflowTimeout() {
  if (!state.workflow.timeoutTimer) return;
  clearTimeout(state.workflow.timeoutTimer);
  state.workflow.timeoutTimer = null;
}

async function processNextPendingChat() {
  if (isHostBusy() || state.workflow.pendingChats.length === 0) return;
  if (state.game.status === "paused") return;

  const nextChat = state.workflow.pendingChats.shift();
  state.passengers.selectedSeat = nextChat.seat;
  showPassengerBubble(nextChat.seat, nextChat.text);
  state.host.targetSeat = nextChat.seat;
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
  if (Date.now() - state.workflow.lastResumeAt < 1500) {
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

function getPassengerPersonas() {
  return (
    PASSENGER_PERSONAS_BY_RELATIONSHIP[state.passengers.relationship]
    || PASSENGER_PERSONAS_BY_RELATIONSHIP["父母+小孩"]
  );
}

function getPassengerPersona(seat) {
  return getPassengerPersonas()[getPersonaSeatKey(seat)] || null;
}

function getCurrentRoundTimelineTemplate() {
  return (
    ROUND_GOLDEN_TIMELINES.find(
      (timeline) => timeline.id === state.timeline.roundTimelineId,
    ) || null
  );
}

function buildRoundQuestionPlanRequest(event) {
  if (event?.type !== "start_game") return null;

  const timeline = getCurrentRoundTimelineTemplate();
  const passengerSlots = (timeline?.steps || []).filter(
    (step) => step.type === "passenger_question",
  );
  const personaAgeGroups = [
    ...new Set(
      ["driver", "rearLeft", "rearRight"]
        .map((seat) => getPassengerPersona(seat)?.age_group)
        .filter(Boolean),
    ),
  ];

  return {
    enabled: true,
    step_count: passengerSlots.length + ROUND_PLAN_EXTRA_STEPS,
    reasoning_stages: ["category", "location", "function", "feature", "near_answer"],
    persona_age_groups: personaAgeGroups,
    generate_question_variants: true,
    generate_host_replies: true,
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
      "每一步同时生成可即时播放的主持人回答",
    ],
  };
}

function buildWorkflowInput(triggerType, event, playerInput) {
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
        source: event.source || "manual",
        seat_label: event.seat ? SEATS[event.seat] : undefined,
      }
    : null;
  const currentTimelineEventType =
    event?.type || (triggerType === "event" ? state.timeline.currentEventType : "");
  const roundQuestionPlanRequest = buildRoundQuestionPlanRequest(event);

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
      question_count: state.game.questionCount,
      max_questions: state.game.maxQuestions,
      current_answer: getCurrentRiddle().answer,
      current_theme: getCurrentRiddle().theme,
      hint: getCurrentRiddle().hint,
      progress: perception.game_progress,
      asked_questions: getAskedQuestions(),
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
  return !(
    triggerType === "simulation"
    && event?.type === "request_passenger_action"
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
  const response = await fetch(DEFAULT_WORKFLOW_ENDPOINT, {
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
        return normalizeWorkflowOutput(JSON.parse(candidate));
      } catch {
        continue;
      }
    }
    if (
      typeof candidate === "object"
      && (
        candidate.ai_reply_text
        || candidate.round_question_plan
        || candidate.round_content?.round_question_plan
        || candidate.round_content?.question_plan
      )
    ) {
      return normalizeWorkflowOutput(candidate);
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
  if (!normalized.ai_reply_text) {
    normalized.ai_reply_text = getDefaultHostReply(normalized);
  }

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

function normalizeRoundQuestionPlan(rawPlan) {
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
  if (steps.length < 2) return null;

  const reasoningPath =
    parsedPlan.reasoning_path
    || parsedPlan.reasoningPath
    || steps.map((step) => step.factKey);

  return {
    id:
      parsedPlan.plan_id
      || parsedPlan.id
      || `${state.timeline.roundTimelineId || "round"}-${state.game.roundIndex}`,
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

  const hostReplyText = String(
    parsedStep.host_reply_text
      || parsedStep.host_reply
      || parsedStep.reply_text
      || "",
  ).trim();
  if (!Object.keys(variants).length || !hostReplyText) return null;

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
    hostReplyText,
    hostEmotion: String(
      parsedStep.host_emotion || parsedStep.hostEmotion || "thinking",
    ),
  };
}

function applyRoundQuestionPlanFromOutput(output, input) {
  if (input.event?.type !== "start_game") return;

  const rawPlan =
    output.round_question_plan
    || output.round_content?.round_question_plan
    || output.round_content?.question_plan
    || output.ui_change?.round_question_plan
    || output.debug?.round_question_plan;
  state.game.roundQuestionPlan = normalizeRoundQuestionPlan(rawPlan);
  state.game.usedRoundQuestionStepIds = [];
  state.game.coveredFactKeys = [];
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

function publishHostLine(text, {
  priority = "P2",
  source = "workflow",
  durationMs = null,
  force = false,
} = {}) {
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
      Math.max(1, Number(requestedLockDurationMs) || HOST_SPEECH_DEFAULT_LOCK_MS),
    );
  const now = Date.now();
  const activeLock = speech.expiresAt > now;
  if (activeLock && !force && nextPriority < speech.priority) {
    return false;
  }

  if (speech.timer) {
    clearTimeout(speech.timer);
    speech.timer = null;
  }
  if (speech.source === "environment" && nextPriority > speech.priority) {
    if (state.ui.environmentAnnouncementTimer) {
      clearTimeout(state.ui.environmentAnnouncementTimer);
      state.ui.environmentAnnouncementTimer = null;
    }
    state.ui.environmentAnnouncementId += 1;
    state.ui.environmentAnnouncementText = "";
    state.ui.environmentAnnouncementBaseText = "";
    state.ui.environmentAnnouncementPending = "";
  }
  speech.id += 1;
  speech.priority = nextPriority;
  speech.source = source;
  speech.expiresAt = lockDurationMs === Infinity
    ? Infinity
    : lockDurationMs > 0
      ? now + lockDurationMs
      : 0;
  state.host.text = normalizedText;

  if (lockDurationMs > 0 && lockDurationMs !== Infinity) {
    const speechId = speech.id;
    const clearOnExpire = source !== "environment";
    speech.timer = window.setTimeout(() => {
      if (speech.id !== speechId) return;
      speech.timer = null;
      speech.priority = 0;
      speech.source = "";
      speech.expiresAt = 0;
      if (clearOnExpire) {
        state.host.text = "";
        render();
      }
    }, lockDurationMs);
  }
  return true;
}

function clearHostSpeechLock(source = "") {
  const speech = state.workflow.hostSpeech;
  if (source && speech.source !== source) return;
  if (speech.timer) clearTimeout(speech.timer);
  speech.timer = null;
  speech.id += 1;
  speech.priority = 0;
  speech.source = "";
  speech.expiresAt = 0;
}

function getWorkflowHostSpeechPriority(output, input) {
  if (output?.is_correct || output?.game_status === "victory" || output?.game_status === "failed") {
    return "P0";
  }

  const eventType = input?.event?.type;
  if (eventType === "hard_brake" || eventType === "resume_game") return "P0";
  if (eventType === "environment_change") return "P1";
  if (input?.trigger_type === "chat" || eventType === "start_game") return "P2";
  if (["driver_tired", "passenger_sleep", "passenger_inactive", "near_destination", "speed_change"].includes(eventType)) {
    return "P3";
  }
  if (["near_answer", "game_stuck", "cabin_laughing"].includes(eventType)) return "P4";
  return "P2";
}

function getDefaultHostReply(output) {
  if (output.is_correct || output.game_status === "victory") {
    return `${SEATS[state.passengers.selectedSeat] || "这位侦探"}答对了，谜底揭晓。`;
  }
  if (state.game.status === "idle") {
    return `${getCurrentRiddle().opening} 你们有 15 个问题，答案先藏好。`;
  }
  return "收到，我们继续沿着这个方向推进。";
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

function applyWorkflowOutput(output, input) {
  const uiChange = output.ui_change || {};
  const isVictoryOutput = Boolean(output.is_correct || output.game_status === "victory");
  const isHardBrakeOutput = input.event?.type === "hard_brake";
  const eventType = input.event?.type;
  const environmentAnnouncementActive = Boolean(state.ui.environmentAnnouncementText);
  const keepRealUserFocus = shouldKeepRealUserFocus(input, output);
  applyRoundQuestionPlanFromOutput(output, input);
  mergeCoveredFactKeysFromOutput(output);
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
  const preserveHigherPriorityHostReply =
    eventType === "environment_change"
    || (
      environmentAnnouncementActive
      && normalizeHostSpeechPriority(hostSpeechPriority) < HOST_SPEECH_PRIORITIES.P0
    );
  if (preserveHigherPriorityHostReply || shouldMuteHostReplyForEvent(eventType, sanitizedHostText)) {
    state.host.text = previousHostText;
  } else if (sanitizedHostText) {
    publishHostLine(
      normalizeHostReplyForRealUser(sanitizedHostText, output, input),
      { priority: hostSpeechPriority, source: input.event?.type || input.trigger_type },
    );
  } else {
    state.host.text = previousHostText;
  }
  if (passengerActionApplied && !output.ai_reply_text && !preserveHigherPriorityHostReply) {
    publishHostLine("这个问题收到，我来接住这一轮。", {
      priority: hostSpeechPriority,
      source: input.event?.type || input.trigger_type,
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
    showCorrectSeatLight(correctSeat);
    startConfetti();
    state.game.status = "victory";
    publishHostLine(
      makeVictoryHostText(correctSeat, output.answer || getCurrentRiddle().answer),
      { priority: "P0", source: "victory", durationMs: HOST_SPEECH_P0_LOCK_MS },
    );
    setHostAvatarState("excited", { transient: false });
    state.host.targetSeat = correctSeat;
  }

  updateDecisionTrace(normalizeDecisionTrace(output, input));

  state.game.history.push({
    at: new Date().toISOString(),
    input,
    output,
  });

  if (isVictoryOutput) {
    scheduleNextRound();
  }
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
    state.workflow.hostAvatarTimer = setTimeout(() => {
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
  clearTimeout(state.workflow.hostAvatarTimer);
  state.workflow.hostAvatarTimer = null;
}

function schedulePassengerActivityClear() {
  if (state.workflow.activityTimer) clearTimeout(state.workflow.activityTimer);
  state.workflow.activityTimer = setTimeout(() => {
    clearPassengerActivities();
    state.workflow.activityTimer = null;
    render();
  }, 6000);
}

function showCorrectSeatLight(seat) {
  clearCorrectLightTimer();
  state.ui.correctLightSeat = seat;
  state.workflow.correctLightTimer = setTimeout(() => {
    state.workflow.correctLightTimer = null;
    state.ui.correctLightSeat = null;
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
  clearTimeout(state.workflow.correctLightTimer);
  state.workflow.correctLightTimer = null;
}

function scheduleNextRound() {
  clearNextRoundTimer();
  const completedRound = state.game.roundIndex;
  state.workflow.nextRoundTimer = setTimeout(
    () => advanceAfterVictory(completedRound),
    NEXT_ROUND_DELAY_MS,
  );
}

function advanceAfterVictory(completedRound) {
  state.workflow.nextRoundTimer = null;
  if (state.game.status !== "victory" || state.game.roundIndex !== completedRound) return;

  if (state.timeline.status === "paused") {
    state.workflow.nextRoundTimer = setTimeout(
      () => advanceAfterVictory(completedRound),
      PAUSED_ROUND_POLL_MS,
    );
    return;
  }

  if (completedRound >= state.game.totalRounds) {
    finishGameSeries();
    render();
    return;
  }

  state.game.roundIndex = completedRound + 1;
  state.game.currentRiddleIndex = (state.game.currentRiddleIndex + 1) % RIDDLES.length;
  state.game.questionCount = 0;
  state.game.roundQuestionPlan = null;
  state.game.usedRoundQuestionStepIds = [];
  state.game.coveredFactKeys = [];
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
  publishHostLine(`第 ${state.game.roundIndex} 题准备好了。`, {
    priority: "P2",
    source: "next_round",
  });
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

function finishGameSeries() {
  clearQuestionClock();
  clearNextRoundTimer();
  finishTimelineSilently();
  state.game.status = "summary";
  state.ui.cabinMode = "summary";
  clearConfetti();
  state.ui.showAnswer = false;
  state.ui.correctLightSeat = null;
  state.ui.animation = "summary";
  publishHostLine(makeSummaryHostText(), {
    priority: "P0",
    source: "game_summary",
    durationMs: HOST_SPEECH_P0_LOCK_MS,
  });
  state.host.emotion = "normal";
  state.host.targetSeat = null;
  setHostAvatarState(HOST_AVATAR_DEFAULT_STATE, { transient: false });
  state.ui.alert = "本轮游戏已完成";
}

function clearNextRoundTimer() {
  if (!state.workflow.nextRoundTimer) return;
  clearTimeout(state.workflow.nextRoundTimer);
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
  clearPassengerBubbles(seat);
  state.passengers.seats[seat].bubble = text;
  state.workflow.lastBubbleShownAt = Date.now();
  playPassengerBubbleSound();
  scheduleBubbleClear();
}

function getBubbleOutputDelayMs(input) {
  if (input.trigger_type !== "chat") return 0;
  if (!state.workflow.lastBubbleShownAt) return 0;
  const elapsed = Date.now() - state.workflow.lastBubbleShownAt;
  return Math.max(0, MIN_BUBBLE_DISPLAY_MS - elapsed);
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

function render() {
  const riddle = getCurrentRiddle();
  const screenMode = getGameScreenMode();
  const hostBusy = isHostBusy();
  const requestedHostState = normalizeHostAvatarState(state.host.avatarState);
  // Keep the thinking sprite alive until its own sequence finishes. A new
  // reply may reveal the bubble while the already-started animation continues.
  const hostThinking = hostBusy;
  const noWinnerReveal = state.game.status === "failed" && state.ui.showAnswer;
  const currentThinkingSprite =
    hostSprite.source === RESOURCE_CONFIG.host.thinking.src
    && hostSprite.thinkingCycleId === state.workflow.hostThinkingCycleId;
  const thinkingAnimationComplete =
    currentThinkingSprite && hostSprite.completed;
  const shouldShowThinking =
    !thinkingAnimationComplete
    && (state.workflow.hostThinkingActive || currentThinkingSprite);
  const renderedHostState = shouldShowThinking
    ? "thinking"
    : requestedHostState === "thinking"
      ? HOST_AVATAR_DEFAULT_STATE
      : requestedHostState;
  const hostBubbleText = hostThinking ? "" : String(state.host.text || "");
  const hostBubbleHidden = hostThinking || !hostBubbleText.trim();
  const hostSpeechVisible = !hostBubbleHidden;
  const mediaHostState =
    hostSpeechVisible && renderedHostState === HOST_AVATAR_DEFAULT_STATE
      ? "speak"
      : renderedHostState;
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
  els.gameScreen.className = `game-screen screen-${screenMode} ${getScreenEnvironmentClass(screenMode)}`;
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
  setRenderedImageSource(
    els.gameScreen.querySelector(".game-screen-background"),
    screenBackground,
    () => {
      refreshGameScreenBackdrop();
      if (state.ui.environmentAnnouncementPending === state.ui.screenEnvironment) {
        state.ui.environmentAnnouncementPending = "";
        showEnvironmentAnnouncement(state.ui.screenEnvironment);
      }
    },
  );
  els.environmentLabel.textContent = `车外环境：${state.car.environment}`;
  els.speedLabel.textContent = `${state.car.speed} km/h`;
  els.destinationLabel.textContent = `目的地：${state.car.destination}`;

  renderGameProgress();
  els.stageLabel.textContent = getStageLabel();
  els.riddleTitle.textContent = getRiddleTitle(riddle);
  const questionIntroVisible = isQuestionIntroVisible();
  els.riddleTitle.classList.toggle("question-intro", questionIntroVisible);
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
  const hostBubbleLength = Array.from(hostBubbleText).length;
  const hostBubbleVariant =
    hostBubbleLength > 46 ? "long-text" : hostBubbleLength > 28 ? "medium-text" : "";
  els.hostBubble.classList.remove("thinking");
  els.hostBubble.classList.toggle("hidden", hostBubbleHidden);
  els.hostBubble.classList.toggle(
    "medium-text",
    !hostBubbleHidden && hostBubbleVariant === "medium-text",
  );
  els.hostBubble.classList.toggle(
    "long-text",
    !hostBubbleHidden && hostBubbleVariant === "long-text",
  );
  els.hostBubble.setAttribute("aria-busy", hostBusy ? "true" : "false");
  const hostBubbleTextElement = setHostBubbleText(hostBubbleText);
  if (!hostBubbleHidden && hostBubbleVariant) {
    scheduleTextClamp(
      hostBubbleTextElement,
      hostBubbleText,
      hostBubbleVariant === "long-text" ? 4 : 3,
    );
  }
  els.hostAvatar.classList.toggle("thinking", hostThinking);
  els.hostAvatar.dataset.avatarState = mediaHostState;
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
  pendingImage.onload = () => {
    if (!image.isConnected || image.dataset.assetSource !== source) return;
    pendingImage.onload = null;
    pendingImage.onerror = null;
    for (const attribute of image.attributes) {
      if (attribute.name !== "src") pendingImage.setAttribute(attribute.name, attribute.value);
    }
    // A new node invalidates stale image layers under Safari's backdrop filters.
    image.replaceWith(pendingImage);
    onReplace?.();
  };
  pendingImage.onerror = () => {
    if (image.isConnected && image.dataset.assetSource === source) {
      delete image.dataset.assetSource;
      console.warn("Background image could not be loaded:", source);
    }
  };
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
  if (state.game.status === "summary") return "summary";
  if (state.game.status === "victory" || state.ui.showAnswer) return "reveal";
  if (state.game.status === "idle" && state.timeline.status === "idle") return "ready";
  return "playing";
}

function renderHostMedia(screenMode, avatarState = state.host.avatarState) {
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
    if (loadId !== hostSprite.loadId || hostSprite.source !== media.src) return;
    hostSprite.loading = false;
    hostSprite.fallback = true;
    els.hostCanvas.hidden = true;
    els.hostImage.hidden = false;
    els.hostImage.src = media.fallback || RESOURCE_CONFIG.host.normal.src;
    if (!media.loop) playHostSpriteAudio(media.audio).catch(() => {});
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
  Object.values(RESOURCE_CONFIG.host)
    .filter((media) => media?.kind === "sprite" && media.src)
    .forEach((media) => {
      void loadHostSpriteImage(media.src).catch((error) => {
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
  cancelAnimationFrame(hostSprite.animationFrameId);
  hostSprite.animationFrameId = requestAnimationFrame(stepHostSprite);
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
      hostSprite.animationFrameId = requestAnimationFrame(stepHostSprite);
      return;
    }
    drawHostSpriteFrame(hostSprite.frames.length - 1);
    hostSprite.playing = false;
    hostSprite.completed = true;
    hostSprite.animationFrameId = 0;
    state.workflow.hostThinkingActive = false;
    state.workflow.hostThinkingStartedAt = 0;
    if (hostSprite.source === RESOURCE_CONFIG.host.thinking.src) render();
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
  hostSprite.animationFrameId = requestAnimationFrame(stepHostSprite);
}

function resetHostSprite() {
  hostSprite.loadId += 1;
  cancelAnimationFrame(hostSprite.animationFrameId);
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

async function playHostSpriteAudio(audioMeta) {
  if (!audioMeta?.src) return false;
  const context = prepareAudioContext();
  if (!context) return playHostSpriteAudioElement(audioMeta);
  if (context.state === "suspended") {
    await context.resume().catch(() => {});
  }
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
    if (hostSprite.audioSource) stopHostSpriteAudio();
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
    console.warn("Host sprite audio could not use Web Audio; using media fallback.", error);
    return playHostSpriteAudioElement(audioMeta);
  }
}

function playHostSpriteAudioElement(audioMeta) {
  const audio = new Audio(new URL(audioMeta.src, document.baseURI).href);
  audio.preload = "auto";
  audio.volume = Math.min(1, Math.max(0, Number(audioMeta.volume) || 0.85));
  hostSprite.audioElement?.pause();
  hostSprite.audioElement = audio;
  const start = () => {
    audio.currentTime = Math.max(0, Number(audioMeta.trimStartMs) || 0) / 1000;
    audio.play().catch(() => {});
  };
  window.setTimeout(start, Math.max(0, Number(audioMeta.delayMs) || 0));
  audio.addEventListener("ended", () => {
    if (hostSprite.audioElement === audio) hostSprite.audioElement = null;
  }, { once: true });
  return true;
}

function stopHostSpriteAudio() {
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
  const stateKey = normalizeHostAvatarState(avatarState);
  return RESOURCE_CONFIG.host[stateKey] || RESOURCE_CONFIG.host.normal;
}

function startQuestionClock() {
  clearQuestionClock();
  questionClock.active = true;
  questionClock.expired = false;
  questionClock.startedAt = Date.now();
  questionClock.roundIndex = state.game.roundIndex;
  questionClock.intervalId = window.setInterval(tickQuestionClock, QUESTION_TIMER_TICK_MS);
  renderQuestionClock(0);
}

function clearQuestionClock() {
  if (questionClock.intervalId) window.clearInterval(questionClock.intervalId);
  questionClock.intervalId = 0;
  questionClock.startedAt = 0;
  questionClock.pausedAt = 0;
  questionClock.pausedDurationMs = 0;
  questionClock.roundIndex = 0;
  questionClock.active = false;
  questionClock.expired = false;
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
  questionIntro.timerId = window.setTimeout(() => {
    questionIntro.timerId = 0;
    if (questionIntro.roundIndex !== state.game.roundIndex) return;
    questionIntro.active = false;
    render();
  }, QUESTION_INTRO_DURATION_MS);
}

function clearQuestionIntro() {
  if (questionIntro.timerId) window.clearTimeout(questionIntro.timerId);
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
  questionClock.pausedAt = Date.now();
  renderQuestionClock(getQuestionElapsedMs(questionClock.pausedAt));
}

function resumeQuestionClock() {
  if (!questionClock.active || !questionClock.pausedAt) return;
  const resumedAt = Date.now();
  questionClock.pausedDurationMs += resumedAt - questionClock.pausedAt;
  questionClock.pausedAt = 0;
  renderQuestionClock(getQuestionElapsedMs(resumedAt));
}

function getQuestionElapsedMs(now = Date.now()) {
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
  const answer = String(getCurrentRiddle()?.answer || "").replace(/\s/g, "");
  renderQuestionTimerRing(remainingRatio, Boolean(questionClock.pausedAt), isUrgent);
  els.questionTimer.classList.toggle("is-urgent", isUrgent);
  els.questionTimer.classList.toggle("is-paused", Boolean(questionClock.pausedAt));
  els.gameScreen.classList.toggle("is-time-critical", isUrgent && !questionClock.pausedAt);
  els.questionTimer.setAttribute("aria-label", `本题剩余${remainingSeconds}秒`);
  els.answerLengthHint.textContent = `${Array.from(answer).length}个字`;
  els.answerLengthHint.hidden = elapsedMs < ANSWER_LENGTH_HINT_DELAY_MS || state.ui.showAnswer;
}

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
  if (isHostBusy() || state.workflow.pendingChats.length > 0) return;

  clearQuestionClock();
  abortActiveWorkflow();
  cancelPreparedHostReply();
  clearNextRoundTimer();
  state.workflow.pendingChats = [];
  state.game.status = "failed";
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
  finishTimelineSilently();
  render();
  state.workflow.nextRoundTimer = setTimeout(
    () => advanceAfterTimeout(completedRound),
    NEXT_ROUND_DELAY_MS,
  );
}

function resolveExpiredQuestion() {
  if (!questionClock.active || !questionClock.expired) return;
  if (getQuestionElapsedMs() < QUESTION_DURATION_MS) return;
  if (isHostBusy() || state.workflow.pendingChats.length > 0) return;
  handleQuestionTimeout(questionClock.roundIndex);
}

function advanceAfterTimeout(completedRound) {
  state.workflow.nextRoundTimer = null;
  if (state.game.status !== "failed" || state.game.roundIndex !== completedRound) return;
  if (completedRound >= state.game.totalRounds) {
    finishGameSeries();
    render();
    return;
  }

  state.game.roundIndex = completedRound + 1;
  state.game.currentRiddleIndex = (state.game.currentRiddleIndex + 1) % RIDDLES.length;
  state.game.questionCount = 0;
  state.game.roundQuestionPlan = null;
  state.game.usedRoundQuestionStepIds = [];
  state.game.coveredFactKeys = [];
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
  publishHostLine(`上一题时间到，第 ${state.game.roundIndex} 题准备好了。`, {
    priority: "P2",
    source: "next_round_after_timeout",
  });
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
  const total = Math.max(1, Number(state.game.totalRounds) || RIDDLES.length);
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
  return Math.min(7, state.game.totalRounds);
}

function getSummaryMvpSeat() {
  return state.ui.correctSeat || "front";
}

function makeSummaryHostText() {
  return "本次案件调查圆满收官。全车智商在线，下次上车我们继续开局！";
}

function formatDecisionText(text, suffix) {
  if (!suffix) return text;
  return `${text}（${suffix}）`;
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

function scheduleTextClamp(element, text, maxLines) {
  window.requestAnimationFrame(() => {
    if (
      !els.hostBubble.classList.contains("medium-text") &&
      !els.hostBubble.classList.contains("long-text")
    ) {
      return;
    }
    if (element.textContent !== text) return;
    clampTextToLines(element, text, maxLines);
  });
}

function clampTextToLines(element, text, maxLines) {
  const chars = Array.from(String(text || ""));
  if (!chars.length) return;

  const style = getComputedStyle(element);
  const toNumber = (value) => Number(String(value).replace("px", "")) || 0;
  const lineHeight = toNumber(style.lineHeight) || toNumber(style.fontSize) * 1.4;
  const maxHeight = Math.ceil(lineHeight * maxLines + 1);

  element.textContent = chars.join("");
  if (element.scrollHeight <= maxHeight) return;

  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    element.textContent = `${chars.slice(0, mid).join("")}…`;
    if (element.scrollHeight <= maxHeight) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  element.textContent = `${chars.slice(0, low).join("")}…`;
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
    status.textContent =
      (effectiveActivity !== "idle" ? seatState.activityLabel : "")
      || PASSENGER_ACTIVITY_LABELS[effectiveActivity]
      || seatState.mood;

    avatar.className = "passenger-figure";
    avatar.dataset.mood = seatState.mood;
    avatar.dataset.activity = effectiveActivity || "idle";
    avatar.src = resolvePassengerAsset(seat, seatState, effectiveActivity);
  });
}

function resolvePassengerAsset(seat, seatState, activity) {
  const relationshipSeats =
    RESOURCE_CONFIG.relationshipSeats[state.passengers.relationship]
    || RESOURCE_CONFIG.relationshipSeats["父母+小孩"];
  const personaKey = relationshipSeats[seat] || "maleYoung";
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

  const isBusy = isHostBusy();
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
  els.pauseTimeline.classList.toggle("is-paused", isTimelinePaused);
  els.pauseTimeline.setAttribute("aria-pressed", isTimelinePaused ? "true" : "false");
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
