# 文档索引

当前日常 Dify 迭代入口：[阿里云测试与正式发布](DIFY_ECS_ITERATION.md)。本地 Demo 已切到独立 ECS 测试三应用/测试知识库，地址4175；Cloud仅作历史备份。统一命令 `node tools/dify.mjs` 完成状态检查、初始化、测试与发布；生产应用ID继续保留。

主持人语音播报接入配置：[CosyVoice 新加坡 / 龙华 `longhua_v3`](COSYVOICE_TTS.md)。密钥仅配置在 Demo 服务端环境中。

游戏加载页、默认首题加载条件、20秒失败出口及场景预演缓存：[GAME_LOADING.md](GAME_LOADING.md)。当前先在本地4175体验，未部署正式网站。

开始新的 Dify 子对话时，先读 [DIFY_CURRENT_STATE.md](./DIFY_CURRENT_STATE.md)。该文件记录最近确认的云端版本、应用职责、当前运行边界和安全迭代步骤；细节再查对应专题文档。

工作流和知识库的正式版本资料见 [dify/README.md](../dify/README.md)：已保存三套 Cloud 完整 DSL、三套 ECS 迁移导入副本、28 条知识库原文、环境绑定及 SHA-256 清单。当前归档是 2026-10-19 来源/2026-10-20 上线的迁移基线，不是新做的 ECS 发布图回读；后续稳定版本另建目录保留历史。

