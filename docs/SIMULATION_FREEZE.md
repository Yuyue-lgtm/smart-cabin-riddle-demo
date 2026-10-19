# 模拟暂停与恢复

更新：2026-10-18。仅修改本地前端，不修改 Dify/BFF 协议、云端应用或事件优先级。

## 行为

开始模拟后点击“暂停模拟”，中控屏、座舱环境模拟、手动控制区的动态内容保持在点击时的位置，方便检查信息；点击“继续模拟”才继续。

- 冻结游戏计时、题号提示、主持人/乘客气泡、重要事件、背景延迟切换、事件冷却和下一题调度。
- 冻结主持人序列帧、彩带 Canvas、红光、射灯、玻璃层过渡和结算页分阶段动画，不隐藏或重启动画。
- 暂停背景音乐、主持人音频及 Web Audio 音效；保留开关与播放位置，恢复后继续。
- 暂停期间已发出的 Dify/预演请求可以完成，但结果和错误处理等待恢复，不覆盖当前气泡、分析面板、人物或设备状态。恢复后仍走原来源、版本、优先级及有效期检查。
- 除“继续模拟”外，事件、车速、环境、音乐、重置、下一局、座位与输入等控制均不可操作；面板文字仍可选择、滚动查看。
- 结算页也可暂停。恢复时还原原来的时间轴状态，不把已结束的时间轴重新启动。
- 手动暂停与急刹/临时事件的安全暂停独立。暂停模拟期间，4.5秒安全恢复计时也停住；继续模拟不会跳过剩余安全暂停。

## 实现边界

`client-app.js` 内 `createSimulationRuntime()` 仅接管 Demo 自身的 timeout、interval、RAF 与本地时间，不改写浏览器全局时钟。暂停保存剩余延迟，恢复不追赶积压帧、不一次性清空气泡。Canvas 与序列帧使用扣除暂停时长的时间戳。

CSS 动画和过渡通过 Web Animations API 保存并暂停；`.simulation-frozen` 同时防止新增 CSS 动画运行。异步请求、人物资源和背景图片回调等待恢复后才应用；音频由媒体元素暂停和 AudioContext suspend/resume 处理。

本地气泡/事件时间使用模拟时钟；Dify 签名交接的 `expires_at_ms` 继续使用真实墙钟，不能因暂停而延长云端凭据有效期。重要情境在恢复时过期，仍需按既有队列规则重新分析，不绕过服务端签名验证。

## 验证

```sh
node --test tests/*.test.cjs
PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/simulation-freeze-browser.cjs
```

117项本地单元回归通过，包含5项新增模拟时钟测试。Chrome浏览器测试以桩响应验证：游戏页暂停6.5秒、结算过渡暂停5秒时，三分区前后截图像素完全一致；延迟Chatflow结果不提前应用，音乐/音效暂停，恢复后气泡、背景、人物、Canvas和安全暂停计时继续。测试不发送真实 Dify 请求。截图位于 `tmp/simulation-frozen-*-before.png` 和 `tmp/simulation-frozen-*-after.png`。

脚本与样式缓存版本：`20261018-full-simulation-freeze-v1`。旧页面刷新后生效；未部署线上。
