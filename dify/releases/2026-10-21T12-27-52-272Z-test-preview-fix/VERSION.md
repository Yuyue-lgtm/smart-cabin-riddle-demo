# 测试预演规则 v2

日期：2026-10-21。仅发布阿里云测试预演应用`aa30333f-4a8d-4d89-9d6f-557ee7296263`，版本`preview-rules-v2`。正式三应用和测试主持/情境的已发布图与操作前hash一致；Cloud未调用写入，网站未部署。

发布工作流：`183a9bf0-4d24-49bf-8042-3edc5850da0d`。
内容SHA-256：`5e802720e7a57ff88d8e0ac7cd50aed234a342ff4fa402f8a30bb87abe4dc58d`。

## 原因与修改

模型未被明确告知与守卫完全一致的连续字片段约束，安全带第三问反复包含“安全”；补全也会重复违规。增加实际hint回归后又发现“它平时”同时命中“它平/平时”、“城市里”同时命中“城市/市里”。已有守卫未变，不能把HTTP200视为完整ready。

只修改输入压缩节点`2000000000005`和生成提示节点`2000000000002`：显式传入谜底/提示片段及具体特征词，前三问避免提示片段、只用短回答，年龄变体保持主体和事实一致，修复时根据全局题序生成缺失后缀、不重写前缀。模型`deepseek-flash`、`thinking=false`、`max_tokens=6144`及原节点异常重试配置未改；输出守卫`2000000000003`、边、变量、知识库未变。

## 验证

- 最终12项草稿真实回归全部一次ready，2.3–3.7秒：安全带4/5/6步与重复生成、2步前缀补齐至5/6步、雨伞/红绿灯/草原/雪人/方向盘。均带Demo实际虚构题目提示及年龄变体。
- 发布后真实API3项全部一次ready：安全带5/6步、保留前2步补齐6步。
- 两个直接补全草稿案例及发布API补全案例均核对前缀不变。
- 本地16项Python守卫、14项Node预演测试通过；本机4175三路readiness正常。
- 测试运行前后校验workflow hash，发布时检查并发修改，正式三应用和测试另两应用做前后hash核对。

最终证据为`draft-demo-hints-regression.json`和`published-regression.json`。`draft-regression.json`、`draft-final-regression.json`是早期不带hint的回归，不代表最终版本；两个`draft-demo-hints-failed*.json`保留中间失败，不作通过证据。所有请求仅虚构数据，不含真实乘客、API Key或管理会话。

复测命令（需要有效管理会话、SSH隧道及私有测试Key）：

```sh
node tools/dify-workflow-mcp/scripts/test-ecs-preview-rules.mjs draft tmp/preview-draft-check.json
node tools/dify-workflow-mcp/scripts/test-ecs-preview-rules.mjs published tmp/preview-api-check.json
python3 tests/dify-preview-guard.py
node --test tests/dify-preview.test.cjs tests/dify-preview-prefetch.test.cjs
```

## 备份与边界

修复前后完整DSL分别为`before-test-preview.yml`、`after-test-preview.yml`，配套JSON保留发布图及草稿。需要回退时先读当前测试草稿和hash，比较本记录后再定点恢复，不得盲目覆盖后续编辑。候选、差异、发布回执及完整性清单均在本目录。

有限样例不能证明模型永不违规或所有自然语言事实都正确；原有安全截断、一次补全及部分成功保留继续生效。后续更新正式版需单独发布，不会随测试版自动同步。
