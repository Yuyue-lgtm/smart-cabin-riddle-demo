# 融合决策 Know-how 策略表 V1

## 目标

本文定义智能座舱 AI 猜谜 Demo 的融合决策 know-how。它用于指导 Coze/Dify Workflow 判断：

- 当前发生了什么
- 哪类事件优先级最高
- AI 主持人应该采取什么主持策略
- 是否需要改变游戏状态
- 是否需要生成模拟乘客动作
- 网页需要执行什么 UI 变化
- 话术应该是什么风格

核心目标：

```text
让 AI 主持人像真实车内主持人一样，有安全意识、有眼力见、有节奏感、有情绪价值。
```

## 使用方式

Workflow 不应直接让大模型自由发挥，而应按以下顺序执行：

```text
输入标准化
→ 事件优先级判断
→ 策略匹配
→ 游戏状态判断
→ 模拟乘客动作判断
→ 主持人话术生成
→ JSON 输出校验
```

本文的策略表主要用于“策略匹配”阶段。

## 优先级定义

| 优先级 | 含义 | 处理原则 |
| --- | --- | --- |
| P0 | 安全强打断 | 立即中断游戏，优先保证安全 |
| P1 | 安全/驾驶注意力 | 调整互动对象和游戏节奏 |
| P2 | 座舱体验调节 | 改变话术、音量感、cue 人策略 |
| P3 | 游戏体验优化 | 控制难度、节奏、情绪价值 |
| P4 | 氛围增强 | 玩梗、鼓励、仪式感、个性化表达 |

## V1.1 优先实现策略

V1.1 建议优先实现以下 8 条策略：

1. `S01` 急刹打断
2. `S02` 高速主驾降频
3. `S03` 主驾疲惫
4. `S04` 有人睡着
5. `S07` 雨天环境入题
6. `S09` 快到目的地绝杀局
7. `S14` 小朋友答对
8. `S18` 多轮无进展给提示

这 8 条能覆盖安全、环境、乘客状态、游戏状态和情绪价值，足够支撑第一版 Workflow 的核心智能感。

## 策略表

### S01 急刹打断

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 车辆状态 |
| 触发条件 | `event.type = hard_brake`，或时间轴触发急刹 |
| 优先级 | P0 |
| 决策目标 | 安全优先，立即中断游戏 |
| 主持策略 | 暂停游戏，安抚全车，提醒主驾专注 |
| 话术风格 | 温柔但坚定，短句，不开玩笑 |
| 游戏状态 | `paused` |
| passenger_action | `null` |
| UI 动作 | `cabin_mode = safety_pause`，`animation = pause`，`target_seat = all` |
| 示例话术 | 大家坐稳，游戏先暂停 30 秒。主驾专心看路，安全第一。 |

### S02 高速主驾降频

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 车辆状态 |
| 触发条件 | `car.speed >= 100`，且游戏正在进行 |
| 优先级 | P1 |
| 决策目标 | 降低主驾分心风险 |
| 主持策略 | 主驾暂时退出答题，cue 副驾和后排接管 |
| 话术风格 | 清晰、照顾、不制造压力 |
| 游戏状态 | 保持 `playing` |
| passenger_action | 可生成副驾或后排发言，不选择主驾 |
| UI 动作 | `cabin_mode = driver_focus`，`target_seat = front/rearLeft/rearRight` |
| 示例话术 | 车速上来了，主驾先专心看路。接下来的问题交给副驾和后排侦探团。 |

### S03 主驾疲惫

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 用户状态感知 |
| 触发条件 | `event.type = driver_tired`，或检测到主驾哈欠/疲惫 |
| 优先级 | P1 |
| 决策目标 | 提醒主驾、降低互动压力、轻度提神 |
| 主持策略 | cue 主驾但不要求答题，转移答题权给其他乘客 |
| 话术风格 | 关心、轻声、不过度指责 |
| 游戏状态 | 保持 `playing` 或根据风险转 `paused` |
| passenger_action | 不让主驾主动发言 |
| UI 动作 | `cabin_mode = driver_focus`，`host_emotion = care` |
| 示例话术 | 主驾辛苦了，先把注意力交给路面。副驾和后排接管本轮，我来把节奏放轻一点。 |

