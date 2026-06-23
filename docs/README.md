# 文档索引

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
12. [TEST_SCRIPT.md](./TEST_SCRIPT.md)

## 文档用途

### PRODUCT_BRIEF.md

说明这个 demo 为什么做、给谁看、比赛里要证明什么，以及当前不做什么。

### MVP_SPEC.md

定义 V1.x 的最小闭环、三分区功能、车内互动区、时间轴、模拟乘客、题库、事件优先级、状态中心和插件化边界。

### WORKFLOW_CONTRACT.md

定义网页和 Coze/Dify Workflow 的输入输出 JSON，包括 `passenger_action`、时间轴事件和 UI 指令。后续前端和工作流都应以这份契约为准。

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

梳理当前哪些主持话术来自 Coze，哪些被前端覆盖，以及哪些覆盖是为了稳定性必须保留、哪些可以逐步放权给 Coze。

### PUBLIC_ACCEPTANCE_REPORT.md

记录公网端到端验收结果、问题优先级、演示准入标准和每轮分享前的主链路测试结论。

### ROADMAP.md

规划后续版本节奏，避免一次性塞太多功能导致不稳定。

### TEST_SCRIPT.md

提供每次修改后的回归测试步骤、分享体验测试步骤和比赛现场讲解脚本。

## 维护规则

- 修改功能前，先确认是否符合 `PRODUCT_BRIEF.md` 和 `MVP_SPEC.md`。
- 修改接口前，必须同步更新 `WORKFLOW_CONTRACT.md`。
- 每次完成稳定版本后，更新 `ROADMAP.md` 状态。
- 每次发现新的现场风险，补充到 `TEST_SCRIPT.md`。
- 每个稳定版本都建议 Git 提交并打标签。
