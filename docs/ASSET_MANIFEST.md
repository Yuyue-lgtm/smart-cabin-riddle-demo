# Asset Manifest

本文件记录运行时资源的规范名称。Figma 资源不直接复制进 `assets/`，应先放入临时导入目录，完成内容哈希比对后再决定是否替换规范文件。人物优先使用原始透明层；如果用户已在 Figma 裁剪或调色，应通过节点 `exportAsync({format:'PNG',contentsOnly:true,useAbsoluteBounds:true})` 导出，保留裁剪与滤镜并排除画布背景。必须检查角落alpha和透明像素数，不能只看PNG有无alpha通道；`download_assets.export`可能包含不透明画布底色，不能直接用于人物。

固定画布尺寸：主持人 `564×572`，乘客 `287×328`，中控屏背景 `1440×810`，座舱环境背景 `810×651`。

完整的 Figma 资源页、节点 ID、运行时状态和推荐文件名映射见 `docs/ASSET_CONFIG.md`。

## Canonical Assets

2026-10-23 新增女青年2：`Assets / Passengers` 节点 `398:224`–`398:227`，四种状态均按用户裁剪的287×328导出透明PNG后转为质量90的WebP，不缩放，逐像素透明通道一致。运行文件为 `passenger-female-young2-{normal,tired,sleep,laugh}.webp`，原始切片与压缩脚本保存在 `tmp/female-young2-20261023/`，校验记录追加至`IMAGE_OPTIMIZATION.json`。

2026-10-23：运行资源按`IMAGE_OPTIMIZATION.json`追加压缩；主持人静态fallback使用`-static.webp`，图集仍为原名WebP，尺寸和375帧坐标不变。准备页panel-mosaic允许低清，素材降为128×84，页面显示尺寸和摆放不变；其他图片保持当前输出尺寸。hi-audio、host-cheer、host-yes追加64 kbps MP3压缩，时长不变，动画JSON不变。完整体积与备份位置见 [压缩报告](IMAGE_OPTIMIZATION.md)。图标保留PNG，SVG不变；不改变加载逻辑，不部署线上。

| 项目规范文件 | 当前用途 | 历史 Figma 导出名 |
| --- | --- | --- |
| `screen-default.webp` | 中控屏默认背景 | `figma-*-background.png` |
| `cabin-env-garage.webp` | 座舱车库环境背景，实际导出尺寸 807×651 | Figma `Assets / Cabin Environments` / `CE 车库` / `272:322` |
| `cabin-env-tunnel.webp` | 座舱隧道环境背景，实际导出尺寸 807×651 | Figma `Assets / Cabin Environments` / `CE 隧道` / `272:323` |
| `host-normal-static.webp` | AI 主持人默认状态的静态 fallback | `figma-*-host.png` |
| `host-normal.json` + `host-normal.webp` | AI 主持人默认待机透明序列动画，32 帧、10fps，Canvas 循环播放且无音频 | 用户提供 Sprite Sheet |
| `host-speak.json` + `host-speak.webp` | AI 主持人说话透明序列动画，运行时使用大图内有效的 42 帧、10fps，主持人气泡显示期间 Canvas 循环播放；不播放 JSON 中越出大图范围的末尾帧 | 用户提供 Sprite Sheet |
| `host-thinking.json` + `host-thinking.webp` | AI 主持人思考透明序列动画，40 帧、10fps，Canvas 播放一次，完成后回默认状态 | 用户提供 Sprite Sheet |
| `host-heart.json` + `host-heart.webp` | AI 主持人比心透明序列动画，27 帧、10fps，Canvas 播放一次 | 用户提供 Sprite Sheet |
| `host-yes.json` + `host-yes.webp` + `host-yes.mp3` | AI 主持人答对后的 40 帧透明序列动画，10fps，Canvas 播放一次；音频延迟 180ms、音量 0.85 | 用户提供 Sprite Sheet 与音频 |
| `background-music.mp3` | 游戏背景音乐，准备页开关控制，循环播放，默认关闭，音量 25% | 用户提供 `正午阳光.mp3`，原样导入，约48.43秒 |
| `stage-beam.webp` | 准备页和结算页光束 | `figma-ready-beam.png`、`figma-summary-beam-right.png` |
| `game-icon-loading.png` | 游戏加载页、游戏中、揭晓页及网页标签图标 | Figma「游戏加载」节点 `379:74` |
| `question-icon.svg` | 问题计数图标 | `figma-playing-question-icon.svg`、`figma-reveal-question-icon.svg` |
| `bubble-tail.svg` | 主持人气泡尾部 | `figma-*-bubble-tail.*` |
| `cabin-interior.webp` | 座舱内饰透明叠层 | Figma `座舱内` |
| `cabin-correct-light.webp` | 答对座位氛围灯，单次显示 5 秒 | Figma `答对 氛围灯` |
| `cabin-location-icon.svg` | 座舱目的地状态图标 | Figma `状态胶囊 / 目的地 / 图标` |
| `cabin-speed-icon.svg` | 座舱车速状态图标 | Figma `状态胶囊 / 车速 / 图标` |
| `important-event-icon.svg` | 座舱重要事件红色感叹号图标 | Figma `重要事件图标 / 红色感叹号` |
| `cabin-bubble-tail.svg` | 乘客发言气泡尾部 | Figma 乘客气泡 `Icon` |

