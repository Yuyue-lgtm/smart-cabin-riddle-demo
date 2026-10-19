import copy
import inspect
import json
import re
import sys
import unittest


DOCUMENTS = json.load(sys.stdin)


class Graph:
    def __init__(self, dsl):
        self.dsl = dsl
        self.nodes = {n['id']: n for n in dsl['workflow']['graph']['nodes'] if n['type'] == 'custom'}
        self.code = {}
        for key, node in self.nodes.items():
            if node['data']['type'] == 'code':
                namespace = {}
                exec(compile(node['data']['code'], key, 'exec'), namespace)
                self.code[key] = namespace['main']
                assert set(inspect.signature(namespace['main']).parameters) == {v['variable'] for v in node['data']['variables']}

    def run(self, node, **kwargs):
        value = self.code[node](**kwargs)
        schema = self.nodes[node]['data']['outputs']
        assert set(value) == set(schema), (node, set(value), set(schema))
        for key, field in schema.items():
            assert isinstance(value[key], {'boolean': bool, 'string': str, 'object': dict}[field['type']]), (node, key)
        return value


CHAT, SCENE = [Graph(d) for d in DOCUMENTS]
BASE = {'game_id': 'game-1', 'round_id': 'round-1', 'scene_version': '1',
        'game': {'status': 'playing', 'current_answer': '雨伞', 'round_index': 1, 'question_count': 3,
                 'max_questions': 15, 'round_question_plan': {'steps': [{'fact_key': 'rain', 'variants': {'default': '下雨会用吗？'}, 'expected_answer': 'yes'}]}},
        'car': {'environment': '城市夜景', 'speed': 50, 'destination': '火锅店'},
        'passengers': {'states': {'front': 'awake', 'rearLeft': 'sleeping', 'rearRight': 'awake'}, 'selected_seat': 'front'},
        'event': {'id': 'event-1', 'type': 'passenger_sleep', 'value': 'rearLeft'}}
MODEL = {'intent': 'answer_question', 'reply_mode': 'answer_only', 'ai_reply_text': '是的，下雨时会用到它。',
         'strategy': 'direct_answer', 'target_seat': None, 'reason_codes': ['ordinary_yes_no'], 'applied_knowhow_ids': []}


def chat_input(query='答案是不是红色？', snapshot=None, situation='{}'):
    return CHAT.run('1000000000002', query=query, snapshot=json.dumps(snapshot or BASE), situation=situation)


def scene_input(snapshot=None):
    return SCENE.run('3000000000002', snapshot=json.dumps(snapshot or BASE))


def scene_plan(normalized=None, **plan):
    normalized = normalized or scene_input()
    value = {'needs_knowhow': False, 'share_context': True, 'selected_fields': ['passengers'], 'proactive_speech': False, **plan}
    return SCENE.run('3000000000008', analysis_text=json.dumps(value), context_json=normalized['context_json'])


def scene_result(normalized=None, plan=None, model=None):
    normalized = normalized or scene_input()
    plan = plan or scene_plan(normalized)
    model = model or {**MODEL, 'ai_reply_text': '后排有朋友休息，我们轻声玩。', 'strategy': 'soft_response', 'reason_codes': ['sleeping_passenger_excluded']}
    return json.loads(SCENE.run('3000000000014', director_text=json.dumps(model), payload=normalized['payload'], director_context=plan['director_context'])['scene_output'])


