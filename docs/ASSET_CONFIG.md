# Asset Config

本文档记录 Figma 资源页中的图片资源与 Demo 运行时配置的对应关系。Figma 负责视觉资源源文件，项目运行时使用 `assets/` 下的规范文件名。

Figma 文件：https://www.figma.com/design/gpsQrBcnC7pejnzFVsSbsY/guess-game-demo

## 图片压缩（2026-10-23，本地当前）

运行图片按 [压缩报告](IMAGE_OPTIMIZATION.md) 分档优化。主持人9张图集按用户要求从备份恢复至质量78、合计13.75 MiB，不再使用本轮质量60版本；保持图集尺寸、375帧坐标、透明通道和时长，未重新编码。4张指定人物fallback继续使用质量64，保持尺寸和透明通道。超过100 KB的3张中控背景使用质量68，所有中控背景低于120000字节。准备页panel-mosaic无清晰度要求，降为128×84、约2.5 KB，页面显示尺寸不变；stage-beam保持480×480，通过重采样简化纹理、保留平滑渐变。结算彩带figma-summary-ribbon质量64。图标保留130×130 PNG，使用128色调色板压缩；SVG不变。此前11张UI切片的其他素材继续沿用质量58或32，未追加的文字切片仍为无损WebP。

hi-audio、host-cheer、host-yes从原始备份转为64 kbps单声道MP3，保留LAME时长和编码延迟标记，浏览器解码时长与原版一致；播放速度、音效增益、延迟、动画JSON及背景音乐不变。静态主持人fallback仍使用`host-*-static.webp`，不与同名图集混用。

本轮不更改Figma裁剪、页面尺寸、懒加载策略、业务逻辑或Dify。原文件及修改前的源码保存在忽略的本地备份目录，不随网页发布；单文件体积、参数、哈希及备份位置见`IMAGE_OPTIMIZATION.json`。下方早期记录中“原始WebP不转码”“静态PNG fallback”等表述属于导入阶段，当前运行格式以本节和资源清单为准。

## 当前音频与每局开场（2026-10-22，本地）

2026-10-23更新：背景音开关新手引导从进入准备页开始计时，2秒后显示，不再等待打招呼动效或欢迎气泡结束；保留本地累计显示两次、点击开关后隐藏、已开启声音不显示的规则。欢迎气泡显示期间临时避让，结束后恢复，不额外计数。场景切换或重置回准备页重置本次计时，页面重绘不延后计时。

准备页欢迎语气泡增加双层柔和阴影以区分背景和附近气泡，仅影响准备页，不改变位置、尺寸及其他页面气泡。

每局首题开始独立播放一次比心动效，不依赖Dify开场串词是否及时返回；切换场景、重置及新一局均按新的game_id重置，后续五题及重绘不重复播放。比心播放完成后回到说话或默认动效；乘客发言及安全事件可中断。Dify串词仍按原3秒开场窗口处理，过晚不补播，不延迟题目计时。

结算双击提示音的整体增益已降至上一版的50%，基音与泛音包络同步减半；仅影响“铛铛！”，不改变其他音效、音乐或合成人声音量。

结算页MVP开始放大时播放一次金属敲击声“铛铛！”，两声同为659.25Hz基音、相同音色，间隔260ms。通过Web Animations API读取`summary-mvp-emphasis`的实际进度，在18%淡入关键帧后开始放大时触发，不再使用进入结算页后的固定延时；当前样式为3500ms延迟、1800ms时长，约在第3824ms响第一声。暂停时音画一起冻结；减少动态效果模式下MVP立即显示，提示音随之播放。通过Web Audio本地合成，不新增音频资源、不调用TTS、不受背景音开关控制；页面重绘不重复触发。放大前退出结算取消待播音效；浏览器恢复音频上下文前若已退出结算或换局，不补播旧提示音。原庆祝动效及配套MP3保持不变。