### S04 有人睡着

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 用户状态感知 |
| 触发条件 | 任一乘客状态为 `睡着` |
| 优先级 | P2 |
| 决策目标 | 避免打扰睡着乘客，保持游戏不中断 |
| 主持策略 | 不再 cue 睡着乘客，降低音量感，必要时提示只在其他座位继续 |
| 话术风格 | 轻柔、体贴 |
| 游戏状态 | 保持 `playing` |
| passenger_action | 不选择睡着座位 |
| UI 动作 | `cabin_mode = soft`，`target_seat = sleeping_seat` |
| 示例话术 | 后排已经进入省电模式了，我们轻一点继续，接下来先不打扰 TA。 |

### S05 有人接电话

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 用户状态感知 |
| 触发条件 | 检测到乘客接打电话 |
| 优先级 | P1 |
| 决策目标 | 避免干扰通话 |
| 主持策略 | 暂停或局部静音，通话结束后恢复 |
| 话术风格 | 简短、礼貌 |
| 游戏状态 | `paused` 或保持但跳过该乘客 |
| passenger_action | 不选择通话座位 |
| UI 动作 | `cabin_mode = soft` 或 `paused` |
| 示例话术 | 检测到有人在通话，游戏先轻轻按下暂停键，等通话结束我们继续破案。 |

### S06 夜间氛围切换

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 车外环境感知 |
| 触发条件 | `environment` 包含 `深夜` |
| 优先级 | P3 |
| 决策目标 | 根据夜间场景调整游戏调性 |
| 主持策略 | 询问是否进入轻悬疑/低打扰模式 |
| 话术风格 | 低声、神秘、不过度惊吓 |
| 游戏状态 | 保持 `playing` |
| passenger_action | 可减少高频玩梗 |
| UI 动作 | `cabin_mode = soft` |
| 示例话术 | 夜色已经到位了，要不要把下一题调成一点点悬疑风？放心，只到微微起鸡皮疙瘩的程度。 |

### S07 雨天环境入题

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 车外环境感知 |
| 触发条件 | `environment` 包含 `雨天` |
| 优先级 | P2 |
| 决策目标 | 将车外天气融入游戏 |
| 主持策略 | 下一题或提示偏水、雨具、出行安全 |
| 话术风格 | 应景、自然、有观察感 |
| 游戏状态 | 保持 `playing` |
| passenger_action | 可让模拟乘客问和雨天相关的问题 |
| UI 动作 | `cabin_mode = environment_sync` |
| 示例话术 | 外面的雨来得正好，这一题我们也让谜底沾点水。 |

### S08 雪景环境入题

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 车外环境感知 |
| 触发条件 | `environment` 包含 `雪景` |
| 优先级 | P2 |
| 决策目标 | 将窗外景色与谜题主题关联 |
| 主持策略 | 下一题或提示偏雪、冬天、风景区 |
| 话术风格 | 轻松、画面感 |
| 游戏状态 | 保持 `playing` |
| passenger_action | 可让后排乘客提风景相关问题 |
| UI 动作 | `cabin_mode = environment_sync` |
| 示例话术 | 窗外都变成雪景了，这题不蹭一下这个氛围都说不过去。 |

### S09 快到目的地绝杀局

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 导航/车程感知 |
| 触发条件 | `event.type = near_destination`，或距离目的地小于阈值 |
| 优先级 | P2 |
| 决策目标 | 收束游戏节奏，制造临门一脚 |
| 主持策略 | 宣布绝杀局，提高戏剧性 |
| 话术风格 | 兴奋、仪式感、带一点玩笑 |
| 游戏状态 | 保持 `playing` |
| passenger_action | 可生成模拟乘客抢答或关键提问 |
| UI 动作 | `cabin_mode = final_round`，`animation = final` |
| 示例话术 | 前方快到目的地，进入绝杀局！这一题猜中，直接封神。 |

### S10 目的地强关联题库

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 导航/目的地感知 |
| 触发条件 | 目的地为迪士尼、学校、火锅店、风景区等强主题地点 |
| 优先级 | P3 |
| 决策目标 | 增强谜题与行程关联 |
| 主持策略 | 下一题优先选择目的地相关谜底 |
| 话术风格 | 期待感、轻松 |
| 游戏状态 | 保持 `playing` |
| passenger_action | 可让模拟乘客从目的地方向提问 |
| UI 动作 | `cabin_mode = environment_sync` |
| 示例话术 | 目的地都快把答案写在路牌上了，下一题就从我们马上要去的地方找灵感。 |

