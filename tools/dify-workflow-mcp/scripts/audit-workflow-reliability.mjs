import fs from 'node:fs';
import { requestConsoleJson as request } from '../src/index.mjs';
import { apps, folder, save } from './update-structured-reliability.mjs';

const records = fs.readFileSync(new URL('../../../tmp/workflow-diagnostics.ndjson', import.meta.url), 'utf8')
  .split(/\r?\n/).filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } })
  .filter(row => row.phase === 'finish' && row.timestamp >= '2026-10-17T00:00:00Z');
const failure = row => row.status >= 400 || row.diagnostic?.model_nodes?.some(node => node.status === 'exception')
  || ['constraint_fallback', 'event_reply_skipped'].includes(row.guard_status);
const selected = records.filter(failure).slice(-10);
for (const route of ['situation', 'preview']) {
  const candidate = records.filter(row => row.route === route && row.workflow_run_id).at(-1);
  if (candidate) selected.push(candidate);
}
const classify = error => /parse structured output/i.test(error) ? 'structured_output_parse_failed'
  : /rate.limit|429/i.test(error) ? 'rate_limited' : /timed?.?out|timeout/i.test(error) ? 'timeout'
  : /variable.*(?:not found|missing)|selector/i.test(error) ? 'missing_variable'
  : /sandbox|traceback|typeerror|keyerror|nameerror|valueerror/i.test(error) ? 'code_execution_error'
  : error ? 'other_error' : null;
const inspected = [];
for (let offset = 0; offset < selected.length; offset += 2) {
  const results = await Promise.allSettled(selected.slice(offset, offset + 2).map(async row => {
    const response = await request(`/apps/${row.app_id}/workflow-runs/${row.workflow_run_id}/node-executions`);
    return { run_id: row.workflow_run_id, app_id: row.app_id, event_type: row.event_type, route: row.route,
      node_errors: response.data.filter(node => node.status === 'exception' || node.status === 'failed').map(node => ({
        node_id: node.node_id, title: node.title, type: node.node_type, error_class: classify([node.error, node.outputs?.error_message].join(' ')),
        contains_reasoning_tag: /<think\b/.test(node.error || ''),
      })),
      model_nodes: response.data.filter(node => node.node_type === 'llm').map(node => ({ node_id: node.node_id,
        status: node.status, text_length: node.outputs?.text?.length || 0,
        reasoning_length: node.outputs?.reasoning_content?.length || 0 })),
    };
  }));
  results.forEach((result, index) => inspected.push(result.status === 'fulfilled' ? result.value
    : { run_id: selected[offset + index].workflow_run_id, inspection_error: result.reason.message }));
}
const report = { checked_at: new Date().toISOString(), source: 'local_diagnostics_and_historical_cloud_node_executions',
  caveat: 'Mixed manual and automated local tests; these counts are not a production failure-rate estimate.',
  summary: Object.fromEntries(['chat', 'situation', 'preview'].map(route => {
    const rows = records.filter(row => row.route === route);
    return [route, { requests: rows.length, http_errors: rows.filter(row => row.status >= 400).length,
      recovered_after_retry: rows.filter(row => row.diagnostic?.model_retry_count && row.diagnostic?.model_output_status === 'valid').length,
      exhausted_retries: rows.filter(row => row.diagnostic?.model_output_status === 'retry_exhausted').length,
      skipped_events: rows.filter(row => row.guard_status === 'event_reply_skipped').length }];
  })), inspected };
fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
save('historical-audit.json', report);
console.log(JSON.stringify(report, null, 2));
