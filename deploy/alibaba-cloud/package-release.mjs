import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const selected = ['index.html', 'client-app.js', 'styles.css', 'release-info.json', 'dev-server.cjs'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
function collect(folder) {
  for (const item of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const name = path.posix.join(folder, item.name);
    if (item.isSymbolicLink()) throw new Error(`Refusing symlink: ${name}`);
    if (item.isDirectory()) collect(name);
    else if (item.isFile() && (folder.startsWith('assets') || name.endsWith('.js') || name.endsWith('.cjs'))) selected.push(name);
  }
}
collect('api');
collect('assets');
selected.sort();
const files = selected.map(name => {
  const content = fs.readFileSync(path.join(root, name));
  return { path: name, bytes: content.length, sha256: sha256(content) };
});
const digest = sha256(JSON.stringify(files));
const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${digest.slice(0, 12)}`;
const directory = path.join(root, 'tmp/alibaba-cloud/releases', id);
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
fs.chmodSync(directory, 0o755);
for (const file of files) {
  const destination = path.join(directory, file.path);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
  fs.copyFileSync(path.join(root, file.path), destination);
  fs.chmodSync(destination, 0o644);
}
const manifest = {
  release_id: id, built_at: new Date().toISOString(), source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  working_tree_dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  content_sha256: digest, file_count: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), files,
};
fs.writeFileSync(path.join(directory, 'deployment-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o644 });
const archive = directory + '.tar.gz';
execFileSync('tar', ['-czf', archive, '-C', directory, '.'], {
  env: { ...process.env, LANG: 'C', LC_ALL: 'C', COPYFILE_DISABLE: '1' },
});
fs.chmodSync(archive, 0o600);
console.log(JSON.stringify({ archive: path.relative(root, archive), release_id: id, file_count: files.length,
  bytes: manifest.bytes, archive_sha256: sha256(fs.readFileSync(archive)), source_commit: manifest.source_commit,
  working_tree_dirty: manifest.working_tree_dirty }, null, 2));
