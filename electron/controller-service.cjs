const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');
const { DISTRO } = require('./system-manager.cjs');

function windowsToWsl(input) {
  const normalized = path.resolve(input).replace(/\\/g, '/');
  const drive = normalized.match(/^([A-Za-z]):\/(.*)$/);
  return drive ? `/mnt/${drive[1].toLowerCase()}/${drive[2]}` : normalized;
}

class ControllerService {
  constructor({ resourcesPath, emit }) {
    this.resourcesPath = resourcesPath;
    this.emit = emit;
    this.process = null;
    this.ready = false;
  }

  get backendPath() {
    const packaged = path.join(this.resourcesPath, 'backend', 'squid_bridge.py');
    return fs.existsSync(packaged) ? packaged : path.join(__dirname, '..', 'backend', 'squid_bridge.py');
  }

  async connect(options = {}) {
    if (this.process) return { ok: true, alreadyRunning: true };
    const args = ['-d', DISTRO, '-u', 'root', '--', '/opt/squidsketch/venv/bin/python', windowsToWsl(this.backendPath)];
    if (options.reconnect !== false) args.push('--reconnect');
    this.process = spawn('wsl.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.ready = false;
    this.process.stdout.setEncoding('utf8');
    this.process.stderr.setEncoding('utf8');

    const lines = readline.createInterface({ input: this.process.stdout });
    lines.on('line', (line) => {
      try {
        const event = JSON.parse(line);
        if (event.type === 'connected') this.ready = true;
        this.emit(event);
      } catch {
        this.emit({ type: 'log', level: 'info', message: line });
      }
    });
    this.process.stderr.on('data', (data) => this.emit({ type: 'log', level: 'error', message: data.trim() }));
    this.process.on('error', (error) => this.emit({ type: 'error', message: error.message }));
    this.process.on('exit', (code) => {
      this.emit({ type: 'disconnected', code });
      this.process = null;
      this.ready = false;
    });
    this.emit({ type: 'connecting', message: '正在创建虚拟 Pro Controller…' });
    return { ok: true };
  }

  send(payload) {
    if (!this.process?.stdin?.writable) return false;
    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
    return true;
  }

  sendQueued(payload) {
    if (!this.process?.stdin?.writable) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.process.stdin.write(`${JSON.stringify(payload)}\n`, (error) => resolve(!error));
    });
  }

  button(button, pressed) { return this.send({ type: 'button', button, pressed }); }
  stick(stick, x, y) { return this.send({ type: 'stick', stick, x, y }); }
  macro(macro, metadata) { return this.sendQueued({ type: 'macro', macro, metadata }); }
  stopMacro() { return this.send({ type: 'stop_macro' }); }

  async disconnect() {
    if (!this.process) return { ok: true, alreadyStopped: true };
    this.send({ type: 'shutdown' });
    const child = this.process;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve({ ok: true, forced: true }); }, 4_000);
      child.once('exit', () => { clearTimeout(timer); resolve({ ok: true }); });
    });
  }

  disconnectSync() {
    if (this.process) this.process.kill();
    this.process = null;
  }
}

module.exports = { ControllerService, windowsToWsl };