class ParallelTests(unittest.TestCase):
    def test_fallback_reasons_survive_the_final_guard(self):
        snapshot = copy.deepcopy(BASE)
        snapshot['passengers']['states']['rearLeft'] = 'awake'
        normalized = chat_input('太难了，但让我再想想。', snapshot)
        invited = {**MODEL, 'ai_reply_text': '要不要请后排右一起猜？',
                   'strategy': 'invite_collaboration', 'target_seat': 'rearRight'}
        response = CHAT.run('1000000000006', director_text=json.dumps(invited, ensure_ascii=False),
                            payload=normalized['payload'], director_context=normalized['context_json'])
        result = json.loads(response['workflow_output'])
        self.assertEqual(result['ai_reply_text'], '我陪你慢慢想，按你的节奏来。')
        self.assertEqual(result['debug']['fallback_origin'], 'parallel_guard')
        self.assertIn('independent_thinking_invitation_conflict', result['debug']['fallback_reason_codes'])

        broken = {**MODEL, 'ai_reply_text': ''}
        response = CHAT.run('1000000000006', director_text=json.dumps(broken, ensure_ascii=False),
                            payload=normalized['payload'], director_context=normalized['context_json'])
        result = json.loads(response['workflow_output'])
        self.assertIn('upstream_validation_failed', result['debug']['fallback_reason_codes'])
        self.assertIn('missing_long_or_answer_leaking_reply', result['debug']['validation_errors'])
        self.assertIn('missing_model_reply', result['debug']['validation_reason_codes'])

    def test_graphs_notes_and_selectors(self):
        for graph in [CHAT, SCENE]:
            outputs = {}
            selectors = []
            for key, node in graph.nodes.items():
                data, kind = node['data'], node['data']['type']
                if kind == 'start': outputs[key] = {v['variable'] for v in data['variables']}
                if kind == 'code':
                    outputs[key] = set(data['outputs'])
                    selectors.extend(v['value_selector'] for v in data['variables'])
                if kind == 'llm':
                    outputs[key] = {'text', 'structured_output'}
                    for prompt in data['prompt_template']:
                        selectors.extend(m.split('.') for m in re.findall(r'\{\{#([^#]+)#\}\}', prompt['text']))
                if kind == 'if-else':
                    selectors.extend(c['variable_selector'] for case in data['cases'] for c in case['conditions'])
                if kind == 'knowledge-retrieval':
                    outputs[key] = {'result'}
                    selectors.append(data['query_variable_selector'])
                    self.assertEqual(data['multiple_retrieval_config']['top_k'], 3)
                    self.assertFalse(data['multiple_retrieval_config']['reranking_enable'])
                    self.assertTrue(data['dataset_ids'])
                if kind == 'variable-aggregator':
                    outputs[key] = {'output'}
                    selectors.extend(data['variables'])
                if kind == 'end': selectors.extend(v['value_selector'] for v in data['outputs'])
                if kind == 'answer': selectors.extend(m.split('.') for m in re.findall(r'\{\{#([^#]+)#\}\}', data['answer']))
                self.assertTrue(data['desc'], key)
            for node, field, *_ in selectors:
                self.assertIn(field, outputs[node], (node, field)) if node != 'sys' else self.assertEqual(field, 'query')
            reachable = set()
            edges = graph.dsl['workflow']['graph']['edges']
            def walk(node, stack):
                self.assertNotIn(node, stack)
                reachable.add(node)
                for e in edges:
                    if e['source'] == node:
                        self.assertEqual(e['data']['sourceType'], graph.nodes[node]['data']['type'])
                        self.assertEqual(e['data']['targetType'], graph.nodes[e['target']]['data']['type'])
                        walk(e['target'], stack | {node})
            walk(next(k for k, n in graph.nodes.items() if n['data']['type'] == 'start'), set())
            self.assertEqual(reachable, set(graph.nodes))
            for n in graph.dsl['workflow']['graph']['nodes']:
                if n['type'] == 'custom-note': self.assertTrue(json.loads(n['data']['text'])['root']['children'])

    def test_paths_do_not_share_online_retrieval(self):
        model = CHAT.nodes['1000000000005']['data']
        self.assertTrue(model['structured_output_enabled'])
        self.assertIn('ai_reply_text', model['structured_output']['schema']['required'])
        self.assertTrue(model['model']['completion_params']['thinking'])
        self.assertEqual(model['model']['completion_params']['reasoning_effort'], 'low')
        self.assertEqual(model['model']['completion_params']['response_format'], 'json_object')
        self.assertEqual(sum(n['data']['type'] == 'llm' for n in CHAT.nodes.values()), 2)
        self.assertFalse(any(n['data']['type'] == 'knowledge-retrieval' for n in CHAT.nodes.values()))
        self.assertEqual(sum(n['data']['type'] == 'llm' for n in SCENE.nodes.values()), 2)
        self.assertFalse(any(n['data'].get('memory') for n in SCENE.nodes.values()))
        edges = SCENE.dsl['workflow']['graph']['edges']
        queue = ['3000000000004']
        while queue:
            key = queue.pop()
            self.assertNotIn(SCENE.nodes[key]['data']['type'], ('llm', 'knowledge-retrieval'))
            queue += [e['target'] for e in edges if e['source'] == key]

    def test_structured_output_preferred_and_text_compatibility(self):
        model = {**MODEL, 'covered_fact_keys': [], 'execution_actions': []}
        for raw, structured, expected_source in [
            ('<think>unfinished', model, 'structured_output'),
            (json.dumps(model), {}, 'text'),
            ('<think>private reasoning</think>' + json.dumps(model), {}, 'text'),
            (json.dumps({**model, 'ai_reply_text': '不是。'}), model, 'structured_output'),
        ]:
            normalized = CHAT.run('1000000000021', director_text=raw, director_structured=structured)
            self.assertFalse(normalized['needs_retry'])
            result = json.loads(normalized['model_result'])
            self.assertEqual(result['attempts'][0]['source'], expected_source)
            self.assertEqual(json.loads(result['canonical_text'])['ai_reply_text'], model['ai_reply_text'])

    def test_output_retry_is_bounded_and_keeps_both_attempts(self):
        valid = {**MODEL, 'covered_fact_keys': [], 'execution_actions': []}
        for raw, code in [('', 'empty_model_output'), ('{}', 'empty_model_output'),
                          ('<think>private reasoning</think>', 'think_only_output'),
                          ('<think>unfinished', 'think_only_output'), ('{"broken":', 'invalid_model_json')]:
            first = CHAT.run('1000000000021', director_text=raw, director_structured={})
            self.assertTrue(first['needs_retry'])
            self.assertIn(code, json.loads(first['model_result'])['attempts'][0]['reason_codes'])
            fixed = CHAT.run('1000000000024', director_text='', director_structured=valid,
                             previous_result=first['model_result'])
            recovered = json.loads(fixed['model_result'])
            self.assertEqual(recovered['status'], 'valid')
            self.assertEqual(len(recovered['attempts']), 2)
            failed = CHAT.run('1000000000024', director_text=raw, director_structured={},
                             previous_result=first['model_result'])
            self.assertEqual(json.loads(failed['model_result'])['status'], 'retry_exhausted')
            normalized = chat_input('下雨会用吗？')
            response = CHAT.run('1000000000006', director_text=raw, model_result=failed['model_result'],
                                payload=normalized['payload'], director_context=normalized['context_json'])
            guarded = json.loads(response['workflow_output'])
            self.assertEqual(guarded['debug']['model_retry_count'], 1)
            self.assertIn(code, guarded['debug']['model_failure_reason_codes'])
            self.assertEqual(guarded['decision_trace']['guard_status'], 'model_output_fallback')
            self.assertNotIn('我陪你慢慢想', guarded['ai_reply_text'])
            self.assertNotIn('雨伞', guarded['ai_reply_text'])
            self.assertEqual(guarded['covered_fact_keys'], [])
            self.assertFalse(guarded['is_correct'])
            self.assertEqual(guarded['execution']['actions'], [])

    def test_retry_recovery_still_passes_hint_and_answer_guards(self):
        model = {**MODEL, 'covered_fact_keys': [], 'execution_actions': []}
        first = CHAT.run('1000000000021', director_text='', director_structured={})
        fixed = CHAT.run('1000000000024', director_text='', director_structured=model,
                         previous_result=first['model_result'])
        normalized = chat_input('给我一点提示吧')
        response = CHAT.run('1000000000006', director_text='', model_result=fixed['model_result'],
                            payload=normalized['payload'], director_context=normalized['context_json'])
        guarded = json.loads(response['workflow_output'])
        self.assertTrue(guarded['decision_trace']['hint_blocked'])
        self.assertEqual(guarded['covered_fact_keys'], [])
        self.assertEqual(guarded['debug']['model_retry_count'], 1)
        exhausted = CHAT.run('1000000000024', director_text='', director_structured={},
                             previous_result=first['model_result'])
        failed = CHAT.run('1000000000006', director_text='', model_result=exhausted['model_result'],
                          payload=normalized['payload'], director_context=normalized['context_json'])
        failed_result = json.loads(failed['workflow_output'])
        self.assertIn('不额外给提示', failed_result['ai_reply_text'])
        self.assertTrue(failed_result['decision_trace']['hint_blocked'])
        self.assertEqual(failed_result['covered_fact_keys'], [])

    def test_no_transcript_or_snapshot_in_query_answer(self):
        raw = {**BASE, 'interaction': {'recent_messages': [{'text': 'HISTORY_SENTINEL'}]}, 'player_input': 'OLD_SENTINEL'}
        result = chat_input('太难了，帮帮我。', raw)
        self.assertNotIn('HISTORY_SENTINEL', json.dumps(result))
        self.assertNotIn('OLD_SENTINEL', json.dumps(result))
        self.assertEqual(json.loads(result['payload'])['player_input'], '太难了，帮帮我。')
        for utterance in ['太难了，帮帮我。', '太难了，但让我再想想。', '答案是不是红色？']:
            self.assertFalse(chat_input(utterance)['is_p0'])
        terminal = CHAT.run('1000000000020', workflow_output=json.dumps({'ai_reply_text': '好的。', 'answer': '雨伞'}), payload=result['payload'])
        self.assertEqual(terminal['reply_text'], '好的。')
        self.assertIsNone(json.loads(terminal['host_result'])['answer'])

    def test_round_boundary_uses_current_snapshot(self):
        raw = copy.deepcopy(BASE)
        raw['round_id'] = 'round-2'
        raw['game'].update(current_answer='海豚', round_index=2, asked_questions=[], covered_fact_keys=[])
        raw['round_context'] = {'previous_game_id': 'game-1', 'previous_round_id': 'round-1',
                                'current_round_id': 'spoofed-old-round', 'current_snapshot_is_authoritative': False}
        normalized = chat_input('它是人造的吗？', raw)
        context = json.loads(normalized['context_json'])
        self.assertEqual(context['game']['current_answer'], '海豚')
        self.assertEqual(context['round_context']['round_id'], 'round-2')
        self.assertEqual(context['round_context']['transition'], 'new_round')
        self.assertTrue(context['round_context']['current_snapshot_is_authoritative'])
        self.assertIn('上一题已结束', context['round_context']['notice'])
        result = CHAT.run('1000000000020', workflow_output=json.dumps({'ai_reply_text': '不是人造的。'}), payload=normalized['payload'])
        self.assertEqual(json.loads(result['host_result'])['context_scope']['round_id'], 'round-2')

    def test_p0_bypass(self):
        for kind in ['hard_brake', 'safety_pause', 'round_timeout', 'game_end', 'answer_correct']:
            raw = {**BASE, 'event': {'id': kind, 'type': kind}}
            normalized = scene_input(raw)
            self.assertTrue(normalized['is_p0'])
            self.assertFalse(normalized['can_analyze'])
        self.assertTrue(chat_input('雨伞')['exact_correct'])

    def test_event_gates(self):
        for duration, expected in [(14999, False), (15000, False), (15001, True)]:
            raw = {**BASE, 'driver': {'state': 'fatigued'}, 'event': {'id': 'tired', 'type': 'driver_tired', 'state': 'fatigued', 'duration_ms': duration}}
            self.assertEqual(scene_input(raw)['can_analyze'], expected)
        for before, after, expected in [(120, 121, True), (121, 125, False), (119, 120, False)]:
            raw = {**BASE, 'event': {'id': 'speed', 'type': 'speed_overspeed', 'previous_value': before, 'value': after}}
            self.assertEqual(scene_input(raw)['can_analyze'], expected)
        self.assertFalse(scene_input({**BASE, 'event': {'type': 'chat', 'id': 'x'}})['can_analyze'])
        self.assertFalse(scene_input({**BASE, 'game': {**BASE['game'], 'status': 'paused'}})['can_analyze'])

    def test_analyst_does_not_see_answer_or_user_text(self):
        context = scene_input({**BASE, 'event': {**BASE['event'], 'value': '雨伞'}, 'player_input': '让我再想想'})['context_json']
        self.assertNotIn('雨伞', context)
        self.assertNotIn('让我再想想', context)
        plan = scene_plan(needs_knowhow=True)
        self.assertNotIn('雨伞', plan['knowhow_query'])

    def test_participation_opportunity_requires_real_observations(self):
        raw = copy.deepcopy(BASE)
        raw['passengers']['states']['front'] = '普通'
        raw['event'] = {'id': 'inactive-1', 'type': 'passenger_inactive', 'source': 'participation_monitor', 'seat': 'front'}
        raw['participation'] = {'seat': 'front', 'version': 3, 'inactive_duration_ms': 20000,
                                'dialogue_silence_ms': 2500, 'remaining_ms': 40000,
                                'real_user_turn_count': 0, 'invitation_declined': False,
                                'raw_transcript': 'PRIVATE_TRANSCRIPT'}
        normalized = scene_input(raw)
        self.assertTrue(normalized['can_analyze'])
        context = json.loads(normalized['context_json'])
        self.assertEqual(context['eligible_collaborators'], ['front'])
        self.assertNotIn('PRIVATE_TRANSCRIPT', normalized['context_json'])
        self.assertNotIn('雨伞', normalized['context_json'])
        for key, value in [('inactive_duration_ms', 19999), ('dialogue_silence_ms', 2499),
                           ('remaining_ms', 15000), ('invitation_declined', True)]:
            changed = copy.deepcopy(raw)
            changed['participation'][key] = value
            self.assertFalse(scene_input(changed)['can_analyze'], key)
        for state in ['sleeping', '睡着', 'unknown']:
            changed = copy.deepcopy(raw)
            changed['passengers']['states']['front'] = state
            self.assertFalse(scene_input(changed)['can_analyze'], state)
        changed = copy.deepcopy(raw)
        changed['event']['source'] = 'timeline'
        self.assertFalse(scene_input(changed)['can_analyze'])
        model = {**MODEL, 'intent': 'event', 'reply_mode': 'chat_only',
                 'ai_reply_text': '副驾有什么想法？也来问一问吧。',
                 'strategy': 'invite_collaboration', 'target_seat': 'front',
                 'reason_codes': ['eligible_collaborator_available']}
        for proactive in [False, True]:
            plan = scene_plan(normalized, share_context=False, selected_fields=[], proactive_speech=proactive)
            result = scene_result(normalized, plan, model)
            self.assertEqual(result['analysis_status'], 'ready')
            self.assertEqual(result['request_proactive_speech'], proactive)
            self.assertEqual(result['participation_version'], 3)
            self.assertFalse(result['usable_for_dialogue'])
            self.assertEqual(result['dialogue_context'], {})
            self.assertEqual(result['expires_at_ms'] - result['generated_at_ms'], 10000)

    def test_retrieval_empty_malformed_and_actual_ids(self):
        normalized, plan = scene_input(), scene_plan(needs_knowhow=True)
        for chunks, status in [([], 'empty'), ([{'content': '{bad'}], 'failed'), ([{'content': '{"knowhow_id":"HK05","title":"睡眠关怀"}'}], 'used')]:
            context = SCENE.run('3000000000011', context_json=plan['director_context'], retrieval_results=chunks, eligible_target_seats=plan['eligible_target_seats'])
            self.assertEqual(context['knowhow_status'], status)
            self.assertEqual(scene_result(normalized, context)['knowhow_status'], status)

    def test_unknown_experience_and_ineligible_invites(self):
        for model in [{**MODEL, 'applied_knowhow_ids': ['HK99']}, {**MODEL, 'strategy': 'invite_collaboration', 'target_seat': 'rearLeft', 'ai_reply_text': '请后排左也来猜。'}, {**MODEL, 'ai_reply_text': '请主驾一起猜。'}]:
            data = chat_input()
            result = json.loads(CHAT.run('1000000000006', director_text=json.dumps(model), payload=data['payload'], director_context=data['context_json'])['workflow_output'])
            self.assertEqual(result['applied_knowhow_ids'], [])
            self.assertIsNone(result['target_seat'])
            self.assertNotIn('请主驾', result['ai_reply_text'])

    def test_cache_version_expiry_and_no_stale_facts(self):
        cached = scene_result()
        self.assertTrue(cached['usable_for_dialogue'])
        self.assertFalse(cached['request_proactive_speech'])
        self.assertIsNone(cached['host_response'])
        for key in ['game_id', 'round_id', 'scene_version']:
            data = chat_input(snapshot={**BASE, key: 'new'}, situation=json.dumps(cached))
            self.assertEqual(json.loads(data['context_json'])['situation_status'], 'scope_mismatch')
        expired = {**cached, 'expires_at_ms': 1}
        self.assertEqual(json.loads(chat_input(situation=json.dumps(expired))['context_json'])['situation_status'], 'expired')
        self.assertEqual(json.loads(chat_input(situation=json.dumps(cached))['context_json'])['situation_status'], 'valid')

    def test_no_proactive_speech_without_authorized_event(self):
        normalized = scene_input()
        plan = scene_plan(normalized, proactive_speech=True)
        self.assertFalse(scene_result(normalized, plan)['request_proactive_speech'])
        normalized = scene_input({**BASE, 'event': {'id': 'env', 'type': 'environment_change',
                                                  'previous_value': '车库', 'value': BASE['car']['environment']}})
        plan = scene_plan(normalized, proactive_speech=True)
        self.assertTrue(scene_result(normalized, plan)['request_proactive_speech'])

    def test_environment_background_or_legacy_fast_path(self):
        raw = copy.deepcopy(BASE)
        raw['car']['environment'] = '高速路晴天白天'
        raw['event'] = {'id': 'env-fast', 'type': 'environment_change', 'previous_value': '车库', 'value': raw['car']['environment']}
        normalized = scene_input(raw)
        if 'environment_fast_path' not in normalized:
            context = json.loads(normalized['context_json'])
            self.assertTrue(normalized['can_analyze'])
            self.assertEqual(context['snapshot']['environment'], raw['car']['environment'])
            self.assertNotIn(BASE['game']['current_answer'], normalized['context_json'])
            self.assertFalse(normalized['feedback_fast_path'])
            raw['game']['status'] = 'paused'
            self.assertFalse(scene_input(raw)['can_analyze'])
            return
        self.assertTrue(normalized['environment_fast_path'])
        plan = SCENE.run('3000000000021', context_json=normalized['context_json'])
        context = json.loads(plan['director_context'])
        self.assertTrue(context['analysis_plan']['proactive_speech'])
        self.assertNotIn(BASE['game']['current_answer'], plan['director_context'])
        for model in [{}, {**MODEL, 'ai_reply_text': '高速路况安全畅通。'},
                      {**MODEL, 'ai_reply_text': '我们驶上高速啦。', 'strategy': 'soft_response', 'reason_codes': ['environment_change']}]:
            output = json.loads(SCENE.run('3000000000014', director_text=json.dumps(model), payload=normalized['payload'],
                                         director_context=plan['director_context'])['scene_output'])
            self.assertTrue(output['request_proactive_speech'])
            self.assertEqual(output['analysis_status'], 'ready')
            self.assertIn('高速', output['host_response']['ai_reply_text'])
            self.assertEqual(output['decision_trace']['priority'], 'P1')
            self.assertEqual(output['execution']['actions'], [])
        for change in ['same', 'mismatch', 'paused']:
            invalid = copy.deepcopy(raw)
            if change == 'same': invalid['event']['previous_value'] = invalid['car']['environment']
            elif change == 'mismatch': invalid['event']['value'] = '隧道'
            else: invalid['game']['status'] = 'paused'
            self.assertFalse(scene_input(invalid)['environment_fast_path'])
        edges = SCENE.dsl['workflow']['graph']['edges']
        queue = ['3000000000021']
        visited = set()
        while queue:
            key = queue.pop()
            if key in visited: continue
            visited.add(key)
            self.assertNotEqual(SCENE.nodes[key]['data']['type'], 'knowledge-retrieval')
            queue += [edge['target'] for edge in edges if edge['source'] == key]
        self.assertEqual(sum(SCENE.nodes[key]['data']['type'] == 'llm' for key in visited), 1)

    def test_model_failure_and_paused_music(self):
        normalized = scene_input()
        plan = SCENE.run('3000000000008', analysis_text='{}', context_json=normalized['context_json'])
        self.assertFalse(plan['needs_knowhow'])
        self.assertEqual(scene_result(normalized, plan)['analysis_status'], 'failed')
        snapshot = {**BASE, 'game': {**BASE['game'], 'status': 'paused'}}
        data = chat_input('打开音乐', snapshot)
        result = json.loads(CHAT.run('1000000000006', director_text=json.dumps(MODEL), payload=data['payload'], director_context=data['context_json'])['workflow_output'])
        self.assertEqual(result['game_status'], 'paused')
        self.assertEqual(result['execution']['actions'][0]['type'], 'music.set_enabled')
        self.assertFalse(result['is_correct'])

    def test_reasoning_wrapped_json(self):
        normalized = scene_input()
        raw = '<think>Example {"needs_knowhow":false} is not the final output.</think>```json\n' + json.dumps({'needs_knowhow': True, 'share_context': True, 'selected_fields': ['passengers'], 'proactive_speech': False}) + '\n```'
        plan = SCENE.run('3000000000008', analysis_text=raw, context_json=normalized['context_json'])
        self.assertTrue(plan['needs_knowhow'])
        self.assertTrue(json.loads(plan['director_context'])['analysis_plan']['analysis_valid'])
        wrapped = '<think>Example {"strategy":"wrong"}</think>' + json.dumps(MODEL)
        chat = chat_input()
        result = json.loads(CHAT.run('1000000000006', director_text=wrapped, payload=chat['payload'], director_context=chat['context_json'])['workflow_output'])
        self.assertEqual(result['ai_reply_text'], MODEL['ai_reply_text'])


unittest.main(argv=['test-parallel-host'], verbosity=2)
