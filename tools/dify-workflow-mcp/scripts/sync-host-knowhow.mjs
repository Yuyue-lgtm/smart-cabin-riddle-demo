import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export function renderKnowhowUpload(rows) {
  assert.ok(Array.isArray(rows) && rows.length > 0, 'Expected complete experience records');
  assert.equal(new Set(rows.map(row => row.knowhow_id)).size, rows.length);
  for (const row of rows) {
    assert.match(row.knowhow_id, /^HK\d{2}$/);
    for (const key of ['title', 'scenario', 'applicability', 'recommended_strategy', 'version']) {
      assert.ok(typeof row[key] === 'string' && row[key].trim(), `${row.knowhow_id}: ${key}`);
    }
    for (const key of ['recommended_actions', 'exceptions', 'forbidden_actions']) {
      assert.ok(Array.isArray(row[key]) && row[key].length
        && row[key].every(value => typeof value === 'string' && value.trim()), `${row.knowhow_id}: ${key}`);
    }
    assert.ok(Array.isArray(row.examples) && row.examples.length && row.examples.every(example =>
      typeof example.user === 'string' && example.user.trim() && typeof example.host === 'string'), `${row.knowhow_id}: examples`);
    assert.ok(JSON.stringify(row).length <= 4000, `${row.knowhow_id}: exceeds retrieval parser limit`);
  }
  return rows.map(row => JSON.stringify(row)).join('\n\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = path.join(root, 'docs/主持经验库-v1.jsonl');
  const rows = fs.readFileSync(source, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  fs.writeFileSync(path.join(root, 'docs/主持经验库-v1.md'), renderKnowhowUpload(rows));
  console.log(`Synced ${rows.length} complete host experience records.`);
}
