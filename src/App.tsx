import { useCallback, useEffect, useMemo, useState } from 'react';
import SetupPage from './components/SetupPage';
import ControllerPage from './components/ControllerPage';
import StudioPage from './components/StudioPage';

type Page = 'setup' | 'controller' | 'studio';
type ConnectionState = 'offline' | 'connecting' | 'pairing' | 'connected' | 'error';

const navItems: Array<{ id: Page; label: string; hint: string; icon: string }> = [
  { id: 'setup', label: '准备舱', hint: '环境与蓝牙', icon: '01' },
  { id: 'controller', label: '虚拟手柄', hint: '完整操控', icon: '02' },
  { id: 'studio', label: '涂鸦工坊', hint: '导图与绘制', icon: '03' }
];

export default function App() {
  const [page, setPage] = useState<Page>('setup');
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('offline');
  const [controllerMessage, setControllerMessage] = useState('等待连接');
  const [macroProgress, setMacroProgress] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [version, setVersion] = useState('0.1.0');
  const drawingActive = macroProgress !== null && macroProgress < 1;

  const refreshStatus = useCallback(async () => {
    try {
      setSystemStatus(await window.squidSketch.system.getStatus());
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    window.squidSketch.app.version().then(setVersion).catch(() => undefined);
    const offSystem = window.squidSketch.system.onProgress((event) => {
      if (typeof event.message === 'string') setToast(event.message);
      if (event.phase === 'released' || event.phase === 'attached' || event.phase === 'completed') refreshStatus();
    });
    const offController = window.squidSketch.controller.onEvent((event) => {
      if (event.message && ['connecting', 'starting', 'pairing', 'connected', 'disconnecting'].includes(event.type)) {
        setControllerMessage(event.message);
      }
      if (event.type === 'connecting' || event.type === 'starting') setConnection('connecting');
      if (event.type === 'pairing') setConnection('pairing');
      if (event.type === 'connected') setConnection('connected');
      if (event.type === 'disconnected') { setConnection('offline'); setControllerMessage('虚拟手柄已断开 · 蓝牙仍由 WSL 接管'); setMacroProgress(null); refreshStatus(); }
      if (event.type === 'error') { setConnection('error'); setControllerMessage('连接失败'); setToast(event.message || '控制器发生错误'); }
      if (event.type === 'macro_started') setMacroProgress(0);
      if (event.type === 'macro_progress') setMacroProgress(event.progress ?? 0);
      if (event.type === 'macro_completed') { setMacroProgress(1); setToast('涂鸦绘制完成！'); }
      if (event.type === 'macro_stopped') { setMacroProgress(null); setToast('绘制已停止，可以调整起始行后继续'); }
    });
    return () => { offSystem(); offController(); };
  }, [refreshStatus]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const readyCount = useMemo(() => {
    if (!systemStatus) return 0;
    return [systemStatus.wsl.installed, systemStatus.distro.installed, systemStatus.usbipd.installed].filter(Boolean).length;
  }, [systemStatus]);

  const connectController = async () => {
    try {
      setConnection('connecting');
      let latest = systemStatus;
      if (!latest?.bluetooth.attachedBusId) {
        const adapter = latest?.bluetooth.candidates[0];
        if (!adapter) throw new Error('没有检测到可接管的内置 USB 蓝牙适配器');
        latest = await window.squidSketch.system.attachBluetooth(adapter.busId);
        setSystemStatus(latest);
      }
      await window.squidSketch.controller.connect({ reconnect: true });
    } catch (error) {
      setConnection('error');
      setToast(error instanceof Error ? error.message : String(error));
    }
  };

  const disconnectController = async () => {
    await window.squidSketch.controller.disconnect();
    setConnection('offline');
    setControllerMessage('虚拟手柄已断开 · 蓝牙仍由 WSL 接管');
    await refreshStatus();
  };

  return (
    <div className="app-shell">
      <div className="ink-blob ink-blob-a" />
      <div className="ink-blob ink-blob-b" />
      <div className="ink-splat ink-splat-lime" aria-hidden="true" />
      <div className="ink-splat ink-splat-cyan" aria-hidden="true" />
      <div className="ink-splat ink-splat-pink" aria-hidden="true" />
      <aside className="sidebar">
        <div className="brand" onClick={() => setPage('setup')}>
          <div className="brand-mark"><span>SD</span></div>
          <div><strong>SPLATOON</strong><em>DECK</em></div>
        </div>
        <nav>
          {navItems.map((item) => (
            <button key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(item.id)}>
              <span className="nav-number">{item.icon}</span>
              <span><strong>{item.label}</strong><small>{item.hint}</small></span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className={`connection-pill ${connection}`}><i />{connection === 'connected' ? 'SWITCH 2 已连接' : controllerMessage}</div>
          <div className="mini-meter"><span style={{ width: `${readyCount / 3 * 100}%` }} /></div>
          <small>环境就绪度 {readyCount}/3 · v{version}</small>
        </div>
      </aside>

      <main className="main-content">
        {page === 'setup' && <SetupPage status={systemStatus} refresh={refreshStatus} notify={setToast} />}
        {page === 'controller' && (
          <ControllerPage
            connection={connection}
            message={controllerMessage}
            inputLocked={drawingActive}
            onConnect={connectController}
            onDisconnect={disconnectController}
          />
        )}
        <div className="persisted-page" hidden={page !== 'studio'} aria-hidden={page !== 'studio'}>
          <StudioPage
            connection={connection}
            progress={macroProgress}
            onNeedController={() => setPage('controller')}
            notify={setToast}
          />
        </div>
      </main>
      {toast && <div className="toast"><span>!</span>{toast}</div>}
    </div>
  );
}
