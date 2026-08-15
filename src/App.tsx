import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SetupPage from './components/SetupPage';
import ControllerPage from './components/ControllerPage';
import StudioPage from './components/StudioPage';
import { LOCALE_OPTIONS, useI18n } from './lib/i18n';

type Page = 'setup' | 'controller' | 'studio';
type ConnectionState = 'offline' | 'connecting' | 'pairing' | 'connected' | 'error';
type MacroKind = 'drawing' | 'controller' | null;

const navItems: Array<{ id: Page; label: string; hint: string; icon: string }> = [
  { id: 'setup', label: '准备舱', hint: '环境与蓝牙', icon: '01' },
  { id: 'controller', label: '虚拟手柄', hint: '完整操控', icon: '02' },
  { id: 'studio', label: '涂鸦工坊', hint: '导图与绘制', icon: '03' }
];

export default function App() {
  const { locale, setLocale, t, tx } = useI18n();
  const [page, setPage] = useState<Page>('setup');
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('offline');
  const [controllerMessage, setControllerMessage] = useState('等待连接');
  const [macroProgress, setMacroProgress] = useState<number | null>(null);
  const [macroElapsedMs, setMacroElapsedMs] = useState<number>(0);
  const [macroKind, setMacroKind] = useState<MacroKind>(null);
  const macroKindRef = useRef<MacroKind>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [version, setVersion] = useState('0.2.3');
  const macroActive = macroProgress !== null && macroProgress < 1;
  const controllerPlaybackActive = macroKind === 'controller' && macroActive;

  const refreshStatus = useCallback(async () => {
    try {
      setSystemStatus(await window.splatoonDeck.system.getStatus());
    } catch (error) {
      setToast(tx(error instanceof Error ? error.message : String(error)));
    }
  }, [tx]);

  useEffect(() => {
    refreshStatus();
    window.splatoonDeck.app.version().then(setVersion).catch(() => undefined);
    const offSystem = window.splatoonDeck.system.onProgress((event) => {
      if (typeof event.message === 'string') setToast(tx(event.message));
      if (event.phase === 'released' || event.phase === 'attached' || event.phase === 'completed') refreshStatus();
    });
    const offController = window.splatoonDeck.controller.onEvent((event) => {
      if (event.message && ['connecting', 'starting', 'pairing', 'connected', 'disconnecting'].includes(event.type)) {
        setControllerMessage(event.message);
      }
      if (event.type === 'connecting' || event.type === 'starting') setConnection('connecting');
      if (event.type === 'pairing') setConnection('pairing');
      if (event.type === 'connected') setConnection('connected');
      if (event.type === 'disconnected') { setConnection('offline'); setControllerMessage('虚拟手柄已断开 · 蓝牙仍由 WSL 接管'); setMacroProgress(null); setMacroKind(null); macroKindRef.current = null; refreshStatus(); }
      if (event.type === 'error') {
        if (event.code !== 'MACRO_BUSY') { setConnection('error'); setControllerMessage('连接失败'); }
        setToast(tx(event.message || '控制器发生错误'));
      }
      if (event.type === 'macro_started') {
        const kind: MacroKind = event.metadata?.kind === 'controller-recording' ? 'controller' : 'drawing';
        macroKindRef.current = kind;
        setMacroKind(kind);
        setMacroProgress(0);
        setMacroElapsedMs(0);
      }
      if (event.type === 'macro_progress') { setMacroProgress(event.progress ?? 0); setMacroElapsedMs(event.elapsedMs ?? 0); }
      if (event.type === 'macro_completed') {
        const kind = macroKindRef.current;
        setMacroProgress(1);
        setToast(t(kind === 'controller' ? '宏回放完成' : '涂鸦绘制完成！'));
        if (kind === 'controller') { macroKindRef.current = null; setMacroKind(null); }
      }
      if (event.type === 'macro_stopped') {
        const kind = macroKindRef.current;
        setMacroProgress(null);
        setMacroKind(null);
        macroKindRef.current = null;
        setToast(t(kind === 'controller' ? '宏回放已停止' : '绘制已停止，可以调整起始行后继续'));
      }
    });
    return () => { offSystem(); offController(); };
  }, [refreshStatus, t, tx]);

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
        if (!adapter) throw new Error(t('没有检测到可接管的内置 USB 蓝牙适配器'));
        latest = await window.splatoonDeck.system.attachBluetooth(adapter.busId);
        setSystemStatus(latest);
      }
      await window.splatoonDeck.controller.connect({ reconnect: true });
    } catch (error) {
      setConnection('error');
      setToast(tx(error instanceof Error ? error.message : String(error)));
    }
  };

  const disconnectController = async () => {
    await window.splatoonDeck.controller.disconnect();
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
              <span><strong>{t(item.label)}</strong><small>{t(item.hint)}</small></span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="language-switcher" role="group" aria-label={t('界面语言')}>
            {LOCALE_OPTIONS.map((option) => <button key={option.value} className={locale === option.value ? 'active' : ''} aria-pressed={locale === option.value} title={option.label} onClick={() => setLocale(option.value)}>{option.short}</button>)}
          </div>
          <div className={`connection-pill ${connection}`}><i />{connection === 'connected' ? t('SWITCH 2 已连接') : tx(controllerMessage)}</div>
          <div className="mini-meter"><span style={{ width: `${readyCount / 3 * 100}%` }} /></div>
          <small>{t('环境就绪度 {{count}}/3 · v{{version}}', { count: readyCount, version })}</small>
        </div>
      </aside>

      <main className="main-content">
        {page === 'setup' && <SetupPage status={systemStatus} refresh={refreshStatus} notify={setToast} />}
        {page === 'controller' && (
          <ControllerPage
            connection={connection}
            message={controllerMessage}
            inputLocked={macroActive}
            playbackActive={controllerPlaybackActive}
            playbackProgress={controllerPlaybackActive ? macroProgress : null}
            playbackElapsedMs={controllerPlaybackActive ? macroElapsedMs : 0}
            onConnect={connectController}
            onDisconnect={disconnectController}
            notify={setToast}
          />
        )}
        <div className="persisted-page" hidden={page !== 'studio'} aria-hidden={page !== 'studio'}>
          <StudioPage
            connection={connection}
            progress={macroKind === 'controller' ? null : macroProgress}
            elapsedMs={macroKind === 'controller' ? 0 : macroElapsedMs}
            onNeedController={() => setPage('controller')}
            notify={setToast}
          />
        </div>
      </main>
      {toast && <div className="toast"><span>!</span>{toast}</div>}
    </div>
  );
}
