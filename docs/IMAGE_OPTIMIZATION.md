# 图片压缩报告

本地批次：`20261022-images-v6`。追加女青年2后共检查94张图片，82张缩小，总计57.68 MiB → 15.60 MiB，减少72.9%。

2026-10-23新增女青年2：四张Figma裁剪透明切片（默认／犯困／睡着／大笑），均为287×328，质量90 WebP合计444828 → 69466字节，减少84.4%。使用仅导出内容的PNG保留裁剪和滤镜，未带入画布背景；透明通道逐像素一致，PSNR为38.6–39.1dB。原图和脚本：`tmp/female-young2-20261023/`，哈希记录见`IMAGE_OPTIMIZATION.json`的`passenger_addition`；其他图片、主持人图集及音频未重新压缩。

主持人9张图集：26.81 MiB → 13.75 MiB，累计减少48.7%。图集第一轮为17.93 MiB，当前比图集第一轮减少23.3%。

## 处理规则

- `cabin-env-*`：WebP质量28，允许较明显细节损失，由实际玻璃叠层下的页面对比验收。
- 中控背景：高质量WebP；人物：较高质量WebP；未列入追加压缩的文字及装饰切片：无损WebP。
- 首轮UI追加压缩为11张：装饰质量32起、文字质量58起。该阶段合计1686.6 KiB → 406.6 KiB，减少75.9%；后续追加以当前文件明细为准。
- 主持人图集：WebP质量78起，逐帧采样检查后决定最终质量；从原始备份编码，9张图集均不缩放、不裁剪、不改帧坐标、帧数或时长。
- 主持人最新恢复：按用户要求，从`20261022-images-v3`备份逐字节还原9张质量78图集，合计13.75 MiB；未重新编码，其他媒体维持追加压缩结果。
- 准备页panel-mosaic降为128像素宽，约2.5 KB，页面显示尺寸不变；stage-beam简化纹理并重建平滑渐变，保持480×480输出，低于25 KB。图集和人物兜底图保持逐像素透明通道。大于100 KB的中控背景再次压缩，所有中控背景低于120000字节。
- 图标维持130×130 PNG，使用128色调色板压缩；12个SVG保持原字节。
- hi-audio、host-cheer、host-yes使用原始备份转码为64 kbps单声道MP3，保留LAME时长与编码延迟标记；合计263.7 KiB → 128.8 KiB。未更改播放速度、音量、动画时序或JSON。
- 仅调整媒体资源及缓存版本；不改变加载策略、游戏逻辑或Dify。

## 备份与校验

原资源及被修改的源文件备份：`tmp/image-optimization/2026-10-22T15-24-23-170Z/original/`（本地忽略目录，不随网页发布）。
每个文件的原始/压缩SHA-256、尺寸、质量档位、透明度和抽帧指标见同目录的`IMAGE_OPTIMIZATION.json`。
只从本批次原始备份编码，不重复压缩已经优化的输出。若需回退，先核对工作区后续修改，不直接覆盖其他人的更新。

## 验收结果

- 9张主持人图集已按用户指定，从质量78的历史备份逐字节恢复至合计14422376字节（13.75 MiB），未重新编码。
- 相对恢复前，仅9张图集内容发生变化；其他图片、图标、MP3、动画JSON、页面布局和业务逻辑保持不变。资源缓存版本已更新。
- 362项Node自动测试通过；Chrome检查19个桌面及手机页面状态、375帧动画和81张非图集图片，无空帧、越界、图片解码失败、资源404或页面报错。
- 此前3段MP3的解码时长及静音播放检查通过，恢复操作未更改音频；Safari尚未实机验收，真实Dify和TTS未参与本次测试。
- 原图和每轮版本均已备份。仅本地恢复，未部署线上；旧标签页需强制刷新。

## 文件明细

