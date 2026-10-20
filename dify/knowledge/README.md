# 主持经验库原始资料

2026-10-20 后续已从ECS实时读取并核对正式/测试两个库，最新原文见 [正式库 JSONL](../releases/2026-10-20T05-17-33-943Z-ecs/before-knowledge.jsonl)、[测试库 JSONL](../releases/2026-10-20T05-17-33-943Z-ecs/test-knowledge.jsonl)；同目录含Markdown导入文件和完整处理/检索配置JSON。两库均28条且内容/配置一致，分别经实际检索节点命中HK28。后续日常先改测试库，按 [发布流程](../../docs/DIFY_ECS_ITERATION.md) 同步，以下保留最初Cloud迁移基线的说明。

当前迁移基线的原文保存在：

- [knowhow-source.jsonl](../releases/2026-10-20-migration-baseline/knowledge/knowhow-source.jsonl)：HK01-HK28，每行一个完整经验对象，保留来源版本、规则、动作、例外、禁用行为和示例。
- [knowhow-source.md](../releases/2026-10-20-migration-baseline/knowledge/knowhow-source.md)：相同的 28 个 JSON 对象，以空行分隔，供 Dify 文档导入。
- [来源证据](../releases/2026-10-20-migration-baseline/evidence/cloud-migration-manifest.json)：来源知识库/文档 ID、分段设置、索引状态、原文 SHA-256 和本地稿差异。
- [实例绑定](../environments.json)：Cloud/ECS 的不同知识库 ID、两个检索节点和检索设置。

来源是 2026-10-19 从 Cloud 完整导出的有效分段，阿里云迁移时逐条核对一致。当前归档没有重新查询远端知识库。

`docs/主持经验库-v1.jsonl` 和 `docs/主持经验库-v1.md` 是既有编写稿，继续保留。HK10 的编写稿与 Cloud 来源存在差异，不能把文件名中的 v1 或相同的经验 version 当作内容完全一致的证明。本次未覆盖任一原稿。

## 导入和核对

1. 新建目标知识库并选择经济型索引。当前基线不需要运行 embedding 或 rerank；来源中记录的 OpenAI embedding 元数据不代表经济索引需要该模型。
2. 上传 `knowhow-source.md`，以空行分段，长度 1024，overlap 来源为 0；ECS 1.17.1 的界面当时最小允许 1，实际采用 1。
3. 索引完成后确认恰好 28 个完整 JSON 分段，HK01-HK28 无缺失、无重复，均可用/启用；若自动分段拆开记录，先修正分段，不能直接上线。
4. 将情境节点 `3000000000010` 和 `3000000000024` 绑定到新知识库，TopK=3，关闭 rerank。知识库 ID 不跨实例复用。
5. 用副驾长期未参与场景确认 HK28 可以命中，再做睡眠、成就反馈等相关经验回归。

HK10 来源本身仍含“四题/六题门槛”矛盾，迁移时按用户决定保留；修订应另建版本、确认实际统计规则并同步工作流测试。不得为了整理资料而悄悄改原文。
