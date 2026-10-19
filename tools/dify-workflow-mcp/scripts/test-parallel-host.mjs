import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
const here = path.dirname(fileURLToPath(import.meta.url));
const folder = path.resolve(here, '../workflows/parallel');
const documents = ['host-dialogue-v4.yml', 'cabin-situation-v1.yml'].map((name, index) =>
  YAML.parse(fs.readFileSync(index === 1 && process.argv[2] ? path.resolve(process.argv[2]) : path.join(folder, name), 'utf8')));
const source = path.resolve(here, '../workflows/host/src');
const guard = documents[0].workflow.graph.nodes.find(node => node.id === '1000000000006');
guard.data.code = ['common.py', 'parallel_common.py', 'realtime_guard.py', 'knowhow_guard.py', 'parallel_guard.py']
  .concat('dialogue_guard.py').map(name => fs.readFileSync(path.join(source, name), 'utf8').trim()).join('\n\n');
const result = spawnSync('python3', [path.join(here, 'test-parallel-host.py')], { input: JSON.stringify(documents), encoding: 'utf8' });
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
process.exit(result.status ?? 1);
