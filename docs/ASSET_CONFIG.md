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
8. Figma 中同名资源按媒体类型整理；当前运行时主持人动画统一使用透明 Sprite Sheet + Canvas，静态 PNG 只作为加载失败时的 fallback，视频文件不再是主持人动画的运行时依赖。
9. Sprite Sheet 固定 6 列、行数随帧数变化，每帧为 `720×720`，运行时显示区域保持主持人 `564×572`；JSON 中的帧数和 fps 用于核对资源，播放时按统一 `100ms` 帧间隔推进。

## 游戏图标与网页标签（2026-10-21）

最新来源：`261:12`「Pencil 1:1 / 游戏进行中-第几题」中的 `261:37`「游戏icon」。游戏加载页、游戏中、揭晓页及网页标签 favicon 统一复用 `assets/game-icon-loading.png`（130×130 PNG）；游戏中显示尺寸由 47×47 容器控制，位置(31,39)、圆角12px。通过版本查询参数刷新浏览器图标缓存，不另存游戏图标切片或 favicon 副本。

## 打招呼与庆祝动效（2026-10-21）

准备页时序随后调整：wave 播完再显示欢迎气泡和说话动效，欢迎语音按共用声音开关合成；说话动效在音频结束或失败时回待机，文字可保留。欢迎播放中开始游戏会取消欢迎，不占用游戏主持状态；素材资源本身不变。该项先在本地验证，尚未部署正式网站。

同日更新：打招呼改用用户新提供的 `host-wave-sprites/host-wave.webp`、`host-wave.json`、`host-wave-audio.mp3`；音频在项目内规范为 `host-wave.mp3`，JSON 引用同步修正。仍为 4320×5040、40 帧、10fps/4 秒，播放及开关逻辑不变。WebP 与 MP3 不转码，运行引用增加内容 hash 查询参数，避免浏览器沿用旧素材。

用户提供的 `host-wave/`、`host-cheer/` 原始 WebP 和 MP3 原样导入，不重新转码；JSON 的 `meta.image` 和 `audio.src` 改为对应规范英文文件名。打招呼为 4320×5040、40 帧、4 秒（最后两个格子透明且不在声明帧内）；庆祝为 4320×7200、60 帧、6 秒，100 个声明帧均有效，无须裁帧。

准备页每次进入播放一次打招呼，结算页每次进入播放一次庆祝，完成后回到待机/说话动画。准备页首次默认为静音，点击现有声音开关开启时重新播放打招呼及 MP3，以满足浏览器用户手势要求。音效共用背景音/主持人语音开关，无须调用语音 API；静音、离开页面状态会终止音效，旧异步加载不会串入新状态。模拟暂停同时冻结动画和音效，恢复后续播。结算页移除旧合成提示音，避免与提供的庆祝音效叠加；保留原 6 秒后结算串词流程。

## 准备页招呼动效更新（2026-10-21）

改用用户提供的 `hi-sprites/hi.webp` 与 `hi.json`，规范资源为 `assets/hi.webp`、`assets/hi.json`，4320×7200、60帧、10fps。准备页持续循环该动效，不切换其他主持人动画；不再显示欢迎话术气泡，也不触发欢迎语音。配套 `hi-audio.mp3` 不自动播放。背景音开关始终可见；未关闭过的新手引导气泡在进入准备页4秒后出现，离开准备页隐藏。人偶显示框为 `556×556`，位于中控画布坐标 `(788,251)`；只覆盖准备页，游戏中和结算页保持原尺寸位置。

## 游戏加载页（2026-10-21）

来源 Figma `377:46`「Pencil 1:1 / 游戏加载」。图标节点 `379:74` 原图保存在 `assets/game-icon-loading.png`（130×130），并同时供游戏画面及网页标签复用；加载页显示130×130、圆角30，内容块(441,301)、宽558，标题30px，进度轨558×12。底色及右上渐变由CSS还原，不使用整屏截图。加载范围、20秒失败出口和首题模板缓存见 [GAME_LOADING.md](GAME_LOADING.md)。

## 座舱分区睡眠关怀（2026-10-18）

视觉来源：Figma `313:677`「座舱与环境模拟-关灯效果」，座舱画布 `810×1080`。主持人明确下发 `cabin.apply_sleep_comfort` 且目标仍睡着时，等待对应气泡实际显示才启用；检测睡眠本身不启用设备模拟。醒来保持效果，直到主持人的 `cabin.restore_sleep_comfort` 对应话术显示时再移除；重置直接清除。

同日最新协同规则更新：空调值显示“用户记忆值”，覆盖早先的“关闭”；有效入睡必启关怀，但仍等主持气泡显示后执行。四区遮罩也用于普通对话的 `cabin.set_zone_light`，该动作不显示分区音量/空调提示；恢复睡眠关怀时灯光恢复睡前值，不强制开启。资源文件、尺寸、坐标和滤镜不变。

