# 游戏暂停权限与六题配置

更新：2026-10-19。本地前端和主持人 Chatflow 已实现游戏暂停/继续；现有乘客输入框继续作为语音指令的模拟入口，不包含麦克风识别。

## 游戏控制

- 玩家可在游戏进行中输入明确的“暂停游戏”“继续游戏”等指令。前端解析玩家原话；只有明确匹配的请求才允许执行 `game.set_paused`，模型单独提出的动作不授予权限。
- 暂停保留当前题、已用问题数、已确认事实和倒计时剩余时间；自动时间轴停止。继续时从剩余时间恢复，重复暂停/继续不会重置进度。
- 暂停/继续由玩家明确发起时，主持人不播放思考动画；确认话术走正常气泡优先级和显示时长。
- 处于急刹等安全暂停时，`game.set_paused(false)` 无法恢复游戏。安全恢复后，如果玩家此前暂停了游戏，仍保持玩家暂停状态。
- “暂停模拟”是另一种操作：它冻结三分区画面、音频、模拟时钟和异步结果。游戏暂停不冻结座舱控制、气泡动画或玩家控制输入。
- 每题倒计时未激活时，暂停/继续指令不启动或伪造一局游戏。否定、假设、咨询式表达、音乐请求及谜题描述不触发游戏暂停。

## 六题与进度条

- 每局六题；题库仍有十个候选谜题，按环境匹配和本局去重选题。第六题答对或超时后进入结算，不启动第七题。
- 中控屏顶部显示六个进度点，中心位置不变，点间距仍为 `46px`。六点轨道宽 `270px`，居中于原进度条位置。
- 结算页完成题数上限为六题，破解数初始值为零。
- 自动睡眠事件进行期间，车速和车外环境按钮保持可用；仅在“暂停模拟”全冻结期间禁用。

## Dify 更新

主持人 Chatflow App ID：`74bef8bd-22bd-4e19-91da-5e8d645dd8ed`。游戏暂停动作是受限动作 `{"type":"game.set_paused","paused":true|false}`；服务端守卫只接受与玩家明确原话相符的请求，并拒绝否定、假设、音乐指令及安全暂停覆盖。情境 Workflow 和提问预演 Workflow 未因本次权限变更而更新。

2026-10-19 发布并读回的主持人 hash：`5fd8948bda460cb725b10b271ddfa51c33976fc1a6bab66bcee9a3481ee3d6d0`。发布前通过 74 个 Dify 代码节点守卫用例和 8 个真实云端场景，包括暂停、继续、重复请求、安全暂停保护、否定请求、假设表达及普通问答。完整规则与维护脚本见 [Dify 当前状态](DIFY_CURRENT_STATE.md) 及 `tools/dify-workflow-mcp/scripts/update-game-control.mjs`。

## 回归

```sh
node --test tests/*.test.cjs
PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/game-control-browser.cjs
PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/simulation-freeze-browser.cjs
PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/multi-event-queue-browser.cjs
```

本次 153 项本地单元测试、游戏控制浏览器流程、完整暂停冻结和多事件队列验证通过。真实页面暂停/继续请求也通过本地 `/api/workflow` 调用已发布 Chatflow 验证。当前前端仅在本地运行，未部署 Vercel。