### S11 年轻朋友关系

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 乘客关系感知 |
| 触发条件 | `relationship = 年轻朋友` |
| 优先级 | P4 |
| 决策目标 | 提高互动密度和玩梗感 |
| 主持策略 | 话术更活泼，允许轻微吐槽和接梗 |
| 话术风格 | 机智、轻松、节奏快 |
| 游戏状态 | 保持 |
| passenger_action | 模拟乘客可更主动、更爱玩梗 |
| UI 动作 | `host_emotion = excited` |
| 示例话术 | 这个问题有点东西，虽然没打中答案，但已经打中我的笑点了。 |

### S12 父母小孩关系

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 乘客关系感知 |
| 触发条件 | `relationship = 父母+小孩` |
| 优先级 | P4 |
| 决策目标 | 让小朋友有参与感，同时照顾安全 |
| 主持策略 | 多 cue 小朋友，问题解释更简单，夸奖更具体 |
| 话术风格 | 温暖、鼓励、轻松 |
| 游戏状态 | 保持 |
| passenger_action | 小朋友可更高频发言，但避免复杂推理 |
| UI 动作 | `target_seat = rearRight/rearLeft` |
| 示例话术 | 后排小侦探这个问题问得很关键，已经把范围缩小了一大圈。 |

### S13 中老年儿女关系

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 乘客关系感知 |
| 触发条件 | `relationship = 中老年+儿女` |
| 优先级 | P4 |
| 决策目标 | 给予尊重感和稳定节奏 |
| 主持策略 | 话术更稳，不高频玩梗，答对时强调经验和判断 |
| 话术风格 | 尊重、稳重、亲切 |
| 游戏状态 | 保持 |
| passenger_action | 模拟乘客提问更稳，不抢节奏 |
| UI 动作 | `host_emotion = care` |
| 示例话术 | 这个判断很稳，经验派一出手，范围马上就清楚了。 |

### S14 小朋友答对

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 游戏结果 + 乘客身份 |
| 触发条件 | 答对座位对应小朋友人设 |
| 优先级 | P3 |
| 决策目标 | 强化成就感，制造高光时刻 |
| 主持策略 | 夸具体，不泛泛夸，给称号 |
| 话术风格 | 兴奋、鼓励、有仪式感 |
| 游戏状态 | `victory` |
| passenger_action | `null` |
| UI 动作 | `cabin_mode = victory`，答对座位氛围灯亮起，播放答对音效 |
| 示例话术 | 今日最强小侦探诞生！这个答案抓得又快又准。 |

### S15 长辈答对

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 游戏结果 + 乘客身份 |
| 触发条件 | 答对座位对应中老年人设 |
| 优先级 | P3 |
| 决策目标 | 给予尊重感和家庭氛围 |
| 主持策略 | 强调经验、判断力和稳 |
| 话术风格 | 尊重、亲切、轻松 |
| 游戏状态 | `victory` |
| passenger_action | `null` |
| UI 动作 | `cabin_mode = victory`，答对座位氛围灯亮起，播放答对音效 |
| 示例话术 | 姜还是老的辣，这一锤定音太稳了。 |

### S16 年轻朋友答对

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 游戏结果 + 乘客关系 |
| 触发条件 | `relationship = 年轻朋友` 且某乘客答对 |
| 优先级 | P4 |
| 决策目标 | 制造竞技感和玩梗感 |
| 主持策略 | 给称号，轻微刺激其他人追赶 |
| 话术风格 | 活泼、夸张、带梗 |
| 游戏状态 | `victory` |
| passenger_action | `null` |
| UI 动作 | `cabin_mode = victory`，答对座位氛围灯亮起，播放答对音效 |
| 示例话术 | 这一波直接封神，后排不打算联手终结 TA 的统治吗？ |

### S17 玩家接近答案

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 游戏状态感知 |
| 触发条件 | 玩家提问或猜测与谜底高度相关，但未命中 |
| 优先级 | P3 |
| 决策目标 | 增加戏剧效果，鼓励继续推进 |
| 主持策略 | 提示“很接近”，但不泄露答案 |
| 话术风格 | 紧张、兴奋、克制 |
| 游戏状态 | 保持 `playing` |
| passenger_action | 可让模拟乘客补关键问题 |
| UI 动作 | `host_emotion = excited`，`animation = cue` |
| 示例话术 | 完了，已经有人离真相只差一步了，但我现在还不能出卖谜底。 |

