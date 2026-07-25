# Asset Manifest

本文件记录运行时资源的规范名称。Figma 导出文件不直接复制进 `assets/`，应先放入 `tmp/figma-import/`，完成内容哈希比对后再决定是否替换规范文件。

## Canonical Assets

| 项目规范文件 | 当前用途 | 历史 Figma 导出名 |
| --- | --- | --- |
| `screen-background.png` | 中控屏准备、游戏中、揭晓、结算背景 | `figma-*-background.png` |
| `host-default.png` | 当前四种主持人状态的默认占位图 | `figma-*-host.png` |
| `stage-beam.png` | 准备页和结算页光束 | `figma-ready-beam.png`、`figma-summary-beam-right.png` |
| `game-icon.png` | 游戏图标 | `figma-playing-game-icon.png`、`figma-reveal-game-icon.png` |
| `question-icon.svg` | 问题计数图标 | `figma-playing-question-icon.svg`、`figma-reveal-question-icon.svg` |
| `bubble-tail.svg` | 主持人气泡尾部 | `figma-*-bubble-tail.*` |
| `cabin-env-sunset.png` | 座舱区夕阳车外环境 | Figma `外部环境-夕阳` |
| `cabin-interior.png` | 座舱内饰透明叠层 | Figma `座舱内` |
| `cabin-correct-light.png` | 答对座位氛围灯，单次显示 5 秒 | Figma `答对 氛围灯` |
| `passenger-female.png` | 当前女性乘客基础形象 | Figma `用户-后排右`、`用户-副驾` |
| `passenger-male.png` | 当前男性乘客基础形象 | Figma `用户-后排左`、`用户-主驾` |
| `cabin-location-icon.svg` | 座舱目的地状态图标 | Figma `状态胶囊 / 目的地 / 图标` |
| `cabin-speed-icon.svg` | 座舱车速状态图标 | Figma `状态胶囊 / 车速 / 图标` |
| `cabin-bubble-tail.svg` | 乘客发言气泡尾部 | Figma 乘客气泡 `Icon` |

## Import Rules

1. 新导出资源先放入 `tmp/figma-import/`，不要直接覆盖 `assets/`。
2. 通过 SHA-256 判断是否与现有资源内容相同；相同文件直接丢弃。
3. 只有视觉内容确实变化时才替换规范文件，并保持代码引用不变。
4. 新增真实状态时使用语义名称，例如 `host-excited.webp`、`screen-rain.webp`。
5. 提交前检查 HTML、CSS 和 JS 引用，并完成准备、游戏中、揭晓、结算四状态回归。

## Deployment Source

当前 Vercel 配置通过根目录 `index.html`、`assets/` 和 `api/` 提供页面与接口，不读取 `dist/`。`dist/` 仅作为本地历史构建产物，已从 Git 和 Vercel 上传包中排除。
