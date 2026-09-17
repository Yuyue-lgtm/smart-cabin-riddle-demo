# Asset Config

本文档记录 Figma 资源页中的图片资源与 Demo 运行时配置的对应关系。Figma 负责视觉资源源文件，项目运行时使用 `assets/` 下的规范文件名。

Figma 文件：https://www.figma.com/design/gpsQrBcnC7pejnzFVsSbsY/guess-game-demo

## 使用原则

1. Figma 图层名保留中文可读名称，导出到项目后统一改为语义化英文文件名。
2. 新导出文件先进入 `tmp/figma-import/`，完成内容比对后再进入 `assets/`。
3. 当前阶段优先保持 PNG/JPG 原图质量，等 V1.4 视觉资源基本稳定后，再统一做 WebP 和加载优化。
4. 代码只引用规范文件名，不直接引用 Figma 临时导出名。
5. 缺少某个状态资源时，按表内 `fallback_asset` 回退，避免页面空图。
6. 人物切片使用 Figma 返回的 `rawImages` 原始透明图片层；不要使用节点 `export` 合成图，避免把画板底色一起带入人物资源。
7. 运行时固定画布尺寸：主持人 `564×572`、乘客 `287×328`、中控背景 `1440×810`、座舱环境 `810×651`。个别 Figma 节点若少 1px，导入时只补透明边缘，不拉伸人物。
8. Figma 中同名资源按媒体类型优先级处理：视频优先于静态切片，静态切片作为视频不可用时的 fallback。

## AI Host

| asset_key | 类型 | Figma 页面 | Figma 节点 | Figma 图层名 | 推荐文件名 | 适用状态 | fallback_asset |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `host_yes` | AI_HOST | Assets / AI Host | `214:1920` | 主持人 yes！静态切片 | `host-yes.png` | 猜对、答对反馈、正向确认；视频 fallback | `host-normal.png` |
| `host_cheer` | AI_HOST | Assets / AI Host | `214:1919` | 主持人 欢呼 | `host-cheer.png` | 结算、胜利总结、高情绪价值夸奖 | `host-yes.png` |
| `host_puzzled` | AI_HOST | Assets / AI Host | `214:1915` | 主持人 疑惑 | `host-puzzled.png` | 思考、尴尬、玩家方向偏离 | `host-normal.png` |
| `host_heart` | AI_HOST | Assets / AI Host | `214:1916` | 主持人 比心 | `host-heart.png` | 鼓励、安抚、亲和表达 | `host-normal.png` |
| `host_wave` | AI_HOST | Assets / AI Host | `214:1917` | 主持人 打招呼 | `host-wave.png` | 开场、恢复游戏、欢迎回来 | `host-normal.png` |
| `host_normal` | AI_HOST | Assets / AI Host | `214:1918` | 主持人 默认 | `host-normal.png` | 默认主持状态 | `host-normal.png` |
| `host_yes_video` | AI_HOST_VIDEO | Assets / AI Host | `227:2` | 主持人 yes！视频 | `host-yes.webm` | 猜对、答对反馈，优先于 `host_yes` 静态切片 | `host-yes.png` |

### Host State Mapping

| 运行时字段 | 推荐资源 | 显示时长 | 备注 |
| --- | --- | --- | --- |
| `normal` | `host_normal` | 常驻 | 默认状态 |
| `greeting` | `host_wave` | 4s 后回默认 | 开局或恢复 |
| `smile` | `host_heart` | 4s 后回默认 | 亲和、鼓励 |
| `awkward` | `host_puzzled` | 4s 后回默认 | 尴尬、疑惑、冷场兜底 |
| `excited` | `host_yes` | 4s 后回默认 | 答对题目 |
| `celebration` | `host_cheer` | 4s 后回默认 | 揭晓、结算、MVP |

## Passengers

