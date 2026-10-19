# 下一题应景选题

更新：2026-10-19。选题由前端负责；题库有10个候选谜题，每局使用6题。最新增量为应景开场，前端和BFF新增受限的开场请求，复用现有主持Chatflow。不新增或修改Dify云端工作流。每局六题及控制器行为详见 [游戏暂停权限与六题配置](GAME_CONTROL_AND_SIX_ROUNDS.md)。

## 规则

1. 当前题一旦开始即锁定谜底、题面提示、问题次数与已确认事实。环境变化不能中途换题。
2. 进入当前题时仍提前准备下一题。优先从现有题库选择符合当前环境、且本局未出过的题目；没有合适题目时按原题库顺序循环寻找未出题，不重复凑题，不让模型现场编谜底。
3. 本局记录 `state.game.playedRiddleIndices`，每题开始时记录一次；准备页预取不算已出题，新局或重置清空。
4. 环境切换后稳定800ms，再调整下一题；连续变化只处理最后一个环境。这个延时不改变座舱立即换图、中控延后2秒换图和原有情境事件响应。
5. 仅当下一题实际改变时，取消并替换旧预演；新请求携带目标题的谜底、题号、主题、最新座舱快照和空的本题问答记录。保留已选单题时间轴，不改变模拟事件节奏。
6. 下一题相同则直接复用待返回或已完成的预演，不因为环境文字、刷新或换题边界再次请求。已替换预演即使晚返回，也不能覆盖新缓存或当前计划。
7. 答对和超时两条换题路径均在进入下一题前按最新环境确认选题；若800ms稳定计时尚未结束，以换题边界当时环境为准并取消旧计时。进入后锁题，后续环境变化只能影响再下一题。
8. 预演未完成或失败也照常开题；没有有效计划就跳过模拟乘客提问，不使用本地问题或旧题计划，不补播错过的时间点。主持人实际回答仍走 Chatflow。
9. 最后一题不准备第11题。结算页预取下一局第一题和准备页初始选题保持原逻辑，本次不改成“下一局应景”。

## 环境优先级

按下表顺序匹配；天气优先于道路/地点，排除已出题后可继续选其它匹配主题。

| 环境包含 | 主题 | 当前候选谜底 |
| --- | --- | --- |
| 雨 | 雨天 | 雨伞 |
| 雪 | 雪景 | 雪人 |
| 城区 | 城区 | 红绿灯 |
| 风景区 | 风景 | 草原 |
| 高速 | 高速 | 安全带 |

例如“城区雨天白天”优先雨伞，若已出则选未出过的红绿灯；两者已出则走普通顺序。“风景区雪景白天”优先雪人，其次草原。车库、隧道没有专属题目，不强行映射。

## 异步和暂停边界

- `roundQuestionPreparations` 仍以局/题为键；替换后通过对象身份、取消状态、目标谜底及局/题校验隔离晚返回结果，修复请求也一并取消。
- 普通急刹/安全暂停仍可保留并准备下一题，不能将结果用于当前题或执行UI动作。
- 手动“暂停模拟”使用模拟时钟暂停800ms稳定计时；已返回的预演等待恢复，沿用完整冻结规则。
- 重置和结算清除未执行的环境选题计时，避免旧局回调影响新局。
- 调试控制台 `[next-riddle]` 记录目标局/题、环境、题目索引、主题与 `environment_match / unused_sequence` 选题原因；不向玩家显示未来谜底。

## 验证与入口

### 应景题开场串词

- 只在下一题实际开始、`第N题`提示出现时请求；第1题、普通顺序题不新增固定开场。题目必须有本轮选题记录，且确实匹配当前环境。
- 每题至多申请一次自然串词，不在切环境时提前承诺下一题。请求触发后6秒为开场有效窗口，沿用模拟时钟，手动暂停不消耗窗口。生成不播放思考动画。
- 串词为P3，按现有气泡锁和优先级排队；乘客问答、P0/P1/P2优先。等待中的开场可以等重要话术结束，但超出窗口就跳过；生成中遇更高优先级事件时取消，不阻塞该事件。
- 任意乘客开始发言，即使不计提问次数，也取消未播开场。P0、环境再次变化、换题、新局、已结束状态和错误来源都拒绝旧结果。已经实际显示的气泡仍遵守现有6秒/最短展示规则，不因后续提问突然消失。
- 只消费通过守卫的简短`intent=event`话术，不调用`applyWorkflowOutput`改变游戏；禁止谜底、事实更新、答对/揭晓、模拟乘客和设备动作。失败或过晚保持静默，不补固定话术。
- `route=chat, operation=environment_round_intro`，输入为`trigger_type=event, event.type=round_changed, event.source=environment_riddle, event.priority=P3`。BFF检查题号>=2、未开始问答、主题与环境匹配等，再构造一次性规则情境传给Chatflow已有`situation_event`处理。不请求情境Workflow，不写入情境缓存、不接受前端任意指导词或动作授权，也不放宽普通情境签名交接。
- 使用原同源用户ID和全局`conversation_id`。网关健康标记`workflow_proxy.environment_round_intro=true`，修改BFF后需重启本地服务；4186已重启。三个Dify应用本次均未保存草稿或发布。

真实发布API以独立用户、同一会话验证雪景/雨天/城区：均通过守卫、动作与事实为空，耗时4422/4103/4565ms。运行ID分别为`4542fdda-3b66-4a83-911b-da6bcc08019a`、`ba016d1c-a9a3-400e-a9f7-08e632b01837`、`9bf6dc27-cfe7-4eb8-9cd8-39dec6d999ef`，记录见`tmp/environment-round-intro/live-verification.json`。实际Chrome→本地BFF→发布Chatflow也验证显示，截图`tmp/environment-round-intro-live.png`；仅预演和其它事件使用桩。

```sh
node --test tests/environment-round-intro.test.cjs
PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/environment-round-intro-browser.cjs
LIVE_INTRO=1 PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/environment-round-intro-browser.cjs
node --env-file=.env.local tools/dify-workflow-mcp/scripts/verify-environment-intro-api.mjs
```

后两条调用真实发布API并产生测试日志/模型用量，不保存或发布工作流。全部142项本地单元测试通过，其中新增12项开场测试；浏览器正常开场、一次性、无思考、乘客抢先和P0保护通过，原应景选题、完整暂停和多事件队列回归通过。已取消请求在解析完成后也不能写回旧会话ID。

主要代码：`setEnvironment`、`selectNextRiddleIndex`、`prepareFollowingRound`、`advanceAfterVictory`、`advanceAfterTimeout`。

```sh
node --test tests/*.test.cjs
PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/environment-riddle-browser.cjs
```

历史验证当时每局为10题；当前已改为每局6题，候选池仍为10题。该组历史130项回归覆盖当时的十题完整唯一性；现行六题设置与完整回归见 [游戏暂停权限与六题配置](GAME_CONTROL_AND_SIX_ROUNDS.md)。Chrome浏览器使用桩响应验证实际环境按钮、题面、预演问题、主持Chatflow当前题快照、两条换题路径和未来谜底不泄露；检查桌面与小窗口截图 `tmp/environment-riddle-snow.png`、`tmp/environment-riddle-rain-small.png`。不以桩测试替代云端生成质量验收。

最新脚本缓存版本 `20261018-environment-round-intro-v1`，刷新本地页面后生效；未部署线上。
