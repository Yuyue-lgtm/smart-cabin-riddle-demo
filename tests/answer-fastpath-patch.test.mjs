import test from 'node:test';
import assert from 'node:assert/strict';
import { patchAnswerFastpath } from '../tools/dify-workflow-mcp/scripts/update-ecs-answer-fastpath.mjs';

function fixture() {
  return { features: {}, environment_variables: [], conversation_variables: [], graph: { edges: [], nodes: [
    { id: '1000000000002', data: { type: 'code', code: 'import json\n\ndef main(input_payload: str, cabin_snapshot: str) -> dict:\n    return {}\n\ndef host_preferences(payload):\n    return {}\n\n_normalize_original = main\n' } },
    { id: '1000000000004', data: { type: 'code', code: 'import json\n\ndef main(payload: object, exact_correct: bool, event_type: str) -> dict:\n    return {}\n' } },
    { id: '1000000000005', data: { type: 'llm', model: { temperature: 1.8 }, prompt: 'Existing host style' } },
  ] } };
}

test('patch changes only input and rule nodes and preserves adjacent Python helpers', () => {
  const original = fixture();
  const before = structuredClone(original);
  const result = patchAnswerFastpath(original);
  assert.deepEqual(original, before);
  assert.deepEqual(result.graph.nodes[2], original.graph.nodes[2]);
  assert.deepEqual(result.graph.edges, original.graph.edges);
  assert.deepEqual(result.features, original.features);
  assert.ok(result.graph.nodes[0].data.code.includes('def host_preferences(payload):\n    return {}\n\n_normalize_original = main\n'));
  assert.match(result.graph.nodes[0].data.code, /candidate != "none"/);
  assert.match(result.graph.nodes[1].data.code, /answer_candidate_confirmation/);
});

test('answer fastpath patch is idempotent', () => {
  const once = patchAnswerFastpath(fixture());
  assert.deepEqual(patchAnswerFastpath(once), once);
});