| asset_key | 类型 | Figma 页面 | Figma 节点 | Figma 图层名 | 推荐文件名 | 乘客角色 | 状态 | fallback_asset |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `passenger_baby_normal` | PASSENGER | Assets / Passengers | `184:310` | 婴儿_默认 | `passenger-baby-normal.png` | 婴儿 | 普通 | `passenger-girl-normal.png` |
| `passenger_baby_laugh` | PASSENGER | Assets / Passengers | `184:309` | 婴儿_大笑 | `passenger-baby-laugh.png` | 婴儿 | 大笑 | `passenger-baby-normal.png` |
| `passenger_baby_sleep` | PASSENGER | Assets / Passengers | `184:308` | 婴儿_睡着 | `passenger-baby-sleep.png` | 婴儿 | 睡着 | `passenger-baby-normal.png` |
| `passenger_grandma_normal` | PASSENGER | Assets / Passengers | `184:312` | 奶奶_默认 | `passenger-grandma-normal.png` | 奶奶 | 普通 | `passenger-female-young-normal.png` |
| `passenger_grandma_laugh` | PASSENGER | Assets / Passengers | `184:316` | 奶奶_大笑 | `passenger-grandma-laugh.png` | 奶奶 | 大笑 | `passenger-grandma-normal.png` |
| `passenger_grandma_sleep` | PASSENGER | Assets / Passengers | `184:311` | 奶奶_睡着 | `passenger-grandma-sleep.png` | 奶奶 | 睡着 | `passenger-grandma-normal.png` |
| `passenger_grandpa_normal` | PASSENGER | Assets / Passengers | `184:305` | 爷爷_默认 | `passenger-grandpa-normal.png` | 爷爷 | 普通 | `passenger-male-young-normal.png` |
| `passenger_grandpa_laugh` | PASSENGER | Assets / Passengers | `184:317` | 爷爷_大笑 | `passenger-grandpa-laugh.png` | 爷爷 | 大笑 | `passenger-grandpa-normal.png` |
| `passenger_grandpa_sleep` | PASSENGER | Assets / Passengers | `184:318` | 爷爷_睡着 | `passenger-grandpa-sleep.png` | 爷爷 | 睡着 | `passenger-grandpa-normal.png` |
| `passenger_girl_normal` | PASSENGER | Assets / Passengers | `184:288` | 小女孩_默认 | `passenger-girl-normal.png` | 小女孩 | 普通 | `passenger-female-young-normal.png` |
| `passenger_girl_laugh` | PASSENGER | Assets / Passengers | `184:290` | 小女孩_大笑 | `passenger-girl-laugh.png` | 小女孩 | 大笑 | `passenger-girl-normal.png` |
| `passenger_girl_sleep` | PASSENGER | Assets / Passengers | `184:289` | 小女孩_睡着 | `passenger-girl-sleep.png` | 小女孩 | 睡着 | `passenger-girl-normal.png` |
| `passenger_boy_normal` | PASSENGER | Assets / Passengers | `184:313` | 小男孩_默认 | `passenger-boy-normal.png` | 小男孩 | 普通 | `passenger-male-young-normal.png` |
| `passenger_boy_laugh` | PASSENGER | Assets / Passengers | `184:306` | 小男孩_大笑 | `passenger-boy-laugh.png` | 小男孩 | 大笑 | `passenger-boy-normal.png` |
| `passenger_boy_sleep` | PASSENGER | Assets / Passengers | `184:307` | 小男孩_睡着 | `passenger-boy-sleep.png` | 小男孩 | 睡着 | `passenger-boy-normal.png` |
| `passenger_female_young_normal` | PASSENGER | Assets / Passengers | `184:291` | 女青年_默认 | `passenger-female-young-normal.png` | 女青年 | 普通 | `passenger-female-young-normal.png` |
| `passenger_female_young_laugh` | PASSENGER | Assets / Passengers | `184:293` | 女青年_大笑 | `passenger-female-young-laugh.png` | 女青年 | 大笑 | `passenger-female-young-normal.png` |
| `passenger_female_young_tired` | PASSENGER | Assets / Passengers | `184:294` | 女青年_犯困 | `passenger-female-young-tired.png` | 女青年 | 犯困 | `passenger-female-young-normal.png` |
| `passenger_female_young_sleep` | PASSENGER | Assets / Passengers | `184:292` | 女青年_睡着 | `passenger-female-young-sleep.png` | 女青年 | 睡着 | `passenger-female-young-normal.png` |
| `passenger_male_young_normal` | PASSENGER | Assets / Passengers | `184:295` | 男青年_默认 | `passenger-male-young-normal.png` | 男青年 | 普通 | `passenger-male-young-normal.png` |
| `passenger_male_young_laugh` | PASSENGER | Assets / Passengers | `184:296` | 男青年_大笑 | `passenger-male-young-laugh.png` | 男青年 | 大笑 | `passenger-male-young-normal.png` |
| `passenger_male_young_tired` | PASSENGER | Assets / Passengers | `184:297` | 男青年_犯困 | `passenger-male-young-tired.png` | 男青年 | 犯困 | `passenger-male-young-normal.png` |
| `passenger_male_young_sleep` | PASSENGER | Assets / Passengers | `184:298` | 男青年_睡着 | `passenger-male-young-sleep.png` | 男青年 | 睡着 | `passenger-male-young-normal.png` |
| `passenger_mom_normal` | PASSENGER | Assets / Passengers | `184:304` | 妈妈_默认 | `passenger-mom-normal.png` | 妈妈 | 普通 | `passenger-female-young-normal.png` |
| `passenger_mom_laugh` | PASSENGER | Assets / Passengers | `184:303` | 妈妈_大笑 | `passenger-mom-laugh.png` | 妈妈 | 大笑 | `passenger-mom-normal.png` |
| `passenger_mom_tired` | PASSENGER | Assets / Passengers | `184:301` | 妈妈_犯困 | `passenger-mom-tired.png` | 妈妈 | 犯困 | `passenger-mom-normal.png` |
| `passenger_mom_sleep` | PASSENGER | Assets / Passengers | `184:302` | 妈妈_睡着 | `passenger-mom-sleep.png` | 妈妈 | 睡着 | `passenger-mom-normal.png` |
| `passenger_dad_normal` | PASSENGER | Assets / Passengers | `184:299` | 爸爸_默认 | `passenger-dad-normal.png` | 爸爸 | 普通 | `passenger-male-young-normal.png` |
| `passenger_dad_laugh` | PASSENGER | Assets / Passengers | `184:300` | 爸爸_大笑 | `passenger-dad-laugh.png` | 爸爸 | 大笑 | `passenger-dad-normal.png` |
| `passenger_dad_tired` | PASSENGER | Assets / Passengers | `184:314` | 爸爸_犯困 | `passenger-dad-tired.png` | 爸爸 | 犯困 | `passenger-dad-normal.png` |
| `passenger_dad_sleep` | PASSENGER | Assets / Passengers | `184:315` | 爸爸_睡着 | `passenger-dad-sleep.png` | 爸爸 | 睡着 | `passenger-dad-normal.png` |

