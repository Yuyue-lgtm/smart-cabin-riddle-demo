# 座舱情境协同规则

2026-10-23本地知识内容更新见 [黄金线经验补充](HOST_KNOWHOW_GOLDEN_LINES.md)：13条经验升至5.0，28个ID和现有权限保留，尚未同步远端。JSONL为唯一源，历史 `update-cabin-knowhow.mjs` 现在只校验导出，不再写回旧版。下文Cloud脚本、4.0分段和发布记录为历史，不作为本轮同步步骤。

更新：2026-10-18。求助只复述公开线索；最新睡眠规则为有效入睡必须启用关怀，空调调至“用户记忆值”，覆盖同日早先的“自主选择/关闭空调”规定。导航不在本次打断范围。

同日体验卡住修复：急刹恢复必须恢复打断前状态，而非统一设playing。超时/答对揭晓时被急刹打断，4.5秒后恢复揭晓并重新安排下一题；连续急刹保留原快照，新局/重置取消旧回调。92项本地回归通过，浏览器验证能进入下一题并启动倒计时。本增量纯前端，Dify已发布版本保持下述记录不变，详情见 `TEST_SCRIPT.md` 最新章节。

## 场景与边界

多事件并发使用 [HOST_EVENT_QUEUE.md](HOST_EVENT_QUEUE.md)：不同座位独立，非P0不打断当前气泡；重要事件P0后按最新快照重新分析，旧模型结果和旧签名不得复用。设备仍随气泡实际出现执行且按事件去重。

| 场景 | 主持人职责 | 前端职责 |
| --- | --- | --- |
| 乘员睡着 | 排除睡眠乘员邀请；有效入睡且尚未关怀时必须启用，描述关灯、分区音量0、空调调至用户记忆值 | 事件目标与状态校验；承接气泡实际显示时模拟执行 |
| 乘员醒来 | 描述恢复灯光、音频和空调原设置，轻柔欢迎回归，不催答 | 醒来不立即撤去效果；恢复话术显示时执行；灯光恢复睡前状态，不强制开启 |
| 游戏与车控混合 | 判断真实控制需求或谜题问题；目标不明先澄清；不能做的自然婉拒 | 普通对话仅接受背景音乐开关和明确分区灯光；二次校验、记录执行回执，不改变游戏进度 |
| 求助、要提示、太难 | 只重述当前题已经公开的线索，不能从答案或隐藏属性推导 | 记录真正展示的题面及问答；发送 `game.public_clues`，不清空已确认事实、不消耗问题次数 |
| 临时事件打断 | 前端暂停后简短承接；恢复后接续当前题，不重新开场 | 冻结计时，保存待回答问题、已生成待播回答；4.5秒后恢复，不重复计次；旧异步结果失效 |
| 主驾疲惫、分心 | 提醒关注驾驶安全和车辆安全提醒，必要时安全停车休息 | 停止主驾游戏邀请；仅模拟，不控制车辆，不用游戏提神 |

## 动作协议

普通乘客允许：

```json
{"type":"music.set_enabled","enabled":false}
{"type":"cabin.set_zone_light","seat":"front","enabled":false}
```

分区灯光座位只能是 `driver/front/rearLeft/rearRight`。原话明确“副驾/主驾/后排左/后排右”或“我这边”才授权；“把灯关了”先询问分区，不默认全车。否定、假设、引用和谜题中“它能关灯吗”不授权。灯光复用现有四区柔边遮罩，但不会显示睡眠音量/空调提示。普通灯光动作随承接气泡实际显示再执行。背景音乐仍沿用开关及音量配置，与分区音频模拟独立。

睡眠事件特例：

```json
{"type":"cabin.apply_sleep_comfort","seat":"rearRight"}
{"type":"cabin.restore_sleep_comfort","seat":"rearRight"}
```

只能用于当前有效睡眠/醒来事件目标；睡眠关怀显示“分区音量：0”“分区空调：用户记忆值”。有效入睡且尚未关怀时，主持上下文标记 `sleep_comfort.required=true`，不再允许选择静默或空动作。守卫对漏动作、缺少设备说明、误说关闭空调或空结果提供确定性的目标关怀计划和安全承接话术；不放行其他座位/未知动作/额外参数。已启用不重复执行，过期、P0、已醒和作用域无效不补动作。醒来恢复需要此前启用了关怀。前端仍只接受结构化动作，并在承接气泡实际出现时执行，不能把自由文本当执行权限。通用空调、分区音量、切换主题、查询到达时间均未开放，不能伪称完成。

## 公开线索

- `state.game.publicClues` 只在本题题面实际展示，以及通过守卫的游戏回答气泡实际出现时记录；问答含已展示的原问题，避免孤立“是/不是”失去语境。
- 换题、新局清空，打断保留。尚未出现的气泡、预演回答、事实目录和旧题内容不能加入。
- `game.public_clues` 随当前聊天发送，由 `cabin_policy_input.py` 注入上下文；隐藏谜底仍仅用于判题、防泄露。
- `cabin_policy_guard.py` 对求助采用公开内容约束，只选择本题允许的短线索复述，不让模型自由扩写；空列表时明确暂无可复述内容，不新增 `covered_fact_keys`。
- 普通属性问题仍由实时Chatflow回答。只在有效的游戏问题回应落地时增加计数，控制请求、帮助、澄清、闲聊不消耗次数。

