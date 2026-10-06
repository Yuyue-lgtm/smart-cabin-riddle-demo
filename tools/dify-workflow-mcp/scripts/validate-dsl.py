import inspect
import json
import re
import sys


def validate(item):
    document = item['document']
    assert document['version'] == '0.7.0'
    assert document['kind'] == 'app'
    assert document['app']['mode'] in ('workflow', 'advanced-chat')
    is_chatflow = document['app']['mode'] == 'advanced-chat'
    graph = document['workflow']['graph']
    nodes = {node['id']: node for node in graph['nodes']}
    assert len(nodes) == len(graph['nodes'])
    outputs = {}
    code_nodes = {}
    selectors = []
    for node_id, node in nodes.items():
        assert isinstance(node_id, str)
        data = node['data']
        assert node['type'] == 'custom'
        assert not ({'variables', 'outputs', 'code'} & node.keys()), node_id
        kind = data['type']
        if kind == 'start':
            outputs[node_id] = {v['variable'] for v in data['variables']}
        elif kind == 'llm':
            if not is_chatflow:
                assert 'memory' not in data
            assert data['model']['mode'] == 'chat'
            assert data['model']['provider'] == 'langgenius/gemini/google'
            assert data['model']['name'] == 'gemini-3.5-flash-lite'
            outputs[node_id] = {'text', 'usage', 'finish_reason'}
            for prompt in data['prompt_template']:
                selectors.extend(match.split('.') for match in re.findall(r'\{\{#([^#]+)#\}\}', prompt['text']))
        elif kind == 'code':
            assert isinstance(data['variables'], list)
            assert isinstance(data['outputs'], dict)
            outputs[node_id] = set(data['outputs'])
            namespace = {}
            exec(compile(data['code'], f'{node_id}.py', 'exec'), namespace)
            code_nodes[node_id] = namespace['main']
            assert set(inspect.signature(namespace['main']).parameters) == {v['variable'] for v in data['variables']}
            selectors.extend(v['value_selector'] for v in data['variables'])
        elif kind == 'variable-aggregator':
            outputs[node_id] = {'output'}
            assert data['output_type'] == 'string'
            selectors.extend(data['variables'])
        elif kind == 'end':
            assert not is_chatflow, 'Chatflow should terminate with an answer node'
            selectors.extend(v['value_selector'] for v in data['outputs'])
        elif kind == 'answer':
            assert is_chatflow
            selectors.extend(v['value_selector'] for v in data.get('variables', []))
        elif kind == 'if-else':
            for case in data['cases']:
                assert isinstance(case['case_id'], str)
                selectors.extend(c['variable_selector'] for c in case['conditions'])
        else:
            raise AssertionError(f'Unexpected node type: {kind}')

    for source_id, variable, *rest in selectors:
        if source_id == 'sys':
            assert variable in ('query', 'user_id', 'conversation_id')
            continue
        if source_id == 'conversation':
            assert any(v['name'] == variable for v in document['workflow'].get('conversation_variables', []))
            continue
        assert source_id in nodes and variable in outputs[source_id], (source_id, variable)

    children = {node_id: [] for node_id in nodes}
    for edge in graph['edges']:
        assert all(isinstance(edge[key], str) for key in ['id', 'source', 'target', 'sourceHandle', 'targetHandle'])
        source, target = nodes[edge['source']]['data'], nodes[edge['target']]['data']
        assert edge['data']['sourceType'] == source['type']
        assert edge['data']['targetType'] == target['type']
        handles = {c['case_id'] for c in source['cases']} | {'false'} if source['type'] == 'if-else' else {'source'}
        assert edge['sourceHandle'] in handles
        children[edge['source']].append(edge['target'])
    starts = [n for n in nodes if nodes[n]['data']['type'] == 'start']
    assert len(starts) == 1
    visited = set()

    def visit(node_id, stack):
        assert node_id not in stack, 'Cycle in graph'
        visited.add(node_id)
        if not children[node_id]:
            expected_terminal = 'answer' if is_chatflow else 'end'
            assert nodes[node_id]['data']['type'] == expected_terminal
        for child in children[node_id]:
            visit(child, stack | {node_id})

    visit(starts[0], set())
    assert visited == set(nodes), 'Unreachable nodes'

    def run(node_id, **kwargs):
        result = code_nodes[node_id](**kwargs)
        schema = nodes[node_id]['data']['outputs']
        assert set(result) == set(schema)
        types = {'string': str, 'boolean': bool, 'object': dict}
        for key, value in result.items():
            assert isinstance(value, types[schema[key]['type']]), key
        return result

    if '1000000000002' in code_nodes:
        normalize = '1000000000002'
        sample = {'trigger_type': 'chat', 'player_input': '雨伞', 'game': {'current_answer': '雨伞', 'status': 'playing'}}
        result = run(normalize, input_payload=json.dumps(sample), **({'cabin_snapshot': '{}'} if 'cabin_snapshot' in inspect.signature(code_nodes[normalize]).parameters else {}))
        assert result['is_p0'] and result['exact_correct']
        p0 = json.loads(run('1000000000004', payload=result['payload'], exact_correct=True, event_type='')['workflow_output'])
        assert p0['game_status'] == 'victory'
        for event, status in [('hard_brake', 'paused'), ('round_timeout', 'failed'), ('game_end', 'finished')]:
            value = json.loads(run('1000000000004', payload=sample, exact_correct=False, event_type=event)['workflow_output'])
            assert value['game_status'] == status
        malformed_args = {'input_payload': '{bad json'}
        if 'cabin_snapshot' in inspect.signature(code_nodes[normalize]).parameters:
            malformed_args['cabin_snapshot'] = '{}'
        assert not run(normalize, **malformed_args)['is_p0']
        for text in ['not json', '{"speech":null}', '{"ai_reply_text":"可以聊聊，然后继续猜谜。"}']:
            value = json.loads(run('1000000000006', director_text=text, payload=sample)['workflow_output'])
            assert value['speech']['max_duration_ms'] == 6000
            if is_chatflow:
                assert set(('perception', 'decision_trace', 'execution', 'priority')) <= set(value)
        if is_chatflow:
            value = json.loads(run('1000000000006', director_text='{"ai_reply_text":"我来帮你打开背景音乐。","execution_actions":[{"type":"music.set_enabled","enabled":true}]}', payload={**sample, 'player_input': '请打开音乐'})['workflow_output'])
            assert value['execution']['actions'][0]['type'] == 'music.set_enabled'
            assert value['execution']['actions'][0]['enabled'] is True
            value = json.loads(run('1000000000006', director_text='{"ai_reply_text":"好的。","execution_actions":[{"type":"music.set_enabled","enabled":true}]}', payload={**sample, 'player_input': '请关闭背景音乐'})['workflow_output'])
            assert value['execution']['actions'][0]['enabled'] is False
            value = json.loads(run('1000000000006', director_text='{"ai_reply_text":"好的。","execution_actions":[{"type":"music.set_enabled","enabled":true}]}', payload={**sample, 'player_input': '不要关闭音乐'})['workflow_output'])
            assert value['execution']['actions'] == []
            value = json.loads(run('1000000000006', director_text='{"ai_reply_text":"好的。"}', payload={**sample, 'player_input': '别放音乐'})['workflow_output'])
            assert value['execution']['actions'][0]['enabled'] is False
            value = json.loads(run('1000000000006', director_text='{"ai_reply_text":"已打开车内照明灯。","execution_actions":[{"type":"cabin_lighting.set_enabled","enabled":true}]}', payload={**sample, 'player_input': '打开车内照明灯'})['workflow_output'])
            assert value['execution']['actions'] == []
            value = json.loads(run('1000000000006', director_text='{"ai_reply_text":"给你一点提示。","covered_fact_keys":["secret"]}', payload={**sample, 'player_input': '给我一点提示'})['workflow_output'])
            assert value['decision_trace']['hint_blocked'] is True
            p0_value = json.loads(run('1000000000004', payload=sample, exact_correct=True, event_type='')['workflow_output'])
            assert p0_value['decision_trace']['layer'] == 'rule'
            assert p0_value['execution']['actions'][0]['preset'] == 'cabin-correct-light'
    else:
        for text in ['not json', '{"round_question_plan":null}', '{"round_question_plan":{"steps":[null,{}]}}']:
            extra = {}
            if 'context_json' in inspect.signature(code_nodes['2000000000003']).parameters:
                extra['context_json'] = run('2000000000005', input_payload='{}')['context_json']
            value = json.loads(run('2000000000003', director_text=text, **extra)['workflow_output'])
            assert isinstance(value['round_question_plan']['steps'], list)
    print(f"PASS {item['file']}: {len(nodes)} nodes, {len(graph['edges'])} edges, references, Python code and smoke tests")


for item in json.load(sys.stdin):
    validate(item)
