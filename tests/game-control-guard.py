import copy
import json
import sys
from pathlib import Path

folder = Path(sys.argv[1])
graph = json.loads((folder / 'dialogue-candidate.json').read_text())['graph']
functions = {}
for node in graph['nodes']:
    if node['data']['type'] == 'code':
        namespace = {}
        exec(compile(node['data']['code'], node['id'], 'exec'), namespace)
        functions[node['id']] = namespace
base = {'game_id': 'game-control-test', 'round_id': 'game-control-test-r2', 'scene_version': 'game-control-v1',
        'game': {'status': 'playing', 'pause_reason': '', 'current_answer': '海豚', 'round_index': 2,
                 'question_count': 3, 'total_rounds': 6, 'public_clues': ['它不是人造的。']},
        'car': {'environment': '城区晴天白天', 'speed': 50},
        'passengers': {'selected_seat': 'front', 'states': {'front': 'normal', 'driver': 'normal'}}}
model = {'intent': 'game_related_chat', 'reply_mode': 'chat_only', 'ai_reply_text': '我来暂停游戏。',
         'covered_fact_keys': [], 'execution_actions': [], 'strategy': 'soft_response', 'target_seat': None,
         'reason_codes': ['explicit_game_control'], 'applied_knowhow_ids': []}
checks = 0

def run(query, status='playing', reason='', value=None):
    current = copy.deepcopy(base)
    current['game'].update(status=status, pause_reason=reason)
    normalized = functions['1000000000002']['main'](query, json.dumps(current), '{}')
    assert json.loads(normalized['payload'])['game']['pause_reason'] == reason
    context = json.loads(normalized['context_json'])
    assert 'game.set_paused' in context['capabilities']['allowed']
    output = model if value is None else value
    args = {'director_text': json.dumps(output), 'payload': normalized['payload'], 'director_context': normalized['context_json']}
    first = functions['1000000000021']['main'](**args)
    if first['needs_retry']:
        retry = functions['1000000000024']['main'](json.dumps(output), first['model_result'], payload=normalized['payload'], director_context=normalized['context_json'])
        canonical = retry['model_result']
    else:
        canonical = first['model_result']
    return json.loads(functions['1000000000006']['main'](**args, model_result=canonical)['workflow_output'])

for phrase, paused in [('暂停游戏', True), ('帮我暂停一下游戏', True), ('游戏先暂停', True), ('暂停一下', True),
                       ('继续游戏', False), ('恢复游戏', False), ('接着玩', False), ('游戏继续', False)]:
    for status, reason in [('playing', ''), ('paused', 'user')]:
        value = {**model, 'ai_reply_text': '我来暂停游戏。' if paused else '我来继续游戏。',
                 'execution_actions': [{'type': 'game.set_paused', 'paused': paused}]}
        result = run(phrase, status, reason, value)
        assert result['execution']['actions'] == [{'type': 'game.set_paused', 'paused': paused}], result
        assert result['decision_trace']['guard_status'] == 'passed'
        assert result['game_status'] == status and not result['is_correct'] and not result['covered_fact_keys']
        assert not result['ui_change']['show_answer'] and not result['passenger_action']
        checks += 1
for phrase in ['不要暂停游戏', '别继续游戏', '如果暂停游戏会怎样', '他说“暂停游戏”', '它能暂停游戏吗',
               '暂停背景音乐', '继续播放音乐', '暂停游戏然后继续游戏', '我不想继续游戏', '我不愿暂停游戏', '要不要暂停游戏', '如何暂停游戏']:
    result = run(phrase, value={**model, 'execution_actions': [{'type': 'game.set_paused', 'paused': True}]})
    assert all(action['type'] != 'game.set_paused' for action in result['execution']['actions']), (phrase, result)
    checks += 1
for status, reason in [('paused', 'safety'), ('paused', ''), ('victory', ''), ('summary', ''), ('failed', '')]:
    result = run('继续游戏', status, reason)
    assert not result['execution']['actions'] and result['game_status'] == status
    checks += 1
for reply in ['我没有暂停权限。', '我暂不支持暂停游戏。', '我陪你慢慢想。', '谜底是海豚。']:
    result = run('暂停游戏', value={**model, 'ai_reply_text': reply})
    assert result['execution']['actions'] == [{'type': 'game.set_paused', 'paused': True}]
    assert '暂停' in result['ai_reply_text'] and '海豚' not in result['ai_reply_text'] and '不支持' not in result['ai_reply_text']
    checks += 1
print(f'PASS: {checks} game-control node cases, first/retry schema, explicit authorization, safety protection and refusal repair.')