## 临时打断

手动事件新增“临时事件打断”和“主驾分心”，没有导航入口。

`temporary_interruption` 由本地确定性分支即时暂停，并作为P0观察通知情境Workflow；后台结果不能覆盖界面。保留待处理聊天与已生成普通回答，旧请求被取消并通过状态版本拒绝；未回答问题在恢复后用当前快照重新请求，不重复扣次数。恢复固定为4.5秒。新的急刹、重置、新局等取消旧恢复任务。急刹沿用原有独立4.5秒安全逻辑，不受普通临时打断解除。

`driver_distracted` 为P1，前后端及Dify两个应用均认识此事件。共用 `perception_snapshot` 显式输出 `driver_state=分心`，不再退回“收到座舱事件”；主持与情境所有内嵌副本同步。与疲惫一样走情境规则分析、Chatflow安全提醒；没有游戏提神、强制加入或车辆真实安全控制动作。

## 经验库

复用现有28个ID，定点更新HK01、HK02、HK05、HK06、HK07、HK08至 `version=4.0`。原文源为 `主持经验库-v1.jsonl`，Markdown由同步脚本生成。原Dify知识库更新同一文档的六个分段，未新建重复知识库；28条均完成索引并启用。

```sh
node tools/dify-workflow-mcp/scripts/update-cabin-knowhow.mjs
node tools/dify-workflow-mcp/scripts/sync-host-knowhow.mjs
node tools/dify-workflow-mcp/scripts/update-host-experiences.mjs knowledge
node tools/dify-workflow-mcp/scripts/update-host-experiences.mjs knowledge-status
```

## 安全迭代

从实时草稿定点修改，只修改当前约束、动作守卫及其预检副本、主持/重试提示、情境事件定义与P1分支。模型、会话记忆、图结构、知识库绑定、预演应用保持不变。

```sh
node tools/dify-workflow-mcp/scripts/update-cabin-policy.mjs status
node tools/dify-workflow-mcp/scripts/update-cabin-policy.mjs prepare
python3 tests/cabin-policy-guard.py tmp/dify-import/cabin-policy
node tools/dify-workflow-mcp/scripts/update-cabin-policy.mjs save
node tools/dify-workflow-mcp/scripts/update-cabin-policy.mjs verify
node tools/dify-workflow-mcp/scripts/update-cabin-policy.mjs publish
node tools/dify-workflow-mcp/scripts/verify-cabin-policy-api.mjs
```

保存和发布都校验实时hash；必须验证完全相同的已保存草稿。完整已发布DSL及 `cloud-apps.json` 自动同步。本次不部署Vercel、不创建Git提交。后续子对话先读 `DIFY_CURRENT_STATE.md`，不要用旧睡眠补丁或旧生成器覆盖整图、去掉本次策略包装层。

## 验收

最新本地92项JavaScript回归、37项Dify代码节点规则回归、37项睡眠守卫，以及浏览器四区睡眠/醒来、话术与设备执行同步、用户记忆值显示和两种窗口尺寸均通过。最终草稿14次主持和5次情境运行覆盖求助、困难、灯光开关/澄清、普通音乐、不能执行的需求、普通问答、睡眠/醒来、疲惫/分心和临时打断。发布hash与最终API运行记录见 `DIFY_CURRENT_STATE.md` 及 `tmp/dify-import/cabin-policy/`；连续两名乘员入睡和醒来恢复的真实API复测见 `tmp/dify-import/sleep-comfort/api-verification.json`。

曾通过真实回归定位并修正 `driver_distracted` 只加入情境白名单、未加入主持白名单的问题。当前离线回归同时校验两端事件有效性，避免再次出现“分析成功，主持守卫拒绝”。截图：`tmp/cabin-policy-browser.png`、`tmp/cabin-policy-mobile.png`。

此前一轮发布API曾经本地4186 BFF、独立测试用户的同一会话验证通过：公开线索复述运行 `3603fc52-1670-4f10-8fa5-6d251b8a2cdd`，副驾关灯 `79785f26-b841-4707-b229-e8f2f083d328`；主驾分心情境 `1146f422-514f-4359-b332-3d832c3dd40b` 接续主持 `75788500-f07b-443b-97a4-64845447115c`，无设备动作；临时打断 `db03124d-e128-4e4f-bb2b-a60de819ad8d` 仅记录、不申请发言。最新必启关怀/分心感知版本已再次通过同样API测试，完整新报告为 `tmp/dify-import/cabin-policy/api-verification.json`，包含当前run ID；空调、ETA和换主题三项仍婉拒，未增加事实或执行动作。
