const { execFile, spawnSync } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const fs = require('node:fs');

const execFileAsync = promisify(execFile);
const DISTRO = 'SquidSketch';

function cleanOutput(value = '') {
  return String(value).replace(/^\uFEFF/, '').replace(/\0/g, '').trim();
}

function decodeOutput(value) {
  if (value === undefined || value === null) return '';
  if (!Buffer.isBuffer(value)) return cleanOutput(value);
  if (!value.length) return '';

  if (value.length >= 2 && value[0] === 0xff && value[1] === 0xfe) {
    return cleanOutput(value.subarray(2).toString('utf16le'));
  }
  if (value.length >= 3 && value[0] === 0xef && value[1] === 0xbb && value[2] === 0xbf) {
    return cleanOutput(value.subarray(3).toString('utf8'));
  }

  // wsl.exe writes its Windows-side status/list output as UTF-16LE without a
  // BOM. Detect the alternating NUL bytes before falling back to UTF-8. Linux
  // commands executed through WSL continue to pass through as normal UTF-8.
  const sampleLength = Math.min(value.length - (value.length % 2), 4096);
  let evenNuls = 0;
  let oddNuls = 0;
  for (let index = 0; index < sampleLength; index += 2) {
    if (value[index] === 0) evenNuls++;
    if (value[index + 1] === 0) oddNuls++;
  }
  const pairs = Math.max(1, sampleLength / 2);
  if (oddNuls / pairs > 0.2 && evenNuls / pairs < 0.08) return cleanOutput(value.toString('utf16le'));
  return cleanOutput(value.toString('utf8'));
}

async function capture(file, args, options = {}) {
  try {
    const result = await execFileAsync(file, args, {
      windowsHide: true,
      timeout: options.timeout || 15_000,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'buffer'
    });
    return { ok: true, stdout: decodeOutput(result.stdout), stderr: decodeOutput(result.stderr) };
  } catch (error) {
    return {
      ok: false,
      stdout: decodeOutput(error.stdout),
      stderr: decodeOutput(error.stderr || error.message),
      code: error.code
    };
  }
}

function isBluetoothDevice(description = '', instanceId = '') {
  return /bluetooth|wireless bluetooth|蓝牙/i.test(`${description} ${instanceId}`);
}

function vidPidFromInstanceId(instanceId = '') {
  const match = instanceId.match(/VID_([0-9a-f]{4}).*PID_([0-9a-f]{4})/i);
  return match ? `${match[1].toLowerCase()}:${match[2].toLowerCase()}` : '';
}

function parseUsbipdState(output) {
  let parsed;
  try { parsed = JSON.parse(cleanOutput(output)); } catch { return []; }
  if (!Array.isArray(parsed?.Devices)) return [];
  return parsed.Devices.flatMap((device) => {
    const busId = typeof device.BusId === 'string' ? device.BusId : '';
    if (!busId) return [];
    const instanceId = typeof device.InstanceId === 'string' ? device.InstanceId : '';
    const description = typeof device.Description === 'string' ? device.Description : 'Unknown USB device';
    const attached = Boolean(device.ClientIPAddress);
    const bound = Boolean(device.PersistedGuid);
    return [{
      busId,
      vidPid: vidPidFromInstanceId(instanceId),
      description,
      state: attached ? 'Attached' : bound ? 'Shared' : 'Not shared',
      likelyBluetooth: isBluetoothDevice(description, instanceId),
      instanceId,
      persistedGuid: device.PersistedGuid || null,
      clientIPAddress: device.ClientIPAddress || null,
      bound,
      attached
    }];
  });
}

// Fallback for usbipd-win 3.x and for installations where `state` is unavailable.
// Both the pre-4.0 (VID:PID column) and current text layouts are accepted.
function parseUsbipdList(output) {
  const structured = parseUsbipdState(output);
  if (structured.length) return structured;
  return cleanOutput(output).split(/\r?\n/).flatMap((line) => {
    const busMatch = line.match(/^\s*(\d+-\d+(?:\.\d+)*)\s+(.+)$/);
    if (!busMatch) return [];
    const stateMatch = busMatch[2].match(/\s{2,}(Not shared|Shared(?: \(forced\))?|Attached|Not attached)\s*$/i);
    if (!stateMatch) return [];
    let description = busMatch[2].slice(0, stateMatch.index).trim();
    const vidPidMatch = description.match(/^([0-9a-f]{4}:[0-9a-f]{4})\s+/i);
    const vidPid = vidPidMatch ? vidPidMatch[1].toLowerCase() : '';
    if (vidPidMatch) description = description.slice(vidPidMatch[0].length).trim();
    const state = stateMatch[1];
    const attached = /^attached$/i.test(state);
    const bound = attached || /^shared/i.test(state);
    return [{
      busId: busMatch[1], vidPid, description, state,
      likelyBluetooth: isBluetoothDevice(description),
      instanceId: '', persistedGuid: null, clientIPAddress: null, bound, attached
    }];
  });
}

