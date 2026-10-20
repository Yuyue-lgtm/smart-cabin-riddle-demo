import { createEcsConsole, probeEcs } from './dify-workflow-mcp/src/ecs-console.mjs';
import { loginEcs } from './dify-workflow-mcp/src/ecs-login.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot, profilesPath } from './dify-workflow-mcp/src/ecs-console.mjs';

const [command = 'help', ...args] = process.argv.slice(2);
try {
  if (command === 'tunnel') {
    const { runTunnelCommand } = await import('./dify-workflow-mcp/src/ecs-tunnel.mjs');
    console.log(JSON.stringify(await runTunnelCommand(args[0], args.slice(1)), null, 2));
  } else if (command === 'doctor') {
    const { diagnoseEcs } = await import('./dify-workflow-mcp/src/ecs-doctor.mjs');
    const report = await diagnoseEcs();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } else if (command === 'smoke') {
    await probeEcs();
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, ['deploy/alibaba-cloud/verify-live.cjs', 'http://127.0.0.1:4175', '--test'], {
      cwd: projectRoot, encoding: 'utf8', timeout: 600000,
    });
    const file = path.join(projectRoot, 'tmp/dify-ecs/smoke-latest.json');
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, result.stdout || '{}', { mode: 0o600 });
    process.stdout.write(result.stdout || 'SMOKE_TEST_FAILED\n');
    if (result.status !== 0) process.exitCode = 1;
  } else if (command === 'login') {
    await loginEcs();
    console.log('ECS_CONSOLE_CONNECTED');
  } else if (command === 'verify') {
    const profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
    const folder = args[0] ? path.resolve(args[0]) : path.join(projectRoot, 'dify', profiles.latest_verified_ecs_snapshot || '');
    if (!folder.startsWith(path.join(projectRoot, 'dify/releases/'))) throw new Error('Select a version under dify/releases');
    const { verifyReleaseFolder } = await import('./dify-workflow-mcp/src/ecs-release.mjs');
    console.log(JSON.stringify(verifyReleaseFolder(folder)));
  } else if (command === 'help') {
    console.log('node tools/dify.mjs tunnel install|start|restart|stop|status | doctor | smoke | login | status | setup | test | release [--publish] | dev | verify [version-folder]');
  } else {
    await probeEcs();
    const { runCommand } = await import('./dify-workflow-mcp/src/ecs-project.mjs');
    await runCommand(command, args, createEcsConsole());
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
