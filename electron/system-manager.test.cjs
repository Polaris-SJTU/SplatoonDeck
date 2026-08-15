const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  SystemManager,
  decodeOutput,
  hasInstalledEnvironment,
  isWslUnavailable,
  parseUsbipdList,
  parseUsbipdState,
  restartStillPending,
  vidPidFromInstanceId
} = require('./system-manager.cjs');

test('automatic status refresh does not launch WSL', () => {
  const source = fs.readFileSync(path.join(__dirname, 'system-manager.cjs'), 'utf8');
  assert.match(source, /async getStatus\(\{ probeWsl = false \} = \{\}\)/);
  assert.match(source, /probeWsl \? capture\('wsl\.exe', \['--status'\]\) : skippedWslProbe/);
  assert.match(source, /probeWsl \? capture\('wsl\.exe', \['--list', '--quiet'\]\) : skippedWslProbe/);
  assert.match(source, /diagnose[\s\S]*getStatus\(\{ probeWsl: true \}\)/);
  assert.match(source, /return \{ \.\.\.result, logPath, status: await this\.getStatus\(\) \}/);
});

test('automatic status uses only the app-owned environment marker', () => {
  assert.equal(hasInstalledEnvironment(null), false);
  assert.equal(hasInstalledEnvironment({ lifecycle: 'installing', completed: false }), false);
  assert.equal(hasInstalledEnvironment({ lifecycle: 'uninstalled', completed: false }), false);
  assert.equal(hasInstalledEnvironment({ lifecycle: 'installed', completed: true }), true);
});

test('detects disabled WSL status messages in supported UI languages', () => {
  assert.equal(isWslUnavailable('WSL2 cannot start because virtualization is not enabled.'), true);
  assert.equal(isWslUnavailable('WSL2 无法启动，因为此计算机上未启用虚拟化。'), true);
  assert.equal(isWslUnavailable('WSL 2 を起動できません。仮想化が有効になっていません。'), true);
  assert.equal(isWslUnavailable('默认分发: SplatoonDeck\r\n默认版本: 2'), false);
});

test('clears a restart request only after Windows has booted again', () => {
  const marker = { restartRequired: true };
  assert.equal(restartStillPending(marker, 2_000, 1_000), true);
  assert.equal(restartStillPending(marker, 2_000, 3_000), false);
  assert.equal(restartStillPending({ restartRequired: false }, 2_000, 1_000), false);
  assert.equal(restartStillPending(marker, Number.NaN, 3_000), true);
});

test('removes an uninstalled lifecycle marker after Windows restarts', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'splatoon-deck-restart-cleanup-'));
  try {
    const manager = new SystemManager({ resourcesPath: temp, userDataPath: temp, emit: () => undefined });
    manager.writeJson(manager.markerPath, { schema: 2, lifecycle: 'uninstalled', restartRequired: true, restartReason: 'uninstall' });
    fs.utimesSync(manager.markerPath, new Date('2000-01-01'), new Date('2000-01-01'));
    assert.equal(manager.reconcileRestartMarker(), null);
    assert.equal(fs.existsSync(manager.markerPath), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
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
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'splatoondeck-test-'));
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

test('reads UTF-8 JSON state files that include a BOM', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'splatoondeck-bom-'));
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

test('dependency management uses the bundled native elevated helper without PowerShell', () => {
  const source = fs.readFileSync(path.join(__dirname, 'system-manager.cjs'), 'utf8');
  const helper = fs.readFileSync(path.join(__dirname, '..', 'native', 'SplatoonDeck.Setup', 'Program.cs'), 'utf8');
  assert.match(source, /SplatoonDeck\.Setup\.exe/);
  assert.match(source, /runSetupAction\('install'\)/);
  assert.doesNotMatch(source, /powershell\.exe/i);
  assert.match(helper, /Verb = "runas"/);
  assert.match(helper, /Console\.ReadLine\(\)/);
  assert.match(helper, /class Logger/);
});

test('native helper streams progress, owns only new components, and preserves failures', () => {
  const helper = fs.readFileSync(path.join(__dirname, '..', 'native', 'SplatoonDeck.Setup', 'Program.cs'), 'utf8');
  assert.match(helper, /Keep this window open/);
  assert.match(helper, /\[FAILED\]/);
  assert.match(helper, /Press Enter to close this window/);
  assert.match(helper, /wslEnvironmentExistedBefore/);
  assert.match(helper, /installedWslRuntimeByApp/);
  assert.match(helper, /lifecycle.*uninstalled/);
  assert.match(helper, /restartReason.*uninstall/);
  assert.match(helper, /RedirectStandardInput = true/);
  assert.match(helper, /elapsed\.ElapsedMilliseconds < timeoutMilliseconds/);
  assert.match(helper, /\[TIMEOUT\]/);
  assert.match(helper, /Still working\.\.\. elapsed/);
  assert.match(helper, /KillOnJobClose/);
  assert.match(helper, /AssignProcessToJobObject/);
  assert.match(helper, /SplatoonDeck\.DependencySetup/);
  assert.match(helper, /Another Windows component operation is still running/);
  assert.doesNotMatch(helper, /PowerShell|Tee-Object|Start-Transcript/i);
});

