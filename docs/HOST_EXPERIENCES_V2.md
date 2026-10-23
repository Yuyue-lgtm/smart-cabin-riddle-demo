# 主持经验库 v3 与成就反馈

2026-10-23：已按当前五条黄金线补强13条经验至5.0，仍保留28个ID和其他15条原文。可读说明、覆盖矩阵与验证见 [黄金线经验补充](HOST_KNOWHOW_GOLDEN_LINES.md)。修复HK02默认策略与守卫不一致，以及旧维护脚本回写旧内容的问题。本轮只更新本地内容；ECS维护通道不可用，测试库与正式库均未同步。下文“已入库/发布”仅描述历史版本，不能当成本轮5.0已上线。

2026-10-18最新情境增量：现有28个ID不变，HK01/HK02/HK05/HK06/HK07/HK08已更新至4.0并同步云端原文档分段。支持公开线索复述、睡眠关灯/音频静音/空调关闭及恢复、普通车控权限、临时事件4.5秒接续、主驾安全边界。详见 [座舱情境协同规则](CABIN_SCENARIO_POLICY.md)。以下成就与HK28规则保持不变。

更新日期：2026-10-18。规范源为 `主持经验库-v1.jsonl`，保留文件名以兼容现有知识库；`主持经验库-v1.md` 由 `sync-host-knowhow.mjs` 生成。当前共28条，原HK01–HK09保留，新增HK10–HK28均已进入Dify原知识库并完成索引。

## 经验与触发状态

| ID | 新增经验 | 当前接入 |
| --- | --- | --- |
| HK10 | 团队累计首次六题 | 已接入真实结算事件 |
| HK11 | 同一人连续两题、三题 | 已接入；其他人答对或无人答对均中断 |
| HK12 | 个人累计首次六题 | 已接入，与团队门槛合并一句 |
| HK13 | 本局个人首次破题 | 已接入并按轮次限频 |
| HK14 | 连续至少两题未破后的反弹 | 已接入；否定属性回答不计失败 |
| HK15 | 多次明确猜错后成功 | 经验已入库；待独立猜错记录，当前不自动触发 |
| HK16 | 关键提问者贡献 | 经验已入库；当前只认可可证实协作，不判定谁的问题最关键 |
| HK17 | 多人有效提问接力成功 | 已接入已确认事实键的提问者与答对者归属 |
| HK18 | 不同乘员轮流得分 | 经验已入库，暂未增加独立触发事件 |
| HK19 | 提问方式进步 | 经验已入库；待有证据的前后问法比较 |
| HK20 | 少量有效提问破解 | 经验已入库；待问题/闲聊的独立计数 |
| HK21 | 最后十秒破题 | 经验已入库，暂未增加独立触发事件 |
| HK22 | 安静乘员主动加入 | 经验已入库；不能将时间轴模拟当成真实主动参与 |
| HK23 | 明确要求夸奖、安慰 | Chatflow直接响应当前原话，P0结束后排队显示 |
| HK24 | 接梗与称号呼应 | 经验已入库，普通对话可自然接续；未新增称号存储 |
| HK25 | 被纠正后的简短修复 | 经验已入库，对话提示词已加入先回应原问题的约束 |
| HK26 | 记住主持偏好 | 已接入真实副驾明确表达与同源localStorage保存 |
| HK27 | 个性化整局回顾 | 经验已入库；结算题数/MVP已用真实统计，完整生成式回顾待后续 |
| HK28 | 真实副驾未参与时低压力邀请 | 已接入 passenger_inactive 情境检索与 Chatflow 表达；由有效参与快照、情境授权和当前状态共同约束 |

“入库”表示可检索的完整经验已存在，不表示每项都有传感器、计数器或自动触发。未知事实不能由模型补造。每条含场景、适用条件、策略、建议、例外、禁用行为及示例。

## 真实统计与发言

