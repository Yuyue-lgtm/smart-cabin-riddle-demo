import copy
import json
import sys
import time
from pathlib import Path

candidate = json.loads(Path(sys.argv[1]).read_text())
nodes = {node['id']: node for node in candidate['graph']['nodes']}
functions = {}
for key, node in nodes.items():
    if node['data']['type'] == 'code':
        namespace = {}
        exec(compile(node['data']['code'], key, 'exec'), namespace)
        functions[key] = namespace['main']

base = {
    'game_id': 'comfort-test', 'round_id': 'comfort-test-r1', 'scene_version': 'sv-test',
    'game': {'status': 'playing', 'current_answer': '海豚', 'round_index': 1},
    'car': {'speed': 50, 'environment': '风景区晴天深夜'},
    'passengers': {'selected_seat': 'front', 'states': {
        'driver': 'normal', 'front': 'normal', 'rearLeft': 'normal', 'rearRight': 'sleeping'}},
    'event': {'id': 'sleep-test', 'type': 'passenger_sleep', 'priority': 'P2', 'seat': 'rearRight'},
    'dialogue_request': {'kind': 'situation_event', 'event_id': 'sleep-test'},
}
model = {
    'intent': 'event', 'reply_mode': 'chat_only', 'ai_reply_text': '有朋友休息了，我来关灯、降低分区音量，空调恢复记忆设置。',
    'covered_fact_keys': [], 'strategy': 'soft_response', 'target_seat': None,
    'reason_codes': ['sleeping_passenger_excluded'], 'applied_knowhow_ids': [],
    'execution_actions': [{'type': 'cabin.apply_sleep_comfort', 'seat': 'rearRight'}],
}


def normalize(snapshot, expired=False, silent=False):
    now = int(time.time() * 1000)
    scene = {key: snapshot[key] for key in ('game_id', 'round_id', 'scene_version')}
    scene.update(event_id=snapshot['event']['id'], analysis_status='ready', request_proactive_speech=not silent,
                 request_host_decision=silent, host_decision_seat=snapshot['event']['seat'] if silent else None,
                 generated_at_ms=now - 1000, expires_at_ms=now - 1 if expired else now + 59000,
                 dialogue_context={'guidance': {'strategy': 'soft_response', 'target_seat': None},
                                   'knowhow': {'status': 'not_relevant', 'retrieved': [],
                                               'eligible_target_seats': ['front', 'rearLeft']}})
    return functions['1000000000002'](query='当前座舱事件', snapshot=json.dumps(snapshot), situation=json.dumps(scene))


def guard(value, normalized):
    return json.loads(functions['1000000000006'](director_text=json.dumps(value),
        payload=normalized['payload'], director_context=normalized['context_json'])['workflow_output'])


checks = 0
for seat in ('driver', 'front', 'rearLeft', 'rearRight'):
    snapshot, value = copy.deepcopy(base), copy.deepcopy(model)
    snapshot['event']['seat'] = seat
    snapshot['passengers']['states'][seat] = 'sleeping'
    value['execution_actions'][0]['seat'] = seat
    normalized = normalize(snapshot)
    context = json.loads(normalized['context_json'])
    assert context['sleep_comfort']['eligible_seats'] == [seat]
    assert '海豚' not in normalized['context_json']
    result = guard(value, normalized)
    assert result['decision_trace']['guard_status'] == 'passed', result
    assert result['execution']['actions'] == value['execution_actions']
    assert not result['is_correct'] and not result['covered_fact_keys']
    for node in ('1000000000021', '1000000000024'):
        args = {'director_text': json.dumps(value), 'payload': normalized['payload'], 'director_context': normalized['context_json']}
        if node.endswith('24'):
            args['previous_result'] = json.dumps({'attempts': [{'status': 'invalid', 'reason_codes': ['empty_model_output']} ]})
        inspected = json.loads(functions[node](**args)['model_result'])
        assert inspected['status'] == 'valid', inspected
        assert json.loads(inspected['canonical_text'])['execution_actions'] == value['execution_actions']
    checks += 1

for kind in ('awake', 'wrong-seat', 'unknown-action', 'extra-parameter', 'expired', 'paused', 'environment'):
    snapshot, value = copy.deepcopy(base), copy.deepcopy(model)
    if kind == 'awake': snapshot['passengers']['states']['rearRight'] = 'normal'
    if kind == 'wrong-seat': value['execution_actions'][0]['seat'] = 'front'
    if kind == 'unknown-action': value['execution_actions'][0]['type'] = 'cabin.unlock_doors'
    if kind == 'extra-parameter': value['execution_actions'][0]['temperature'] = 50
    if kind == 'paused': snapshot['game']['status'] = 'paused'
    if kind == 'environment': snapshot['event']['type'] = 'environment_change'
    result = guard(value, normalize(snapshot, expired=kind == 'expired'))
    assert result['execution']['actions'] == [], (kind, result)
    assert result['decision_trace']['guard_status'] != 'passed'
    checks += 1

silent = guard(model, normalize(base, silent=True))
assert silent['decision_trace']['guard_status'] == 'passed'
assert silent['ai_reply_text'] == model['ai_reply_text']
assert silent['execution']['actions'] == model['execution_actions']
checks += 1
for seat in ('driver', 'front', 'rearLeft', 'rearRight'):
    snapshot, value = copy.deepcopy(base), copy.deepcopy(model)
    snapshot['event'].update(type='passenger_wake', seat=seat)
    snapshot['passengers']['states'][seat] = 'normal'
    snapshot['car']['sleep_comfort_seats'] = [seat]
    value['execution_actions'] = [{'type': 'cabin.restore_sleep_comfort', 'seat': seat}]
    value['ai_reply_text'] = '你醒啦，我来恢复这边的灯光、空调和分区音量。'
    normalized = normalize(snapshot, silent=True)
    restored = guard(value, normalized)
    assert restored['decision_trace']['guard_status'] == 'passed', restored
    assert restored['execution']['actions'] == value['execution_actions']
    assert restored['ai_reply_text'] == value['ai_reply_text']
    snapshot['car']['sleep_comfort_seats'] = []
    assert guard(value, normalize(snapshot))['execution']['actions'] == []
    checks += 2
for value in ({**model, 'execution_actions': []},
              {**model, 'ai_reply_text': '我来安排一个安静角落。'},
              {**model, 'ai_reply_text': '我来关灯、静音音量，关闭空调。'}, {}):
    result = guard(value, normalize(base, silent=True))
    assert result['decision_trace']['guard_status'] == 'passed', result
    assert result['execution']['actions'] == model['execution_actions'], result
    assert '记忆' in result['ai_reply_text'] and '关闭空调' not in result['ai_reply_text'], result
    assert not result['is_correct'] and not result['covered_fact_keys']
    checks += 1
    for invalid in ('expired', 'paused', 'awake'):
        snapshot = copy.deepcopy(base)
        if invalid == 'paused': snapshot['game']['status'] = 'paused'
        if invalid == 'awake': snapshot['passengers']['states']['rearRight'] = 'normal'
        assert not guard(value, normalize(snapshot, silent=True, expired=invalid == 'expired'))['execution']['actions']
        checks += 1
snapshot = copy.deepcopy(base)
snapshot['car']['sleep_comfort_seats'] = ['rearRight']
assert not guard({**model, 'execution_actions': []}, normalize(snapshot, silent=True))['execution']['actions']
checks += 1
print(f'PASS: {checks} sleep-comfort guard cases, mandatory silent-scene care, memory climate, four zones, primary/retry and stale-state guards.')
