const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const test = require("node:test");

function fixture({ hold = false, controller } = {}) {
  const messages = [];
  const socket = new EventEmitter();
  socket.destroyed = false;
  socket.destroy = () => { socket.destroyed = true; };
  socket.setTimeout = () => {};
  const send = (opcode, payload) => {
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
    const header = data.length < 126 ? Buffer.from([0x80 | opcode, data.length]) : Buffer.from([0x80 | opcode, 126, data.length >> 8, data.length & 255]);
    queueMicrotask(() => { if (!socket.destroyed) socket.emit("data", Buffer.concat([header, data])); });
  };
  socket.write = data => {
    if (typeof data === "string") {
      const key = /Sec-WebSocket-Key: (.+)\r\n/.exec(data)[1];
      const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      queueMicrotask(() => { if (!socket.destroyed) socket.emit("data", Buffer.from(`HTTP/1.1 101 Switching Protocols\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)); });
      return;
    }
    const offset = (data[1] & 127) < 126 ? 2 : 4;
    const mask = data.subarray(offset, offset + 4), body = Buffer.from(data.subarray(offset + 4));
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
    const message = JSON.parse(body.toString());
    messages.push(message);
    if (message.header.action === "run-task") send(1, { header: { event: "task-started" } });
    if (message.header.action === "continue-task") {
      if (hold) queueMicrotask(() => controller.abort());
      else send(2, Buffer.from("ID3fictional-audio"));
    }
    if (message.header.action === "finish-task" && !hold) send(1, { header: { event: "task-finished" } });
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../api/cosyvoice-websocket.cjs"), "utf8"), {
    module, Buffer, URL, setTimeout, clearTimeout,
    require: name => name === "node:tls" ? { connect() { queueMicrotask(() => { if (!socket.destroyed) socket.emit("secureConnect"); }); return socket; } } : require(name),
  });
  return { synthesize: module.exports.synthesizeCosyVoice, socket, messages };
}

test("CosyVoice streams MP3 and sends the selected voice/rate/pitch without returning the credential", async () => {
  const f = fixture(), chunks = [], stages = [];
  const bytes = await f.synthesize({ apiKey: "fixture-key", text: "虚构测试", onAudio: chunk => chunks.push(chunk), onProgress: stage => stages.push(stage) });
  assert.deepEqual(stages, ['connected', 'task_started']);
  assert.equal(Buffer.concat(chunks).toString(), "ID3fictional-audio");
  assert.equal(bytes, Buffer.concat(chunks).length);
  const parameters = f.messages[0].payload.parameters;
  assert.equal(parameters.voice, "longhua_v3");
  assert.equal(parameters.rate, 1);
  assert.equal(parameters.pitch, 1);
  assert.equal(f.socket.destroyed, true);
});

test("an already-cancelled synthesis rejects during the handshake", async () => {
  const controller = new AbortController();
  controller.abort();
  const f = fixture();
  await assert.rejects(f.synthesize({ apiKey: "fixture-key", text: "虚构测试", signal: controller.signal }), /COSYVOICE_REQUEST_ABORTED/);
  assert.equal(f.socket.destroyed, true);
});

test("P0/browser cancellation still closes upstream synthesis after the WebSocket handshake", async () => {
  const controller = new AbortController(), f = fixture({ hold: true, controller });
  await assert.rejects(f.synthesize({ apiKey: "fixture-key", text: "虚构测试", signal: controller.signal }), /COSYVOICE_REQUEST_ABORTED/);
  assert.equal(f.socket.destroyed, true);
});
