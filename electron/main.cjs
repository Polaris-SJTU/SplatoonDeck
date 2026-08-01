const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('node:path');
const { SystemManager } = require('./system-manager.cjs');
const { ControllerService } = require('./controller-service.cjs');

let window;
let system;
let controller;

// Keep the pre-rename data location so existing installs retain setup state.
app.setPath('userData', path.join(app.getPath('appData'), 'Squid Sketch'));

function send(channel, payload) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

function createWindow() {
  window = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#101014',
    title: 'SquidDeck',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.removeMenu();
  window.setMenuBarVisibility(false);
  window.once('ready-to-show', () => window.show());
  if (!app.isPackaged) window.loadURL('http://127.0.0.1:5173');
  else window.loadFile(path.join(__dirname, '..', 'dist-ui', 'index.html'));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  system = new SystemManager({ resourcesPath: process.resourcesPath, userDataPath: app.getPath('userData'), emit: (x) => send('system:progress', x) });
  controller = new ControllerService({ resourcesPath: process.resourcesPath, emit: (x) => send('controller:event', x) });

  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('system:get-status', () => system.getStatus());
  ipcMain.handle('system:diagnose', () => system.diagnose());
  ipcMain.handle('system:install', () => system.install());
  ipcMain.handle('system:uninstall', async () => { await controller.disconnect(); await system.releaseBluetooth(); return system.uninstall(); });
  ipcMain.handle('system:attach-bluetooth', (_e, busId) => system.attachBluetooth(busId));
  ipcMain.handle('system:release-bluetooth', async () => { await controller.disconnect(); return system.releaseBluetooth(); });
  ipcMain.handle('controller:connect', (_e, options) => controller.connect(options));
  ipcMain.handle('controller:disconnect', () => controller.disconnect());
  ipcMain.on('controller:button', (_e, x) => controller.button(x.button, x.pressed));
  ipcMain.on('controller:stick', (_e, x) => controller.stick(x.stick, x.x, x.y));
  ipcMain.handle('controller:macro', async (_e, x) => ({ ok: await controller.macro(x.macro, x.metadata) }));
  ipcMain.handle('controller:stop-macro', () => ({ ok: controller.stopMacro() }));
});

app.on('before-quit', () => {
  controller?.disconnectSync();
  system?.releaseBluetoothSync();
});

app.on('window-all-closed', () => app.quit());
