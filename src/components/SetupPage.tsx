import { useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n';

type Props = {
  status: SystemStatus | null;
  refresh(): Promise<void>;
  notify(message: string): void;
};

function StatusBadge({ ok, pending = false }: { ok: boolean; pending?: boolean }) {
  const { t } = useI18n();
  return <span className={`status-badge ${ok ? 'ok' : pending ? 'pending' : 'missing'}`}>{t(ok ? '就绪' : pending ? '待完成' : '需处理')}</span>;
}

export default function SetupPage({ status, refresh, notify }: Props) {
  const { t, tx } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedBusId, setSelectedBusId] = useState('');
  const [diagnostic, setDiagnostic] = useState<DiagnosticReport | null>(null);
  const adapters = status?.bluetooth.candidates ?? [];
  const activeBusId = status?.bluetooth.attachedBusId;
  const busId = selectedBusId || adapters[0]?.busId || '';
  const allReady = Boolean(status?.wsl.installed && status?.distro.installed && status?.usbipd.installed);
  const installRestartPending = Boolean(status?.restartRequired && status.restartReason !== 'uninstall');
  const uninstallRestartPending = Boolean(status?.restartRequired && status.restartReason === 'uninstall');
  const dependenciesRemoved = status?.installMarker?.lifecycle === 'uninstalled';
  const steps = useMemo(() => [
    { title: 'WSL 2', detail: t('隔离运行 Linux 蓝牙协议栈'), ok: Boolean(status?.wsl.installed) },
    { title: t('专用环境'), detail: t('只存放 SplatoonDeck 的 BlueZ 与 NXBT'), ok: Boolean(status?.distro.installed) },
    { title: 'USB/IP', detail: t('把内置蓝牙临时交给 WSL'), ok: Boolean(status?.usbipd.installed) }
  ], [status, t]);

  const action = async (name: string, operation: () => Promise<unknown>) => {
    try {
      setBusy(name);
      await operation();
      await refresh();
    } catch (error) {
      notify(tx(error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(null);
    }
  };

  const runDiagnostic = async () => {
    try {
      setBusy('diagnose');
      const report = await window.splatoonDeck.system.diagnose();
      setDiagnostic(report);
      notify(report.ok ? t('兼容性诊断通过') : t('诊断完成：{{count}} 项需要处理', { count: report.failed }));
      await refresh();
    } catch (error) {
      notify(tx(error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="page setup-page">
      <header className="page-header">
        <div><span className="eyebrow">GET READY</span><h1>{t('准备你的')}<span>{t('墨水舱')}</span></h1><p>{t('一次配置，之后打开应用即可连接。系统改动都会记录，也能安全清理。')}</p></div>
        <button className="icon-button" onClick={refresh} aria-label={t('刷新')}>↻</button>
      </header>

      {installRestartPending && (
        <div className="restart-banner"><strong>{t('需要重启 Windows')}</strong><span>{t('前置依赖已准备完成。重启后点击“继续安装”，安装会从下一阶段继续。')}</span></div>
      )}
      {uninstallRestartPending && (
        <div className="restart-banner"><strong>{t('清理完成，等待重启')}</strong><span>{t('SplatoonDeck 添加的依赖已经移除；重启 Windows 后系统组件清理将完全生效。')}</span></div>
      )}
      {status?.bluetooth.recoveredSession && activeBusId && (
        <div className="restart-banner recovery-banner"><strong>{t('已恢复上次会话')}</strong><span>{t('检测到蓝牙仍由 WSL 接管，可点击“归还蓝牙”安全恢复 Windows 蓝牙。')}</span></div>
      )}

      <div className="setup-grid">
        <article className="card setup-card">
          <div className="card-title"><div><span className="step-kicker">STEP 01</span><h2>{t('运行环境')}</h2></div><StatusBadge ok={allReady && !uninstallRestartPending} pending={installRestartPending || uninstallRestartPending} /></div>
          <div className="dependency-list">
            {steps.map((step, index) => (
              <div className="dependency-row" key={step.title}>
                <span className={`dependency-icon ${step.ok ? 'done' : ''}`}>{step.ok ? '✓' : index + 1}</span>
                <div><strong>{step.title}</strong><small>{step.detail}</small></div>
                <span className={step.ok ? 'dot ok' : 'dot'} />
              </div>
            ))}
          </div>
          <button className="primary-button lime" disabled={Boolean(busy) || uninstallRestartPending} onClick={() => action('install', () => window.splatoonDeck.system.install())}>
            {busy === 'install' ? <i className="spinner" /> : '→'} {t(uninstallRestartPending ? '重启后可重新安装' : allReady ? '检查 / 修复依赖' : installRestartPending ? '重启后继续安装' : '一键安装依赖')}
          </button>
          <p className="fine-print">{t('安装需要管理员确认和网络连接；首次安装会分阶段进行，并可能要求重启。')}</p>
        </article>

        <article className="card setup-card accent-purple">
          <div className="card-title"><div><span className="step-kicker">STEP 02</span><h2>{t('蓝牙接管')}</h2></div><StatusBadge ok={Boolean(activeBusId)} /></div>
          <div className="adapter-visual"><div className="radio-wave wave-1" /><div className="radio-wave wave-2" /><div className="bluetooth-glyph">ᛒ</div></div>
          <label className="select-label">{t('选择电脑内置蓝牙')}</label>
          <select value={busId} onChange={(event) => setSelectedBusId(event.target.value)} disabled={!allReady || Boolean(activeBusId)}>
            {adapters.length ? adapters.map((adapter) => <option key={adapter.busId} value={adapter.busId}>{adapter.description} · {adapter.busId} · {adapter.state}</option>) : <option value="">{t('未检测到 USB 蓝牙适配器')}</option>}
          </select>
          {activeBusId ? (
            <button className="primary-button purple" disabled={Boolean(busy)} onClick={() => action('release', () => window.splatoonDeck.system.releaseBluetooth())}>↩ {t('归还蓝牙给 Windows')}</button>
          ) : (
            <button className="primary-button purple" disabled={!allReady || !busId || Boolean(busy)} onClick={() => action('attach', () => window.splatoonDeck.system.attachBluetooth(busId))}>⚡ {t('临时接管蓝牙')}</button>
          )}
          <p className="fine-print">{t('断开虚拟手柄不会归还蓝牙；请在此处点击“归还蓝牙给 Windows”，正常退出应用时也会自动归还。')}</p>
        </article>

        <article className="card safety-card">
          <div><span className="step-kicker">SAFETY</span><h2>{t('不留下一滴墨水')}</h2><p>{t('清理只移除本应用创建的 Linux 环境、WSL 运行时、USB 共享记录和 usbipd。安装前已有或正被其他软件使用的组件会保留。')}</p></div>
          <button className="ghost-button danger" disabled={Boolean(busy) || dependenciesRemoved} onClick={() => action('uninstall', () => window.splatoonDeck.system.uninstall())}>{t(busy === 'uninstall' ? '正在清理…' : dependenciesRemoved ? '依赖已卸载' : '卸载应用依赖')}</button>
        </article>
      </div>

      <article className="card diagnostic-card">
        <div className="diagnostic-head">
          <div><span className="step-kicker">COMPATIBILITY</span><h2>{t('硬件兼容性诊断')}</h2><p>{t('检查 WSL 内核、usbipd、BlueZ、NXBT 和 Linux 蓝牙控制器，不会主动接管设备。')}</p></div>
          <button className="ghost-button" disabled={Boolean(busy)} onClick={runDiagnostic}>{t(busy === 'diagnose' ? '诊断中…' : '运行诊断')}</button>
        </div>
        {diagnostic && (
          <div className="diagnostic-grid">
            {diagnostic.checks.map((check) => (
              <div className={`diagnostic-row ${check.ok ? 'ok' : check.pending ? 'pending' : 'failed'}`} key={check.id}>
                <span>{check.ok ? '✓' : check.pending ? '…' : '!'}</span>
                <div><strong>{t(check.label)}</strong><small>{tx(check.detail)}</small></div>
              </div>
            ))}
          </div>
        )}
      </article>

      <div className="compat-strip">
        <span>{t('兼容基线')}</span><strong>Windows 11 · x64 · USB Bluetooth · Switch 2</strong><small>{t('部分蓝牙芯片或厂商驱动可能不支持 USB/IP 接管，请先运行诊断。')}</small>
      </div>
    </section>
  );
}
