/// <reference types="vite/client" />

type UsbDevice = {
  busId: string;
  vidPid: string;
  description: string;
  state: string;
  likelyBluetooth: boolean;
  instanceId?: string;
  persistedGuid?: string | null;
  clientIPAddress?: string | null;
  bound?: boolean;
  attached?: boolean;
};

type DiagnosticCheck = {
  id: string;
  label: string;
  ok: boolean;
  pending?: boolean;
  detail: string;
};

type DiagnosticReport = {
  generatedAt: string;
  ok: boolean;
  failed: number;
  checks: DiagnosticCheck[];
  status: SystemStatus;
};

type SystemStatus = {
  windows: { ok: boolean; version: string };
  wsl: { installed: boolean; detail: string };
  distro: { installed: boolean; name: string };
  usbipd: { installed: boolean; version?: string; devices: UsbDevice[]; detail: string; source?: string };
  bluetooth: { attachedBusId: string | null; candidates: UsbDevice[]; recoveredSession?: boolean };
  installMarker: Record<string, unknown> | null;
  setup: SetupProgress | null;
  restartRequired: boolean;
  restartReason: 'install' | 'uninstall' | null;
};

type SetupProgress = {
  operation: 'install' | 'uninstall';
  operationId: string;
  lifecycle: string;
  phase: string;
  stageIndex: number;
  stageTotal: number;
  stageStatus: 'running' | 'warning' | 'failed' | 'restart-required' | 'ready-to-continue' | 'completed' | string;
  stageTitle: string;
  stageDetail: string;
  nextTitle: string;
  progressPercent: number;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
  awaitingUserConfirmation: boolean;
  restartRequired: boolean;
  restartReason: 'install' | 'uninstall' | null;
  updatedAt: string;
};

type SystemProgressEvent = {
  phase: string;
  operation?: 'install' | 'uninstall';
  message?: string;
  setup?: SetupProgress | null;
  logPath?: string;
};

type ControllerEvent = {
  type: string;
  message?: string;
  progress?: number;
  elapsedMs?: number;
  code?: string | number;
  detail?: string;
  metadata?: Record<string, unknown>;
};

interface Window {
  splatoonDeck: {
    system: {
      getStatus(): Promise<SystemStatus>;
      diagnose(): Promise<DiagnosticReport>;
      install(): Promise<Record<string, unknown>>;
      uninstall(): Promise<Record<string, unknown>>;
      restartWindows(): Promise<Record<string, unknown>>;
      attachBluetooth(busId: string): Promise<SystemStatus>;
      releaseBluetooth(): Promise<Record<string, unknown>>;
      onProgress(listener: (event: SystemProgressEvent) => void): () => void;
    };
    controller: {
      connect(options?: { reconnect?: boolean }): Promise<{ ok: boolean }>;
      disconnect(): Promise<{ ok: boolean }>;
      button(button: string, pressed: boolean): void;
      stick(stick: string, x: number, y: number): void;
      runMacro(macro: string, metadata: Record<string, unknown>): Promise<{ ok: boolean }>;
      stopMacro(): Promise<{ ok: boolean }>;
      onEvent(listener: (event: ControllerEvent) => void): () => void;
    };
    app: { version(): Promise<string> };
  };
}