- `game.performance.results` 每个`round_id`只结算一次，分别记录胜出座位或无人答对。当前局的人员由局ID与座位共同界定，重置/继续挑战新局清空成绩；不从历史聊天推算得分。
- `performance`快照含团队破解数、每座位题数、连续得分、连续未破题、本题贡献及最近三题结果。换题不清空本局统计。结束页破解题数与MVP读取同一统计，不再写死7题。
- 只有当前题通过守卫、且属于题目事实目录的新`covered_fact_keys`可归属提问者；普通回答“不是”、重复或未知事实键均不增加有效贡献。
- 每次答对最多一条自动反馈。优先顺序：个人六题、团队六题、两/三连、低谷反弹、多人协作、首次破题；可在同句合并一项次要成就。普通反馈之间至少隔一道题，六题/反弹等稀有成就可例外。
- P0揭晓先完成6秒，再显示P4成就反馈。`post_result_feedback`通过独立情境Workflow的成就分支，绕过分析LLM，只做一次真实经验检索和一次话术生成。检索query只含成就主题，避免通用安全词挤占Top3。
- 揭晓完成时若结果尚未返回，最多再等1.5秒；仍无可用结果则使用对应真实成就的短反馈，面板明确标为本地规则，不伪称模型或检索采用。12秒窗口过期、换题、新P0或重置均不补播旧反馈。
- 玩家正在提问/已有待播回答时自动反馈让位；明确“夸我”取消同次自动庆祝，避免重复。反馈气泡结束前延后换题。每条仍最多显示6秒。
- 成就结果不进入后续聊天的情境缓存，不能修改胜利状态、答案UI、计时、乘客动作或音乐。

## 偏好与对话

真实副驾输入更新`host_preferences`：`praise`、`brief`、`invitations`、`independent`。同源浏览器跨题、新局及刷新保留；“可以主动夸/可以邀请/一起想/多说一点”等明确表达可恢复对应项。“继续游戏”不自动重置偏好。模拟乘客台词不写入真实玩家偏好。

少夸限制主动庆祝；玩家本次明确要求夸奖仍应回答。安全P0仍优先。快照中的偏好和本局成绩传入Chatflow，当前快照覆盖旧记忆。

修正`realtime_input.py`的结束状态判断：`victory/failed/finished`中的普通聊天不再自动落入P0重复揭晓；真正的安全/结束事件与明确猜中仍走确定性路径。保留实时主持模型、结构化输出、单次格式重试、提示拒绝和谜底守卫。

## 云端与维护

知识库：`bc87e197-f268-4710-9697-5185726d0ce3`；文档：`a2a9e833-5902-416e-a5c9-eb192a20d622`。新增分段接口受套餐限制，采用标准上传替换文档并重新索引，保持原知识库/文档绑定，空行分段、1024 tokens、overlap=0；2026-10-18已核对28条均completed且enabled。

已发布并读回：

- 情境Workflow：`bc1ce5be-d5c5-4885-84c5-72c2c1f63d18`，本轮已发布 hash `ed4d1159c4ce13d6d9a09361f7cf4bc7cf192c8406155083f4379bb8082f728e`。
- 实时Chatflow：`74bef8bd-22bd-4e19-91da-5e8d645dd8ed`，本轮已发布 hash `82e349e574044651877dbee7f9860613a6ef6e97165f63c723c3bfa58de6ee72`。
- 提问预演应用未改。Dify发布与Demo/Vercel部署分开，本轮未部署Vercel。

定点补丁脚本`update-host-experiences.mjs`先读取最新云端图，保留模型参数、Memory、既有分支、知识绑定与画布，新增成就分支和必要的代码/提示词。后续迭代仍须先读最新hash，不能按本文hash直接覆盖。

```sh
node tools/dify-workflow-mcp/scripts/sync-host-knowhow.mjs
node tools/dify-workflow-mcp/scripts/update-host-experiences.mjs status
node tools/dify-workflow-mcp/scripts/update-host-experiences.mjs prepare
node tools/dify-workflow-mcp/scripts/update-host-experiences.mjs save
python3 tests/host-experiences-guard.py
node tools/dify-workflow-mcp/scripts/verify-host-experiences.mjs
node tools/dify-workflow-mcp/scripts/update-host-experiences.mjs publish
node tools/dify-workflow-mcp/scripts/update-host-experiences.mjs sync-local
```

云端原图、候选、发布回执、28条索引状态、草稿真实运行trace及精确hash验证保存在`tmp/dify-import/host-experiences/`；不包含密钥。上传知识库使用`knowledge-file`，回查用`knowledge-status`。本地回归用`node --test tests/*.test.cjs`；副驾邀请验收用`node tools/dify-workflow-mcp/scripts/verify-host-experiences.mjs`。

已验证Chrome真实页面的揭晓、成就反馈、换题衔接和主动夸奖；并以独立用户通过本地`/api/workflow`验证已发布情境与聊天路由。`sync-local`已将精确发布图同步到`workflows/parallel/`，后续子对话应以这些文件和最新云端读回为基础，不能直接发布旧生成器产物。
