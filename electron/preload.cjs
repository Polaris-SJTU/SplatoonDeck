const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel, listener) => {
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

contextBridge.exposeInMainWorld('splatoonDeck', {
  system: {
    getStatus: () => ipcRenderer.invoke('system:get-status'),
    diagnose: () => ipcRenderer.invoke('system:diagnose'),
    install: () => ipcRenderer.invoke('system:install'),
    uninstall: () => ipcRenderer.invoke('system:uninstall'),
    attachBluetooth: (busId) => ipcRenderer.invoke('system:attach-bluetooth', busId),
    releaseBluetooth: () => ipcRenderer.invoke('system:release-bluetooth'),
    onProgress: (listener) => subscribe('system:progress', listener)
  },
  controller: {
    connect: (options = {}) => ipcRenderer.invoke('controller:connect', options),
    disconnect: () => ipcRenderer.invoke('controller:disconnect'),
    button: (button, pressed) => ipcRenderer.send('controller:button', { button, pressed }),
    stick: (stick, x, y) => ipcRenderer.send('controller:stick', { stick, x, y }),
    runMacro: (macro, metadata) => ipcRenderer.invoke('controller:macro', { macro, metadata }),
    stopMacro: () => ipcRenderer.invoke('controller:stop-macro'),
    onEvent: (listener) => subscribe('controller:event', listener)
  },
  app: {
    version: () => ipcRenderer.invoke('app:version')
  }
});