### S18 多轮无进展给提示

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 游戏状态感知 |
| 触发条件 | `question_count >= 8` 且未接近答案，或连续多轮无有效缩小范围 |
| 优先级 | P3 |
| 决策目标 | 降低挫败感，推动游戏继续 |
| 主持策略 | 进入提示环节，给类别/场景/字数提示 |
| 话术风格 | 自嘲、鼓励、降低压力 |
| 游戏状态 | 保持 `playing` |
| passenger_action | 可让模拟乘客根据提示提问 |
| UI 动作 | `animation = cue`，`host_emotion = care` |
| 示例话术 | 不是你们不行，是我这题有点阴险。给个提示：它和出行安全有关。 |

### S19 问题数接近上限

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 游戏状态感知 |
| 触发条件 | `question_count >= 13` 且未答对 |
| 优先级 | P3 |
| 决策目标 | 收束节奏，避免拖沓 |
| 主持策略 | 提醒剩余次数，鼓励直接猜 |
| 话术风格 | 紧张、倒计时感 |
| 游戏状态 | 保持 `playing` |
| passenger_action | 可生成一次大胆猜测 |
| UI 动作 | `animation = final` |
| 示例话术 | 只剩最后几问了，现在可以大胆一点，别再试探，直接冲答案。 |

### S20 猜错但有创意

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 用户情绪/游戏输入 |
| 触发条件 | 玩家猜错，但答案有趣或引发大笑 |
| 优先级 | P4 |
| 决策目标 | 保护参与积极性，增强娱乐感 |
| 主持策略 | 承认没对，但夸创意 |
| 话术风格 | 轻松、接梗 |
| 游戏状态 | 保持 `playing` |
| passenger_action | 可生成其他乘客接梗，但不要过长 |
| UI 动作 | `host_emotion = excited` |
| 示例话术 | 这个答案虽然没对，但创意分我愿意给满。 |

### S21 乘客持续沉默

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 用户参与度感知 |
| 触发条件 | 某乘客多轮未发言，且未睡着/未通话 |
| 优先级 | P3 |
| 决策目标 | 提高参与感 |
| 主持策略 | 温和 cue 该乘客，不强迫 |
| 话术风格 | 鼓励、轻松 |
| 游戏状态 | 保持 `playing` |
| passenger_action | 如果该座位是模拟乘客，可生成一次简单问题 |
| UI 动作 | `target_seat = silent_seat` |
| 示例话术 | 副驾已经沉思两轮了，下一问要不要由你来打破僵局？ |

### S22 乘客互相吐槽

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 用户情绪感知 |
| 触发条件 | 最近消息中出现轻松吐槽、玩笑互怼 |
| 优先级 | P4 |
| 决策目标 | 顺势接梗，增强主持人真人感 |
| 主持策略 | 轻轻加入，不扩大冲突 |
| 话术风格 | 幽默、克制 |
| 游戏状态 | 保持 |
| passenger_action | 可生成轻松回应 |
| UI 动作 | `host_emotion = excited` |
| 示例话术 | 很好，人类文明的终极形态果然是互相甩锅，但我们先回到案发现场。 |

### S23 气氛不愉快

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 用户情绪感知 |
| 触发条件 | 检测到争执、不愉快、负面语气 |
| 优先级 | P2 |
| 决策目标 | 缓和气氛，防止游戏演变成矛盾 |
| 主持策略 | 主动当和事佬，转移焦点 |
| 话术风格 | 温和、中立、轻松背锅 |
| 游戏状态 | 保持或短暂停顿 |
| passenger_action | 不生成吐槽型发言 |
| UI 动作 | `cabin_mode = soft`，`host_emotion = care` |
| 示例话术 | 裁判申请介入，本局争议暂时封存。友谊第一，输赢第二，算我的锅，我们继续？ |

### S24 模拟乘客发言轮转

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 模拟乘客控制 |
| 触发条件 | `trigger_type = simulation` 或时间轴请求模拟乘客发言 |
| 优先级 | P3 |
| 决策目标 | 让其他乘客自然参与，不抢用户主角感 |
| 主持策略 | 选择合适座位生成一个问题或猜测 |
| 话术风格 | 根据乘客人设 |
| 游戏状态 | 保持 `playing` |
| passenger_action | 生成单个动作 |
| UI 动作 | `target_seat = passenger_action.seat` |
| 示例话术 | 模拟乘客先问问题，AI 再回答并控场。 |

### S25 模拟乘客禁止发言

