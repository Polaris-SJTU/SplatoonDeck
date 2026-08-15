const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  SystemManager,
  decodeOutput,
  isWslUnavailable,
  parseUsbipdList,
  parseUsbipdState,
  vidPidFromInstanceId
} = require('./system-manager.cjs');

test('detects disabled WSL status messages in supported UI languages', () => {
  assert.equal(isWslUnavailable('WSL2 cannot start because virtualization is not enabled.'), true);
  assert.equal(isWslUnavailable('WSL2 无法启动，因为此计算机上未启用虚拟化。'), true);
  assert.equal(isWslUnavailable('WSL 2 を起動できません。仮想化が有効になっていません。'), true);
  assert.equal(isWslUnavailable('默认分发: SquidSketch\r\n默认版本: 2'), false);
});

test('decodes UTF-16LE WSL diagnostics and UTF-8 application output', () => {
  const wslText = '默认分发: Ubuntu\r\n默认版本: 2\r\n只能与 WSL 2 一起运行。';
  assert.equal(decodeOutput(Buffer.from(wslText, 'utf16le')), wslText.trim());
  const appText = '诊断完成：蓝牙控制器正常';
  assert.equal(decodeOutput(Buffer.from(appText, 'utf8')), appText);
  assert.equal(decodeOutput(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(appText)])), appText);
});

test('parses the current usbipd state JSON without localized text', () => {
  const devices = parseUsbipdState(JSON.stringify({ Devices: [
    {
      BusId: '2-10',
      ClientIPAddress: '172.24.16.1',
      Description: 'Intel(R) Wireless Bluetooth(R)',
      InstanceId: 'USB\\VID_8087&PID_0033\\ABC',
      PersistedGuid: '11111111-1111-1111-1111-111111111111',
      StubInstanceId: 'USBIP\\VID_8087&PID_0033',
      IsForced: false
    },
    {
      BusId: '3-2',
      ClientIPAddress: null,
      Description: 'Integrated Camera',
      InstanceId: 'USB\\VID_0C45&PID_636D\\XYZ',
      PersistedGuid: null,
      StubInstanceId: null,
      IsForced: false
    }
  ] }));

  assert.equal(devices.length, 2);
  assert.deepEqual(devices[0], {
    busId: '2-10',
    vidPid: '8087:0033',
    description: 'Intel(R) Wireless Bluetooth(R)',
    state: 'Attached',
    likelyBluetooth: true,
    instanceId: 'USB\\VID_8087&PID_0033\\ABC',
    persistedGuid: '11111111-1111-1111-1111-111111111111',
    clientIPAddress: '172.24.16.1',
    bound: true,
    attached: true
  });
  assert.equal(devices[1].state, 'Not shared');
  assert.equal(devices[1].likelyBluetooth, false);
});

test('parses both current and legacy usbipd list layouts', () => {
  const current = parseUsbipdList(`Connected:\nBUSID  DEVICE                                      STATE\n1-7    Intel(R) Wireless Bluetooth(R)              Shared\n4-4    USB Input Device                            Not shared`);
  assert.equal(current.length, 2);
  assert.equal(current[0].busId, '1-7');
  assert.equal(current[0].vidPid, '');
  assert.equal(current[0].bound, true);

  const legacy = parseUsbipdList(`BUSID  VID:PID    DEVICE                                      STATE\n2-10   8087:0033  Intel(R) Wireless Bluetooth(R)              Attached`);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].vidPid, '8087:0033');
  assert.equal(legacy[0].attached, true);
});

test('derives VID:PID from a Windows USB instance id', () => {
  assert.equal(vidPidFromInstanceId('USB\\VID_0BDA&PID_C123\\00E04C'), '0bda:c123');
  assert.equal(vidPidFromInstanceId('PCI\\VEN_8086'), '');
});

test('recovers and clears a persisted Bluetooth session from structured state', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'squid-sketch-test-'));
  try {
    const manager = new SystemManager({ resourcesPath: temp, userDataPath: temp, emit: () => undefined });
    manager.writeSession({ busId: '1-4', instanceId: 'USB\\VID_8087&PID_0033\\A', description: 'Bluetooth' });
    assert.equal(manager.reconcileSession([{ busId: '1-4', instanceId: 'USB\\VID_8087&PID_0033\\A', attached: true }], true), '1-4');
    assert.equal(manager.reconcileSession([{ busId: '1-4', instanceId: 'USB\\VID_8087&PID_0033\\A', attached: false }], true), null);
    assert.equal(fs.existsSync(manager.sessionPath), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('clears a persisted Bluetooth session when usbipd is unavailable', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'splatoon-deck-no-usbipd-'));
  try {
    const manager = new SystemManager({ resourcesPath: temp, userDataPath: temp, emit: () => undefined });
    manager.writeSession({ busId: '1-4', instanceId: 'USB\\VID_8087&PID_0033\\A', description: 'Bluetooth' });
    assert.equal(manager.reconcileSession([], false), null);
    assert.equal(fs.existsSync(manager.sessionPath), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('reads PowerShell UTF-8 JSON files that include a BOM', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'squid-sketch-bom-'));
  try {
    const manager = new SystemManager({ resourcesPath: temp, userDataPath: temp, emit: () => undefined });
    fs.writeFileSync(manager.markerPath, `\uFEFF${JSON.stringify({ schema: 1, completed: true })}`, 'utf8');
    assert.deepEqual(manager.readMarker(), { schema: 1, completed: true });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('disconnecting the virtual controller keeps Bluetooth attached to WSL', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
  const disconnectHandler = mainSource.split(/\r?\n/).find((line) => line.includes("ipcMain.handle('controller:disconnect'"));
  assert.ok(disconnectHandler, 'controller disconnect IPC handler is registered');
  assert.match(disconnectHandler, /controller\.disconnect\(\)/);
  assert.doesNotMatch(disconnectHandler, /releaseBluetooth/);
});

test('dependency elevation bypasses execution policy and reports PowerShell errors', () => {
  const source = fs.readFileSync(path.join(__dirname, 'system-manager.cjs'), 'utf8');
  assert.match(source, /'-ExecutionPolicy','Bypass','-EncodedCommand'/);
  assert.match(source, /\$ErrorActionPreference = 'Stop'/);
  assert.match(source, /if \(\$null -eq \$p\) \{ exit 1 \}/);
});

test('detects a freshly installed usbipd binary before PATH refresh', () => {
  const source = fs.readFileSync(path.join(__dirname, 'system-manager.cjs'), 'utf8');
  assert.match(source, /path\.join\(programFiles, 'usbipd-win', 'usbipd\.exe'\)/);
  assert.match(source, /capture\(this\.usbipdExecutable, \['--version'\]\)/);
});

test('dependency scripts handle WSL paths, interrupted state and symmetric cleanup', () => {
  const install = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'install-dependencies.ps1'), 'utf8');
  const uninstall = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'uninstall-dependencies.ps1'), 'utf8');
  assert.match(install, /Replace\('\\', '\\\\'\)/);
  assert.match(install, /Could not resolve the Linux dependency setup path/);
  assert.match(uninstall, /\$state = @\{\}/);
  assert.match(uninstall, /Disable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform/);
  assert.match(uninstall, /bluetooth-session\.json/);
});
