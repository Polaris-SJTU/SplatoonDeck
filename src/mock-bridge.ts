const systemListeners = new Set<(event: Record<string, unknown>) => void>();
const controllerListeners = new Set<(event: ControllerEvent) => void>();
let mockMacroTimer: number | null = null;
let mockMacroProgress = 0;
let mockMacroElapsedMs = 0;

let attachedBusId: string | null = null;
const mockAdapter: UsbDevice = {
  busId: '1-4',
  vidPid: '8087:0033',
  description: 'Intel(R) Wireless Bluetooth(R) · 预览设备',
  state: 'Shared',
  likelyBluetooth: true
};

const status = (): SystemStatus => ({
  windows: { ok: true, version: '10.0.26100' },
  wsl: { installed: true, detail: 'Preview mode' },
  distro: { installed: true, name: 'SplatoonDeck' },
  usbipd: { installed: true, devices: [mockAdapter], detail: '' },
  bluetooth: { attachedBusId, candidates: [mockAdapter] },
  installMarker: { preview: true },
  restartRequired: false,
  restartReason: null
});

if (import.meta.env.DEV && !window.splatoonDeck) {
  window.splatoonDeck = {
    system: {
      getStatus: async () => status(),
      diagnose: async () => ({
        generatedAt: new Date().toISOString(),
        ok: true,
        failed: 0,
        checks: [
          { id: 'windows', label: 'Windows', ok: true, detail: '10.0.26100' },
          { id: 'wsl', label: 'WSL 2', ok: true, detail: 'Preview mode' },
          { id: 'bluez', label: 'BlueZ 服务', ok: true, detail: 'active' },
          { id: 'controller', label: 'Linux 蓝牙控制器', ok: true, detail: 'hci0 (preview)' }
        ],
        status: status()
      }),
      install: async () => { systemListeners.forEach((fn) => fn({ phase: 'completed', message: '预览：依赖检查完成' })); return {}; },
      uninstall: async () => ({}),
      attachBluetooth: async (busId) => { attachedBusId = busId; systemListeners.forEach((fn) => fn({ phase: 'attached', message: '预览：蓝牙已接管' })); return status(); },
      releaseBluetooth: async () => { attachedBusId = null; systemListeners.forEach((fn) => fn({ phase: 'released', message: '预览：蓝牙已归还' })); return {}; },
      onProgress: (listener) => { systemListeners.add(listener); return () => systemListeners.delete(listener); }
    },
    controller: {
      connect: async () => {
        controllerListeners.forEach((fn) => fn({ type: 'connecting', message: '正在创建虚拟 Pro Controller…' }));
        window.setTimeout(() => controllerListeners.forEach((fn) => fn({ type: 'pairing', message: '请在 Switch 2 打开更改握法/顺序' })), 350);
        window.setTimeout(() => controllerListeners.forEach((fn) => fn({ type: 'connected', message: 'Pro Controller 已连接（预览）' })), 900);
        return { ok: true };
      },
      disconnect: async () => { controllerListeners.forEach((fn) => fn({ type: 'disconnected', message: '已断开' })); return { ok: true }; },
      button: () => undefined,
      stick: () => undefined,
      runMacro: async (_macro, metadata) => {
        if (mockMacroTimer !== null) window.clearInterval(mockMacroTimer);
        mockMacroProgress = 0;
        mockMacroElapsedMs = 0;
        const startedAt = performance.now();
        const cycleDurationMs = Math.max(1, Number(metadata.cycleDurationMs) || Number(metadata.durationMs) || 1);
        const infinite = metadata.repeatMode === 'infinite';
        const repeatCount = infinite ? Number.POSITIVE_INFINITY : Math.max(1, Number(metadata.repeatCount) || 1);
        const totalDurationMs = infinite ? cycleDurationMs : cycleDurationMs * repeatCount;
        controllerListeners.forEach((fn) => fn({ type: 'macro_started', metadata }));
        mockMacroTimer = window.setInterval(() => {
          mockMacroElapsedMs = Math.max(0, performance.now() - startedAt);
          mockMacroProgress = infinite ? (mockMacroElapsedMs % cycleDurationMs) / cycleDurationMs : mockMacroElapsedMs / totalDurationMs;
          controllerListeners.forEach((fn) => fn({ type: !infinite && mockMacroProgress >= 1 ? 'macro_completed' : 'macro_progress', progress: Math.min(1, mockMacroProgress), elapsedMs: Math.round(mockMacroElapsedMs) }));
          if (mockMacroProgress >= 1 && mockMacroTimer !== null) { window.clearInterval(mockMacroTimer); mockMacroTimer = null; }
        }, 50);
        return { ok: true };
      },
      stopMacro: async () => {
        if (mockMacroTimer !== null) { window.clearInterval(mockMacroTimer); mockMacroTimer = null; }
        controllerListeners.forEach((fn) => fn({ type: 'macro_stopped', progress: mockMacroProgress, elapsedMs: Math.round(mockMacroElapsedMs) }));
        return { ok: true };
      },
      onEvent: (listener) => { controllerListeners.add(listener); return () => controllerListeners.delete(listener); }
    },
    app: { version: async () => '0.2.3-preview' }
  };
}

export {};
