# 主持人睡眠关怀

2026-10-18。视觉来源为Figma `313:677`「座舱与环境模拟-关灯效果」。

同日最新规则以 [座舱情境协同](CABIN_SCENARIO_POLICY.md) 为准：有效入睡必须启用睡眠关怀，空调调至“用户记忆值”，覆盖早先自主选择和关闭空调的规则；醒来恢复原设置。普通对话也可单独开关明确分区的灯光，不显示睡眠设备提示。下面的旧发布hash和验收ID保留作历史记录，最新状态见 `DIFY_CURRENT_STATE.md`。

## 决策与执行

有效入睡且目标尚未启用关怀时，主持人必须安排整套关怀：关闭该区灯光、分区音量设为0、分区空调调至用户记忆值。检测到睡着不立即改变设备，仍等主持人承接话术开始显示后执行。

1. 前端感知睡眠并更新乘客状态，上报情境Workflow。
2. BFF只在分析有效、目标仍睡着，或目标已醒且该区关怀仍启用，并且非P0时附加 `request_host_decision=true`、`host_decision_seat`，签发绑定用户/局/题/情境版本/事件/座位/有效期的交接凭据。
3. 前端接续Chatflow。即使情境静默，也请求主持人生成关怀话术与动作；`sleep_comfort.required=true` 明确本次必须启用。
4. 主持人输出一个目标座位的 `cabin.apply_sleep_comfort`；醒来恢复使用 `cabin.restore_sleep_comfort`。有效入睡时漏动作由确定性守卫补齐，已启用的座位不重复执行。
5. 有设备动作时，主持人必须同时给出描述灯光、空调、分区音量的承接话术。必启睡眠关怀缺少说明、误说关闭空调或空结果时，守卫提供“关灯、分区音量0、空调调至用户记忆值”的安全话术；未知动作和错位目标仍拒绝。
6. 前端收到结果后只登记待执行计划，话术和动作一起进入优先级/最短展示队列。主持人气泡真正开始显示的同一次渲染中，再检查目标、状态、作用域和有效期，才执行设备模拟。P0、过期或状态再次变化时不执行旧计划。

```json
{"type":"cabin.apply_sleep_comfort","seat":"rearRight"}
{"type":"cabin.restore_sleep_comfort","seat":"rearRight"}
```

`seat` 只接受 `driver/front/rearLeft/rearRight`，必须等于当前事件目标，不接受任意设备参数。启用动作只接受 `passenger_sleep` 且仍睡着的目标；恢复动作只接受 `passenger_wake` 且清醒、此前确实启用了关怀的目标。普通聊天、其他事件、P0、旧结果均不能授权整套关怀。分区音量只模拟，不影响网页背景音乐。空调显示“用户记忆值”，不虚构温度数字。恢复时撤去音量/空调提示，并恢复睡前灯光状态，代表恢复原设置。

情境 `request_proactive_speech=false` 不再使新入睡关怀静默，必启规则仍生成动作及对应话术，等气泡实际显示才执行。目标已关怀、已醒或事件失效时不补旧动作。保留原优先级、气泡至少1.5秒及最长6秒规则，不为情境回应播放思考动画。

## 界面状态

`state.ui.sleepComfortSeats` 记录已由主持人启用并在前端成功模拟的座位，与乘客睡眠状态独立，并通过 `car.sleep_comfort_seats` 传入最新快照。醒来只改变乘客状态，不立即移除此数组中的座位；收到恢复动作且对应气泡开始显示时才清除。重置仍直接清除。环境背景切换不清除，多区独立。

手动“乘客醒来”每次从当前仍睡着的座位中选目标，优先当前选中且睡着的座位，否则依次后排右、后排左、副驾、主驾；不再固定 `rearRight`。没有睡眠乘员时显示“当前没有睡着的乘客”，不发送假醒来事件。4秒全事件按钮冷却不变，设备恢复仍等待主持人话术。

资源、原图尺寸和四区坐标见 [ASSET_CONFIG.md](ASSET_CONFIG.md)。所有SVG保留Figma原始路径、尺寸和滤镜，设置提示层位于关灯遮罩之上。

## Dify 版本

主持应用：`74bef8bd-22bd-4e19-91da-5e8d645dd8ed`。本轮已发布并读回hash：`fa0a3f8e7992058c39fb582c39d7167d82d5b90d86eb5321d3ee9031132a196a`，发布版本时间 `2026-10-18 09:57:56.284974`。状态入口为 [DIFY_CURRENT_STATE.md](DIFY_CURRENT_STATE.md)。

只修改主持应用当前约束节点、主模型/重试模型的动作规则、最终守卫及两份预检守卫副本；模型参数、会话记忆、知识库和图连接均保留。情境和预演云端应用未修改。

当前维护使用 `node tools/dify-workflow-mcp/scripts/update-cabin-policy.mjs status|prepare|save|verify|publish`，保留后续座舱权限包装层；不要直接用旧睡眠补丁覆盖。每次基于实时草稿定点修改，保存和发布必须匹配备份及验证hash。生成器同步源为 `dialogue_event_input.py`、`dialogue_event_guard.py`、`dialogue-output.schema.json` 和 `event-dialogue-prompt.txt`；已发布完整图同步至 `workflows/parallel/host-dialogue-v4.yml`，禁止拿过期备份覆盖云端。

## 验收记录

- 81项本地前端/BFF回归通过，覆盖原会话、P0、提问预演、气泡与思考生命周期；其中17项覆盖情境交接、动作等待气泡、优先级排队、恢复及失效保护。
- 22项云端代码节点离线回归通过，覆盖四区、空动作、静默设备决策、睡眠/恢复条件、说明缺失、首次/重试解析、错位/过期/额外参数保护。
- 最终草稿9次真实运行通过：后排睡眠、副驾睡眠、静默睡眠决策、静默醒来恢复、副驾醒来恢复、清醒/不可用状态、环境事件、提示拒绝和音乐开关。其中睡眠静默分支运行 `9553f273-3dec-431e-a30f-8c472569e255`，醒来静默分支 `920430d1-0434-4b59-806c-2175daa0c976`；均给出描述三项设备的话术和合法动作。完整运行ID见 `tmp/dify-import/sleep-comfort/verification.json`。
- 完整浏览器事件链验证通过：设备不在模型结果返回时执行，而在对应气泡显示时执行；等待P1与最短气泡时长期间保持原设备状态；醒来先保持关怀，恢复话术显示才撤去效果。四区、重置、换背景以及2380×1120和1024×768窗口均通过。截图 `tmp/cabin-sleep-comfort-single.png`、`tmp/cabin-sleep-comfort-all.png`、`tmp/cabin-sleep-comfort-small.png`。
- 发布API经本地BFF真实串联通过：睡眠情境 `08440a6f-8013-49b3-b14d-ea867bfae0cd` 选择静默，主持人 `36fbe893-90ce-4d8c-aa33-8bc13f3e640b` 仍生成完整设备说明及后排右关怀动作；随后在同一会话发送醒来事件，情境 `9c3d0eb9-13c2-4f43-80c3-df113d302f4d`、主持人 `d364254b-cc42-47de-b247-a03deb4d7927` 返回恢复三项设备的话术和 `cabin.restore_sleep_comfort`。完整结果见 `tmp/dify-import/sleep-comfort/api-verification.json`。

本地服务地址保持 `http://127.0.0.1:4186/`，已重载代理。未部署Vercel，未创建Git提交。原始测试记录和版本备份保存在忽略目录 `tmp/dify-import/sleep-comfort/`。
