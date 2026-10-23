import copy
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
graph = json.loads(Path(sys.argv[1]).read_text())['graph']
functions = {}
for node in graph['nodes']:
    if node['data']['type'] == 'code':
        namespace = {}
        exec(compile(node['data']['code'], node['id'], 'exec'), namespace)
        functions[node['id']] = namespace['main']

cases = json.loads((root / 'tests/fixtures/answer-fastpath.json').read_text())
base = {'game_id': 'fast-test', 'round_id': 'fast-test-r1', 'scene_version': 'fast-v1', 'trigger_type': 'chat',
        'game': {'status': 'playing', 'current_answer': '雨伞', 'question_count': 3},
        'passengers': {'selected_seat': 'front', 'states': {'driver': 'normal', 'front': 'normal', 'rearLeft': 'normal', 'rearRight': 'normal'}}}
for case in cases:
    snapshot = copy.deepcopy(base)
    snapshot['game'].update(current_answer=case['answer'], status=case.get('status', 'playing'))
    snapshot['answer_candidate'] = {'matched': True, 'confirmation': 'confirmed'}
    normalized = functions['1000000000002'](query=case['text'], snapshot=json.dumps(snapshot), situation='{}')
    payload = json.loads(normalized['payload'])
    candidate = case['kind'] != 'none'
    assert normalized['is_p0'] == candidate, case
    assert normalized['exact_correct'] == (case['kind'] == 'confirmed'), case
    assert payload['answer_candidate']['confirmation'] == case['kind'], case
    if candidate:
        output = json.loads(functions['1000000000004'](payload=normalized['payload'], exact_correct=normalized['exact_correct'], event_type=normalized['event_type'])['workflow_output'])
        assert output['is_correct'] == (case['kind'] == 'confirmed'), (case, output)
        assert output['ui_change']['show_answer'] == output['is_correct'], (case, output)
        assert output['game_status'] == ('victory' if output['is_correct'] else 'playing'), (case, output)
        assert output['decision_trace']['guard_status'] == 'passed'
        if not output['is_correct']:
            assert not output['execution']['actions'] and not output['covered_fact_keys']
            assert output['reply_mode'] == 'chat_only' and output['answer'] is None

for event, status in [('hard_brake', 'paused'), ('timeout', 'failed'), ('game_end', 'finished')]:
    payload = copy.deepcopy(base)
    payload['event'] = {'type': event}
    payload['trigger_type'] = 'event'
    output = json.loads(functions['1000000000004'](payload=json.dumps(payload), exact_correct=True, event_type=event)['workflow_output'])
    assert output['game_status'] == status and not output['is_correct'], output

print(f'PASS: {len(cases)} answer candidate cases and 3 safety/timeout/end precedence cases; all code nodes compile.')
