import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = path.join(root, 'docs/主持经验库-v1.jsonl');
const rows = fs.readFileSync(source, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
assert.equal(new Set(rows.map(row => row.knowhow_id)).size, rows.length);
for (const row of rows) {
  for (const key of ['knowhow_id', 'title', 'scenario', 'applicability', 'recommended_strategy', 'recommended_actions', 'exceptions', 'forbidden_actions', 'examples', 'version']) {
    assert.ok(row[key]?.length, `${row.knowhow_id}: ${key}`);
  }
}
fs.writeFileSync(path.join(root, 'docs/主持经验库-v1.md'), rows.map(row => JSON.stringify(row)).join('\n\n') + '\n');
console.log(`Synced ${rows.length} complete host experience records.`);
