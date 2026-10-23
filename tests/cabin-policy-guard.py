import copy
import json
import sys
import time
from pathlib import Path

folder = Path(sys.argv[1])
functions = {}
for kind in ('dialogue', 'situation'):
    graph = json.loads((folder / f'{kind}-candidate.json').read_text())['graph']
    for node in graph['nodes']:
        if node['data']['type'] == 'code':
            namespace = {}
            exec(compile(node['data']['code'], node['id'], 'exec'), namespace)
            functions[node['id']] = namespace['main']

base = {'game_id': 'policy-test', 'round_id': 'policy-test-r1', 'scene_version': 'sv-policy',
        'game': {'status': 'playing', 'current_answer': '海豚', 'round_index': 1, 'question_count': 3,
                 'public_clues': ['题面：它不是人造的。', '已公开回答：它生活在水里。']},
        'car': {'speed': 50, 'environment': '城区晴天白天'},
        'passengers': {'selected_seat': 'front', 'states': {'driver': 'normal', 'front': 'normal', 'rearLeft': 'normal', 'rearRight': 'normal'}}}
model = {'intent': 'game_related_chat', 'reply_mode': 'chat_only', 'ai_reply_text': '我来调整这边的灯光。',
         'covered_fact_keys': [], 'execution_actions': [], 'strategy': 'soft_response', 'target_seat': None,
         'reason_codes': ['no_relevant_knowhow'], 'applied_knowhow_ids': []}
checks = 0


def run(query, value=None, snapshot=None, preflight=False):
    normalized = functions['1000000000002'](query=query, snapshot=json.dumps(snapshot or base), situation='{}')
    args = {'director_text': json.dumps(model if value is None else value), 'payload': normalized['payload'], 'director_context': normalized['context_json']}
    if preflight:
        result = json.loads(functions['1000000000021'](**args)['model_result'])
        assert result['status'] == 'valid', result
    return json.loads(functions['1000000000006'](**args)['workflow_output'])


for phrase in ('给我一点提示', '太难了', '帮帮我', '给点线索', '重述一下线索'):
    result = run(phrase, {**model, 'ai_reply_text': '答案是海豚。', 'covered_fact_keys': ['secret']}, preflight=True)
    assert '它生活在水里' in result['ai_reply_text'] and len(result['ai_reply_text']) <= 60, result
    assert '已公开回答' not in result['ai_reply_text'] and '已公开：' not in result['ai_reply_text']
    assert not result['covered_fact_keys'] and not result['execution']['actions']
    assert result['decision_trace']['guard_status'] == 'passed'
    checks += 1
recaps = set()
for count in range(3):
    snapshot = copy.deepcopy(base); snapshot['game']['question_count'] = count
    recaps.add(run('多给点提示', snapshot=snapshot)['ai_reply_text'])
    checks += 1
assert len(recaps) == 3
empty = copy.deepcopy(base); empty['game']['public_clues'] = []
assert '没有' in run('给我提示', snapshot=empty)['ai_reply_text']; checks += 1
first_recap = run('多给点提示', {**model, 'ai_reply_text': '陪你想。'})['ai_reply_text']
assert run('多给点提示', {**model, 'ai_reply_text': '陪你想！'})['ai_reply_text'] != first_recap; checks += 1
long_clue = copy.deepcopy(base); long_clue['game']['public_clues'] = ['它' + '很' * 50 + '普通。']
assert len(run('多给点提示', snapshot=long_clue)['ai_reply_text']) <= 60; checks += 1
for query, reply in [('它是人造的吗？', '不是，这条路先划掉，咱换个方向！'),
                     ('你太冷漠了', '刚才像报站了，怪我！这回认真接你的话。')]:
    result = run(query, {**model, 'intent': 'answer_question' if query.startswith('它') else 'smalltalk',
                        'reply_mode': 'answer_only' if query.startswith('它') else 'chat_only',
                        'ai_reply_text': reply, 'strategy': 'direct_answer' if query.startswith('它') else 'soft_response'}, preflight=True)
    assert result['ai_reply_text'] == reply and result['decision_trace']['guard_status'] == 'passed', result
    checks += 1