背景音乐使用 `background-music.mp3`，音量由0.25降为0.175，即原来的70%。背景音开关仍默认关闭、刷新不缓存，只控制背景音乐和主持人合成语音；主持人动效配套MP3与其他游戏音效默认播放，不受该开关控制，也不调用TTS。暂停冻结音效，换场景取消旧音效。浏览器若拦截首次自动播放，仅在用户下一次真实点击或按键时尝试续播当前仍有效动效的音效，不重播动效或旧场景声音。

每次进入准备页，为当前整局提前请求一句Dify开场串词，感知为“游戏即将开始”。准备页原有招呼、欢迎语时序不变；点击开始即启动正常首题倒计时，面板按“第1题”展示3秒后切到提示，不能先露出提示再回到题号。串词与计时、题号/提示并行播放，不等待其文字或语音结束才开题。Dify要求15至25字、最多30字，不报题数或复述规则；前端拒绝超过40字的开场。开启背景音时同步合成语音，每局只播放一次，不在其余五题重复。生成失败/超过20秒时静默跳过；开题后未完成的请求最多在3秒题号窗口内补到，过时取消，始终不阻塞倒计时。换局、P0、高优先级事件或乘客先提问会丢弃旧串词，禁止晚到补播。只允许话术，不能新增线索、判对、操控设备或安排乘客。

## 使用原则

1. Figma 图层名保留中文可读名称，导出到项目后统一改为语义化英文文件名。
2. 新导出文件先进入 `tmp/figma-import/`，完成内容比对后再进入 `assets/`。
3. Figma导入保留原图到临时目录；当前运行资源已完成WebP压缩，新素材按本页压缩规则处理，避免反复编码现有压缩输出。
4. 代码只引用规范文件名，不直接引用 Figma 临时导出名。
5. 缺少某个状态资源时，按表内 `fallback_asset` 回退，避免页面空图。
6. 人物切片使用 Figma 原始透明图片层；有用户裁剪和滤镜时使用节点 `exportAsync({format:'PNG',contentsOnly:true,useAbsoluteBounds:true})` 保留效果并排除背景。不能直接使用 `download_assets.export` 带画布底色的合成图；必须校验真实透明像素，不只检查文件含alpha通道。
7. 运行时固定画布尺寸：主持人 `564×572`、乘客 `287×328`、中控背景 `1440×810`、座舱环境 `810×651`。个别 Figma 节点若少 1px，导入时只补透明边缘，不拉伸人物。
8. Figma 中同名资源按媒体类型整理；当前运行时主持人动画统一使用透明 Sprite Sheet + Canvas，静态`host-*-static.webp`只作为加载失败时的fallback，视频文件不再是主持人动画的运行时依赖。
9. Sprite Sheet 固定 6 列、行数随帧数变化，每帧为 `720×720`。游戏中和结算页保持 `564×572` 及原有帧规则；准备页为 `556×556`，读取已验证的 JSON 帧坐标与时长，当前均为 `100ms`。

## 游戏图标与网页标签（2026-10-21）

最新来源：`261:12`「Pencil 1:1 / 游戏进行中-第几题」中的 `261:37`「游戏icon」。游戏加载页、游戏中、揭晓页及网页标签 favicon 统一复用 `assets/game-icon-loading.png`（130×130 PNG）；游戏中显示尺寸由 47×47 容器控制，位置(31,39)、圆角12px。通过版本查询参数刷新浏览器图标缓存，不另存游戏图标切片或 favicon 副本。

## 打招呼与庆祝动效（2026-10-21）

准备页时序随后调整：wave 播完再显示欢迎气泡和说话动效，欢迎语音按共用声音开关合成；说话动效在音频结束或失败时回待机，文字可保留。欢迎播放中开始游戏会取消欢迎，不占用游戏主持状态；素材资源本身不变。该项先在本地验证，尚未部署正式网站。

