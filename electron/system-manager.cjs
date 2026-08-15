const { execFile, spawnSync } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const execFileAsync = promisify(execFile);
const DISTRO = 'SplatoonDeck';

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
      windowsHide: options.windowsHide ?? true,
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

function isWslUnavailable(detail = '') {
  return /not enabled|is disabled|cannot start|not supported with your current|未启用|无法启动|当前计算机配置不支持|有効になっていません|無効になっています|起動できません|現在のコンピューター構成ではサポートされていません/i.test(detail);
}

function restartStillPending(marker, markerModifiedAt, bootedAt) {
  if (!marker?.restartRequired) return false;
  if (!Number.isFinite(markerModifiedAt) || !Number.isFinite(bootedAt)) return true;
  return bootedAt <= markerModifiedAt;
}

function hasInstalledEnvironment(marker) {
  return Boolean(marker?.lifecycle === 'installed' && marker?.completed !== false);
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

  get usbipdExecutable() {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const installed = path.join(programFiles, 'usbipd-win', 'usbipd.exe');
    return fs.existsSync(installed) ? installed : 'usbipd.exe';
  }

  get setupHelperExecutable() {
    const packaged = path.join(this.resourcesPath, 'native', 'SplatoonDeck.Setup.exe');
    return fs.existsSync(packaged) ? packaged : path.join(__dirname, '..', 'native', 'bin', 'SplatoonDeck.Setup.exe');
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

  reconcileRestartMarker() {
    const marker = this.readMarker();
    if (!marker?.restartRequired) return marker;
    let markerModifiedAt;
    try { markerModifiedAt = fs.statSync(this.markerPath).mtimeMs; } catch { return marker; }
    const bootedAt = Date.now() - (os.uptime() * 1000);
    if (restartStillPending(marker, markerModifiedAt, bootedAt)) return marker;
    if (marker.restartReason === 'uninstall' || marker.lifecycle === 'uninstalled') {
      try { fs.unlinkSync(this.markerPath); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      return null;
    }
    marker.restartRequired = false;
    marker.restartReason = null;
    marker.restartCompletedAt = new Date().toISOString();
    this.writeJson(this.markerPath, marker);
    return marker;
  }

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
    const state = await capture(this.usbipdExecutable, ['state']);
    if (state.ok) return { ok: true, devices: parseUsbipdState(state.stdout), detail: state.stderr, source: 'state' };
    const list = await capture(this.usbipdExecutable, ['list']);
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
    // An unavailable usbipd installation cannot own an attached device. Clear stale
    // sessions after dependency removal instead of showing a phantom connection.
    this.clearSession();
    return null;
  }

  async getStatus({ probeWsl = false } = {}) {
    const marker = this.reconcileRestartMarker();
    const environmentInstalled = hasInstalledEnvironment(marker);
    const skippedWslProbe = Promise.resolve({ ok: false, stdout: '', stderr: '' });
    const [wslStatus, distros, usb, usbVersion] = await Promise.all([
      probeWsl ? capture('wsl.exe', ['--status']) : skippedWslProbe,
      probeWsl ? capture('wsl.exe', ['--list', '--quiet']) : skippedWslProbe,
      this.getUsbDevices(),
      capture(this.usbipdExecutable, ['--version'])
    ]);

    const distroNames = distros.stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const attachedBusId = this.reconcileSession(usb.devices, usb.ok && usb.source === 'state');
    const wslDetail = wslStatus.stdout || wslStatus.stderr;
    const probedWslInstalled = Boolean((wslStatus.ok || distros.ok) && !isWslUnavailable(wslDetail));
    const probedDistroInstalled = distroNames.some((x) => x.toLowerCase() === DISTRO.toLowerCase());
    return {
      windows: { ok: true, version: os.release() },
      wsl: { installed: probeWsl ? probedWslInstalled : environmentInstalled, detail: wslDetail },
      distro: { installed: probeWsl ? probedDistroInstalled : environmentInstalled, name: DISTRO },
      usbipd: { installed: usb.ok, version: usbVersion.stdout, devices: usb.devices, detail: usb.detail, source: usb.source },
      bluetooth: {
        attachedBusId,
        candidates: usb.devices.filter((x) => x.likelyBluetooth),
        recoveredSession: Boolean(attachedBusId && this.recoveredAtStartup)
      },
      installMarker: marker,
      restartRequired: Boolean(marker?.restartRequired),
      restartReason: marker?.restartRequired ? (marker.restartReason || 'install') : null
    };
  }

  async runSetupAction(action) {
    const helper = this.setupHelperExecutable;
    if (!fs.existsSync(helper)) throw new Error(`缺少安装辅助程序：${helper}`);
    const logPath = path.join(this.userDataPath, `${action}-dependencies-${Date.now()}.log`);
    const linuxSetup = path.join(this.scriptRoot, 'linux-setup.sh');
    fs.mkdirSync(this.userDataPath, { recursive: true });
    const args = [
      action,
      '--state', this.markerPath,
      '--session', this.sessionPath,
      '--linux-setup', linuxSetup,
      '--log', logPath
    ];
    this.emit({ phase: 'started', message: action === 'uninstall' ? '正在清理应用依赖…' : '正在安装应用依赖…', logPath });
    const result = await capture(helper, args, { timeout: 30 * 60_000, windowsHide: false });
    const outerDetail = [result.stdout, result.stderr].filter(Boolean).join('\n');
    if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, outerDetail, 'utf8');
    else if (outerDetail) fs.appendFileSync(logPath, `\n${outerDetail}\n`, 'utf8');
    if (result.ok && action === 'uninstall') this.clearSession();
    this.emit({ phase: result.ok ? 'completed' : 'failed', message: result.ok ? '操作已完成' : '操作失败，请查看日志', logPath });
    return { ...result, logPath, status: await this.getStatus() };
  }

  install() { return this.runSetupAction('install'); }
  uninstall() { return this.runSetupAction('uninstall'); }

  async elevateUsbipd(args) {
    for (const arg of args) {
      if (!/^[a-z-]+$|^\d+-\d+(?:\.\d+)*$/i.test(arg)) throw new Error('无效的 USB/IP 参数');
    }
    const helper = this.setupHelperExecutable;
    if (!fs.existsSync(helper)) throw new Error(`缺少安装辅助程序：${helper}`);
    const logPath = path.join(this.userDataPath, `usbipd-${Date.now()}.log`);
    const encodedArgs = Buffer.from(JSON.stringify(args), 'utf8').toString('base64');
    return capture(helper, [
      'usbipd', '--state', this.markerPath, '--session', this.sessionPath,
      '--log', logPath, '--usbipd', this.usbipdExecutable, '--usbipd-args', encodedArgs
    ], { timeout: 120_000, windowsHide: false });
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
    const attach = await capture(this.usbipdExecutable, ['attach', '--wsl', '--busid', busId], { timeout: 120_000 });
    if (!attach.ok) throw new Error(attach.stderr || '蓝牙接管失败');
    this.writeSession(device);
    this.emit({ phase: 'attached', message: '蓝牙已由 WSL 接管', busId });
    return this.getStatus({ probeWsl: true });
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
    const result = await capture(this.usbipdExecutable, ['detach', '--busid', currentBusId], { timeout: 30_000 });
    if (result.ok) this.clearSession();
    this.emit({ phase: result.ok ? 'released' : 'failed', message: result.ok ? '蓝牙已归还 Windows' : '蓝牙归还失败', busId: currentBusId });
    return result;
  }

  releaseBluetoothSync() {
    const busId = this.sessionBusId || this.readSession()?.busId;
    if (!busId) return;
    const result = spawnSync(this.usbipdExecutable, ['detach', '--busid', busId], { windowsHide: true, timeout: 15_000 });
    if (result.status === 0) this.clearSession();
  }

  async diagnose() {
    this.emit({ phase: 'diagnosing', message: '正在检查 WSL、USB/IP、BlueZ 与 NXBT…' });
    const status = await this.getStatus({ probeWsl: true });
    const checks = [
      { id: 'windows', label: 'Windows', ok: status.windows.ok, detail: status.windows.version },
      { id: 'wsl', label: 'WSL 2', ok: status.wsl.installed, detail: status.wsl.detail || '未安装' },
      { id: 'distro', label: 'SplatoonDeck 环境', ok: status.distro.installed, detail: status.distro.installed ? '已安装' : '尚未安装' },
      { id: 'usbipd', label: 'usbipd-win', ok: status.usbipd.installed, detail: status.usbipd.version || status.usbipd.detail || '未安装' },
      { id: 'adapter', label: 'USB 蓝牙适配器', ok: status.bluetooth.candidates.length > 0, detail: status.bluetooth.candidates.map((x) => `${x.description} (${x.busId}, ${x.state})`).join('\n') || '未识别到候选设备' }
    ];

    if (status.distro.installed) {
      const base = ['-d', DISTRO, '-u', 'root', '--'];
      const attached = Boolean(status.bluetooth.attachedBusId);
      const skipped = { ok: true, stdout: '', stderr: '' };
      const [kernel, bluez, nxbt, controller, usb] = await Promise.all([
        capture('wsl.exe', [...base, 'uname', '-r'], { timeout: 10_000 }),
        capture('wsl.exe', [...base, 'systemctl', 'is-active', 'bluetooth.service'], { timeout: 10_000 }),
        capture('wsl.exe', [...base, '/opt/splatoondeck/venv/bin/python', '-c', "import nxbt; print(getattr(nxbt, '__version__', 'installed'))"], { timeout: 10_000 }),
        attached ? capture('wsl.exe', [...base, 'bluetoothctl', 'list'], { timeout: 10_000 }) : skipped,
        attached ? capture('wsl.exe', [...base, 'lsusb'], { timeout: 10_000 }) : skipped
      ]);
      checks.push(
        { id: 'kernel', label: 'WSL 内核', ok: kernel.ok && Boolean(kernel.stdout), detail: kernel.stdout || kernel.stderr || '无法读取' },
        { id: 'bluez', label: 'BlueZ 服务', ok: bluez.stdout === 'active', pending: !attached, detail: bluez.stdout || bluez.stderr || (attached ? '未运行' : '接管蓝牙后可完成此项检查') },
        { id: 'nxbt', label: 'NXBT', ok: nxbt.ok && Boolean(nxbt.stdout) && !/traceback|error|no such/i.test(nxbt.stdout), detail: nxbt.stdout || nxbt.stderr || '导入失败' },
        { id: 'controller', label: 'Linux 蓝牙控制器', ok: controller.ok && Boolean(controller.stdout), pending: !attached, detail: controller.stdout || controller.stderr || (attached ? '已接管 USB，但 BlueZ 未发现控制器' : '接管蓝牙后可完成此项检查') },
        { id: 'lsusb', label: 'WSL USB 设备', ok: !attached || (usb.ok && Boolean(usb.stdout)), detail: usb.stdout || usb.stderr || '当前没有已接管的 USB 设备' }
      );
    }

    const failed = checks.filter((check) => !check.ok && !check.pending).length;
    const report = { generatedAt: new Date().toISOString(), ok: failed === 0, failed, checks, status };
    this.emit({ phase: 'diagnosed', message: failed ? `诊断完成：${failed} 项需要处理` : '诊断通过' });
    return report;
  }
}

module.exports = { SystemManager, DISTRO, capture, decodeOutput, hasInstalledEnvironment, isWslUnavailable, parseUsbipdList, parseUsbipdState, restartStillPending, vidPidFromInstanceId };