for seat, label in (('driver', '主驾'), ('front', '副驾'), ('rearLeft', '后排左'), ('rearRight', '后排右')):
    for enabled, command in ((True, '打开'), (False, '关闭')):
        action = {'type': 'cabin.set_zone_light', 'seat': seat, 'enabled': enabled}
        result = run(f'{command}{label}的灯光', {**model, 'execution_actions': [action]}, preflight=True)
        assert result['execution']['actions'] == [action], result
        checks += 1
for phrase in ('把灯关了', '关闭全车灯光', '我好冷', '还有多久到', '换个主题'):
    result = run(phrase)
    assert result['intent'] == 'game_related_chat' and result['reply_mode'] == 'chat_only'
    assert result['decision_trace']['guard_status'] == 'passed' and not result['execution']['actions']
    checks += 1
for phrase, enabled in (('打开背景音乐', True), ('不要放背景音乐', False), ('别放音乐', False)):
    result = run(phrase)
    assert result['execution']['actions'][0]['enabled'] is enabled, (phrase, result)
    checks += 1
for phrase in ('如果关闭背景音乐', '不要关闭背景音乐', '它能打开音乐吗'):
    assert not run(phrase)['execution']['actions'], phrase
    checks += 1
for phrase in ('它能关灯吗', '如果关闭副驾的灯光', '不要关闭副驾的灯光', '他说“关闭副驾的灯光”'):
    result = run(phrase, {**model, 'execution_actions': [{'type': 'cabin.set_zone_light', 'seat': 'front', 'enabled': False}]})
    assert not result['execution']['actions'] and result['decision_trace']['guard_status'] != 'passed', result
    checks += 1
for action in ({'type': 'cabin.set_zone_light', 'seat': 'rearRight', 'enabled': False},
               {'type': 'cabin.set_zone_light', 'seat': 'front', 'enabled': False, 'temperature': 99},
               {'type': 'cabin.apply_sleep_comfort', 'seat': 'front'}):
    assert not run('关闭副驾灯光', {**model, 'execution_actions': [action]})['execution']['actions']; checks += 1
for kind in ('driver_distracted', 'driver_tired', 'temporary_interruption'):
    snapshot = copy.deepcopy(base)
    snapshot['event'] = {'id': kind, 'type': kind, 'state': 'fatigued', 'duration_ms': 16000}
    if kind == 'temporary_interruption': snapshot['game']['status'] = 'paused'
    normalized = functions['3000000000002'](snapshot=json.dumps(snapshot))
    assert normalized['is_p0'] if kind == 'temporary_interruption' else normalized['priority_fast_path']
    if kind == 'driver_distracted':
        for key in ('3000000000002', '3000000000021'):
            namespace = {}
            graph = json.loads((folder / 'situation-candidate.json').read_text())['graph']
            node = next(row for row in graph['nodes'] if row['id'] == key)
            exec(node['data']['code'], namespace)
            perception = namespace['perception_snapshot'](snapshot)
            assert any(signal['field'] == 'driver_state' and signal['value'] == '分心' for signal in perception['signals'])
            checks += 1
    if kind != 'temporary_interruption':
        now = int(time.time() * 1000)
        scene = {key: snapshot[key] for key in ('game_id', 'round_id', 'scene_version')}
        scene.update(event_id=kind, analysis_status='ready', request_proactive_speech=True,
                     generated_at_ms=now, expires_at_ms=now + 60000)
        snapshot['dialogue_request'] = {'kind': 'situation_event', 'event_id': kind}
        host_input = functions['1000000000002'](query='请回应事件', snapshot=json.dumps(snapshot), situation=json.dumps(scene))
        assert json.loads(host_input['context_json'])['event_dialogue']['valid'], kind
    checks += 1
print(f'PASS: {checks} cabin policy node cases; public-only recap, explicit zone permissions, negative/hypothetical guards and interruption routing.')
