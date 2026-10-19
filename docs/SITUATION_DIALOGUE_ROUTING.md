# 情境分析后自动接续 Chatflow

2026-10-17。本文替代早期“本地环境短句＋后台分析”方案。云端版本与精确 hash 见 [Dify 当前状态](DIFY_CURRENT_STATE.md)。

## 请求顺序

乘客原话直接调用 Chatflow。座舱事件先请求情境 Workflow，前端收到分析后更新面板；当 `analysis_status=ready`、`request_proactive_speech=true` 且事件仍有效时，自动发起第二次同源请求到 Chatflow。情境 Workflow 的 `host_response` 固定为空。过期、被替代、失败的分析不触发 Chatflow，也不补通用承接语。

2026-10-18睡眠/醒来事件例外：BFF确认目标仍睡着，或目标已醒且该区关怀已启用后，附加 `request_host_decision=true` 和 `host_decision_seat`。即使 `request_proactive_speech=false` 仍签发交接凭据，请求主持人做设备决策。若输出启用/恢复动作，必须伴随灯光、空调、分区音量承接话术；前端将动作与话术一起排队，等气泡真正显示才执行模拟。静默情境且无动作时仍清空自然话术。其他静默事件仍不调用Chatflow。

P1 环境变化、车速首次超过 120 km/h、主驾疲惫/睡着持续超过 15 秒使用代码规则分析，跳过情境模型和知识检索。其他事件按需执行一次分析模型及经验检索；原“生成候选串词”的第二个模型节点已移除。Chatflow 负责最终表达，沿用结构化输出和一次有条件重试。

P0 急刹、安全暂停、答对、超时和整局结束仍在前端立即处理。后台只记录情境，不进入自动 Chatflow 串词。急刹按本地 4500ms 恢复。

## 前端路由协议

第一步：`POST /api/workflow`，`route=situation`、`trigger_type=event`，携带当前快照、事件、稳定用户 ID。BFF 调用情境 Workflow `/v1/workflows/run`，返回 `scene_output`；需要主动发言时还返回 `situation_handoff`。

第二步由前端发起：

```json
{
  "route": "chat",
  "operation": "situation_reply",
  "user_id": "同一稳定用户ID",
  "conversation_id": "全局复用的Dify会话ID",
  "situation_handoff": "上一步返回的短期交接凭据",
  "input_payload": "当前快照及原事件JSON字符串"
}
```

快照带 `dialogue_request={"kind":"situation_event","event_id":"原事件ID"}`，`trigger_type` 仍为 `event`，`player_input` 为空，不虚构乘客发言、不增加提问次数。BFF 生成简短系统通知 query，将本次分析放入 Chatflow `inputs.situation`。事件与乘客对话共用持久 `conversation_id`、`user_id` 及单个请求队列，避免同一会话并发乱序。

交接凭据由服务端 HMAC 签名，绑定用户、事件、原始优先级、局、题、情境版本与有效期。密钥留在服务端。凭据包含本次分析，支持两次请求落到不同 Vercel 实例，不依赖进程内缓存。普通聊天仍可读取已完成的有效情境缓存。

## 播放与失效

- 最新调度规范见 [主持人多事件队列](HOST_EVENT_QUEUE.md)，覆盖此前“P1满1.5秒抢占”和“所有状态变化统一失效”的行为。
- 按事件类型和目标合并：睡眠/醒来按座位独立保留，同一目标的新状态替代旧状态；环境只保留最新。不同座位或不同类型的重要事件不互相覆盖。
- 依事件自身条件判断有效性；其他座位或无关环境变化不直接取消旧事件。轮到生成时如果全局版本已变，重新分析并签发新交接，不修改旧签名或放宽BFF校验。
- P1优先进入下一可用Chatflow槽，同级FIFO，排队乘客问题按P2参与；分析先返回不代表先回应。
- 除P0外均等当前气泡正常结束，再播放队列中最高优先级的一条。未完成事件在安全/揭晓P0后重建快照重新处理，不复用旧结果。
- 环境变化、睡着、目的地的本地固定串词已移除。中控屏背景仍独立延迟 2 秒切换。
- 情境串词不触发思考动画；只有乘客 Chatflow 问答等待才触发。
- 情境回复不应用游戏状态、事实更新、乘客动作或音乐；设备仅开放当前睡眠事件中的 `cabin.apply_sleep_comfort` 及已醒且关怀启用目标的 `cabin.restore_sleep_comfort`。两者必须伴随灯光/空调/音量说明，随话术一起排队；气泡实际显示时重新验证并执行模拟。即使原情境静默，有设备动作也须发言；无动作则仍可静默。醒来不立即恢复，守卫失败或越权结果静默并记录回执。详见 [睡眠关怀](SLEEP_COMFORT.md)。
- 揭晓后成就反馈也使用分析→Chatflow，沿用原 P0 后窗口、真实成绩、偏好、限频和事实兜底。

手动区共十一类：急刹、主驾疲惫、主驾分心、临时事件打断、有人睡着、乘客醒来、快到目的地、车速超限、猜谜陷入僵局、接近答案、车内欢笑。全部上报情境 Workflow，主持人在忙时也不丢弃点击。临时打断本地暂停4.5秒并保留待回答问题，后台只记录，没有导航逻辑；分心和疲惫为P1安全提醒，不通过游戏干预主驾。手动疲惫模拟已持续超过15秒；自动检测仍等待实际持续时间。手动超速设为至少130 km/h，并构造阈值穿越事件。完整规则见 [座舱情境协同](CABIN_SCENARIO_POLICY.md)。

## 修改与验证

源文件：`scene_input.py`、`scene_priority_context.py`、`scene_analysis_result.py`、`dialogue_event_input.py`、`dialogue_event_guard.py`、`event-dialogue-prompt.txt`。补丁入口为 `scripts/lib/situation-dialogue.mjs`，生成器 `build-parallel-host.mjs` 已接入。

```sh
node --test tests/*.test.cjs
python3 tests/dify-situation-dialogue-guard.py
node tools/dify-workflow-mcp/scripts/update-situation-dialogue.mjs prepare
node tools/dify-workflow-mcp/scripts/update-situation-dialogue.mjs save
node tools/dify-workflow-mcp/scripts/update-situation-dialogue.mjs verify
node tools/dify-workflow-mcp/scripts/update-situation-dialogue.mjs publish
node tools/dify-workflow-mcp/scripts/update-situation-dialogue.mjs sync-local
```

补丁基于实时云端草稿，保留模型、Memory、检索绑定及非目标节点。保存、发布检查精确 hash，发布只接受对应草稿的通过记录。`tmp/dify-import/situation-dialogue/` 保存忽略的原图备份、候选、原始测试 trace 与发布记录，不可将过期 DSL 覆盖后续改动。

浏览器回归使用 `tests/dify-environment-browser.cjs` 和 `tests/host-experiences-browser.cjs`。诊断用同一个 `event_id` 串起 `route=situation` 与 `route=chat, operation=situation_reply`，可分别观察两段耗时。总响应时间仍为分析、Chatflow生成及排队之和；P1 规则分支消除第一段的模型和检索等待。
