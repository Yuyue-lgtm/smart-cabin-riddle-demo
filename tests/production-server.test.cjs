const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const http = require("node:http");

test("production server protects private files and diagnostics while serving page, media ranges and bounded API bodies", async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "cabin-production-"));
  const root = path.resolve(__dirname, "..");
  fs.copyFileSync(path.join(root, "dev-server.cjs"), path.join(folder, "dev-server.cjs"));
  fs.cpSync(path.join(root, "api"), path.join(folder, "api"), { recursive: true });
  fs.mkdirSync(path.join(folder, "assets"));
  fs.writeFileSync(path.join(folder, "index.html"), "<title>Public page</title>");
  fs.writeFileSync(path.join(folder, "client-app.js"), "// public script\n");
  fs.writeFileSync(path.join(folder, "release-info.json"), '{"release":"test-release"}');
  fs.writeFileSync(path.join(folder, ".env.local"), "RUNTIME_ENV=production\nDIFY_CHATFLOW_API_KEY=private-fixture-token\n", { mode: 0o600 });
  fs.writeFileSync(path.join(folder, "assets/music.m4a"), "0123456789");
  fs.symlinkSync(path.join(folder, ".env.local"), path.join(folder, "assets/leak.json"));
  const child = spawn(process.execPath, [path.join(folder, "dev-server.cjs")], {
    env: { PATH: process.env.PATH, PORT: "0", HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    fs.rmSync(folder, { recursive: true, force: true });
  });
  let serverOutput = "";
  let serverError = "";
  child.stderr.on("data", chunk => { serverError += chunk; });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${serverError}`)), 5000);
    child.stdout.on("data", chunk => {
      serverOutput += chunk;
      const match = /running at (http:\/\/127\.0\.0\.1:\d+)/.exec(serverOutput);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Server exited (${code}): ${serverError}`)); });
  });
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(url + "/client-app.js?version=test")).status, 200);
  const health = await (await fetch(url + "/api/health")).json();
  assert.equal(health.runtime, "production");
  assert.equal(health.host_voice_configured, false);
  const unconfiguredVoice = await fetch(url + "/api/tts", { method: "POST", body: JSON.stringify({ text: "虚构语音测试" }) });
  assert.equal(unconfiguredVoice.status, 503);
  assert.equal((await unconfiguredVoice.json()).error, "TTS_NOT_CONFIGURED");
  assert.doesNotMatch(JSON.stringify(health), /private-fixture-token/);
  for (const file of ["/.env.local", "/%2eenv.local", "/.git/config", "/api/dify-bff.js",
    "/dev-server.cjs", "/api/cosyvoice-websocket.cjs", "/tools/config.json", "/assets/leak.json", "/tmp/workflow-diagnostics.ndjson"]) {
    assert.equal((await fetch(url + file)).status, 404, file);
  }
  assert.equal((await fetch(url + "/api/client-diagnostic", { method: "POST", body: "{}" })).status, 404);
  for (const type of ["host_voice", "workflow_failure", "client_error", "page_state", "player_submission"]) {
    const logged = await fetch(url + "/api/client-diagnostic", { method:"POST", body:JSON.stringify({
      type, stage:type === "client_error" ? "script_error" : type === "page_state" ? "layout_recovered" : type === "player_submission" ? "queued" : "failed",
      reason:type === "host_voice" ? "browser_blocked" : "round_mismatch",
      source:"client-app.js", line:1117, root_width:800, root_height:454,
      speech_text:"private-voice-marker", error_message:"private-error-marker",
    }) });
    assert.equal(logged.status, 202);
  }
  const diagnosticRows = fs.readFileSync(path.join(folder,"tmp/workflow-diagnostics.ndjson"),"utf8");
  assert.match(diagnosticRows, /browser_blocked/);
  assert.match(diagnosticRows, /round_mismatch/);
  assert.match(diagnosticRows, /script_error/);
  assert.match(diagnosticRows, /layout_recovered/);
  assert.match(diagnosticRows, /player_submission/);
  assert.doesNotMatch(diagnosticRows, /private-voice-marker|private-error-marker/);
  assert.equal((await fetch(url + "/tmp/workflow-diagnostics.ndjson")).status, 404);
  const media = await fetch(url + "/assets/music.m4a", { headers: { Range: "bytes=2-4" } });
  assert.equal(media.status, 206);
  assert.equal(media.headers.get("content-type"), "audio/mp4");
  assert.equal(media.headers.get("content-range"), "bytes 2-4/10");
  assert.equal(await media.text(), "234");
  assert.equal((await fetch(url + "/assets/music.m4a", { headers: { Range: "bytes=-0" } })).status, 416);
  const head = await fetch(url + "/assets/music.m4a", { method: "HEAD" });
  assert.equal(head.headers.get("content-length"), "10");
  assert.equal(await head.text(), "");
  const bytes = Buffer.from(JSON.stringify({ route: "situation", input_payload: { trigger_type: "event",
    event: { id: "event-test", type: "未支持的事件" }, player_input: "private-question-marker",
    game: { current_answer: "private-answer-marker" } } }));
  const cut = bytes.indexOf(Buffer.from("未")) + 1;
  const splitResponse = await new Promise((resolve, reject) => {
    const request = http.request(url + "/api/workflow", { method: "POST", headers: { "Content-Type": "application/json" } }, response => {
      let text = "";
      response.on("data", chunk => { text += chunk; });
      response.on("end", () => resolve(JSON.parse(text)));
    });
    request.on("error", reject);
    request.write(bytes.subarray(0, cut));
    setTimeout(() => request.end(bytes.subarray(cut)), 15);
  });
  assert.equal(splitResponse.event_type, "未支持的事件");
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.doesNotMatch(serverOutput, /private-fixture-token|private-question-marker|private-answer-marker/);
  const oversized = await fetch(url + "/api/workflow", { method: "POST", body: "x".repeat(2 * 1024 * 1024 + 1) });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error, "REQUEST_TOO_LARGE");
});