class SystemManager {
  constructor({ resourcesPath, userDataPath, emit }) {
    this.resourcesPath = resourcesPath;
    this.userDataPath = userDataPath;
    this.emit = emit;
    this.markerPath = path.join(userDataPath, 'install-state.json');
    this.sessionPath = path.join(userDataPath, 'bluetooth-session.json');
    const existingSession = this.readSession();
    this.sessionBusId = existingSession?.busId || null;
    this.recoveredAtStartup = Boolean(existingSession);
  }

  get scriptRoot() {
    const packaged = path.join(this.resourcesPath, 'scripts');
    return fs.existsSync(packaged) ? packaged : path.join(__dirname, '..', 'scripts');
  }

  readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
  }

  writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }

  readMarker() { return this.readJson(this.markerPath); }
  readSession() { return this.readJson(this.sessionPath); }

  writeSession(device) {
    this.sessionBusId = device.busId;
    this.writeJson(this.sessionPath, {
      schema: 1,
      busId: device.busId,
      instanceId: device.instanceId || '',
      description: device.description || '',
      attachedAt: new Date().toISOString()
    });
  }

  clearSession() {
    this.sessionBusId = null;
    this.recoveredAtStartup = false;
    try { fs.unlinkSync(this.sessionPath); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  trackBoundDevice(device) {
    const marker = this.readMarker() || { schema: 1 };
    const records = Array.isArray(marker.boundBluetoothByApp) ? marker.boundBluetoothByApp : [];
    const withoutDevice = records.filter((record) =>
      device.instanceId ? record.instanceId !== device.instanceId : record.busId !== device.busId);
    marker.boundBluetoothByApp = [...withoutDevice, {
      busId: device.busId,
      instanceId: device.instanceId || '',
      description: device.description || '',
      boundAt: new Date().toISOString()
    }];
    this.writeJson(this.markerPath, marker);
  }

  async getUsbDevices() {
    const state = await capture('usbipd.exe', ['state']);
    if (state.ok) return { ok: true, devices: parseUsbipdState(state.stdout), detail: state.stderr, source: 'state' };
    const list = await capture('usbipd.exe', ['list']);
    return { ok: list.ok, devices: parseUsbipdList(list.stdout), detail: list.stderr || state.stderr, source: 'list' };
  }

  reconcileSession(devices, usbipdAvailable) {
    const record = this.readSession();
    if (!record) return null;
    const device = devices.find((item) =>
      (record.instanceId && item.instanceId === record.instanceId) || item.busId === record.busId);
    if (device?.attached) {
      if (device.busId !== record.busId) this.writeSession(device);
      else this.sessionBusId = device.busId;
      return device.busId;
    }
    // If structured state is available, an absent/non-attached device means Windows
    // already owns it again (for example after reboot or unplugging).
    if (usbipdAvailable) this.clearSession();
    return usbipdAvailable ? null : record.busId;
  }

  async getStatus() {
    const [wslStatus, distros, usb, windows, usbVersion] = await Promise.all([
      capture('wsl.exe', ['--status']),
      capture('wsl.exe', ['--list', '--quiet']),
      this.getUsbDevices(),
      capture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Environment]::OSVersion.Version.ToString()']),
      capture('usbipd.exe', ['--version'])
    ]);

    const distroNames = distros.stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const marker = this.readMarker();
    const attachedBusId = this.reconcileSession(usb.devices, usb.ok && usb.source === 'state');
    return {
      windows: { ok: windows.ok, version: windows.stdout || 'Unknown' },
      wsl: { installed: wslStatus.ok || distros.ok, detail: wslStatus.stdout || wslStatus.stderr },
      distro: { installed: distroNames.some((x) => x.toLowerCase() === DISTRO.toLowerCase()), name: DISTRO },
      usbipd: { installed: usb.ok, version: usbVersion.stdout, devices: usb.devices, detail: usb.detail, source: usb.source },
      bluetooth: {
        attachedBusId,
        candidates: usb.devices.filter((x) => x.likelyBluetooth),
        recoveredSession: Boolean(attachedBusId && this.recoveredAtStartup)
      },
      installMarker: marker,
      restartRequired: Boolean(marker?.restartRequired)
    };
  }

  async runScript(name) {
    const script = path.join(this.scriptRoot, name);
    if (!fs.existsSync(script)) throw new Error(`缺少安装脚本：${script}`);
    const logPath = path.join(this.userDataPath, `${name}-${Date.now()}.log`);
    const childCommand = `& '${script.replace(/'/g, "''")}' -StatePath '${this.markerPath.replace(/'/g, "''")}'; exit $LASTEXITCODE`;
    const encodedCommand = Buffer.from(childCommand, 'utf16le').toString('base64');
    const args = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `& { $p = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-EncodedCommand','${encodedCommand}') -Verb RunAs -Wait -PassThru; exit $p.ExitCode }`
    ];
    this.emit({ phase: 'started', message: name.includes('uninstall') ? '正在清理应用依赖…' : '正在安装应用依赖…', logPath });
    const result = await capture('powershell.exe', args, { timeout: 30 * 60_000 });
    fs.writeFileSync(logPath, [result.stdout, result.stderr].filter(Boolean).join('\n'), 'utf8');
    this.emit({ phase: result.ok ? 'completed' : 'failed', message: result.ok ? '操作已完成' : '操作失败，请查看日志', logPath });
    return { ...result, logPath, status: await this.getStatus() };
  }

  install() { return this.runScript('install-dependencies.ps1'); }
  uninstall() { return this.runScript('uninstall-dependencies.ps1'); }

  async elevateUsbipd(args) {
    for (const arg of args) {
      if (!/^[a-z-]+$|^\d+-\d+(?:\.\d+)*$/i.test(arg)) throw new Error('无效的 USB/IP 参数');
    }
    const joined = args.map((x) => `'${x}'`).join(',');
    return capture('powershell.exe', ['-NoProfile', '-Command',
      `& { $p = Start-Process -FilePath 'usbipd.exe' -ArgumentList @(${joined}) -Verb RunAs -Wait -PassThru; exit $p.ExitCode }`],
      { timeout: 120_000 });
  }

  async attachBluetooth(busId) {
    if (!/^\d+-\d+(?:\.\d+)*$/.test(busId)) throw new Error('蓝牙设备 Bus ID 无效');
    const before = await this.getUsbDevices();
    const device = before.devices.find((item) => item.busId === busId);
    if (!device) throw new Error('所选蓝牙设备已断开，请刷新后重试');
    if (!device.likelyBluetooth) throw new Error('所选 USB 设备不像蓝牙适配器，已阻止接管');
    if (device.attached) throw new Error('该设备已被其他 USB/IP 会话接管，请先归还设备');

    if (!device.bound) {
      this.emit({ phase: 'binding', message: '正在授权蓝牙设备给 WSL…' });
      const bind = await this.elevateUsbipd(['bind', '--busid', busId]);
      if (!bind.ok) throw new Error(bind.stderr || '无法共享蓝牙设备');
      this.trackBoundDevice(device);
    }

    // Keep the distribution alive before attaching, as recommended by usbipd-win.
    await capture('wsl.exe', ['-d', DISTRO, '-u', 'root', '--', 'true']);
    this.emit({ phase: 'attaching', message: '正在把蓝牙临时交给 WSL…' });
    const attach = await capture('usbipd.exe', ['attach', '--wsl', '--busid', busId], { timeout: 120_000 });
    if (!attach.ok) throw new Error(attach.stderr || '蓝牙接管失败');
    this.writeSession(device);
    this.emit({ phase: 'attached', message: '蓝牙已由 WSL 接管', busId });
    return this.getStatus();
  }

  async releaseBluetooth() {
    const record = this.readSession();
    const busId = this.sessionBusId || record?.busId;
    if (!busId) return { ok: true, alreadyReleased: true };

    const usb = await this.getUsbDevices();
    const device = usb.devices.find((item) =>
      (record?.instanceId && item.instanceId === record.instanceId) || item.busId === busId);
    if (usb.ok && !device?.attached) {
      this.clearSession();
      return { ok: true, alreadyReleased: true };
    }

    const currentBusId = device?.busId || busId;
    const result = await capture('usbipd.exe', ['detach', '--busid', currentBusId], { timeout: 30_000 });
    if (result.ok) this.clearSession();
    this.emit({ phase: result.ok ? 'released' : 'failed', message: result.ok ? '蓝牙已归还 Windows' : '蓝牙归还失败', busId: currentBusId });
    return result;
  }

  releaseBluetoothSync() {
    const busId = this.sessionBusId || this.readSession()?.busId;
    if (!busId) return;
    const result = spawnSync('usbipd.exe', ['detach', '--busid', busId], { windowsHide: true, timeout: 15_000 });
    if (result.status === 0) this.clearSession();
  }

  async diagnose() {
    this.emit({ phase: 'diagnosing', message: '正在检查 WSL、USB/IP、BlueZ 与 NXBT…' });
    const status = await this.getStatus();
    const checks = [
      { id: 'windows', label: 'Windows', ok: status.windows.ok, detail: status.windows.version },
      { id: 'wsl', label: 'WSL 2', ok: status.wsl.installed, detail: status.wsl.detail || '未安装' },
      { id: 'distro', label: 'SquidDeck 环境', ok: status.distro.installed, detail: status.distro.installed ? '已安装' : '尚未安装' },
      { id: 'usbipd', label: 'usbipd-win', ok: status.usbipd.installed, detail: status.usbipd.version || status.usbipd.detail || '未安装' },
      { id: 'adapter', label: 'USB 蓝牙适配器', ok: status.bluetooth.candidates.length > 0, detail: status.bluetooth.candidates.map((x) => `${x.description} (${x.busId}, ${x.state})`).join('\n') || '未识别到候选设备' }
    ];

    if (status.distro.installed) {
      const linux = await capture('wsl.exe', ['-d', DISTRO, '-u', 'root', '--', 'bash', '-lc',
        "printf 'KERNEL='; uname -r; printf '\\nSYSTEMD='; systemctl is-system-running 2>/dev/null || true; printf '\\nBLUEZ='; systemctl is-active bluetooth 2>/dev/null || true; printf '\\nCONTROLLER='; bluetoothctl list 2>/dev/null || true; printf '\\nUSB='; lsusb 2>/dev/null || true; printf '\\nNXBT='; /opt/squidsketch/venv/bin/python -c \"import nxbt; print(getattr(nxbt, '__version__', 'installed'))\" 2>&1"],
      { timeout: 30_000 });
      const fields = Object.fromEntries([...linux.stdout.matchAll(/(?:^|\n)([A-Z]+)=([^\n]*)/g)].map((match) => [match[1], match[2].trim()]));
      checks.push(
        { id: 'kernel', label: 'WSL 内核', ok: linux.ok && Boolean(fields.KERNEL), detail: fields.KERNEL || linux.stderr || '无法读取' },
        { id: 'bluez', label: 'BlueZ 服务', ok: fields.BLUEZ === 'active', detail: fields.BLUEZ || '未运行' },
        { id: 'nxbt', label: 'NXBT', ok: Boolean(fields.NXBT) && !/traceback|error|no such/i.test(fields.NXBT), detail: fields.NXBT || '导入失败' },
        { id: 'controller', label: 'Linux 蓝牙控制器', ok: Boolean(fields.CONTROLLER), pending: !status.bluetooth.attachedBusId, detail: fields.CONTROLLER || (status.bluetooth.attachedBusId ? '已接管 USB，但 BlueZ 未发现控制器' : '接管蓝牙后可完成此项检查') },
        { id: 'lsusb', label: 'WSL USB 设备', ok: !status.bluetooth.attachedBusId || Boolean(fields.USB), detail: fields.USB || '当前没有已接管的 USB 设备' }
      );
    }

    const failed = checks.filter((check) => !check.ok && !check.pending).length;
    const report = { generatedAt: new Date().toISOString(), ok: failed === 0, failed, checks, status };
    this.emit({ phase: 'diagnosed', message: failed ? `诊断完成：${failed} 项需要处理` : '诊断通过' });
    return report;
  }
}

module.exports = { SystemManager, DISTRO, capture, decodeOutput, parseUsbipdList, parseUsbipdState, vidPidFromInstanceId };
