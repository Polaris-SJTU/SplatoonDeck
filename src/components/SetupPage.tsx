import { useMemo, useState } from 'react';

type Props = {
  status: SystemStatus | null;
  refresh(): Promise<void>;
  notify(message: string): void;
};

function StatusBadge({ ok, pending = false }: { ok: boolean; pending?: boolean }) {
  return <span className={`status-badge ${ok ? 'ok' : pending ? 'pending' : 'missing'}`}>{ok ? '就绪' : pending ? '待完成' : '需处理'}</span>;
}

export default function SetupPage({ status, refresh, notify }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedBusId, setSelectedBusId] = useState('');
  const [diagnostic, setDiagnostic] = useState<DiagnosticReport | null>(null);
  const adapters = status?.bluetooth.candidates ?? [];
  const activeBusId = status?.bluetooth.attachedBusId;
  const busId = selectedBusId || adapters[0]?.busId || '';
  const allReady = Boolean(status?.wsl.installed && status?.distro.installed && status?.usbipd.installed);
  const steps = useMemo(() => [
    { title: 'WSL 2', detail: '隔离运行 Linux 蓝牙协议栈', ok: Boolean(status?.wsl.installed) },
    { title: '专用环境', detail: '只存放 SplatoonDeck 的 BlueZ 与 NXBT', ok: Boolean(status?.distro.installed) },
    { title: 'USB/IP', detail: '把内置蓝牙临时交给 WSL', ok: Boolean(status?.usbipd.installed) }
  ], [status]);

  const action = async (name: string, operation: () => Promise<unknown>) => {
    try {
      setBusy(name);
      await operation();
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const runDiagnostic = async () => {
    try {
      setBusy('diagnose');
      const report = await window.squidSketch.system.diagnose();
      setDiagnostic(report);
      notify(report.ok ? '兼容性诊断通过' : `诊断完成：${report.failed} 项需要处理`);
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="page setup-page">
      <header className="page-header">
        <div><span className="eyebrow">GET READY</span><h1>准备你的<span>墨水舱</span></h1><p>一次配置，之后打开应用即可连接。系统改动都会记录，也能安全清理。</p></div>
        <button className="icon-button" onClick={refresh} aria-label="刷新">↻</button>
      </header>

      {status?.restartRequired && (
        <div className="restart-banner"><strong>需要重启 Windows</strong><span>系统组件已启用。重启后再次点击“继续安装”即可，不会重复下载。</span></div>
      )}
      {status?.bluetooth.recoveredSession && activeBusId && (
        <div className="restart-banner recovery-banner"><strong>已恢复上次会话</strong><span>检测到蓝牙仍由 WSL 接管，可点击“归还蓝牙”安全恢复 Windows 蓝牙。</span></div>
      )}

      <div className="setup-grid">
        <article className="card setup-card">
          <div className="card-title"><div><span className="step-kicker">STEP 01</span><h2>运行环境</h2></div><StatusBadge ok={allReady} pending={Boolean(status?.restartRequired)} /></div>
          <div className="dependency-list">
            {steps.map((step, index) => (
              <div className="dependency-row" key={step.title}>
                <span className={`dependency-icon ${step.ok ? 'done' : ''}`}>{step.ok ? '✓' : index + 1}</span>
                <div><strong>{step.title}</strong><small>{step.detail}</small></div>
                <span className={step.ok ? 'dot ok' : 'dot'} />
              </div>
            ))}
          </div>
          <button className="primary-button lime" disabled={Boolean(busy)} onClick={() => action('install', () => window.squidSketch.system.install())}>
            {busy === 'install' ? <i className="spinner" /> : '→'} {allReady ? '检查 / 修复依赖' : status?.restartRequired ? '重启后继续安装' : '一键安装依赖'}
          </button>
          <p className="fine-print">安装需要管理员确认和网络连接；首次启用 WSL 可能要求重启。</p>
        </article>

        <article className="card setup-card accent-purple">
          <div className="card-title"><div><span className="step-kicker">STEP 02</span><h2>蓝牙接管</h2></div><StatusBadge ok={Boolean(activeBusId)} /></div>
          <div className="adapter-visual"><div className="radio-wave wave-1" /><div className="radio-wave wave-2" /><div className="bluetooth-glyph">ᛒ</div></div>
          <label className="select-label">选择电脑内置蓝牙</label>
          <select value={busId} onChange={(event) => setSelectedBusId(event.target.value)} disabled={!allReady || Boolean(activeBusId)}>
            {adapters.length ? adapters.map((adapter) => <option key={adapter.busId} value={adapter.busId}>{adapter.description} · {adapter.busId} · {adapter.state}</option>) : <option value="">未检测到 USB 蓝牙适配器</option>}
          </select>
          {activeBusId ? (
            <button className="primary-button purple" disabled={Boolean(busy)} onClick={() => action('release', () => window.squidSketch.system.releaseBluetooth())}>↩ 归还蓝牙给 Windows</button>
          ) : (
            <button className="primary-button purple" disabled={!allReady || !busId || Boolean(busy)} onClick={() => action('attach', () => window.squidSketch.system.attachBluetooth(busId))}>⚡ 临时接管蓝牙</button>
          )}
          <p className="fine-print">断开虚拟手柄不会归还蓝牙；请在此处点击“归还蓝牙给 Windows”，正常退出应用时也会自动归还。</p>
        </article>

        <article className="card safety-card">
          <div><span className="step-kicker">SAFETY</span><h2>不留下一滴墨水</h2><p>清理只移除本应用创建的 Linux 环境、USB 共享记录和由它安装的 usbipd。发现其他软件在使用 WSL 时，共享系统功能会保留。</p></div>
          <button className="ghost-button danger" disabled={Boolean(busy)} onClick={() => action('uninstall', () => window.squidSketch.system.uninstall())}>{busy === 'uninstall' ? '正在清理…' : '卸载应用依赖'}</button>
        </article>
      </div>

      <article className="card diagnostic-card">
        <div className="diagnostic-head">
          <div><span className="step-kicker">COMPATIBILITY</span><h2>硬件兼容性诊断</h2><p>检查 WSL 内核、usbipd、BlueZ、NXBT 和 Linux 蓝牙控制器，不会主动接管设备。</p></div>
          <button className="ghost-button" disabled={Boolean(busy)} onClick={runDiagnostic}>{busy === 'diagnose' ? '诊断中…' : '运行诊断'}</button>
        </div>
        {diagnostic && (
          <div className="diagnostic-grid">
            {diagnostic.checks.map((check) => (
              <div className={`diagnostic-row ${check.ok ? 'ok' : check.pending ? 'pending' : 'failed'}`} key={check.id}>
                <span>{check.ok ? '✓' : check.pending ? '…' : '!'}</span>
                <div><strong>{check.label}</strong><small>{check.detail}</small></div>
              </div>
            ))}
          </div>
        )}
      </article>

      <div className="compat-strip">
        <span>兼容基线</span><strong>Windows 11 · x64 · USB 蓝牙 · Switch 2</strong><small>部分蓝牙芯片或厂商驱动可能不支持 USB/IP 接管，请先运行诊断。</small>
      </div>
    </section>
  );
}