## Import Rules

2026-10-22 本地清理：删除旧 `background-music.m4a`、`host-puzzled.png`、`host-wave` 的 JSON/WebP/PNG/MP3、`figma-reveal-light-ring.png`。揭晓页同步移除光圈节点及样式；尴尬状态保留语义，改用默认主持人动效。额外删除无运行引用的 `host-yes-square.png` 和 `assets/.DS_Store`，共释放 5,170,031 字节（约4.93MiB）。其余资源均可从 HTML/CSS/JS 或被引用的 JSON/SVG 追溯到，静态 fallback 保留；历史发布记录中的旧文件名仅作历史说明。

`tests/asset-integrity.test.cjs` 检查运行引用、JSON图片与音频依赖均存在、保留资源可达，以及旧资源及揭晓光圈引用均已移除。旧准备页浏览器脚本入口转交 `tests/ready-host-browser.cjs`，不再请求已淘汰的wave资源。

1. 新导出资源先放入 `tmp/figma-import/`，不要直接覆盖 `assets/`。
2. 通过 SHA-256 判断是否与现有资源内容相同；相同文件直接丢弃。
3. 只有视觉内容确实变化时才替换规范文件，并保持代码引用不变。
4. 新增真实状态时使用语义名称，例如 `host-thinking.webp`、`host-yes.mp3`、`screen-city-day.webp`。人物动画的 Sprite Sheet 使用 JSON + WebP 配对，静态 PNG 只保留为 fallback。后续视觉资源稳定后再统一做尺寸压缩、首屏预加载和非首屏懒加载。
5. 提交前检查 HTML、CSS 和 JS 引用，并完成准备、游戏中、揭晓、结算四状态回归。

## Deployment Source

当前 Vercel 配置通过根目录 `index.html`、`assets/` 和 `api/` 提供页面与接口，不读取 `dist/`。`dist/` 仅作为本地历史构建产物，已从 Git 和 Vercel 上传包中排除。

## Runtime Animation Notes

- `host-normal` 循环播放；`host-speak` 在主持人气泡显示期间循环播放，气泡消失后停止；`host-thinking`、`host-heart` 和 `host-yes` 播放一次。
- 主持人思考时隐藏主持人说话气泡；思考动画结束后自动回到默认待机动画。
- `host-yes.mp3` 只在答对动画中播放，音频加载失败时使用答对提示音兜底。
- `background-music.mp3` 由准备页右上角声音按钮控制，默认关闭；每次进入准备页从 `0` 秒开始，打开后循环播放，首次播放遵守浏览器用户手势限制。
- 本地代理已声明 `.webp`、`.mp3` 的 MIME 类型，并允许 `.mp3` 作为静态媒体资源返回。
