import inspect
import json
import re
import sys
import time
import unittest


GRAPHS = json.load(sys.stdin)


class DifyGraphContractTests(unittest.TestCase):
    def code_node(self, node_id):
        namespace = {}
        node = next(node for node in GRAPHS['dialogue']['nodes'] if node['id'] == node_id)
        exec(node['data']['code'], namespace)
        return namespace['main']

    def model_reply(self):
        return {'intent': 'event', 'reply_mode': 'chat_only', 'ai_reply_text': '副驾想不想来猜一问？',
                'covered_fact_keys': [], 'execution_actions': [], 'strategy': 'invite_collaboration',
                'target_seat': 'front', 'reason_codes': ['eligible_collaborator_available'], 'applied_knowhow_ids': []}

    def test_reasoning_is_not_a_reply_and_invalid_schema_retries(self):
        normalize = self.code_node('1000000000021')
        reply = self.model_reply()
        encoded = json.dumps(reply, ensure_ascii=False)
        valid = normalize('<think>{"ai_reply_text":"private reasoning"}</think>' + encoded, {})
        self.assertFalse(valid['needs_retry'])
        self.assertEqual(json.loads(json.loads(valid['model_result'])['canonical_text']), reply)
        for raw in ('<think>' + encoded, '<think>' + encoded + '</think>', '', '{', '[]'):
            result = normalize(raw, {})
            self.assertTrue(result['needs_retry'])
            self.assertEqual(json.loads(result['model_result'])['status'], 'retry_needed')
        malformed = dict(reply, strategy='change_game', execution_actions={})
        self.assertTrue(normalize(json.dumps(malformed), {})['needs_retry'])
        structured = normalize('not JSON', reply)
        self.assertFalse(structured['needs_retry'])
        self.assertEqual(json.loads(structured['model_result'])['attempts'][0]['source'], 'structured_output')
        retried = self.code_node('1000000000024')(encoded, normalize('', {})['model_result'])
        result = json.loads(retried['model_result'])
        self.assertEqual(result['status'], 'valid')
        self.assertEqual(len(result['attempts']), 2)

    def test_invitation_requires_current_participation_and_awake_target(self):
        normalize = self.code_node('1000000000002')
        guard = self.code_node('1000000000006')
        for mood, version, expected in [('普通', 1, True), ('大笑', 1, True), ('沉默', 1, True),
                                        ('睡着', 1, False), ('unknown', 1, False), ('普通', 2, False)]:
            now = int(time.time() * 1000)
            snapshot = {'game_id': 'g', 'round_id': 'r', 'scene_version': 's',
                        'game': {'status': 'playing', 'current_answer': '海豚'},
                        'passengers': {'selected_seat': 'front', 'states': {'front': mood}},
                        'participation': {'seat': 'front', 'version': version, 'inactive_duration_ms': 30000,
                                          'dialogue_silence_ms': 5000, 'remaining_ms': 50000, 'invitation_declined': False},
                        'event': {'id': 'e', 'type': 'passenger_inactive', 'source': 'participation_monitor', 'seat': 'front', 'priority': 'P4'},
                        'dialogue_request': {'kind': 'situation_event', 'event_id': 'e'}}
            scene = {'game_id': 'g', 'round_id': 'r', 'scene_version': 's', 'event_id': 'e', 'participation_version': 1,
                     'analysis_status': 'ready', 'request_proactive_speech': True, 'generated_at_ms': now, 'expires_at_ms': now + 60000,
                     'dialogue_context': {'knowhow': {'eligible_target_seats': ['front'], 'status': 'not_relevant', 'retrieved': []}}}
            normalized = normalize('', json.dumps(snapshot), json.dumps(scene))
            self.assertEqual(json.loads(normalized['context_json'])['event_dialogue']['valid'], expected, (mood, version))
            output = json.loads(guard(json.dumps(self.model_reply(), ensure_ascii=False),
                                      normalized['payload'], normalized['context_json'])['workflow_output'])
            self.assertEqual(output['decision_trace']['guard_status'], 'passed' if expected else 'event_reply_skipped', (mood, version))
            self.assertEqual(bool(output['ai_reply_text']), expected)
            if expected:
                broken = dict(self.model_reply(), target_seat=None)
                first = self.code_node('1000000000021')(json.dumps(broken), {}, normalized['payload'], normalized['context_json'])
                self.assertTrue(first['needs_retry'])
                self.assertIn('content_guard:collaboration_without_eligible_target', json.loads(first['model_result'])['attempts'][0]['reason_codes'][0])
                second = self.code_node('1000000000024')(json.dumps(self.model_reply()), first['model_result'], payload=normalized['payload'], director_context=normalized['context_json'])
                self.assertEqual(json.loads(second['model_result'])['status'], 'valid')

    def test_selectors_edges_and_python_contracts(self):
        checked = 0
        for kind, graph in GRAPHS.items():
            nodes = {node['id']: node for node in graph['nodes'] if node['data']['type'] != 'custom-note'}
            outputs, selectors = {}, []
            for node_id, node in nodes.items():
                data, node_type = node['data'], node['data']['type']
                if node_type == 'start':
                    outputs[node_id] = {field['variable'] for field in data['variables']}
                elif node_type == 'code':
                    namespace = {}
                    exec(compile(data['code'], f'{kind}/{node_id}', 'exec'), namespace)
                    if 'eligible_seats' in namespace:
                        for mood in ('普通', '大笑', '沉默', 'awake'):
                            self.assertIn('front', namespace['eligible_seats']({'passengers': {'states': {'front': mood}}}), (kind, node_id, mood))
                        for mood in ('睡着', 'sleeping', 'unknown'):
                            self.assertNotIn('front', namespace['eligible_seats']({'passengers': {'states': {'front': mood}}}), (kind, node_id, mood))
                    main = namespace['main']
                    parameters = inspect.signature(main).parameters
                    supplied = {field['variable'] for field in data['variables']}
                    required = {key for key, value in parameters.items() if value.default is inspect.Parameter.empty}
                    self.assertTrue(required <= supplied <= set(parameters), (kind, node_id, required, supplied))
                    values = {key: {str: '{}', dict: {}, list: [], bool: False, int: 0, float: 0.0}.get(parameters[key].annotation, '{}')
                              for key in supplied}
                    with self.subTest(kind=kind, node=node_id, title=data['title']):
                        result = main(**values)
                        self.assertEqual(set(result), set(data['outputs']))
                        for field, schema in data['outputs'].items():
                            expected = {'string': str, 'object': dict, 'boolean': bool, 'number': (int, float),
                                        'array': list, 'array[string]': list, 'array[object]': list}[schema['type']]
                            self.assertIsInstance(result[field], expected, field)
                    checked += 1
                    outputs[node_id] = set(data['outputs'])
                    selectors.extend(field['value_selector'] for field in data['variables'])
                elif node_type == 'llm':
                    outputs[node_id] = {'text', 'structured_output', 'reasoning_content', 'usage'}
                    for prompt in data['prompt_template']:
                        selectors.extend(match.split('.') for match in re.findall(r'\{\{#([^#]+)#\}\}', prompt['text']))
                    self.assertEqual(data['model']['completion_params']['thinking'], kind == 'dialogue' and node_id == '1000000000005')
                    self.assertEqual(data['reasoning_format'], 'separated')
                elif node_type == 'if-else':
                    selectors.extend(condition['variable_selector'] for case in data['cases'] for condition in case['conditions'])
                elif node_type == 'knowledge-retrieval':
                    outputs[node_id] = {'result'}
                    selectors.append(data['query_variable_selector'])
                elif node_type == 'variable-aggregator':
                    outputs[node_id] = {'output'}
                    selectors.extend(data['variables'])
                elif node_type == 'end':
                    selectors.extend(field['value_selector'] for field in data['outputs'])
                elif node_type == 'answer':
                    selectors.extend(match.split('.') for match in re.findall(r'\{\{#([^#]+)#\}\}', data['answer']))
            for source, field, *_ in selectors:
                if source not in {'sys', 'conversation', 'env'}:
                    self.assertIn(field, outputs.get(source, set()), (kind, source, field))
            edges = graph['edges']
            visited = set()

            def visit(node_id, stack):
                self.assertNotIn(node_id, stack, f'{kind}: graph cycle')
                if node_id in visited:
                    return
                visited.add(node_id)
                for edge in edges:
                    if edge['source'] == node_id:
                        self.assertIn(edge['target'], nodes)
                        visit(edge['target'], stack | {node_id})

            start = next(key for key, node in nodes.items() if node['data']['type'] == 'start')
            visit(start, set())
            self.assertEqual(visited, set(nodes), f'{kind}: unreachable processing nodes')
        self.assertGreater(checked, 0)


if __name__ == '__main__':
    unittest.main()
