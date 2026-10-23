import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEcsConsole, profilesPath, projectRoot } from '../src/ecs-console.mjs';
import { assertSeparateProfiles, describeDiff, fingerprint, saveDraft, workflowContent } from '../src/ecs-release.mjs';

const request = createEcsConsole();
const profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
assertSeparateProfiles(profiles.environments.alibaba, profiles.environments['alibaba-test']);
const folder = path.join(projectRoot, 'tmp/dify-ecs', `${new Date().toISOString().replace(/[:.]/g, '-')}-access-audit`);
fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
const save = (name, data) => fs.writeFileSync(path.join(folder, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
const report = { started_at: new Date().toISOString(), method: 'temporary_start_node_description_then_restore',
  app_publication_requested: false, ok: false, apps: [] };
save('report.json', report);

for (const environment of ['alibaba-test', 'alibaba']) {
  for (const [kind, id] of Object.entries(profiles.environments[environment].apps)) {
    const label = `${environment}-${kind}`;
    const row = { environment, kind, app_id: id, read: false, write: false, readback: false, restored: false,
      published_unchanged: false };
    report.apps.push(row);
    let original, published, marked;
    try {
      const info = await request(`/apps/${id}`);
      original = await request(`/apps/${id}/workflows/draft`);
      published = await request(`/apps/${id}/workflows/publish`);
      save(`${label}-before.json`, { info, draft: original, published });
      Object.assign(row, { name: info.name, read: true, draft_hash_before: original.hash,
        published_hash_before: published.hash,
        unpublished_changes: describeDiff(workflowContent(published), workflowContent(original)),
        knowledge_bindings: original.graph.nodes.filter(node => node.data.type === 'knowledge-retrieval')
          .map(node => ({ node_id: node.id, dataset_ids: node.data.dataset_ids })) });
      for (const binding of row.knowledge_bindings) {
        assert.deepEqual(binding.dataset_ids, [profiles.environments[environment].knowledge.dataset_id]);
      }
      marked = workflowContent(original);
      const start = marked.graph.nodes.find(node => node.data.type === 'start');
      assert.ok(start, 'Start node missing');
      start.data.desc = `${start.data.desc || ''}\n[codex-write-probe:${randomUUID()}]`;
      const written = await saveDraft(request, id, marked, original);
      row.write = true;
      row.readback = fingerprint(workflowContent(written)) === fingerprint(marked);
      row.probe_hash = written.hash;
      save(`${label}-probe.json`, written);
    } catch (error) {
      row.error = error.message;
    } finally {
      if (original && marked) {
        try {
          const current = await request(`/apps/${id}/workflows/draft`);
          const content = workflowContent(current);
          if (fingerprint(content) === fingerprint(marked)) {
            await saveDraft(request, id, workflowContent(original), current);
          } else {
            assert.equal(fingerprint(content), fingerprint(workflowContent(original)),
              'Concurrent draft change detected; stopped without overwriting it');
          }
          const restored = await request(`/apps/${id}/workflows/draft`);
          row.restored = fingerprint(workflowContent(restored)) === fingerprint(workflowContent(original));
          row.draft_hash_after = restored.hash;
          const afterPublished = await request(`/apps/${id}/workflows/publish`);
          row.published_unchanged = afterPublished.hash === published.hash
            && fingerprint(workflowContent(afterPublished)) === fingerprint(workflowContent(published));
          save(`${label}-after.json`, { draft: restored, published: afterPublished });
        } catch (error) {
          row.restore_error = error.message;
        }
      }
      save('report.json', report);
      console.log(JSON.stringify(row));
    }
    if (!row.restored && original && marked) throw new Error(`Restore requires attention: ${label}; ${folder}`);
  }
}
report.ok = report.apps.length === 6 && report.apps.every(row => row.read && row.write && row.readback
  && row.restored && row.published_unchanged && !row.error && !row.restore_error);
report.completed_at = new Date().toISOString();
save('report.json', report);
console.log(JSON.stringify({ ok: report.ok, report: path.relative(projectRoot, path.join(folder, 'report.json')) }));
if (!report.ok) process.exitCode = 1;
