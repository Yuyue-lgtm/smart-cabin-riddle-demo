import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderKnowhowUpload } from './sync-host-knowhow.mjs';

// Keep the historical command, but never downgrade the canonical JSONL records.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = new URL('../../../docs/主持经验库-v1.jsonl', import.meta.url);
  const rows = fs.readFileSync(source, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  fs.writeFileSync(new URL('../../../docs/主持经验库-v1.md', import.meta.url), renderKnowhowUpload(rows));
  console.log(JSON.stringify({ source: 'docs/主持经验库-v1.jsonl', total: rows.length, source_modified: false }));
}
