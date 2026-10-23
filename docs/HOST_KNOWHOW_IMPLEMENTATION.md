# 主持经验库 v1

2026-10-23最新本地内容为 [黄金线经验补充](HOST_KNOWHOW_GOLDEN_LINES.md)：28个ID保留，13条升级5.0，上传文件仍由JSONL生成。本轮未同步远端；以下检索路由、9条分段等内容为历史方案，不用于推断当前测试应用绑定。

2026-10-18已扩展为28条完整经验并更新原云端知识库；HK28覆盖经真实参与状态确认后的副驾低压力邀请，状态与版本由前端、情境Workflow和Chatflow守卫共同校验。当前实现与发布hash见 [主持经验库 v3](HOST_EXPERIENCES_V2.md)。以下9条/旧单Chatflow方案为历史说明。

> 最新v4草稿已将经验检索移到独立情境Workflow，普通对话不再按玩家原话触发检索。见 [双路并行方案](DIFY_PARALLEL_HOST.md)。下文保留旧版单Chatflow检索方案和验证历史，知识库文档仍可沿用。

## 交付物

- 新 Chatflow DSL：`tmp/dify-import/realtime-host-director-v3-knowhow.yml`
- 知识库上传文件：`docs/主持经验库-v1.md`。每条完整经验是一段 JSON，段落之间空一行，便于在 Dify 中按段落分块。
- 可编辑 JSONL 源文件：`docs/主持经验库-v1.jsonl`
- 生成命令：`node tools/dify-workflow-mcp/scripts/build-host-knowhow-chatflow.mjs`
- 静态测试：`node tools/dify-workflow-mcp/scripts/test-host-knowhow.mjs`

## Chatflow 变化

新 DSL 使用独立应用名 `Smart Cabin Realtime Host Director v3 Knowledge`，不覆盖上传文件、现有工作流或线上草稿。模型设置沿用读取到的当前草稿 `deepseek-flash`；导入后仍需在 Dify 检查模型提供方绑定。

流程如下：

```text
开始 → 输入标准化与 P0 预判 → P0 规则分支
  ├─ P0 → 确定性响应 → 输出汇总
  └─ 普通 → 主持经验相关性筛选 → 经验检索条件分支
       ├─ 需要经验 → Knowledge Retrieval → 整理检索经验 ┐
       └─ 免检索 → 整理免检索上下文                    ┴→ 合并主持上下文
          → 原有唯一 LLM → 输出守卫 → 输出汇总
```

相关性筛选是代码规则，不增加分类 LLM。明确的普通是/否问题与音乐开关不检索；卡壳/求助、独立思考表达、协作请求、非 P0 的座舱情境事件、适合承接的闲聊进入检索分支。检索 query 只含进度摘要、当前原话、发言座位、乘员状态、可邀请对象、少量相关对话和持续约束，不含谜底、完整输入 JSON 或全量历史。Knowledge Retrieval 最多 3 条，关闭 rerank 和 metadata filtering；两个普通分支在同一个 LLM 前合流，P0 完全绕过检索和 LLM。

LLM 输出新增 `knowhow_status`、`retrieved_knowhow`、`strategy`、`target_seat`、`reason_codes`、`applied_knowhow_ids`。`retrieved_knowhow` 表示本轮检索命中，`applied_knowhow_ids` 只表示最终实际采用，不能互相替代。守卫校验策略枚举、经验 ID 与本轮实际检索集合、协作目标白名单和暂停状态；不合规时输出短兜底话术、清除目标及经验引用。谜底保护、拒绝额外提示、事实键校验和音乐动作白名单继续由代码负责。答对氛围灯仍由既有 P0 规则输出，经验内容不能授权 UI 或车辆动作。

现有“感知 / 决策 / 执行”面板已接入：感知列显示检索状态及命中经验标题/ID；决策列显示策略、理由标签、协作目标和采用经验；执行列沿用前端实际回执。**不显示相似度当置信度，也不伪造检索/模型耗时。** 当前 Chatflow 响应没有向网页提供节点级检索与模型耗时；后续若接入 Dify tracing 才能展示这些分项耗时。

## Dify UI 手工步骤

1. 在 Dify 创建新的知识库“主持经验库 v1”，选择可用的 embedding 配置；DSL 不包含也不会编造 dataset ID、密钥或模型凭证。
2. 上传 `docs/主持经验库-v1.md`。选择适合短规则文档的索引方式；分段分隔符设为空行（两个换行），分段长度设为大于最长经验段落，避免把一条 JSON 经验拆开；不加 overlap。确认最终索引为 9 个完整段落。
3. 导入 `tmp/dify-import/realtime-host-director-v3-knowhow.yml` 为**新 Chatflow 应用**，不要覆盖正在使用的应用。导入后检查模型绑定、记忆窗口和 P0 分支。
4. 打开“主持经验知识检索”节点，选择刚建立的知识库。确认 Top K 为 3、rerank 关闭、metadata filtering 关闭。DSL 中 `dataset_ids` 留空是有意的，必须在此绑定后才可运行/发布。
5. 在调试面板逐项运行下方测试。特别检查空检索能够继续到原 LLM、普通问答不经过检索，以及检索片段保留完整 JSON。不要仅凭 DSL 静态验证就发布。
6. 只有确认新 Chatflow 运行和输出后，再决定是否更新 Demo 的 Chatflow App ID/API Key 与发布版本。本次没有写入或发布任何云端应用。

