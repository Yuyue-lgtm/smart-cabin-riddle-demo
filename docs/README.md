# 文档索引

这个目录用于固定项目方向，避免后续开发偏离“可分享体验版智能座舱 AI 猜谜 Demo”的目标，或让代码逻辑变得难以维护。

建议每次开始新一轮开发前先看：

1. [PRODUCT_BRIEF.md](./PRODUCT_BRIEF.md)
2. [MVP_SPEC.md](./MVP_SPEC.md)
3. [WORKFLOW_CONTRACT.md](./WORKFLOW_CONTRACT.md)
4. [ROADMAP.md](./ROADMAP.md)
5. [TEST_SCRIPT.md](./TEST_SCRIPT.md)

## 文档用途

### PRODUCT_BRIEF.md

说明这个 demo 为什么做、给谁看、比赛里要证明什么，以及当前不做什么。

### MVP_SPEC.md

定义 V1.x 的最小闭环、三分区功能、车内互动区、时间轴、模拟乘客、题库、事件优先级、状态中心和插件化边界。

### WORKFLOW_CONTRACT.md

定义网页和 Coze/Dify Workflow 的输入输出 JSON，包括 `passenger_action`、时间轴事件和 UI 指令。后续前端和工作流都应以这份契约为准。

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
