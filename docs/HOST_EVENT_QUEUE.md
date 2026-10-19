# 主持人多事件队列

更新：2026-10-18。前端缓存版本 `20261018-event-priority-queue-v1`。本次只调整前端调度，不修改Dify图、发布版本、BFF签名协议或模型权限。

## 调度规则

- P0仍由本地立即处理并抢占；其余话术不打断正在显示的气泡，保持现有1.5秒最短、6秒最长时长，P1默认3秒。
- 新乘客问题的思考动效同样等待当前气泡的显示期结束，避免虽然没有新话术抢占、旧气泡却被思考状态提前隐藏。
- 待处理事件按P1→P2→P3→P4排序，同级按收到事件的序号FIFO。分析可异步完成，但低优先级或后到同级分析先返回，不能抢先进入主持Chatflow。
- Chatflow仍单请求串行，与乘客提问共用请求槽；排队的真实乘客问题按P2参与FIFO。已经开始的模型请求不被普通事件粗暴取消，其回复按话术队列等待。
- 前端 `state.workflow.situationEvents` 保存事件意图、座位、局/题、依赖、顺序、状态及设备去重键；`pendingSituationReplies` 保存有效分析交接，`deferredHostReplies` 是统一待播话术队列。不再用单个最短气泡/环境槽覆盖普通待播事件。

## 合并与有效性

- 睡着与醒来共享 `sleep_state:座位` 键：不同座位互不覆盖；同一座位发生新状态，替代尚未完成的旧状态事件。
- 环境变化只保留最新环境；不同类型的重要事件独立保留。同类型同目标的新通知替代旧通知，并记录原因。
- 播放前检查该事件自己的依赖：睡眠/醒来检查目标座位状态，环境检查当前环境，主驾事件检查驾驶员状态，超速检查是否仍超限，目的地检查是否仍为该目的地。其他乘员或无关环境变化不直接取消关怀事件。
- 普通乘客回答绑定局、题、谜底与P0代数；无关座舱变化不使当前题回答丢失。跨题、换局和P0旧结果仍拒绝。
- 邀请、僵局、接近答案、笑声等题内/氛围事件仅在本题且30秒内有效；重要状态事件保持到条件改变或本局结束。已完成历史最多保留最近100条，尚未完成的事件不因历史条数限制而删除。
- 生成话术时重建当前快照。如果原分析的 `scene_version` 已变化，重新请求情境Workflow取得最新签名交接，再请求Chatflow；不篡改旧凭据，不放宽服务端的局/题/版本/HMAC校验。
- 分析或待播凭据超过有效期时，重要事件回到重新分析阶段，不把过期话术或设备计划直接执行。真正网络失败/模型守卫失败仍记录失败，不伪称已回应。

## P0 与设备

安全暂停、临时打断、答对和超时让旧请求、旧交接和待播话术全部失效，但保留尚未处理的事件意图。恢复或进入下一题后，用新的P0代数、当前题和最新快照重新分析；题内事件自然取消，仍有意义的座舱事件继续处理。重置、新局和整局结束取消旧局待办。

睡眠关怀仍须等待对应话术真正开始显示，再核对座位/状态/作用域。每个事件的设备动作按“动作类型＋座位”去重；P0后重分析也不会重复执行同一动作。入睡关灯、分区音量0、空调用户记忆值及醒来恢复规则不变。

## 诊断与回归

融合决策面板现已直接表达仲裁结果：感知保留原观察并汇总同时事件；决策标题显示前端实际优先级标签，正文说明“高优先级先回应／当前气泡结束后处理／同级FIFO／P0等待”等原因；执行正文显示正在回应及接下来前两项，更多待办显示数量。原始模型决策、检索内容和设备回执保留，可在原列内滚动查看。优先级不是模型自行上报值，而是同一前端仲裁函数的结果。分析未形成决策时，不提前显示优先级或执行；面板为空时不显示队列模板或箭头。

该显示层不改变队列、时长、动作权限或Dify规则。最新脚本及样式缓存版本均为 `20261018-priority-panel-v1`。浏览器回归 `tests/decision-priority-browser.cjs` 覆盖桌面与1024px窗口、P1环境回应/P2双座位等待、P0抢占与空状态；截图 `tmp/decision-priority-desktop.png` 和 `tmp/decision-priority-small.png`。

控制台筛选 `[situation-event]` 可看每次状态变化及原因；或输入：

```js
console.table(state.workflow.situationEvents.map(({ event, status, reason, sequence }) => ({
  id: event.id, type: event.type, seat: event.seat, priority: event.priority, sequence, status, reason
})))
```

状态包括 `pending_analysis`、`analyzing`、`ready`、`generating`、`waiting_speech`、`showing`、`completed`，以及带原因的 `superseded/cancelled/silent/failed`。同一个 `event_id` 继续串起本地BFF日志和两段Dify运行。

回归入口：`node --test tests/*.test.cjs`、`tests/multi-event-queue-browser.cjs`、`tests/cabin-sleep-comfort-browser.cjs`。真实已发布API浏览器验证入口为 `tests/dify-situation-live-browser.cjs`，只对预演使用桩。图形截图 `tmp/multi-event-queue.png`。
