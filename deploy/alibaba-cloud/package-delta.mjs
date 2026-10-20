import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [releaseFolder, baseCommit] = process.argv.slice(2);
if (!releaseFolder || !/^[a-f0-9]{40}$/.test(baseCommit || '')) throw new Error('Release folder and verified base commit required');
const folder = path.resolve(releaseFolder);
const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'deployment-manifest.json'), 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');
const delta = folder + '.delta';
fs.mkdirSync(delta, { mode: 0o700 });
const changed = [];
for (const entry of manifest.files) {
  const content = fs.readFileSync(path.join(folder, entry.path));
  if (digest(content) !== entry.sha256) throw new Error('Release file changed after packaging');
  let base;
  try { base = execFileSync('git', ['show', `${baseCommit}:${entry.path}`], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }); }
  catch { base = Buffer.alloc(0); }
  if (digest(base) === entry.sha256) continue;
  const dest = path.join(delta, entry.path);
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  fs.copyFileSync(path.join(folder, entry.path), dest);
  changed.push(entry.path);
}
fs.copyFileSync(path.join(folder, 'deployment-manifest.json'), path.join(delta, 'deployment-manifest.json'));
fs.writeFileSync(path.join(delta, 'delta-source.json'), JSON.stringify({ base_commit: baseCommit,
  repository: 'Yuyue-lgtm/smart-cabin-riddle-demo', changed_files: changed }) + '\n', { mode: 0o600 });
const archive = delta + '.tar.gz';
execFileSync('tar', ['-czf', archive, '-C', delta, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
fs.chmodSync(archive, 0o600);
console.log(JSON.stringify({ archive, sha256: digest(fs.readFileSync(archive)), bytes: fs.statSync(archive).size,
  changed_files: changed.length, reused_files: manifest.files.length - changed.length }, null, 2));
