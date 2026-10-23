import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createEcsConsole, profilesPath, projectRoot } from '../src/ecs-console.mjs';
import { assertSeparateProfiles } from '../src/ecs-release.mjs';

const request = createEcsConsole();
const profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
assertSeparateProfiles(profiles.environments.alibaba, profiles.environments['alibaba-test']);
const folder = path.join(projectRoot, 'tmp/dify-ecs', `${new Date().toISOString().replace(/[:.]/g, '-')}-mcp-labels`);
fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
const report = { apps: [] };
const save = (name, value) => fs.writeFileSync(path.join(folder, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const marker = '[Cabinplay application environment]';

for (const environment of ['alibaba-test', 'alibaba']) {
  const profile = profiles.environments[environment];
  for (const [kind, id] of Object.entries(profile.apps)) {
    const before = await request(`/apps/${id}/server`);
    assert.ok(before.id && before.server_code && before.status === 'active');
    save(`${environment}-${kind}-before.json`, before);
    const original = before.description.split(marker)[0].trimEnd();
    const description = `${original}\n\n${marker}\n${environment === 'alibaba-test' ? '测试' : '正式'}应用；App=${id}；KB=${profile.knowledge.dataset_id}。X-Env=PRODUCTION仅标记共享实例。MCP仅执行本应用，草稿编辑经Console。`;
    assert.ok(description.length <= 255, 'MCP description exceeds the database field limit');
    await request(`/apps/${id}/server`, { method: 'PUT', body: { id: before.id,
      description, parameters: before.parameters, status: before.status } });
    const after = await request(`/apps/${id}/server`);
    assert.equal(after.description, description);
    for (const key of ['id', 'server_code', 'parameters', 'status']) assert.deepEqual(after[key], before[key]);
    save(`${environment}-${kind}-after.json`, after);
    report.apps.push({ environment, kind, app_id: id, description_verified: true, endpoint_and_parameters_unchanged: true });
    save('report.json', report);
    console.log(JSON.stringify(report.apps.at(-1)));
  }
}
report.ok = report.apps.length === 6;
report.completed_at = new Date().toISOString();
save('report.json', report);
console.log(JSON.stringify({ ok: report.ok, report: path.relative(projectRoot, path.join(folder, 'report.json')) }));