同日更新：打招呼改用用户新提供的 `host-wave-sprites/host-wave.webp`、`host-wave.json`、`host-wave-audio.mp3`；音频在项目内规范为 `host-wave.mp3`，JSON 引用同步修正。仍为 4320×5040、40 帧、10fps/4 秒，播放及开关逻辑不变。WebP 与 MP3 不转码，运行引用增加内容 hash 查询参数，避免浏览器沿用旧素材。

用户提供的 `host-wave/`、`host-cheer/` 原始 WebP 和 MP3 原样导入，不重新转码；JSON 的 `meta.image` 和 `audio.src` 改为对应规范英文文件名。打招呼为 4320×5040、40 帧、4 秒（最后两个格子透明且不在声明帧内）；庆祝为 4320×7200、60 帧、6 秒，100 个声明帧均有效，无须裁帧。

历史开关逻辑已被上方2026-10-22规则替代。当前准备页每次进入播放一次打招呼，结算页每次进入播放一次庆祝，完成后回到待机/说话动画；开关不重播动效。配套MP3独立于背景音开关，无须调用语音API。离开页面状态会终止音效，旧异步加载不会串入新状态。模拟暂停同时冻结动画和音效，恢复后续播。结算页移除旧合成提示音，避免与提供的庆祝音效叠加；保留原6秒后结算串词流程。

## 准备页持地图主持人（2026-10-22，当前）

本节取代下方2026-10-21的循环hi逻辑。用户提供的三套WebP原样导入，不转码；JSON修正导出时的旧图片名和招呼音频引用，图片尺寸、全部声明帧已核对。资源版本参数 `ready-map-20261022` 用于避开旧浏览器缓存。

| 准备页状态 | 规范资源 | 画布尺寸 | 帧数 | 播放方式 |
| --- | --- | --- | --- | --- |
| 打招呼 | `hi.webp`、`hi.json`、`hi-audio.mp3` | 4320×7200 | 60 | 每次进入播放一次；招呼音效独立于背景音开关 |
| 默认 | `host-ready-normal.webp`、`host-ready-normal.json` | 4320×5040 | 40 | 欢迎结束后循环 |
| 说话 | `host-ready-speak.webp`、`host-ready-speak.json` | 4320×4320 | 34 | 欢迎语音实际播放期间循环，音频结束或失败即回默认 |