### Relationship Seat Mapping

| 乘客关系 | driver | front | rearLeft | rearRight |
| --- | --- | --- | --- | --- |
| 年轻朋友 | 男青年 | 女青年 | 男青年 | 女青年 |
| 父母+小孩 | 爸爸 | 妈妈 | 小男孩 | 小女孩 |
| 中老年+儿女 | 男青年 | 女青年 | 爷爷 | 奶奶 |

### Passenger State Mapping

| 前端状态 | Figma 状态 | 说明 |
| --- | --- | --- |
| `normal` | 默认 | 常规状态 |
| `laugh` | 大笑 | 舱内大笑、玩梗、答对后短暂表现 |
| `tired` | 犯困 | 主驾疲惫、乘客低参与、困倦 |
| `sleeping` | 睡着 | 乘客睡着，不再参与自动提问 |
| `celebrating` | 大笑 + 答对氛围灯 | 答对题目时，乘客资源可短暂大笑，氛围灯单独叠加 5s |

## Control Screen Backgrounds

| asset_key | 类型 | Figma 页面 | Figma 节点 | Figma 图层名 | 推荐文件名 | 适用中控背景 | fallback_asset |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `screen_default` | CONTROL_SCREEN_BG | Assets / Control Screen Backgrounds | `222:234` | CS 默认背景 | `screen-default.png` | 默认 | `screen-default.png` |
| `screen_city_day` | CONTROL_SCREEN_BG | Assets / Control Screen Backgrounds | `212:1648` | CS 城市白天 | `screen-city-day.png` | 城区晴天白天、城区雨天白天 | `screen-default.png` |
| `screen_city_night` | CONTROL_SCREEN_BG | Assets / Control Screen Backgrounds | `212:1651` | CS 城市夜晚 | `screen-city-night.png` | 城区夜晚 | `screen-default.png` |
| `screen_scenic_day` | CONTROL_SCREEN_BG | Assets / Control Screen Backgrounds | `212:1654` | CS 风景白天 | `screen-scenic-day.png` | 风景区晴天白天、高速路晴天白天 | `screen-default.png` |
| `screen_scenic_sunset` | CONTROL_SCREEN_BG | Assets / Control Screen Backgrounds | `199:1294` | CS 风景晚霞 | `screen-scenic-sunset.png` | 风景区傍晚、雨天朋友聚会揭晓氛围 | `screen-scenic-day.png` |
| `screen_snow_day` | CONTROL_SCREEN_BG | Assets / Control Screen Backgrounds | `212:1657` | CS 雪景白天 | `screen-snow-day.png` | 风景区雪景白天 | `screen-default.png` |
| `screen_deep_night` | CONTROL_SCREEN_BG | Assets / Control Screen Backgrounds | `216:2291` | CS 深夜 | `screen-deep-night.png` | 高速路晴天深夜、风景区晴天深夜 | `screen-default.png` |