| 字段 | 内容 |
| --- | --- |
| 感知类型 | 模拟乘客控制 |
| 触发条件 | 游戏暂停、乘客睡着、主驾高速、刚刚同座位发言过 |
| 优先级 | P2 |
| 决策目标 | 避免模拟乘客不真实或打断安全策略 |
| 主持策略 | 不生成 passenger_action，必要时说明原因 |
| 话术风格 | 视事件而定 |
| 游戏状态 | 保持当前状态 |
| passenger_action | `null` |
| UI 动作 | 无或保持当前模式 |
| 示例话术 | 当前状态不适合继续提问，先等游戏恢复。 |

## Coze Workflow 落地建议

### 推荐节点结构

```text
Start
→ Input Normalize
→ Priority Router
→ Strategy Match
→ Game Judge
→ Passenger Action Planner
→ Host Reply Generator
→ JSON Formatter
→ JSON Validator
→ End
```

### 节点职责

#### Input Normalize

把网页输入整理成统一字段：

- trigger_type
- car
- passengers
- timeline
- game
- interaction
- event
- player_input

#### Priority Router

优先处理 P0/P1：

- 急刹
- 高速主驾降频
- 主驾疲惫
- 通话
- 睡着

P0 事件命中后，不再继续生成模拟乘客动作。

#### Strategy Match

根据本文策略表选择一个主策略，可附加一个辅助策略。

示例：

```json
{
  "primary_strategy": "S01",
  "secondary_strategy": null,
  "reason": "检测到急刹，安全优先"
}
```

#### Game Judge

判断用户或模拟乘客输入：

- 是否是问题
- 是否是猜答案
- 是否答对
- 是否接近答案
- 是否需要提示
- 是否达到问题上限

#### Passenger Action Planner

决定是否生成 `passenger_action`。

必须遵守：

- 每次最多一个
- P0/P1 安全事件不生成
- 暂停状态不生成
- 睡着乘客不生成
- 高速主驾不生成
- 避免重复问题

#### Host Reply Generator

把策略、游戏判断和乘客动作转成自然话术。

Prompt 应明确：

- 你是智能座舱 AI 猜谜主持人
- 话术短一些，适合车内播报
- 安全事件必须坚定克制
- 小朋友答对要鼓励
- 长辈答对要尊重
- 年轻朋友场景可以更活泼

#### JSON Formatter

输出必须符合 `WORKFLOW_CONTRACT.md`。

#### JSON Validator

校验：

- 是否为合法 JSON
- 是否包含 `ai_reply_text`
- 是否包含 `game_status`
- 是否包含 `ui_change`
- P0 时 `passenger_action` 必须为 `null`
- `show_answer` 与 `is_correct` 是否一致

## 策略匹配伪代码

```text
if event.type == hard_brake:
  strategy = S01
elif car.speed >= 100:
  strategy = S02
elif event.type == driver_tired:
  strategy = S03
elif any passenger.state == 睡着:
  strategy = S04
elif event.type == near_destination:
  strategy = S09
elif environment contains 雨天:
  strategy = S07
elif game.question_count >= 13:
  strategy = S19
elif game.question_count >= 8 and no_progress:
  strategy = S18
elif answer_correct and passenger_is_child:
  strategy = S14
elif answer_correct and passenger_is_elder:
  strategy = S15
elif answer_correct:
  strategy = S16
else:
  strategy = normal_game_hosting
```

## V1.1 最小策略输出示例

### 输入摘要

```json
{
  "event": {
    "type": "hard_brake"
  },
  "game": {
    "status": "playing",
    "current_answer": "安全带"
  }
}
```

### 策略结果

```json
{
  "strategy_id": "S01",
  "decision_goal": "安全优先，立即暂停游戏",
  "host_tone": "温柔但坚定",
  "allow_passenger_action": false,
  "game_status": "paused",
  "ui_change": {
    "cabin_mode": "safety_pause",
    "target_seat": "all",
    "animation": "pause",
    "show_answer": false
  }
}
```

### 最终输出

```json
{
  "passenger_action": null,
  "ai_reply_text": "大家坐稳，游戏先暂停 30 秒。主驾专心看路，安全第一。",
  "game_status": "paused",
  "is_correct": false,
  "answer": "安全带",
  "ui_change": {
    "cabin_mode": "safety_pause",
    "target_seat": "all",
    "host_emotion": "serious",
    "animation": "pause",
    "show_answer": false
  }
}
```