test('native helper prepares and restarts before launching WSL', () => {
  const helper = fs.readFileSync(path.join(__dirname, '..', 'native', 'SplatoonDeck.Setup', 'Program.cs'), 'utf8');
  assert.doesNotMatch(helper, /--list --quiet/);
  assert.doesNotMatch(helper, /commands\.Run\("wsl\.exe", "--update/);
  assert.doesNotMatch(helper, /commands\.Run\("wsl\.exe", "--uninstall/);
  assert.match(helper, /Registry\.CurrentUser\.OpenSubKey\(@"Software\\Microsoft\\Windows\\CurrentVersion\\Lxss"\)/);
  assert.match(helper, /Microsoft\.WSL/);
  assert.doesNotMatch(helper, /Microsoft\.WSL[\s\S]{0,200}--force/);
  assert.match(helper, /upgrade --id Microsoft\.WSL/);
  assert.match(helper, /install --id Microsoft\.WSL/);
  assert.match(helper, /No WSL upgrade was applied/);
  assert.match(helper, /wslRuntimePrepared/);
  assert.match(helper, /A Windows restart is still required/);
  assert.ok(helper.indexOf('if (restartRequired)') < helper.indexOf('commands.Run("wsl.exe", "--version"'));
  assert.match(helper, /RemoveDistroRegistration\(ProgramDistro\)/);
  assert.match(helper, /String\.Equals\(name, distributionName, StringComparison\.OrdinalIgnoreCase\)/);
});

test('native helper retries and resumes the Ubuntu download safely', () => {
  const helper = fs.readFileSync(path.join(__dirname, '..', 'native', 'SplatoonDeck.Setup', 'Program.cs'), 'utf8');
  assert.match(helper, /DownloadWithResume/);
  assert.match(helper, /destination \+ "\.partial"/);
  assert.match(helper, /request\.AddRange\(existing\)/);
  assert.match(helper, /attempt <= 4/);
  assert.match(helper, /ReadWriteTimeout = 60 \* 1000/);
  assert.match(helper, /The partial file was preserved for the next run/);
  assert.match(helper, /SHA256SUMS/);
  assert.match(helper, /ComputeSha256/);
  assert.match(helper, /The Ubuntu checksum did not match/);
  assert.match(helper, /--install --no-distribution/);
  assert.doesNotMatch(helper, /EnableFeature\(name\)/);
});

test('compiled native helper starts and captures live command output without elevation', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'splatoondeck-native-helper-'));
  try {
    const helper = path.join(__dirname, '..', 'native', 'bin', 'SplatoonDeck.Setup.exe');
    const logPath = path.join(temp, 'self-test.log');
    const result = spawnSync(helper, ['self-test', '--state', path.join(temp, 'state.json'), '--log', logPath], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const log = fs.readFileSync(logPath, 'utf8');
    assert.match(log, /Native command output ready/);
    assert.match(log, /\[TIMEOUT\]/);
    assert.match(log, /Self-test passed/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('detects a freshly installed usbipd binary before PATH refresh', () => {
  const source = fs.readFileSync(path.join(__dirname, 'system-manager.cjs'), 'utf8');
  assert.match(source, /path\.join\(programFiles, 'usbipd-win', 'usbipd\.exe'\)/);
  assert.match(source, /capture\(this\.usbipdExecutable, \['--version'\]\)/);
});

test('native dependency helper uses the fully renamed dedicated environment', () => {
  const helper = fs.readFileSync(path.join(__dirname, '..', 'native', 'SplatoonDeck.Setup', 'Program.cs'), 'utf8');
  const linux = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'linux-setup.sh'), 'utf8');
  const controller = fs.readFileSync(path.join(__dirname, 'controller-service.cjs'), 'utf8');
  assert.match(helper, /DistroName.*SplatoonDeck/);
  assert.match(helper, /LocalApplicationData\), "SplatoonDeck"/);
  assert.match(linux, /\/opt\/splatoondeck\/venv/);
  assert.match(controller, /\/opt\/splatoondeck\/venv\/bin\/python/);
});

test('tracked product content contains no retired application name', () => {
  const retiredName = Buffer.from('c3F1aWRza2V0Y2g=', 'base64').toString('utf8');
  const roots = ['README.md', 'README_EN.md', 'README_JA.md', 'backend', 'electron', 'native/SplatoonDeck.Setup', 'scripts', 'src'];
  const visit = (entry) => {
    const fullPath = path.join(__dirname, '..', entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(fullPath)) visit(path.join(entry, child));
      return;
    }
    const content = fs.readFileSync(fullPath, 'utf8').toLowerCase();
    assert.equal(content.includes(retiredName), false, `${entry} contains the retired application name`);
  };
  roots.forEach(visit);
});

test('setup UI distinguishes install and uninstall restart states', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'SetupPage.tsx'), 'utf8');
  assert.match(source, /status\.restartReason !== 'uninstall'/);
  assert.match(source, /status\.restartReason === 'uninstall'/);
  assert.match(source, /重启后可重新安装/);
  assert.match(source, /依赖已卸载/);
});
