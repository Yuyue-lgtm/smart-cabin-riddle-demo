const tls = require("node:tls");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 45_000;

class CosyVoiceSocket extends EventEmitter {
  constructor(url, apiKey, signal, onAudio) {
    super();
    this.url = new URL(url);
    this.apiKey = apiKey;
    this.signal = signal;
    this.onAudio = onAudio;
    this.buffer = Buffer.alloc(0);
    this.handshaken = false;
    this.fragments = [];
    this.audio = [];
    this.audioBytes = 0;
    this.taskId = crypto.randomUUID();
    this.failed = null;
    this.socket = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString("base64");
      const expectedAccept = crypto.createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
      const port = Number(this.url.port || 443);
      this.socket = tls.connect({ host: this.url.hostname, port, servername: this.url.hostname });
      const fail = error => {
        if (!this.handshaken) reject(error);
        this.fail(error);
      };
      this.socket.once("error", fail);
      this.socket.on("data", chunk => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (!this.handshaken) {
          const boundary = this.buffer.indexOf("\r\n\r\n");
          if (boundary < 0) return;
          const header = this.buffer.subarray(0, boundary).toString("latin1");
          this.buffer = this.buffer.subarray(boundary + 4);
          const status = /^HTTP\/1\.[01] (\d+)/.exec(header)?.[1];
          const accept = /^sec-websocket-accept:\s*(.+)$/im.exec(header)?.[1]?.trim();
          if (status !== "101" || accept !== expectedAccept) {
            fail(new Error(`COSYVOICE_WS_HANDSHAKE_${status || "INVALID"}`));
            this.socket.destroy();
            return;
          }
          this.handshaken = true;
          this.socket.removeListener("error", fail);
          this.socket.on("error", error => this.fail(error));
          resolve();
          this.consumeFrames();
          return;
        }
        this.consumeFrames();
      });
      this.socket.once("secureConnect", () => {
        const path = `${this.url.pathname}${this.url.search}`;
        this.socket.write([
          `GET ${path} HTTP/1.1`, `Host: ${this.url.host}`, "Upgrade: websocket", "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`, "Sec-WebSocket-Version: 13", `Authorization: Bearer ${this.apiKey}`,
          "\r\n",
        ].join("\r\n"));
      });
      this.abortHandler = () => {
        fail(new Error("COSYVOICE_REQUEST_ABORTED"));
      };
      if (this.signal?.aborted) this.abortHandler();
      else this.signal?.addEventListener("abort", this.abortHandler, { once: true });
      this.socket.setTimeout(DEFAULT_TIMEOUT_MS, () => {
        fail(new Error("COSYVOICE_WS_TIMEOUT"));
      });
    });
  }

  sendJson(value) {
    this.sendFrame(0x1, Buffer.from(JSON.stringify(value)));
  }

  sendFrame(opcode, payload) {
    const mask = crypto.randomBytes(4);
    let header;
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
    } else if (payload.length <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i] ^ mask[i % 4];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  consumeFrames() {
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const longLength = this.buffer.readBigUInt64BE(2);
        if (longLength > BigInt(MAX_AUDIO_BYTES)) return this.fail(new Error("COSYVOICE_AUDIO_TOO_LARGE"));
        length = Number(longLength);
        offset = 10;
      }
      const masked = Boolean(second & 0x80);
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;
      let payload = this.buffer.subarray(offset, offset + length);
      if (masked) {
        const mask = this.buffer.subarray(offset - 4, offset);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      }
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode === 0x8) {
        this.socket.end();
        return;
      }
      if (opcode === 0x9) {
        this.sendFrame(0xA, payload);
        continue;
      }
      if (opcode === 0x2) {
        this.audioBytes += payload.length;
        if (this.audioBytes > MAX_AUDIO_BYTES) return this.fail(new Error("COSYVOICE_AUDIO_TOO_LARGE"));
        if (this.onAudio) {
          try { this.onAudio(payload); } catch (error) { return this.fail(error); }
        } else this.audio.push(payload);
        continue;
      }
      if (opcode === 0x1 || opcode === 0x0) {
        this.fragments.push(payload);
        if (first & 0x80) {
          const message = Buffer.concat(this.fragments).toString("utf8");
          this.fragments = [];
          this.handleMessage(message);
        }
      }
    }
  }

  handleMessage(message) {
    let event;
    try { event = JSON.parse(message); } catch { return this.fail(new Error("COSYVOICE_INVALID_EVENT")); }
    const name = event?.header?.event;
    if (name === "task-failed") {
      const code = String(event.header.error_code || "UNKNOWN").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
      return this.fail(new Error(`COSYVOICE_TASK_FAILED_${code}`));
    }
    this.emit(name, event);
  }

  waitFor(name) {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`COSYVOICE_WAIT_${name}_TIMEOUT`)), DEFAULT_TIMEOUT_MS);
      this.once(name, value => { clearTimeout(timer); resolve(value); });
      this.once("failed", error => { clearTimeout(timer); reject(error); });
    });
  }

  fail(error) {
    if (this.failed) return;
    this.failed = error;
    this.emit("failed", error);
    this.socket?.destroy();
  }

  close() {
    this.signal?.removeEventListener("abort", this.abortHandler);
    this.socket?.destroy();
  }
}

async function synthesizeCosyVoice({ apiKey, text, baseUrl = "https://dashscope-intl.aliyuncs.com", model = "cosyvoice-v3-flash", voice = "longhua_v3", signal, onAudio, onProgress }) {
  const wsBase = baseUrl.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:").replace(/\/+$/, "");
  const client = new CosyVoiceSocket(`${wsBase}/api-ws/v1/inference`, apiKey, signal, onAudio);
  try {
    await client.connect();
    onProgress?.("connected");
    const taskId = client.taskId;
    const taskStarted = client.waitFor("task-started");
    client.sendJson({
      header: { action: "run-task", task_id: taskId, streaming: "duplex" },
      payload: {
        task_group: "audio", task: "tts", function: "SpeechSynthesizer", model,
        input: {},
        parameters: { text_type: "PlainText", voice, format: "mp3", sample_rate: 24000, volume: 50, rate: 1, pitch: 1 },
      },
    });
    await taskStarted;
    onProgress?.("task_started");
    const taskFinished = client.waitFor("task-finished");
    client.sendJson({ header: { action: "continue-task", task_id: taskId, streaming: "duplex" }, payload: { input: { text } } });
    client.sendJson({ header: { action: "finish-task", task_id: taskId, streaming: "duplex" }, payload: { input: {} } });
    await taskFinished;
    if (!client.audioBytes) throw new Error("COSYVOICE_NO_AUDIO");
    return onAudio ? client.audioBytes : Buffer.concat(client.audio, client.audioBytes);
  } finally {
    client.close();
  }
}

module.exports = { synthesizeCosyVoice };