三套资源独立于游戏中的 `host-normal`、`host-speak`、`host-thinking` 等和结算页 `host-cheer`，不替换后两类资源或映射。准备页人物显示框为 `(813,251)`、`556×556`，向右移动25px；Canvas使用同样的正方形比例。欢迎气泡在原有自适应底边锚点基础上上移30px，游戏中与结算页不变。打招呼完成后才显示当前黄金线欢迎气泡；五条欢迎语见 [黄金线新稿](GOLDEN_EXPERIENCE_LINES_V2_DRAFT.md#准备页欢迎语)，与前端配置逐条测试一致。

静音时不调用语音API，文字显示期间播放准备页说话动效；开启声音时等欢迎音频实际开始才播放说话动效。开关不重播旧招呼或欢迎语，游戏开始、重置和切换主题会使旧播放失效。新手声音引导等欢迎气泡关闭后显示，不再从进入准备页计时4秒；仅语音播放结束而气泡仍在时不显示。实际显示累计两次后不再提示，次数保存在 `smart-cabin-sound-onboarding-show-count-v3`，旧版“点击一次永久关闭”的标记不再使用。每次进入准备页最多展示一次，重绘不增加次数；声音已开启时不提示也不计数，点击开关收起本次提示，离开准备页隐藏。

准备页自动进入前，三张Sprite Sheet和各自JSON、招呼音效均完成加载；JSON校验实际图片尺寸、文件名、帧数与坐标边界后使用。保留既有20秒／失败重试与“先进入”逃生路径。语音API不预调用，欢迎语音只在可播放且声音开启时按需合成。

本地301项回归及静音Chrome桌面／手机验收通过；134帧均非空，验证完整预加载、一次招呼、音频结束切默认、切场景／提前开局取消和原结算庆祝。浏览器使用真实动效文件，预演与TTS使用测试桩；未消耗真实语音API。截图 `tmp/ready-map-*.png`，报告 `tmp/ready-map-browser.json`。本轮未部署线上。

## 准备页招呼动效更新（2026-10-21，历史）

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
| `host_yes` | AI_HOST | Assets / AI Host | `214:1920` | 主持人 yes！静态切片 | `host-yes-static.webp` | Sprite Sheet 加载失败时的静态 fallback | `host-normal-static.webp` |
| `host_cheer` | AI_HOST_SPRITE | Assets / AI Host | 用户提供 Sprite Sheet | 主持人 欢呼 | `host-cheer.json` + `host-cheer.webp` + `host-cheer.mp3` | 结算页播放一次 60 帧庆祝及音效 | `host-cheer-static.webp` |
| `host_heart_sprite` | AI_HOST_SPRITE | Assets / AI Host | 用户提供 Sprite Sheet | 主持人 比心序列动画 | `host-heart.json` + `host-heart.webp` | 鼓励、安抚、亲和表达，Canvas 播放一次 | `host-heart-static.webp` |
| `host_ready_greeting` | AI_HOST_SPRITE | 用户提供持地图动效 | 用户提供 Sprite Sheet | 准备页 打招呼 | `hi.json` + `hi.webp` + `hi-audio.mp3` | 准备页播放一次 60 帧打招呼及音效 | `host-normal-static.webp` |
| `host_normal` | AI_HOST_SPRITE | Assets / AI Host | `214:1918` | 主持人 默认待机序列动画 | `host-normal.json` + `host-normal.webp` | 默认状态，Canvas 循环播放，不播放音频 | `host-normal-static.webp` |
| `host_speak_sprite` | AI_HOST_SPRITE | Assets / AI Host | 用户提供 Sprite Sheet | 主持人 说话序列动画 | `host-speak.json` + `host-speak.webp` | 主持人说话气泡显示期间循环播放有效的 42 帧，无音频；忽略 JSON 中越出大图范围的末尾帧，气泡消失后停止 | `host-normal-static.webp` |
| `host_thinking_sprite` | AI_HOST_SPRITE | Assets / AI Host | Assets / AI Host | 主持人 思考序列动画 | `host-thinking.json` + `host-thinking.webp` | 主持人思考时播放一次，不显示说话气泡，播放完成后回默认状态 | `host-thinking-static.webp` |
| `host_yes_sprite` | AI_HOST_SPRITE | Assets / AI Host | 用户提供 Sprite Sheet | 主持人 yes！40 帧透明序列动画与同步音频 | `host-yes.json` + `host-yes.webp` + `host-yes.mp3` | 猜对、答对反馈，Canvas 按 JSON 帧时长播放一次，音频按 JSON 时间轴同步 | `host-yes-static.webp` |

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
| `passenger_baby_normal` | PASSENGER | Assets / Passengers | `184:310` | 婴儿_默认 | `passenger-baby-normal.webp` | 婴儿 | 普通 | `passenger-girl-normal.webp` |
| `passenger_baby_laugh` | PASSENGER | Assets / Passengers | `184:309` | 婴儿_大笑 | `passenger-baby-laugh.webp` | 婴儿 | 大笑 | `passenger-baby-normal.webp` |
| `passenger_baby_sleep` | PASSENGER | Assets / Passengers | `184:308` | 婴儿_睡着 | `passenger-baby-sleep.webp` | 婴儿 | 睡着 | `passenger-baby-normal.webp` |
| `passenger_grandma_normal` | PASSENGER | Assets / Passengers | `184:312` | 奶奶_默认 | `passenger-grandma-normal.webp` | 奶奶 | 普通 | `passenger-female-young-normal.webp` |
| `passenger_grandma_laugh` | PASSENGER | Assets / Passengers | `184:316` | 奶奶_大笑 | `passenger-grandma-laugh.webp` | 奶奶 | 大笑 | `passenger-grandma-normal.webp` |
| `passenger_grandma_sleep` | PASSENGER | Assets / Passengers | `184:311` | 奶奶_睡着 | `passenger-grandma-sleep.webp` | 奶奶 | 睡着 | `passenger-grandma-normal.webp` |
| `passenger_grandpa_normal` | PASSENGER | Assets / Passengers | `184:305` | 爷爷_默认 | `passenger-grandpa-normal.webp` | 爷爷 | 普通 | `passenger-male-young-normal.webp` |
| `passenger_grandpa_laugh` | PASSENGER | Assets / Passengers | `184:317` | 爷爷_大笑 | `passenger-grandpa-laugh.webp` | 爷爷 | 大笑 | `passenger-grandpa-normal.webp` |
| `passenger_grandpa_sleep` | PASSENGER | Assets / Passengers | `184:318` | 爷爷_睡着 | `passenger-grandpa-sleep.webp` | 爷爷 | 睡着 | `passenger-grandpa-normal.webp` |
| `passenger_girl_normal` | PASSENGER | Assets / Passengers | `184:288` | 小女孩_默认 | `passenger-girl-normal.webp` | 小女孩 | 普通 | `passenger-female-young-normal.webp` |
| `passenger_girl_laugh` | PASSENGER | Assets / Passengers | `184:290` | 小女孩_大笑 | `passenger-girl-laugh.webp` | 小女孩 | 大笑 | `passenger-girl-normal.webp` |
| `passenger_girl_sleep` | PASSENGER | Assets / Passengers | `184:289` | 小女孩_睡着 | `passenger-girl-sleep.webp` | 小女孩 | 睡着 | `passenger-girl-normal.webp` |
| `passenger_boy_normal` | PASSENGER | Assets / Passengers | `184:313` | 小男孩_默认 | `passenger-boy-normal.webp` | 小男孩 | 普通 | `passenger-male-young-normal.webp` |
| `passenger_boy_laugh` | PASSENGER | Assets / Passengers | `184:306` | 小男孩_大笑 | `passenger-boy-laugh.webp` | 小男孩 | 大笑 | `passenger-boy-normal.webp` |
| `passenger_boy_sleep` | PASSENGER | Assets / Passengers | `184:307` | 小男孩_睡着 | `passenger-boy-sleep.webp` | 小男孩 | 睡着 | `passenger-boy-normal.webp` |
| `passenger_female_young_normal` | PASSENGER | Assets / Passengers | `184:291` | 女青年_默认 | `passenger-female-young-normal.webp` | 女青年 | 普通 | `passenger-female-young-normal.webp` |
| `passenger_female_young_laugh` | PASSENGER | Assets / Passengers | `184:293` | 女青年_大笑 | `passenger-female-young-laugh.webp` | 女青年 | 大笑 | `passenger-female-young-normal.webp` |
| `passenger_female_young_tired` | PASSENGER | Assets / Passengers | `184:294` | 女青年_犯困 | `passenger-female-young-tired.webp` | 女青年 | 犯困 | `passenger-female-young-normal.webp` |
| `passenger_female_young_sleep` | PASSENGER | Assets / Passengers | `184:292` | 女青年_睡着 | `passenger-female-young-sleep.webp` | 女青年 | 睡着 | `passenger-female-young-normal.webp` |
| `passenger_female_young2_normal` | PASSENGER | Assets / Passengers | `398:225` | 女青年2_默认 | `passenger-female-young2-normal.webp` | 女青年2 | 普通 | `passenger-female-young-normal.webp` |
| `passenger_female_young2_laugh` | PASSENGER | Assets / Passengers | `398:227` | 女青年2_大笑 | `passenger-female-young2-laugh.webp` | 女青年2 | 大笑 | `passenger-female-young2-normal.webp` |
| `passenger_female_young2_tired` | PASSENGER | Assets / Passengers | `398:224` | 女青年2_犯困 | `passenger-female-young2-tired.webp` | 女青年2 | 疲惫 | `passenger-female-young2-normal.webp` |
| `passenger_female_young2_sleep` | PASSENGER | Assets / Passengers | `398:226` | 女青年2_睡着 | `passenger-female-young2-sleep.webp` | 女青年2 | 睡着 | `passenger-female-young2-normal.webp` |
| `passenger_male_young_normal` | PASSENGER | Assets / Passengers | `184:295` | 男青年_默认 | `passenger-male-young-normal.webp` | 男青年 | 普通 | `passenger-male-young-normal.webp` |
| `passenger_male_young_laugh` | PASSENGER | Assets / Passengers | `184:296` | 男青年_大笑 | `passenger-male-young-laugh.webp` | 男青年 | 大笑 | `passenger-male-young-normal.webp` |
| `passenger_male_young_tired` | PASSENGER | Assets / Passengers | `184:297` | 男青年_犯困 | `passenger-male-young-tired.webp` | 男青年 | 犯困 | `passenger-male-young-normal.webp` |
| `passenger_male_young_sleep` | PASSENGER | Assets / Passengers | `184:298` | 男青年_睡着 | `passenger-male-young-sleep.webp` | 男青年 | 睡着 | `passenger-male-young-normal.webp` |
| `passenger_mom_normal` | PASSENGER | Assets / Passengers | `184:304` | 妈妈_默认 | `passenger-mom-normal.webp` | 妈妈 | 普通 | `passenger-female-young-normal.webp` |
| `passenger_mom_laugh` | PASSENGER | Assets / Passengers | `184:303` | 妈妈_大笑 | `passenger-mom-laugh.webp` | 妈妈 | 大笑 | `passenger-mom-normal.webp` |
| `passenger_mom_tired` | PASSENGER | Assets / Passengers | `184:301` | 妈妈_犯困 | `passenger-mom-tired.webp` | 妈妈 | 犯困 | `passenger-mom-normal.webp` |
| `passenger_mom_sleep` | PASSENGER | Assets / Passengers | `184:302` | 妈妈_睡着 | `passenger-mom-sleep.webp` | 妈妈 | 睡着 | `passenger-mom-normal.webp` |
| `passenger_dad_normal` | PASSENGER | Assets / Passengers | `184:299` | 爸爸_默认 | `passenger-dad-normal.webp` | 爸爸 | 普通 | `passenger-male-young-normal.webp` |
| `passenger_dad_laugh` | PASSENGER | Assets / Passengers | `184:300` | 爸爸_大笑 | `passenger-dad-laugh.webp` | 爸爸 | 大笑 | `passenger-dad-normal.webp` |
| `passenger_dad_tired` | PASSENGER | Assets / Passengers | `184:314` | 爸爸_犯困 | `passenger-dad-tired.webp` | 爸爸 | 犯困 | `passenger-dad-normal.webp` |
| `passenger_dad_sleep` | PASSENGER | Assets / Passengers | `184:315` | 爸爸_睡着 | `passenger-dad-sleep.webp` | 爸爸 | 睡着 | `passenger-dad-normal.webp` |

### Relationship Seat Mapping

此表是关系类型的默认形象；黄金线显式座位配置优先，当前映射见 [黄金线成员表](GOLDEN_EXPERIENCE_LINES_V2_DRAFT.md)。2026-10-23：长辈同行主驾为爸爸；家庭返程副驾妈妈、左后空座；风景归城主驾爸爸、副驾妈妈；朋友夜游副驾女青年2、左后空座、右后女青年。空座不渲染人物／状态，不参与乘客事件或自动发言。婴儿仅展示睡眠、默认和大笑等表情，发言入口统一拦截；Dify完整与精简快照均传递人物身份、是否有人和是否可答题。

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
| `screen_default` | CONTROL_SCREEN_BG | Assets / Control Screen Backgrounds | `222:234` | CS 默认背景 | `screen-default.webp` | 默认 | `screen-default.webp` |
| `screen_city_day` | CONTROL_SCREEN_BG | Assets / Control Screen Backgrounds | `212:1648` | CS 城市白天 | `screen-city-day.webp` | 城区晴天白天、城区雨天白天 | `screen-default.webp` |
| `screen_city_night` | CONTROL_SCREEN_BG | Assets / Control Screen Backgrounds | `212:1651` | CS 城市夜晚 | `screen-city-night.webp` | 城区夜晚 | `screen-default.webp` |
| `screen_scenic_day` | CONTROL_SCREEN_BG | Assets / Control Screen Backgrounds | `212:1654` | CS 风景白天 | `screen-scenic-day.webp` | 风景区晴天白天、高速路晴天白天 | `screen-default.webp` |
| `screen_scenic_sunset` | CONTROL_SCREEN_BG | Assets / Control Screen Backgrounds | `199:1294` | CS 风景晚霞 | `screen-scenic-sunset.webp` | 风景区傍晚、雨天朋友聚会揭晓氛围 | `screen-scenic-day.webp` |
| `screen_snow_day` | CONTROL_SCREEN_BG | Assets / Control Screen Backgrounds | `212:1657` | CS 雪景白天 | `screen-snow-day.webp` | 风景区雪景白天 | `screen-default.webp` |
| `screen_deep_night` | CONTROL_SCREEN_BG | Assets / Control Screen Backgrounds | `216:2291` | CS 深夜 | `screen-deep-night.webp` | 高速路晴天深夜、风景区晴天深夜 | `screen-default.webp` |

## Cabin Environments

| asset_key | 类型 | Figma 页面 | Figma 节点 | Figma 图层名 | 推荐文件名 | 适用座舱外景 | fallback_asset |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cabin_garage` | CABIN_ENV | Assets / Cabin Environments | `272:322` | CE 车库 | `cabin-env-garage.webp` | 车库环境 | `cabin-env-scenic-day.webp` |
| `cabin_tunnel` | CABIN_ENV | Assets / Cabin Environments | `272:323` | CE 隧道 | `cabin-env-tunnel.webp` | 隧道环境 | `cabin-env-scenic-day.webp` |
| `cabin_scenic_day` | CABIN_ENV | Assets / Cabin Environments | `209:1297` | CE 风景白天 | `cabin-env-scenic-day.webp` | 风景区晴天白天、高速路晴天白天 | `cabin-env-scenic-day.webp` |
| `cabin_snow_day` | CABIN_ENV | Assets / Cabin Environments | `212:1668` | CE 雪景白天 | `cabin-env-snow-day.webp` | 风景区雪景白天 | `cabin-env-scenic-day.webp` |
| `cabin_city_day` | CABIN_ENV | Assets / Cabin Environments | `212:1670` | CE 城市白天 | `cabin-env-city-day.webp` | 城区晴天白天、城区雨天白天 | `cabin-env-scenic-day.webp` |
| `cabin_city_night` | CABIN_ENV | Assets / Cabin Environments | `209:1437` | CE 城市夜晚 | `cabin-env-city-night.webp` | 城区夜晚 | `cabin-env-city-day.webp` |
| `cabin_scenic_sunset` | CABIN_ENV | Assets / Cabin Environments | `209:1577` | CE 风景晚霞 | `cabin-env-scenic-sunset.webp` | 风景区傍晚、雨天朋友聚会揭晓氛围 | `cabin-env-scenic-day.webp` |
| `cabin_deep_night` | CABIN_ENV | Assets / Cabin Environments | `216:2293` | CE 深夜 | `cabin-env-deep-night.webp` | 高速路晴天深夜、风景区晴天深夜 | `cabin-env-scenic-sunset.webp` |

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
