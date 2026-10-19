import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../../..');
const dslPath = path.join(projectRoot, 'tmp/dify-import/realtime-host-director-v3-knowhow.yml');
const document = YAML.parse(fs.readFileSync(dslPath, 'utf8'));
const result = spawnSync('python3', [path.join(here, 'test-host-knowhow.py')], {
  cwd: projectRoot,
  input: JSON.stringify(document),
  encoding: 'utf8',
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
