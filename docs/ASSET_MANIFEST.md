# Asset Manifest

本文件记录运行时资源的规范名称。Figma 资源不直接复制进 `assets/`，应先放入 `tmp/figma-import/`，完成内容哈希比对后再决定是否替换规范文件。人物切片必须使用 Figma 的 `rawImages` 原始透明层，不能使用节点 `export` 合成图。

固定画布尺寸：主持人 `564×572`，乘客 `287×328`，中控屏背景 `1440×810`，座舱环境背景 `810×651`。

完整的 Figma 资源页、节点 ID、运行时状态和推荐文件名映射见 `docs/ASSET_CONFIG.md`。

## Canonical Assets

| 项目规范文件 | 当前用途 | 历史 Figma 导出名 |
| --- | --- | --- |
| `screen-default.png` | 中控屏默认背景 | `figma-*-background.png` |
| `host-normal.png` | AI 主持人默认状态 | `figma-*-host.png` |
| `stage-beam.png` | 准备页和结算页光束 | `figma-ready-beam.png`、`figma-summary-beam-right.png` |
| `game-icon.png` | 游戏图标 | `figma-playing-game-icon.png`、`figma-reveal-game-icon.png` |
| `question-icon.svg` | 问题计数图标 | `figma-playing-question-icon.svg`、`figma-reveal-question-icon.svg` |
| `bubble-tail.svg` | 主持人气泡尾部 | `figma-*-bubble-tail.*` |
| `cabin-interior.png` | 座舱内饰透明叠层 | Figma `座舱内` |
| `cabin-correct-light.png` | 答对座位氛围灯，单次显示 5 秒 | Figma `答对 氛围灯` |
| `cabin-location-icon.svg` | 座舱目的地状态图标 | Figma `状态胶囊 / 目的地 / 图标` |
| `cabin-speed-icon.svg` | 座舱车速状态图标 | Figma `状态胶囊 / 车速 / 图标` |
| `cabin-bubble-tail.svg` | 乘客发言气泡尾部 | Figma 乘客气泡 `Icon` |

## Import Rules

1. 新导出资源先放入 `tmp/figma-import/`，不要直接覆盖 `assets/`。
2. 通过 SHA-256 判断是否与现有资源内容相同；相同文件直接丢弃。
3. 只有视觉内容确实变化时才替换规范文件，并保持代码引用不变。
4. 新增真实状态时使用语义名称，例如 `host-yes.png`、`screen-city-day.png`。当前资源快速迭代阶段先保持 PNG/JPG，后续视觉资源稳定后再统一转换 WebP。
5. 提交前检查 HTML、CSS 和 JS 引用，并完成准备、游戏中、揭晓、结算四状态回归。

## Deployment Source

当前 Vercel 配置通过根目录 `index.html`、`assets/` 和 `api/` 提供页面与接口，不读取 `dist/`。`dist/` 仅作为本地历史构建产物，已从 Git 和 Vercel 上传包中排除。