| 资源 | Figma 节点 | 本地文件 | 导出尺寸 |
| --- | --- | --- | --- |
| 后排柔边关灯遮罩 | `313:752`、`313:753` | `cabin-sleep-dim-rear.svg` | `511×472`，包含90px滤镜边缘 |
| 前排柔边关灯遮罩 | `313:754`、`313:755` | `cabin-sleep-dim-front.svg` | `566×614`，包含90px滤镜边缘 |
| 分区音量图标 | `313:793` | `cabin-zone-volume-icon.svg` | `14×14` |
| 分区空调图标 | `313:798` | `cabin-zone-climate-icon.svg` | `14×14` |

舒适设置提示尺寸 `147×44`，标签色 `#45E6B5`，值为白色；字体11px，背景模糊3.5px。后排左/右位置 `(170,635)` / `(484,635)`；副驾/主驾位置 `(151,968)` / `(509,968)`。SVG按原始尺寸显示，不改写路径和滤镜。网页背景音乐不因分区音量模拟而改变。

## AI Host

| asset_key | 类型 | Figma 页面 | Figma 节点 | Figma 图层名 | 推荐文件名 | 适用状态 | fallback_asset |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `host_yes` | AI_HOST | Assets / AI Host | `214:1920` | 主持人 yes！静态切片 | `host-yes.png` | Sprite Sheet 加载失败时的静态 fallback | `host-normal.png` |
| `host_cheer` | AI_HOST_SPRITE | Assets / AI Host | 用户提供 Sprite Sheet | 主持人 欢呼 | `host-cheer.json` + `host-cheer.webp` + `host-cheer.mp3` | 结算页播放一次 60 帧庆祝及音效 | `host-cheer.png` |
| `host_puzzled` | AI_HOST | Assets / AI Host | `214:1915` | 主持人 疑惑 | `host-puzzled.png` | 思考、尴尬、玩家方向偏离 | `host-normal.png` |
| `host_heart_sprite` | AI_HOST_SPRITE | Assets / AI Host | 用户提供 Sprite Sheet | 主持人 比心序列动画 | `host-heart.json` + `host-heart.webp` | 鼓励、安抚、亲和表达，Canvas 播放一次 | `host-heart.png` |
| `host_wave` | AI_HOST_SPRITE | Assets / AI Host | 用户提供 Sprite Sheet | 主持人 打招呼 | `host-wave.json` + `host-wave.webp` + `host-wave.mp3` | 准备页播放一次 40 帧打招呼及音效 | `host-wave.png` |
| `host_normal` | AI_HOST_SPRITE | Assets / AI Host | `214:1918` | 主持人 默认待机序列动画 | `host-normal.json` + `host-normal.webp` | 默认状态，Canvas 循环播放，不播放音频 | `host-normal.png` |
| `host_speak_sprite` | AI_HOST_SPRITE | Assets / AI Host | 用户提供 Sprite Sheet | 主持人 说话序列动画 | `host-speak.json` + `host-speak.webp` | 主持人说话气泡显示期间循环播放有效的 42 帧，无音频；忽略 JSON 中越出大图范围的末尾帧，气泡消失后停止 | `host-normal.png` |
| `host_thinking_sprite` | AI_HOST_SPRITE | Assets / AI Host | Assets / AI Host | 主持人 思考序列动画 | `host-thinking.json` + `host-thinking.webp` | 主持人思考时播放一次，不显示说话气泡，播放完成后回默认状态 | `host-thinking.png` |
| `host_yes_sprite` | AI_HOST_SPRITE | Assets / AI Host | 用户提供 Sprite Sheet | 主持人 yes！40 帧透明序列动画与同步音频 | `host-yes.json` + `host-yes.webp` + `host-yes.mp3` | 猜对、答对反馈，Canvas 按 JSON 帧时长播放一次，音频按 JSON 时间轴同步 | `host-yes.png` |

### Host State Mapping

