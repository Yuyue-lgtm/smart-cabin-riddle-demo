import json
import time
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / 'tools/dify-workflow-mcp/workflows/host/src'


def load(*names):
    namespace = {}
    for name in names:
        exec(compile((SOURCE / name).read_text(), name, 'exec'), namespace)
    return namespace['main']


common = ('common.py', 'parallel_common.py', 'experience_common.py')
normalize = load(*common, 'realtime_input.py', 'scene_input.py', 'scene_feedback_input.py')
plan = load(*common, 'scene_priority_context.py')
assemble = load(*common, 'scene_analysis_result.py')
dialogue = load(*common, 'realtime_input.py', 'dialogue_input.py', 'dialogue_experience_input.py', 'dialogue_event_input.py')
guard = load('common.py', 'knowhow_context.py', 'realtime_guard.py', 'parallel_common.py', 'knowhow_guard.py',
             'parallel_guard.py', 'dialogue_guard.py', 'dialogue_event_guard.py')
retrieve_knowhow = load(*common, 'knowhow_context.py', 'scene_knowhow_context.py')
snapshot = {'game_id': 'test', 'round_id': 'test-1', 'scene_version': 'sv-test',
            'game': {'status': 'playing', 'current_answer': '海豚', 'round_index': 1},
            'car': {'environment': '隧道', 'speed': 130},
            'passengers': {'selected_seat': 'front', 'states': {'driver': '疲惫', 'front': '普通', 'rearLeft': '普通', 'rearRight': '普通'}}}
for kind, extra in [('environment_change', {'value': '隧道', 'previous_value': '车库'}),
                    ('speed_overspeed', {'value': 130, 'previous_value': 80}),
                    ('driver_tired', {'duration_ms': 16000, 'state': 'fatigued'})]:
    snapshot['event'] = {'id': f'event-{kind}', 'type': kind, 'priority': 'P1', **extra}
    normalized = normalize(json.dumps(snapshot))
    assert normalized['priority_fast_path']
    context = plan(normalized['context_json'])['director_context']
    result = json.loads(assemble(normalized['payload'], context)['scene_output'])
    assert result['host_response'] is None and result['request_proactive_speech']
    assert result['decision_trace']['priority'] == 'P1'
    snapshot['dialogue_request'] = {'kind': 'situation_event', 'event_id': snapshot['event']['id']}
    host = dialogue('座舱事件', json.dumps(snapshot), json.dumps(result))
    host_context = json.loads(host['context_json'])
    assert host_context['event_dialogue']['valid']
    assert '海豚' not in host['context_json']
    assert json.loads(host['payload'])['player_input'] == ''
    model = {'intent': 'event', 'reply_mode': 'chat_only', 'ai_reply_text': '我们进入隧道啦。', 'strategy': 'soft_response',
             'target_seat': None, 'reason_codes': ['environment_change'], 'applied_knowhow_ids': [], 'covered_fact_keys': []}
    output = json.loads(guard(json.dumps(model), host['payload'], host['context_json'])['workflow_output'])
    assert output['intent'] == 'event' and output['decision_trace']['guard_status'] == 'passed', output
    assert output['execution']['actions'] == [] and output['covered_fact_keys'] == [] and not output['is_correct']
    result['expires_at_ms'] = int(time.time() * 1000) - 1
    assert not json.loads(dialogue('事件', json.dumps(snapshot), json.dumps(result))['context_json'])['event_dialogue']['valid']

now = int(time.time() * 1000)
inactive_snapshot = {
    'game_id': 'test-inactive', 'round_id': 'test-inactive-round-1', 'scene_version': 'sv-inactive-1',
    'game': {'status': 'playing', 'current_answer': '海豚', 'round_index': 1, 'question_count': 0, 'max_questions': 15},
    'car': {'environment': '城市白天', 'speed': 50},
    'passengers': {'selected_seat': 'front', 'states': {'driver': 'normal', 'front': 'normal', 'rearLeft': 'normal', 'rearRight': 'normal'}},
    'event': {'id': 'event-inactive-1', 'type': 'passenger_inactive', 'source': 'participation_monitor',
              'seat': 'front', 'priority': 'P4'},
    'participation': {'seat': 'front', 'version': 9, 'inactive_duration_ms': 37506,
                      'dialogue_silence_ms': 2589, 'remaining_ms': 52494,
                      'real_user_turn_count': 0, 'invitation_declined': False},
    'dialogue_request': {'kind': 'situation_event', 'event_id': 'event-inactive-1'},
}
inactive_scene = {
    'game_id': inactive_snapshot['game_id'], 'round_id': inactive_snapshot['round_id'],
    'scene_version': inactive_snapshot['scene_version'], 'event_id': 'event-inactive-1',
    'analysis_status': 'ready', 'request_proactive_speech': True,
    'participation_version': 9, 'generated_at_ms': now, 'expires_at_ms': now + 10000,
    'dialogue_context': {'guidance': {'strategy': 'invite_collaboration', 'target_seat': 'front'},
                         'knowhow': {'status': 'used', 'retrieved': [{'knowhow_id': 'HK28', 'title': '真实副驾未参与时的低压力邀请'}],
                                     'eligible_target_seats': ['front']}},
}
host = dialogue('system event', json.dumps(inactive_snapshot), json.dumps(inactive_scene))
host_context = json.loads(host['context_json'])
checks = host_context['event_dialogue']['handoff_checks']
assert host_context['event_dialogue']['valid'] and checks == {
    'participation_snapshot_present': True,
    'participation_candidate_valid': True,
    'participation_version_match': True,
}, checks
assert host_context['knowhow']['retrieved'][0]['knowhow_id'] == 'HK28'
assert '海豚' not in host['context_json']

missing_participation = dict(inactive_snapshot)
missing_participation.pop('participation')
host = dialogue('system event', json.dumps(missing_participation), json.dumps(inactive_scene))
event_dialogue = json.loads(host['context_json'])['event_dialogue']
assert not event_dialogue['valid']
assert event_dialogue['failed_handoff_checks'] == [
    'participation_snapshot_present', 'participation_candidate_valid', 'participation_version_match']

mismatched_scene = dict(inactive_scene, participation_version=8)
host = dialogue('system event', json.dumps(inactive_snapshot), json.dumps(mismatched_scene))
event_dialogue = json.loads(host['context_json'])['event_dialogue']
assert not event_dialogue['valid'] and event_dialogue['failed_handoff_checks'] == ['participation_version_match']

retrieval_context = {'event_type': 'passenger_inactive', 'snapshot': {'passengers': {'front': 'normal'}},
                     'knowhow': {'status': 'used', 'retrieved': [{'knowhow_id': 'HK28', 'title': '真实副驾未参与时的低压力邀请',
                                                                    'content': json.dumps({'knowhow_id': 'HK28'})}],
                                 'eligible_target_seats': ['front']}}
retrieval = retrieve_knowhow(json.dumps(retrieval_context),
                             [{'content': json.dumps({'knowhow_id': 'HK28', 'title': '真实副驾未参与时的低压力邀请'})}],
                             '["front"]')
assert [row['knowhow_id'] for row in json.loads(retrieval['retrieved_knowhow'])] == ['HK28']
print('PASS: P1 rule analysis, analysis-only output, scoped event context, speech guard, expiry and hidden-answer isolation.')
print('PASS: inactive-passenger HK28 retrieval, participation handoff, version checks and precise validation diagnostics.')
