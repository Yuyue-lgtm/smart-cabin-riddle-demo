# Dify 工作流与知识库版本库

这里保存可随项目 Git 一起管理的工作流 DSL、知识库原文、环境映射和版本说明。正式资料不再只放在会被忽略的 `tmp/` 中。

当前日常入口是 [阿里云测试与正式发布](../docs/DIFY_ECS_ITERATION.md)：已创建三套独立测试应用和测试知识库，本地使用4175，Cloud保留历史。真实ECS导出与后续发布资料存入 `releases/<时间>-ecs*`；历史迁移基线继续原样保留。最新资源映射及发布记录见 [environments.json](environments.json)。

当前归档：[2026-10-20 迁移基线](releases/2026-10-20-migration-baseline/VERSION.md)。来源是 2026-10-19 已核对的 Cloud 发布导出，以及此次阿里云迁移使用的导入副本；本次只整理本地文件，没有重新读取、修改或发布任何远端应用。

## 目录

```text
dify/
  environments.json                   # 两个实例的应用/知识库 ID；没有凭证
  knowledge/README.md                 # 知识库原文与分段、检索、恢复约定
  releases/
    2026-10-20-migration-baseline/
      VERSION.md                      # 版本来源、上线证据与已知问题
      manifest.json                   # 文件 SHA-256、大小、来源时间与发布 hash
      cloud/                          # 三套 Cloud 完整发布 DSL 的来源备份
      alibaba-import/                 # 三套适配 DeepSeek 0.0.25 的迁移导入 DSL
      knowledge/                      # 28 条 JSONL 原文与可导入的 Markdown
      evidence/                       # 原始迁移清单，说明每一步改动
```

`cloud/` 中的知识库 ID 是来源实例的引用；`alibaba-import/` 中两个检索节点的知识库引用刻意留空。后者不是 ECS 当前已发布图的直接导出，不能拿它的文件 SHA-256 充当 ECS 发布 hash。ECS 的应用 ID、知识库 ID 和绑定节点见 [environments.json](environments.json)。

## 校验

在项目根目录运行（需要已有的 Dify 工具依赖；缺失时先在 `tools/dify-workflow-mcp` 执行 `npm ci`）：

```sh
node tools/dify-workflow-mcp/scripts/archive-dify-baseline.mjs --verify dify/releases/2026-10-20-migration-baseline
```

校验包括全部文件 SHA-256、完整应用图、来源清单、模型工作流保持不变、目标插件一致、28 条经验齐全、Markdown/JSONL 内容一致，以及常见凭证模式与非空 secret 环境变量检查。凭证扫描不是全能检测，新增 HTTP、工具或自定义节点时仍要人工核对认证配置。

本次基线的生成命令如下，只读取已有迁移材料，拒绝覆盖已有版本目录，不发起网络请求：

```sh
node tools/dify-workflow-mcp/scripts/archive-dify-baseline.mjs --source tmp/alibaba-cloud/migrations/2026-10-19T14-55-54-826Z --output dify/releases/2026-10-20-migration-baseline
```

## 后续每次稳定版本

1. 从明确的实例和 App ID 导出完整 DSL，关闭 secret 导出；记录草稿/发布状态、读取时间和实际发布 hash。历史生成器、导入模板不能替代最新线上导出。
2. 知识库发生变化时，同步保存完整原文、各条经验版本和索引/分段设置；模型配置、插件精确版本及引用变动也写入版本说明。
3. 新增一个版本目录，保留旧版，记录来源、变更、测试结果及已知问题，更新文件校验值和环境映射。不要原地改写这次基线。
4. 先本地校验和审阅差异，再另行执行部署/发布，并在实际验收后更新 [当前状态](../docs/DIFY_CURRENT_STATE.md)。Git 提交只保存无密钥资料。

以上说明用于历史迁移基线。后续不做Cloud/ECS自动同步，改为同一ECS中的独立测试与正式应用；已通过 `tools/dify.mjs` 实现初始化、本地配置和发布流程。历史编写稿与基线不能覆盖最新测试图。

## 恢复到另一实例

1. 根据目标 Dify 版本安装兼容的模型插件，在目标控制台配置模型凭证。
2. 按 [知识库说明](knowledge/README.md) 导入原文，生成目标知识库，再绑定情境工作流的两个检索节点。不要复用另一实例的 dataset ID 或加密引用。
3. 导入兼容目标版本的三套 DSL，检查完整节点、插件、模型参数及输出契约；现有实例更新时先备份并确认目标应用，避免误建重复应用或覆盖其他版本。
4. 使用虚构题目验证主持问答/换题、环境、P0、睡眠/醒来和预演，再发布目标应用。通过后由服务端配置该实例的 App ID、API Key 和地址。

API Key、Console Cookie、模型凭证、服务器 `.env`、用户会话和运行日志都不纳入这里。DSL 和知识库原文用于恢复业务配置，不是 Dify 数据库或对话历史的完整备份。