| 原文件 | 运行文件 | 原体积 KiB | 新体积 KiB | 编码 |
| --- | --- | ---: | ---: | --- |
| bubble-tail.svg | bubble-tail.svg | 0.2 | 0.2 | tiny_vector_preserved |
| cabin-bubble-tail.svg | cabin-bubble-tail.svg | 0.2 | 0.2 | tiny_vector_preserved |
| cabin-correct-light.png | cabin-correct-light.webp | 132.5 | 20.0 | webp_q32 |
| cabin-env-city-day.png | cabin-env-city-day.webp | 880.9 | 19.9 | webp_q28 |
| cabin-env-city-night.png | cabin-env-city-night.webp | 848.8 | 25.6 | webp_q28 |
| cabin-env-deep-night.png | cabin-env-deep-night.webp | 666.6 | 6.2 | webp_q28 |
| cabin-env-garage.png | cabin-env-garage.webp | 873.6 | 25.4 | webp_q28 |
| cabin-env-rain.png | cabin-env-rain.webp | 790.7 | 10.5 | webp_q28 |
| cabin-env-scenic-day.png | cabin-env-scenic-day.webp | 669.3 | 10.5 | webp_q28 |
| cabin-env-scenic-sunset.png | cabin-env-scenic-sunset.webp | 723.1 | 7.2 | webp_q28 |
| cabin-env-snow-day.png | cabin-env-snow-day.webp | 823.7 | 14.5 | webp_q28 |
| cabin-env-tunnel.png | cabin-env-tunnel.webp | 789.4 | 11.9 | webp_q28 |
| cabin-interior.png | cabin-interior.webp | 478.4 | 64.2 | webp_q90 |
| cabin-location-icon.svg | cabin-location-icon.svg | 0.8 | 0.8 | tiny_vector_preserved |
| cabin-sleep-dim-front.svg | cabin-sleep-dim-front.svg | 0.7 | 0.7 | tiny_vector_preserved |
| cabin-sleep-dim-rear.svg | cabin-sleep-dim-rear.svg | 0.7 | 0.7 | tiny_vector_preserved |
| cabin-speed-icon.svg | cabin-speed-icon.svg | 1.4 | 1.4 | tiny_vector_preserved |
| cabin-zone-climate-icon.svg | cabin-zone-climate-icon.svg | 1.3 | 1.3 | tiny_vector_preserved |
| cabin-zone-volume-icon.svg | cabin-zone-volume-icon.svg | 0.7 | 0.7 | tiny_vector_preserved |
| figma-playing-ribbon.svg | figma-playing-ribbon.svg | 1.2 | 1.2 | tiny_vector_preserved |
| figma-ready-button.png | figma-ready-button.webp | 135.9 | 18.0 | webp_q58 |
| figma-ready-logo.png | figma-ready-logo.webp | 364.9 | 28.2 | webp_q58 |
| figma-ready-panel-mosaic.png | figma-ready-panel-mosaic.webp | 264.5 | 2.4 | webp_q24 |
| figma-ready-ring-mosaic.png | figma-ready-ring-mosaic.webp | 284.4 | 76.2 | webp_q32 |
| figma-reveal-ribbon.svg | figma-reveal-ribbon.svg | 1.2 | 1.2 | tiny_vector_preserved |
| figma-reveal-stars.png | figma-reveal-stars.webp | 18.1 | 7.5 | webp_lossless |
| figma-summary-bright-light.png | figma-summary-bright-light.webp | 260.9 | 46.4 | webp_q32 |
| figma-summary-light-base.png | figma-summary-light-base.webp | 22.9 | 9.1 | webp_lossless |
| figma-summary-light-ring.png | figma-summary-light-ring.webp | 124.8 | 21.8 | webp_q32 |
| figma-summary-mosaic.png | figma-summary-mosaic.webp | 487.5 | 77.6 | webp_q32 |
| figma-summary-mvp.png | figma-summary-mvp.webp | 33.7 | 7.7 | webp_q58 |
| figma-summary-ribbon.png | figma-summary-ribbon.webp | 59.5 | 24.9 | webp_q64 |
| figma-summary-title.png | figma-summary-title.webp | 279.3 | 23.5 | webp_q58 |
| game-icon-loading.png | game-icon-loading.png | 36.9 | 13.7 | png_palette_128 |
| hi.webp | hi.webp | 5953.7 | 2855.9 | webp_q78 |
| host-cheer.png | host-cheer-static.webp | 299.9 | 32.2 | webp_q64 |
| host-cheer.webp | host-cheer.webp | 4201.0 | 2226.8 | webp_q78 |
| host-heart.png | host-heart-static.webp | 260.1 | 26.6 | webp_q64 |
| host-heart.webp | host-heart.webp | 1557.4 | 836.5 | webp_q78 |
| host-normal.png | host-normal-static.webp | 247.0 | 23.6 | webp_q64 |
| host-normal.webp | host-normal.webp | 1854.8 | 994.0 | webp_q78 |
| host-ready-normal.webp | host-ready-normal.webp | 3538.1 | 1768.2 | webp_q78 |
| host-ready-speak.webp | host-ready-speak.webp | 2782.7 | 1410.5 | webp_q78 |
| host-speak.webp | host-speak.webp | 2477.9 | 1300.6 | webp_q78 |
| host-thinking.png | host-thinking-static.webp | 223.3 | 21.4 | webp_q90 |
| host-thinking.webp | host-thinking.webp | 2462.9 | 1283.2 | webp_q78 |
| host-yes.png | host-yes-static.webp | 280.6 | 28.1 | webp_q64 |
| host-yes.webp | host-yes.webp | 2627.4 | 1408.7 | webp_q78 |
| important-event-icon.svg | important-event-icon.svg | 0.9 | 0.9 | tiny_vector_preserved |
| passenger-baby-laugh.png | passenger-baby-laugh.webp | 103.6 | 15.5 | webp_q90 |
| passenger-baby-normal.png | passenger-baby-normal.webp | 103.8 | 15.9 | webp_q90 |
| passenger-baby-sleep.png | passenger-baby-sleep.webp | 103.2 | 16.2 | webp_q90 |
| passenger-boy-laugh.png | passenger-boy-laugh.webp | 73.2 | 15.1 | webp_q90 |
| passenger-boy-normal.png | passenger-boy-normal.webp | 64.0 | 11.7 | webp_q90 |
| passenger-boy-sleep.png | passenger-boy-sleep.webp | 71.1 | 13.4 | webp_q90 |
| passenger-dad-laugh.png | passenger-dad-laugh.webp | 104.5 | 15.5 | webp_q90 |
| passenger-dad-normal.png | passenger-dad-normal.webp | 103.1 | 16.8 | webp_q90 |
| passenger-dad-sleep.png | passenger-dad-sleep.webp | 102.4 | 14.0 | webp_q90 |
| passenger-dad-tired.png | passenger-dad-tired.webp | 103.5 | 14.6 | webp_q90 |
| passenger-female-young-laugh.png | passenger-female-young-laugh.webp | 112.6 | 20.6 | webp_q90 |
| passenger-female-young-normal.png | passenger-female-young-normal.webp | 106.5 | 18.9 | webp_q90 |
| passenger-female-young-sleep.png | passenger-female-young-sleep.webp | 108.4 | 19.8 | webp_q90 |
| passenger-female-young-tired.png | passenger-female-young-tired.webp | 111.3 | 20.0 | webp_q90 |
| passenger-female-young2-normal.png | passenger-female-young2-normal.webp | 109.3 | 17.4 | webp_q90 |
| passenger-female-young2-tired.png | passenger-female-young2-tired.webp | 113.5 | 17.6 | webp_q90 |
| passenger-female-young2-sleep.png | passenger-female-young2-sleep.webp | 103.8 | 16.1 | webp_q90 |
| passenger-female-young2-laugh.png | passenger-female-young2-laugh.webp | 107.9 | 16.6 | webp_q90 |
| passenger-girl-laugh.png | passenger-girl-laugh.webp | 89.9 | 18.6 | webp_q90 |
| passenger-girl-normal.png | passenger-girl-normal.webp | 89.5 | 17.9 | webp_q90 |
| passenger-girl-sleep.png | passenger-girl-sleep.webp | 96.0 | 19.9 | webp_q90 |
| passenger-grandma-laugh.png | passenger-grandma-laugh.webp | 100.4 | 15.1 | webp_q90 |
| passenger-grandma-normal.png | passenger-grandma-normal.webp | 105.0 | 16.6 | webp_q90 |
| passenger-grandma-sleep.png | passenger-grandma-sleep.webp | 103.2 | 15.2 | webp_q90 |
| passenger-grandpa-laugh.png | passenger-grandpa-laugh.webp | 121.2 | 20.6 | webp_q90 |
| passenger-grandpa-normal.png | passenger-grandpa-normal.webp | 122.0 | 21.6 | webp_q90 |
| passenger-grandpa-sleep.png | passenger-grandpa-sleep.webp | 122.1 | 21.8 | webp_q90 |
| passenger-male-young-laugh.png | passenger-male-young-laugh.webp | 100.0 | 17.7 | webp_q90 |
| passenger-male-young-normal.png | passenger-male-young-normal.webp | 104.7 | 16.3 | webp_q90 |
| passenger-male-young-sleep.png | passenger-male-young-sleep.webp | 93.7 | 15.3 | webp_q90 |
| passenger-male-young-tired.png | passenger-male-young-tired.webp | 97.8 | 17.2 | webp_q90 |
| passenger-mom-laugh.png | passenger-mom-laugh.webp | 97.3 | 15.0 | webp_q90 |
| passenger-mom-normal.png | passenger-mom-normal.webp | 96.9 | 13.4 | webp_q90 |
| passenger-mom-sleep.png | passenger-mom-sleep.webp | 100.0 | 15.0 | webp_q90 |
| passenger-mom-tired.png | passenger-mom-tired.webp | 96.9 | 15.0 | webp_q90 |
| question-icon.svg | question-icon.svg | 1.1 | 1.1 | tiny_vector_preserved |
| screen-city-day.png | screen-city-day.webp | 1889.2 | 69.5 | webp_q68 |
| screen-city-night.png | screen-city-night.webp | 2011.4 | 88.4 | webp_q68 |
| screen-deep-night.png | screen-deep-night.webp | 1736.2 | 66.1 | webp_q85 |
| screen-default.png | screen-default.webp | 4806.3 | 82.1 | webp_q68 |
| screen-rain.png | screen-rain.webp | 1516.5 | 80.4 | webp_q85 |
| screen-scenic-day.png | screen-scenic-day.webp | 1645.3 | 54.8 | webp_q85 |
| screen-scenic-sunset.png | screen-scenic-sunset.webp | 1251.5 | 61.7 | webp_q85 |
| screen-snow-day.png | screen-snow-day.webp | 1668.7 | 65.4 | webp_q85 |
| stage-beam.png | stage-beam.webp | 170.5 | 22.3 | webp_q24 |