阿里云香港 ECS / 自托管 Dify 已上线 [https://cabinplay.xyz/](https://cabinplay.xyz/)，三套目标应用已发布、28条经验已迁移。当前配置、备份、验收和已知问题见 [生产部署记录](ALIBABA_CLOUD_PRODUCTION.md)；准备和迁移历史见 [部署与迁移记录](../deploy/alibaba-cloud/README.md)。换题语义问题按用户选择暂未修复，本机Cloud配置仍保留，勿混用两套App ID或维护脚本。

2026-10-20 最近维护：`agent_backend` 密钥长度错误已修复，仅重建该容器，其他运行容器未变；复查重启0次，三应用10次生产接口回归及161+5项本地测试通过。[修复详情与私有备份位置](ALIBABA_CLOUD_PRODUCTION.md#agent-启动配置修复2026-10-20)。测试次数是当次结果，不代表持续监控；本次文档整理不重新运行线上请求。

- [ALIBABA_CLOUD_PRODUCTION.md](./ALIBABA_CLOUD_PRODUCTION.md)：当前线上入口、三应用ID、服务与安全配置、两轮正式API验收、Agent修复、备份/回退及待办。
- [DIFY_CONNECTION.md](./DIFY_CONNECTION.md)：固定8081直接SSH、Mac后台自动重连、启动前鉴权检查、一键doctor/smoke与断线恢复证据。
- [部署工具与迁移历史](../deploy/alibaba-cloud/README.md)：已完成的导入、知识库重绑、执行工具及分阶段授权边界；历史“未发布/未修复”不代表现状。
- [DIFY_CHATFLOW_INTEGRATION.md](./DIFY_CHATFLOW_INTEGRATION.md)：当前接入、节点职责、动作权限、草稿生成与发布。
- [DIFY_CURRENT_STATE.md](./DIFY_CURRENT_STATE.md)：ECS生产与Cloud来源的区别、最近已确认状态、跨子对话接手顺序和未解决事项。
- [CABIN_SCENARIO_POLICY.md](./CABIN_SCENARIO_POLICY.md)：入睡必启关怀与空调用户记忆值、普通分区灯光权限、公开线索重述、临时打断与主驾安全边界。
- [HOST_EVENT_QUEUE.md](./HOST_EVENT_QUEUE.md)：多事件优先级/FIFO、按座位合并、局部失效、P0后重新分析、设备去重与控制台诊断。
- [SIMULATION_FREEZE.md](./SIMULATION_FREEZE.md)：暂停时冻结三分区画面、音频、计时和异步结果，恢复后从原位置继续。
- [GAME_CONTROL_AND_SIX_ROUNDS.md](./GAME_CONTROL_AND_SIX_ROUNDS.md)：玩家暂停/继续游戏权限、六题进度条、控制器可用状态及本次 Dify 发布验收。
- [ENVIRONMENT_AWARE_RIDDLES.md](./ENVIRONMENT_AWARE_RIDDLES.md)：当前题锁定、下一题按环境择优、本局去重及预演安全替换。
- [DIFY_RELIABILITY_20261018.md](./DIFY_RELIABILITY_20261018.md)：最新结构化输出修复、原始失败根因、三应用发布与回归验收。
- [SITUATION_DIALOGUE_ROUTING.md](./SITUATION_DIALOGUE_ROUTING.md)：情境分析后自动调用Chatflow、P1规则快速分支、事件有效期与串词仲裁。
- [SLEEP_COMFORT.md](./SLEEP_COMFORT.md)：入睡必启关怀、随话术执行、醒来恢复、四区模拟与Figma资源。
- [DIFY_PARALLEL_HOST.md](./DIFY_PARALLEL_HOST.md)：Chatflow 与情境/预演 Workflow 的路由和契约。
- [DIFY_FALLBACK_DIAGNOSTICS.md](./DIFY_FALLBACK_DIAGNOSTICS.md)：模型兜底根因、重试、云端节点日志和前端答对后未推进的本机诊断。
- [HOST_EXPERIENCES_V2.md](./HOST_EXPERIENCES_V2.md)：28条主持经验、首批成就反馈、真实统计、偏好记忆及HK28副驾低压力邀请。
- [REALTIME_HOST_CONTEXT.md](./REALTIME_HOST_CONTEXT.md)：精简上下文、状态同步、主动事件和前端初始化约束。

这个目录用于固定项目方向，避免后续开发偏离“可分享体验版智能座舱 AI 猜谜 Demo”的目标，或让代码逻辑变得难以维护。

建议每次开始新一轮开发前先看：

1. [PRODUCT_BRIEF.md](./PRODUCT_BRIEF.md)
2. [MVP_SPEC.md](./MVP_SPEC.md)
3. [WORKFLOW_CONTRACT.md](./WORKFLOW_CONTRACT.md)
4. [FUSION_DECISION_KNOWHOW.md](./FUSION_DECISION_KNOWHOW.md)
5. [COZE_WORKFLOW_DESIGN.md](./COZE_WORKFLOW_DESIGN.md)
6. [COZE_BUILD_PACKAGE.md](./COZE_BUILD_PACKAGE.md)
7. [COZE_FAST_PATH_OPTIMIZATION.md](./COZE_FAST_PATH_OPTIMIZATION.md)
8. [GOLDEN_EXPERIENCE_LINES.md](./GOLDEN_EXPERIENCE_LINES.md)
9. [HOST_COPY_OWNERSHIP.md](./HOST_COPY_OWNERSHIP.md)
10. [PUBLIC_ACCEPTANCE_REPORT.md](./PUBLIC_ACCEPTANCE_REPORT.md)
11. [ROADMAP.md](./ROADMAP.md)
12. [V1_4_UI_DESIGN_INPUT.md](./V1_4_UI_DESIGN_INPUT.md)
13. [TEST_SCRIPT.md](./TEST_SCRIPT.md)
14. [V1_4_UI_IMPLEMENTATION.md](./V1_4_UI_IMPLEMENTATION.md)
15. [COZE_ROUND_QUESTION_PLAN.md](./COZE_ROUND_QUESTION_PLAN.md)

## 文档用途

### PRODUCT_BRIEF.md

说明这个 demo 为什么做、给谁看、比赛里要证明什么，以及当前不做什么。

### MVP_SPEC.md

定义 V1.x 的最小闭环、三分区功能、车内互动区、时间轴、模拟乘客、题库、事件优先级、状态中心和插件化边界。

### WORKFLOW_CONTRACT.md

定义网页和 Coze/Dify Workflow 的输入输出 JSON，包括 `passenger_action`、时间轴事件、Chatflow 感知/决策/执行结构与动作白名单。实时主持的当前实现以 Dify 文档为准。

### FUSION_DECISION_KNOWHOW.md

定义融合决策 Know-how 的三层形态（常驻原则、策略索引、完整经验库），以及第一版收敛后的高感知状态和典型主持案例。

### COZE_WORKFLOW_DESIGN.md

定义当前“座舱状态摘要、策略选择、按需 Know-how、单次快速导演”的目标架构，并保留旧版节点职责作为参考。

### COZE_BUILD_PACKAGE.md

保留 V1.1 完整节点版的可复制配置，主要用于理解职责；当前部署以快速路径和最新 Workflow 设计为准。

### COZE_FAST_PATH_OPTIMIZATION.md

提供 V1.2 低延迟 Workflow 改造包，并说明如何在保持单模型调用的前提下升级融合决策能力。

### GOLDEN_EXPERIENCE_LINES.md

定义 V1.2 的三条黄金体验线，包括默认状态、时间轴事件、AI 主持策略、UI 高光和备用手动触发方式。

### HOST_COPY_OWNERSHIP.md

梳理当前 Dify Chatflow 与前端的话术边界、环境事件时序和本地兜底；保留 Coze 阶段的历史覆盖分析。

### PUBLIC_ACCEPTANCE_REPORT.md

记录公网端到端验收结果、问题优先级、演示准入标准和每轮分享前的主链路测试结论。

### ROADMAP.md

规划后续版本节奏，避免一次性塞太多功能导致不稳定。

### V1_4_UI_DESIGN_INPUT.md

为 `V1.4` 的整体 UI 与交互体验优化提供设计输入，包括三张核心画面定义、组件清单、资源清单、出图流程，以及 ChatGPT 与 Codex 的分工建议。

### TEST_SCRIPT.md

提供每次修改后的回归测试步骤、分享体验测试步骤和比赛现场讲解脚本；近期记录包含换题阻塞诊断，以及首题、答对换题、超时换题的 3 秒题号提示浏览器回归。

### V1_4_UI_IMPLEMENTATION.md

记录 V1.4 当前已落地的 Figma 页面资源、固定画布规则、主持人 Sprite Sheet 与 Canvas 播放、题目倒计时、气泡小三角和透明切片阴影实现约定。

### COZE_ROUND_QUESTION_PLAN.md

定义“每题开场一次生成逻辑提问链”的 Coze 改造方式、Prompt、输出守卫、前端消费规则与验收用例。

## 维护规则

- 修改功能前，先确认是否符合 `PRODUCT_BRIEF.md` 和 `MVP_SPEC.md`。
- 修改接口前，必须同步更新 `WORKFLOW_CONTRACT.md`。
- 每次完成稳定版本后，更新 `ROADMAP.md` 状态。
- 每次发现新的现场风险，补充到 `TEST_SCRIPT.md`。
- 每个稳定版本都建议 Git 提交并打标签。