## Cabin Environments

| asset_key | 类型 | Figma 页面 | Figma 节点 | Figma 图层名 | 推荐文件名 | 适用座舱外景 | fallback_asset |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cabin_scenic_day` | CABIN_ENV | Assets / Cabin Environments | `209:1297` | CE 风景白天 | `cabin-env-scenic-day.png` | 风景区晴天白天、高速路晴天白天 | `cabin-env-scenic-day.png` |
| `cabin_snow_day` | CABIN_ENV | Assets / Cabin Environments | `212:1668` | CE 雪景白天 | `cabin-env-snow-day.png` | 风景区雪景白天 | `cabin-env-scenic-day.png` |
| `cabin_city_day` | CABIN_ENV | Assets / Cabin Environments | `212:1670` | CE 城市白天 | `cabin-env-city-day.png` | 城区晴天白天、城区雨天白天 | `cabin-env-scenic-day.png` |
| `cabin_city_night` | CABIN_ENV | Assets / Cabin Environments | `209:1437` | CE 城市夜晚 | `cabin-env-city-night.png` | 城区夜晚 | `cabin-env-city-day.png` |
| `cabin_scenic_sunset` | CABIN_ENV | Assets / Cabin Environments | `209:1577` | CE 风景晚霞 | `cabin-env-scenic-sunset.png` | 风景区傍晚、雨天朋友聚会揭晓氛围 | `cabin-env-scenic-day.png` |
| `cabin_deep_night` | CABIN_ENV | Assets / Cabin Environments | `216:2293` | CE 深夜 | `cabin-env-deep-night.png` | 高速路晴天深夜、风景区晴天深夜 | `cabin-env-scenic-sunset.png` |

## Environment Runtime Mapping

| 车外环境 | control_screen_bg | cabin_environment | 备注 |
| --- | --- | --- | --- |
| 高速路晴天白天 | `screen_scenic_day` | `cabin_scenic_day` | 当前暂无专用高速图，先用风景白天 |
| 高速路晴天深夜 | `screen_deep_night` | `cabin_deep_night` | 夜间氛围 |
| 高速路雨天白天 | `screen_scenic_sunset` | `cabin_scenic_sunset` | 当前暂无雨天图，先用晚霞/暗色氛围占位 |
| 城区晴天白天 | `screen_city_day` | `cabin_city_day` | 城市白天 |
| 城区雨天白天 | `screen_city_day` | `cabin_city_day` | 当前暂无雨天图，先用城市白天 |
| 风景区晴天白天 | `screen_scenic_day` | `cabin_scenic_day` | 风景白天 |
| 风景区雪景白天 | `screen_snow_day` | `cabin_snow_day` | 雪景白天 |
| 风景区晴天深夜 | `screen_deep_night` | `cabin_deep_night` | 深夜氛围 |

## 下一步接入建议

1. 按本表从 Figma 导出资源到 `tmp/figma-import/`。
2. 完成哈希去重后，移动到 `assets/` 并使用推荐文件名。
3. 在 `app.js` 中新增资源配置对象，不再把状态判断散落在渲染逻辑里。
4. 先接入主持人和中控/座舱背景，再接入乘客状态矩阵。
5. 资源稳定后，再进行 WebP、尺寸压缩、首屏预加载和非首屏懒加载。
