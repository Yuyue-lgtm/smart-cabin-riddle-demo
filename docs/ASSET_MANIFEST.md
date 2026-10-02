# Asset Manifest

本文件记录运行时资源的规范名称。Figma 资源不直接复制进 `assets/`，应先放入 `tmp/figma-import/`，完成内容哈希比对后再决定是否替换规范文件。人物切片必须使用 Figma 的 `rawImages` 原始透明层，不能使用节点 `export` 合成图。

固定画布尺寸：主持人 `564×572`，乘客 `287×328`，中控屏背景 `1440×810`，座舱环境背景 `810×651`。

完整的 Figma 资源页、节点 ID、运行时状态和推荐文件名映射见 `docs/ASSET_CONFIG.md`。

## Canonical Assets

| 项目规范文件 | 当前用途 | 历史 Figma 导出名 |
| --- | --- | --- |
| `screen-default.png` | 中控屏默认背景 | `figma-*-background.png` |
| `cabin-env-garage.png` | 座舱车库环境背景，实际导出尺寸 807×651 | Figma `Assets / Cabin Environments` / `CE 车库` / `272:322` |
| `cabin-env-tunnel.png` | 座舱隧道环境背景，实际导出尺寸 807×651 | Figma `Assets / Cabin Environments` / `CE 隧道` / `272:323` |
| `host-normal.png` | AI 主持人默认状态的静态 fallback | `figma-*-host.png` |
| `host-normal.json` + `host-normal.webp` | AI 主持人默认待机透明序列动画，32 帧、10fps，Canvas 循环播放且无音频 | 用户提供 Sprite Sheet |
| `host-speak.json` + `host-speak.webp` | AI 主持人说话透明序列动画，运行时使用大图内有效的 42 帧、10fps，主持人气泡显示期间 Canvas 循环播放；不播放 JSON 中越出大图范围的末尾帧 | 用户提供 Sprite Sheet |
| `host-thinking.json` + `host-thinking.webp` | AI 主持人思考透明序列动画，40 帧、10fps，Canvas 播放一次，完成后回默认状态 | 用户提供 Sprite Sheet |
| `host-heart.json` + `host-heart.webp` | AI 主持人比心透明序列动画，27 帧、10fps，Canvas 播放一次 | 用户提供 Sprite Sheet |
| `host-yes.json` + `host-yes.webp` + `host-yes.mp3` | AI 主持人答对后的 40 帧透明序列动画，10fps，Canvas 播放一次；音频延迟 180ms、音量 0.85 | 用户提供 Sprite Sheet 与音频 |
| `background-music.m4a` | 游戏背景音乐，准备页开关控制，循环播放，默认关闭，音量 25% | 用户提供 `背景音乐.m4a` |
| `stage-beam.png` | 准备页和结算页光束 | `figma-ready-beam.png`、`figma-summary-beam-right.png` |
| `game-icon.png` | 游戏图标 | `figma-playing-game-icon.png`、`figma-reveal-game-icon.png` |
| `question-icon.svg` | 问题计数图标 | `figma-playing-question-icon.svg`、`figma-reveal-question-icon.svg` |
| `bubble-tail.svg` | 主持人气泡尾部 | `figma-*-bubble-tail.*` |
| `cabin-interior.png` | 座舱内饰透明叠层 | Figma `座舱内` |
| `cabin-correct-light.png` | 答对座位氛围灯，单次显示 5 秒 | Figma `答对 氛围灯` |
| `cabin-location-icon.svg` | 座舱目的地状态图标 | Figma `状态胶囊 / 目的地 / 图标` |
| `cabin-speed-icon.svg` | 座舱车速状态图标 | Figma `状态胶囊 / 车速 / 图标` |
| `important-event-icon.svg` | 座舱重要事件红色感叹号图标 | Figma `重要事件图标 / 红色感叹号` |
| `cabin-bubble-tail.svg` | 乘客发言气泡尾部 | Figma 乘客气泡 `Icon` |

## Import Rules

1. 新导出资源先放入 `tmp/figma-import/`，不要直接覆盖 `assets/`。
2. 通过 SHA-256 判断是否与现有资源内容相同；相同文件直接丢弃。
3. 只有视觉内容确实变化时才替换规范文件，并保持代码引用不变。
4. 新增真实状态时使用语义名称，例如 `host-thinking.webp`、`host-yes.mp3`、`screen-city-day.png`。人物动画的 Sprite Sheet 使用 JSON + WebP 配对，静态 PNG 只保留为 fallback。后续视觉资源稳定后再统一做尺寸压缩、首屏预加载和非首屏懒加载。
5. 提交前检查 HTML、CSS 和 JS 引用，并完成准备、游戏中、揭晓、结算四状态回归。

## Deployment Source

当前 Vercel 配置通过根目录 `index.html`、`assets/` 和 `api/` 提供页面与接口，不读取 `dist/`。`dist/` 仅作为本地历史构建产物，已从 Git 和 Vercel 上传包中排除。

## Runtime Animation Notes

- `host-normal` 循环播放；`host-speak` 在主持人气泡显示期间循环播放，气泡消失后停止；`host-thinking`、`host-heart` 和 `host-yes` 播放一次。
- 主持人思考时隐藏主持人说话气泡；思考动画结束后自动回到默认待机动画。
- `host-yes.mp3` 只在答对动画中播放，音频加载失败时使用答对提示音兜底。
- `background-music.m4a` 由准备页右上角声音按钮控制，默认关闭；每次进入准备页从 `0` 秒开始，打开后循环播放，首次播放遵守浏览器用户手势限制。
- 本地代理已声明 `.webp`、`.mp3` 的 MIME 类型，并允许 `.mp3` 作为静态媒体资源返回。