| 运行时字段 | 推荐资源 | 显示时长 | 备注 |
| --- | --- | --- | --- |
| `normal` | `host_normal` | 常驻 | 默认状态 |
| `speak` | `host_speak_sprite` | 气泡可见期间 | 主持人说话时循环播放；气泡隐藏后恢复当前主持人状态 |
| `greeting` | `host_wave` | 4s 后回默认 | 开局或恢复 |
| `smile` | `host_heart_sprite` | 27 帧约 2.7s，播放一次 | 亲和、鼓励 |
| `thinking` | `host_thinking_sprite` | 40 帧约 4s，播放一次后回默认 | 思考期间隐藏主持人气泡 |
| `awkward` | `host_puzzled` | 4s 后回默认 | 尴尬、疑惑、冷场兜底 |
| `excited` | `host_yes_sprite` | 40 帧约 4s，播放一次 | 答对题目，进入下一轮或重置时恢复默认；同步播放 `host-yes.mp3` |
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
| `cabin_garage` | CABIN_ENV | Assets / Cabin Environments | `272:322` | CE 车库 | `cabin-env-garage.png` | 车库环境 | `cabin-env-scenic-day.png` |
| `cabin_tunnel` | CABIN_ENV | Assets / Cabin Environments | `272:323` | CE 隧道 | `cabin-env-tunnel.png` | 隧道环境 | `cabin-env-scenic-day.png` |
| `cabin_scenic_day` | CABIN_ENV | Assets / Cabin Environments | `209:1297` | CE 风景白天 | `cabin-env-scenic-day.png` | 风景区晴天白天、高速路晴天白天 | `cabin-env-scenic-day.png` |
| `cabin_snow_day` | CABIN_ENV | Assets / Cabin Environments | `212:1668` | CE 雪景白天 | `cabin-env-snow-day.png` | 风景区雪景白天 | `cabin-env-scenic-day.png` |
| `cabin_city_day` | CABIN_ENV | Assets / Cabin Environments | `212:1670` | CE 城市白天 | `cabin-env-city-day.png` | 城区晴天白天、城区雨天白天 | `cabin-env-scenic-day.png` |
| `cabin_city_night` | CABIN_ENV | Assets / Cabin Environments | `209:1437` | CE 城市夜晚 | `cabin-env-city-night.png` | 城区夜晚 | `cabin-env-city-day.png` |
| `cabin_scenic_sunset` | CABIN_ENV | Assets / Cabin Environments | `209:1577` | CE 风景晚霞 | `cabin-env-scenic-sunset.png` | 风景区傍晚、雨天朋友聚会揭晓氛围 | `cabin-env-scenic-day.png` |
| `cabin_deep_night` | CABIN_ENV | Assets / Cabin Environments | `216:2293` | CE 深夜 | `cabin-env-deep-night.png` | 高速路晴天深夜、风景区晴天深夜 | `cabin-env-scenic-sunset.png` |

## Environment Runtime Mapping

| 车外环境 | control_screen_bg | cabin_environment | 备注 |
| --- | --- | --- | --- |
| 车库 | `screen_default` | `cabin_garage` | 车库场景，中控屏使用默认背景 |
| 隧道 | `screen_default` | `cabin_tunnel` | 隧道场景，中控屏使用默认背景 |
| 高速路晴天白天 | `screen_scenic_day` | `cabin_scenic_day` | 当前暂无专用高速图，先用风景白天 |
| 高速路晴天深夜 | `screen_deep_night` | `cabin_deep_night` | 夜间氛围 |
| 高速路雨天白天 | `screen_scenic_sunset` | `cabin_scenic_sunset` | 当前暂无雨天图，先用晚霞/暗色氛围占位 |
| 城区晴天白天 | `screen_city_day` | `cabin_city_day` | 城市白天 |
| 城区夜晚 | `screen_city_night` | `cabin_city_night` | 城市夜景 |
| 城区雨天白天 | `screen_city_day` | `cabin_city_day` | 当前暂无雨天图，先用城市白天 |
| 风景区晴天白天 | `screen_scenic_day` | `cabin_scenic_day` | 风景白天 |
| 风景区傍晚 | `screen_scenic_sunset` | `cabin_scenic_sunset` | 风景晚霞 |
| 风景区雪景白天 | `screen_snow_day` | `cabin_snow_day` | 雪景白天 |
| 风景区晴天深夜 | `screen_deep_night` | `cabin_deep_night` | 深夜氛围 |

准备页的中控屏固定使用 `screen_default`；座舱按当前黄金体验线的环境配置显示，配置为 `车库` 或 `隧道` 时使用对应新资源，其他场景使用对应室外环境图。进入游戏后继续按 `Environment Runtime Mapping` 切换；如果环境值没有命中映射，座舱回退到 `cabin_scenic_day`，中控屏回退到 `screen_default`。

## 下一步接入建议

1. 按本表从 Figma 导出资源到 `tmp/figma-import/`。
2. 完成哈希去重后，移动到 `assets/` 并使用推荐文件名。
3. 在 `client-app.js` 中新增资源配置对象，不再把状态判断散落在渲染逻辑里。
4. 先接入主持人和中控/座舱背景，再接入乘客状态矩阵。
5. 资源稳定后，再进行 WebP、尺寸压缩、首屏预加载和非首屏懒加载。
