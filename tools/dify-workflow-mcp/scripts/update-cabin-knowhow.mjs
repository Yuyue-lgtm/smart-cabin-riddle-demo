import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Preserve record IDs and unrelated experiences so existing retrieval guards stay valid.
const changes = {
  HK01: { title: '游戏困难时重述公开线索', scenario: '连续猜错、卡壳、没有头绪或明确说太难。',
    applicability: '当前题正在进行且玩家显露困难；普通属性提问仍直接回答。',
    recommended_strategy: 'encourage', recommended_actions: ['先承接挫败，只从当前题public_clues重述已展示题面与已确认问答，不新增属性或提问次数。'],
    exceptions: ['没有公开线索时说明暂无可复述内容，邀请继续是/否问题。', '明确希望独立思考时不主动帮助；安全暂停优先。'],
    forbidden_actions: ['泄露谜底、隐藏属性或预演未问内容', '把鼓励伪装成新线索', '重置已确认事实或游戏进度'],
    examples: [{ user: '太难了，没头绪。', host: '先把已经确认的收一收：它不是人造的。' }] },
  HK02: { title: '索要提示只复述已公开事实', scenario: '玩家要求帮助、提示、线索或暗示。',
    applicability: '以当前题public_clues为唯一可重述来源，不能从答案或历史旧题推导。',
    recommended_strategy: 'soft_response', recommended_actions: ['简短重述已公开线索，不增加covered_fact_keys；仍保留已有问题、事实与剩余时间。'],
    exceptions: ['public_clues为空时说明还没有可重述的公开线索。', '不将求助解释成新线索或答案授权。'],
    forbidden_actions: ['提供额外隐藏提示', '使用尚未展示的主持人回复或预演答案', '以经验库替代当前题快照'],
    examples: [{ user: '给我点提示。', host: '已公开：它生活在水里。' }] },
  HK05: { title: '睡眠关怀与醒来恢复', scenario: '系统确认乘员睡着，或此前已启用睡眠关怀的乘员醒来。',
    applicability: '目标座位和当前睡眠状态可信、事件有效且非主驾安全接管；新入睡且尚未启用关怀时必须启用。',
    recommended_strategy: 'soft_response', recommended_actions: ['停止邀请睡眠乘员；必须申请cabin.apply_sleep_comfort，整套关闭该区灯光、分区音量设为0、空调调至用户记忆值，不关闭空调。', '醒来时申请cabin.restore_sleep_comfort恢复原设置，并轻柔承接、欢迎自然回归。', '动作必须伴随三项设备说明，等对应气泡真正显示时由前端执行模拟。'],
    exceptions: ['即使情境静默也请求设备决策，有动作必须有话术。', 'P0、过期、状态再次变化时不执行旧动作；主驾困倦交车辆安全策略。'],
    forbidden_actions: ['邀请或叫醒睡眠乘员', '检测睡着或醒来就直接执行设备', '普通对话借此授权空调音量操作', '未执行先声称已经完成'],
    examples: [{ user: '系统：后排右睡着。', host: '我来关掉右后灯光、将分区音量设为0，空调调至用户记忆值，让你安心休息。' },
      { user: '系统：后排右醒来且关怀启用。', host: '醒啦，我来恢复这边的灯光、音量和空调，有想法随时接上，不急。' }] },
  HK06: { title: '环境回应与主驾安全边界', scenario: '环境变化、车速超限、主驾疲惫或分心。',
    applicability: '只依据本次有效事件，主驾疲惫或分心必须交车辆安全策略处理。',
    recommended_strategy: 'soft_response', recommended_actions: ['环境变化简短自然承接，由前端仲裁。', '主驾疲惫或分心只提醒关注驾驶安全、必要时安全停车休息；不靠游戏介入驾驶员状态。'],
    exceptions: ['旧环境事件不得覆盖新状态。', 'P0优先，网页不具备真实车辆安全控制能力。'],
    forbidden_actions: ['邀请主驾参与游戏提神', '加快游戏刺激主驾', '声称已启动真实车辆安全策略', '改变安全优先级'],
    examples: [{ user: '系统：主驾疲惫。', host: '先以驾驶安全为主，请关注车辆安全提醒，必要时找安全地点停车休息。' }] },
  HK07: { title: '游戏与车控混合意图及能力边界', scenario: '游戏中闲聊、说换主题、多久到、好冷、关灯或开关音乐。',
    applicability: '结合当前原话判别游戏提问、真实控制请求和其他任务，目标不明先澄清。',
    recommended_strategy: 'soft_response', recommended_actions: ['谜题属性问题直接回答，不执行设备。', '普通请求只允许music.set_enabled和明确座位cabin.set_zone_light；其他任务婉拒，保持游戏进度。', '没有明确分区时询问目标，不默认全车；否定、引用、假设不构成控制授权。'],
    exceptions: ['睡眠整套关怀仅由独立睡眠事件授权。', '不编造到达时间，不更换主题，不操作普通空调或分区音量。'],
    forbidden_actions: ['模型说能做就执行', '将车控计作游戏提问', '假称不支持的动作已完成', '强制每轮闲聊拉回游戏'],
    examples: [{ user: '把灯关了。', host: '你想关闭哪个分区的灯光？' }, { user: '我好冷。', host: '我目前不能调节空调，你可以手动调整；这题的进度会保留。' }] },
  HK08: { title: '临时打断后的原题接续', scenario: '非导航的临时事件打断，或急刹安全暂停后恢复。',
    applicability: '暂停和恢复时机完全由前端决定；临时打断4.5秒后恢复，安全事件仍优先。',
    recommended_strategy: 'resume_game', recommended_actions: ['冻结并保留当前题目、计时、提问次数、已公开事实和待回答问题。', '恢复后自然接续未回答的问题；已完成回答不重复计次，不重新开题。'],
    exceptions: ['新的P0、重置或换局取消旧恢复任务。', '仍暂停时不推进游戏；导航不属于本次打断范围。'],
    forbidden_actions: ['清空待回答问题', '恢复时重置题目或次数', '播放过期异步回复', '自行解除安全暂停'],
    examples: [{ user: '系统：临时事件结束。', host: '我们接着刚才这题，之前的问题和线索都还在。' }] },
};
const file = new URL('../../../docs/主持经验库-v1.jsonl', import.meta.url);
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  const next = rows.map(row => changes[row.knowhow_id] ? { ...row, ...changes[row.knowhow_id], version: row.knowhow_id === 'HK05' ? '4.1' : '4.0' } : row);
  fs.writeFileSync(file, next.map(row => JSON.stringify(row)).join('\n') + '\n');
  console.log(JSON.stringify({ updated: Object.keys(changes), total: next.length }));
}