Dify 的 Knowledge Retrieval 节点以字符串变量作为 query，并返回文档片段数组；检索配置、知识库选择需在节点中指定，见 [Knowledge Retrieval 节点文档](https://docs.dify.ai/en/cloud/use-dify/nodes/knowledge-retrieval)。DSL 节点结构参照 [Dify 官方节点类型](https://github.com/langgenius/dify/blob/main/web/app/components/workflow/nodes/knowledge-retrieval/types.ts) 与 [默认配置](https://github.com/langgenius/dify/blob/main/web/app/components/workflow/nodes/knowledge-retrieval/default.ts)。

## 异常降级边界

Knowledge Retrieval 没有出现在 Dify 官方预置错误处理文档列出的可配置错误处理节点范围中；官方运行实现也会将检索异常报告为节点失败，而不是保证产出空数组。因此新 DSL **没有伪造检索节点 fail-branch/error_strategy 字段**。正常的“无匹配”是成功的空数组，整理节点输出 `knowhow_status=empty` 并继续单次 LLM。返回片段格式异常会标记 `failed`，去掉经验引用后继续单次 LLM。

若 Dify API 因检索节点运行错误而整体失败，Demo 现有请求异常处理会调用本地 `localDecision` 兜底，并标记 `knowhow_status=failed`，保证游戏可继续；这不是 Chatflow 内部重走免检索 LLM 分支。Dify 编辑器中的检索节点硬错误仍可能中断本次调试运行。错误处理支持范围请见 [Dify 预定义错误处理文档](https://docs.dify.ai/zh/use-dify/build/predefined-error-handling-logic)。若导入后的 Cloud 版本 UI 已明确提供该节点的错误分支，应优先手工将失败分支连到免检索上下文；否则保留当前方案并记录该平台限制。

## 测试矩阵

| 用例 | 预期策略与边界 | 静态结果 |
| --- | --- | --- |
| “太难了，帮帮我。” | 检索求助/卡壳经验；鼓励为主。仅在有合格对象且玩家愿意协作时才设目标；不泄露线索。 | 通过相关性路由与 query 脱敏检查；策略生成需在 Dify 验证 |
| “太难了，但让我再想想。” | 检索后采用 `soft_response`；尊重独立思考，不邀请他人、不追加提示。 | 通过检索路由静态检查；模型策略需在 Dify 验证 |
| 后排左睡着，玩家要求邀请后排左 | 睡眠乘员从允许名单剔除；守卫拒绝 rearLeft 目标，可选择其他清醒非主驾对象，否则柔和回应。 | 通过：rearLeft 被过滤；越权目标触发安全兜底 |
| “答案是不是红色？” | `knowhow_status=not_relevant`，直达唯一 LLM；正常回答约束不变。 | 通过免检索路由检查 |
| 急刹 | P0 代码分支快速暂停，绕过筛选、知识检索及 LLM。 | 通过图连线检查：P0 true 无检索路径 |
| Knowledge Retrieval 空数组 | `knowhow_status=empty`，仍交给同一个 LLM，不丢失原主持上下文。 | 通过空结果代码路径 |
| Knowledge Retrieval 返回异常格式/未知 ID | 标记 `failed`；不采纳异常片段或模型自报 ID，继续单次 LLM。 | 通过整理与输出守卫静态测试 |
| 模型输出未知 ID 或邀请睡着乘员 | 经验 ID 必须属于本次真实检索；目标必须在代码生成的清醒非主驾名单。冲突话术退回安全短句并清空目标/经验。 | 通过：HK99 与 rearLeft 均被拒绝 |

测试命令静态解析 DSL，编译并调用其中的 Python Code 节点，检查 9 条经验结构、节点引用、P0 旁路、条件分支、一个 LLM、空检索、五层深度限制和守卫边界。另通过 Dify Cloud 的 Chatflow 草稿调试接口实测四类路径：求助请求成功经过检索并返回 `used`；普通是/否问答走免检索分支并返回 `not_relevant`；急刹成功走 P0 确定性暂停路径；明确索要提示成功走免检索并由守卫拒绝提示。四条云端草稿运行均为 `succeeded`，未测端到端延迟。

自测发现 Dify Code 节点最多接受 5 层结构对象；标准化节点此前原样输出带嵌套谜题计划的 `payload`，触发 `Depth limit 5 reached, object too deep.`。现已将跨节点 `payload` 改为 JSON 字符串，在 P0、相关性筛选和输出守卫中再解析；并增加回归测试。云端仅更新相关代码节点，保留已绑定的知识库和其他配置，当前状态为**草稿、未发布**。此前已发布版本不会自动获得此修复；重新发布当前草稿后才会生效。

本地验证记录：Knowhow DSL 测试通过；现有主持追踪 Python 回归 8/8 通过；`client-app.js` 与 Dify 草稿更新脚本 Node 语法检查通过；`git diff --check` 通过。浏览器截图回归未运行；本次使用 Dify Cloud 草稿调试接口完成流程实测。
