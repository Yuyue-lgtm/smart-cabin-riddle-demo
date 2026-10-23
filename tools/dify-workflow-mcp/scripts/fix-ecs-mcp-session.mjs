import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import YAML from '../node_modules/yaml/dist/index.js';
import { projectRoot } from '../src/ecs-console.mjs';
import { sshArguments } from '../src/ecs-tunnel.mjs';

const apply = process.argv.includes('--apply');
const version = new Date().toISOString().replace(/[:.]/g, '-');
const folder = path.join(projectRoot, 'tmp/dify-ecs', `${version}-mcp-session`);
const stage = `/tmp/cabinplay-${version}-mcp-session`;
const backup = `/root/cabinplay-backups/${version}-mcp-session`;
const compose = '/opt/dify/docker/docker-compose.yaml';
const modulePath = '/app/api/controllers/mcp/mcp.py';
const mountPath = '/opt/dify/local-patches/mcp-session/mcp.py';
fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
const args = sshArguments().filter(arg => !['-N', '-T'].includes(arg));
args.splice(args.indexOf('-L'), 2);
const host = args.pop();
const scpArgs = args.map(arg => arg === '-p' ? '-P' : arg);
const report = { version, applied: false, rollback: false, backup, stage, mount: mountPath };
const save = () => fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
const run = (command, argv, expected = 0, timeout = 60000) => {
  const result = spawnSync(command, argv, { encoding: 'utf8', timeout });
  assert.equal(result.status, expected, `${command}: ${(result.stderr || result.stdout || result.error?.message || '').slice(-2500)}`);
  return result.stdout;
};
const ssh = (command, expected = 0, timeout) => run('ssh', [...args, host, command], expected, timeout);
const upload = (source, destination) => run('scp', [...scpArgs, source, `${host}:${destination}`]);
const download = (source, destination) => run('scp', [...scpArgs, `${host}:${source}`, destination]);
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let composeReplaced = false;
try {
  const image = ssh("docker inspect --format '{{.Config.Image}}' docker-api-1").trim();
  assert.equal(image, 'langgenius/dify-api:1.17.1', 'Review this patch before applying it to a different Dify version');
  ssh(`umask 077\nmkdir -p ${stage}\ndocker cp docker-api-1:${modulePath} ${stage}/mcp-before.py`);
  download(compose, path.join(folder, 'compose-before.yaml'));
  download(`${stage}/mcp-before.py`, path.join(folder, 'mcp-before.py'));
  fs.copyFileSync(path.join(folder, 'mcp-before.py'), path.join(folder, 'mcp.py'));
  const patch = path.join(projectRoot, 'deploy/alibaba-cloud/dify-mcp-session.patch');
  run('patch', ['--fuzz=0', '--dry-run', path.join(folder, 'mcp.py'), patch]);
  run('patch', ['--fuzz=0', path.join(folder, 'mcp.py'), patch]);
  const sourceCompose = fs.readFileSync(path.join(folder, 'compose-before.yaml'), 'utf8');
  const document = YAML.parseDocument(sourceCompose);
  assert.equal(document.errors.length, 0);
  const before = document.toJS();
  const expected = structuredClone(before);
  const mount = `${mountPath}:${modulePath}:ro`;
  assert.ok(Array.isArray(before.services.api.volumes));
  assert.ok(!before.services.api.volumes.some(value => JSON.stringify(value).includes(modulePath)), 'MCP module already mounted; review current patch');
  document.getIn(['services', 'api', 'volumes'], true).add(mount);
  expected.services.api.volumes.push(mount);
  const candidateCompose = document.toString({ lineWidth: 0 });
  assert.deepEqual(YAML.parse(candidateCompose), expected, 'Compose must differ only by the API MCP source mount');
  fs.writeFileSync(path.join(folder, 'compose-candidate.yaml'), candidateCompose, { mode: 0o600 });
  upload(path.join(folder, 'mcp.py'), `${stage}/mcp.py`);
  upload(path.join(folder, 'compose-candidate.yaml'), `${stage}/compose-candidate.yaml`);
  upload(path.join(projectRoot, 'tests/dify-mcp-session.py'), `${stage}/test.py`);
  ssh(`docker cp ${stage}/mcp-before.py docker-api-1:/tmp/cabinplay-mcp-before.py\ndocker cp ${stage}/mcp.py docker-api-1:/tmp/cabinplay-mcp-after.py\ndocker cp ${stage}/test.py docker-api-1:/tmp/cabinplay-mcp-test.py`);
  const oldTest = spawnSync('ssh', [...args, host,
    'docker exec docker-api-1 /app/api/.venv/bin/python /tmp/cabinplay-mcp-test.py /tmp/cabinplay-mcp-before.py'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(oldTest.status, 1, 'Original controller must reproduce the transaction failure');
  assert.match(oldTest.stderr, /closed transaction/);
  fs.writeFileSync(path.join(folder, 'before-test.txt'), oldTest.stderr, { mode: 0o600 });
  ssh('docker exec docker-api-1 /app/api/.venv/bin/python /tmp/cabinplay-mcp-test.py /tmp/cabinplay-mcp-after.py');
  report.transaction_tests = { original_reproduced: true, patched_passed: true, count: 3 };
  report.original_compose_sha256 = hash(path.join(folder, 'compose-before.yaml'));
  report.original_module_sha256 = hash(path.join(folder, 'mcp-before.py'));
  report.candidate_module_sha256 = hash(path.join(folder, 'mcp.py'));
  save();
  console.log(JSON.stringify({ prepared: true, ...report.transaction_tests, folder, apply }));
  if (!apply) process.exit(0);
  assert.equal(ssh(`sha256sum ${compose}`).split(' ')[0], report.original_compose_sha256, 'Compose changed during preparation');
  assert.equal(ssh(`docker exec docker-api-1 sha256sum ${modulePath}`).split(' ')[0], report.original_module_sha256, 'Controller changed during preparation');
  ssh(`umask 077\nmkdir -p ${backup} /opt/dify/local-patches/mcp-session\ncp ${compose} ${backup}/docker-compose.yaml\ncp ${stage}/mcp-before.py ${backup}/mcp.py\ninstall -m 0644 ${stage}/mcp.py ${mountPath}`);
  assert.equal(ssh(`stat -c %a ${mountPath}`).trim(), '644', 'The non-root API user must be able to read the mounted source');
  ssh(`cp ${stage}/compose-candidate.yaml ${compose}`);
  composeReplaced = true;
  ssh(`docker compose -f ${compose} config --quiet`);
  ssh(`docker compose -f ${compose} up -d --no-deps api`, 0, 90000);
  const deadline = Date.now() + 45000;
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:8081/console/api/system-features', { signal: AbortSignal.timeout(3000) });
      if (response.ok) { healthy = true; break; }
    } catch {}
    await delay(1000);
  }
  assert.ok(healthy, 'Dify API did not become healthy');
  assert.equal(ssh(`docker exec docker-api-1 sha256sum ${modulePath}`).split(' ')[0], report.candidate_module_sha256);
  report.applied = true;
  report.completed_at = new Date().toISOString();
  save();
  console.log(JSON.stringify({ applied: true, report: path.relative(projectRoot, path.join(folder, 'report.json')), backup }));
} catch (error) {
  report.error = error.message;
  if (composeReplaced) {
    try {
      const logs = ssh('docker logs --tail 100 docker-api-1 2>&1');
      fs.writeFileSync(path.join(folder, 'failed-api-startup.txt'), logs, { mode: 0o600 });
    } catch (logError) { report.log_capture_error = logError.message; }
    try {
      ssh(`cp ${backup}/docker-compose.yaml ${compose}\ndocker compose -f ${compose} up -d --no-deps api`, 0, 90000);
      report.rollback = true;
    } catch (rollbackError) { report.rollback_error = rollbackError.message; }
  }
  save();
  throw error;
}
