import { useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n';

type Props = {
  status: SystemStatus | null;
  progress: SetupProgress | null;
  refresh(): Promise<void>;
  notify(message: string): void;
};

const INSTALL_STAGES = [
  ['baseline', '检查安装前环境'],
  ['wsl-runtime', '准备 WSL 运行时'],
  ['usbipd', '准备 USB/IP 支持'],
  ['windows-features', '启用 Windows 功能'],
  ['linux-environment', '创建专用 Linux 环境'],
  ['linux-packages', '安装 BlueZ、Python 与 NXBT'],
  ['verification', '验证完整环境']
] as const;

const UNINSTALL_STAGES = [
  ['cleanup-bluetooth', '归还蓝牙设备'],
  ['cleanup-distro', '移除专用 Linux 环境'],
  ['cleanup-usbipd', '恢复 USB/IP 环境'],
  ['cleanup-wsl-runtime', '恢复 WSL 运行时'],
  ['cleanup-features', '恢复 Windows 功能'],
  ['cleanup-verification', '验证清理结果']
] as const;

const ERROR_MESSAGES: Record<string, string> = {
  ADMIN_REQUIRED: '需要管理员权限才能继续，请重新操作并允许授权。',
  COMMAND_TIMEOUT: 'Windows 操作等待超时。请重启电脑后重试，已完成的阶段会自动跳过。',
  NETWORK_OR_FILE_ERROR: '下载或文件处理失败。请检查网络和磁盘空间后重试，已下载内容会继续使用。',
  REQUIRED_FILE_MISSING: '安装文件不完整，请重新下载 SplatoonDeck 后再试。',
  SETUP_FAILED: '本阶段执行失败，环境记录和已完成进度均已保留，可以直接重试。'
};

function StatusBadge({ ok, pending = false }: { ok: boolean; pending?: boolean }) {
  const { t } = useI18n();
  return <span className={`status-badge ${ok ? 'ok' : pending ? 'pending' : 'missing'}`}>{t(ok ? '就绪' : pending ? '待完成' : '需处理')}</span>;
}

export default function SetupPage({ status, progress, refresh, notify }: Props) {
  const { t, tx } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedBusId, setSelectedBusId] = useState('');
  const [diagnostic, setDiagnostic] = useState<DiagnosticReport | null>(null);
  const [dismissedRestart, setDismissedRestart] = useState('');
  const adapters = status?.bluetooth.candidates ?? [];
  const activeBusId = status?.bluetooth.attachedBusId;
  const busId = selectedBusId || adapters[0]?.busId || '';
  const allReady = Boolean(status?.wsl.installed && status?.distro.installed && status?.usbipd.installed);
  const installRestartPending = Boolean(status?.restartRequired && status.restartReason !== 'uninstall');
  const uninstallRestartPending = Boolean(status?.restartRequired && status.restartReason === 'uninstall');
  const installResumePending = progress?.operation === 'install' && progress.lifecycle === 'installing' && progress.stageStatus === 'ready-to-continue';
  const dependenciesRemoved = status?.installMarker?.lifecycle === 'uninstalled';
  const operationRunning = Boolean(progress && ['installing', 'uninstalling'].includes(progress.lifecycle) && !['restart-required', 'ready-to-continue', 'completed', 'failed'].includes(progress.stageStatus));
  const operationFailed = Boolean(progress?.stageStatus.startsWith('failed') || progress?.lifecycle.endsWith('-failed'));
  const operationStages = progress?.operation === 'uninstall' ? UNINSTALL_STAGES : INSTALL_STAGES;
  const currentStage = progress ? operationStages[Math.max(0, progress.stageIndex - 1)] : null;
  const nextStage = progress ? operationStages[progress.stageIndex] : null;
  const downloadPercent = progress?.stageDetail.match(/Ubuntu download:\s*(\d+)%/i)?.[1];
  const visibleStageDetail = downloadPercent
    ? t('正在下载 Linux 环境：{{percent}}%', { percent: downloadPercent })
    : currentStage ? t(currentStage[1]) : tx(progress?.stageDetail || '');
  const restartKey = status?.restartRequired ? `${status.restartReason}:${progress?.operationId || 'pending'}` : '';
  const showRestartDialog = Boolean(restartKey && restartKey !== dismissedRestart);
  const steps = useMemo(() => [
    { title: 'WSL 2', detail: t('隔离运行 Linux 蓝牙协议栈'), ok: Boolean(status?.wsl.installed) },
    { title: t('专用环境'), detail: t('只存放 SplatoonDeck 的 BlueZ 与 NXBT'), ok: Boolean(status?.distro.installed) },
    { title: 'USB/IP', detail: t('把内置蓝牙临时交给 WSL'), ok: Boolean(status?.usbipd.installed) }
  ], [status, t]);

  const action = async (name: string, operation: () => Promise<unknown>) => {
    try {
      setBusy(name);
      const result = await operation() as { ok?: boolean; message?: string };
      await refresh();
      if (result?.ok === false) throw new Error(result.message || t('操作失败，已保留进度，请重试'));
    } catch (error) {
      notify(tx(error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(null);
    }
  };

  const restartWindows = async () => {
    try {
      setBusy('restart');
      await window.splatoonDeck.system.restartWindows();
    } catch (error) {
      notify(tx(error instanceof Error ? error.message : String(error)));
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
        <div className="restart-banner"><strong>{t('需要重启 Windows')}</strong><span>{t('前置依赖已准备完成。重启后点击“继续安装”，安装会从下一阶段继续。')}</span><button onClick={restartWindows}>{t('立即重启')}</button></div>
      )}
      {uninstallRestartPending && (
        <div className="restart-banner"><strong>{t('清理完成，等待重启')}</strong><span>{t('SplatoonDeck 添加的依赖已经移除；重启 Windows 后系统组件清理将完全生效。')}</span><button onClick={restartWindows}>{t('立即重启')}</button></div>
      )}
      {status?.bluetooth.recoveredSession && activeBusId && (
        <div className="restart-banner recovery-banner"><strong>{t('已恢复上次会话')}</strong><span>{t('检测到蓝牙仍由 WSL 接管，可点击“归还蓝牙”安全恢复 Windows 蓝牙。')}</span></div>
      )}

      {progress && (
        <section className={`setup-operation ${operationFailed ? 'failed' : progress.stageStatus === 'restart-required' ? 'restart' : ''}`} aria-live="polite">
          <div className="setup-operation-head">
            <div><span className="step-kicker">{progress.operation === 'uninstall' ? t('环境清理') : t('环境安装')}</span><h2>{t(operationFailed ? '操作需要处理' : progress.stageStatus === 'completed' ? '操作已完成' : progress.stageStatus === 'restart-required' ? '等待 Windows 重启' : progress.stageStatus === 'ready-to-continue' ? '可以继续安装' : '正在执行')}</h2></div>
            <strong>{Math.round(progress.progressPercent)}%</strong>
          </div>
          <div className="setup-progress-track"><i style={{ width: `${progress.progressPercent}%` }} /></div>
          <div className="setup-stage-list">
            {operationStages.map(([phase, title], index) => {
              const number = index + 1;
              const paused = ['restart-required', 'ready-to-continue'].includes(progress.stageStatus);
              const complete = progress.stageStatus === 'completed' || number < progress.stageIndex || (paused && number <= progress.stageIndex);
              const current = number === progress.stageIndex && !complete;
              const failed = current && operationFailed;
              return <div className={`setup-stage ${complete ? 'complete' : current ? failed ? 'failed' : 'current' : ''}`} key={phase}><span>{complete ? '✓' : failed ? '!' : number}</span><small>{t(title)}</small></div>;
            })}
          </div>
          <div className="setup-operation-detail">
            <div><strong>{operationFailed ? t('本阶段未完成') : t('当前阶段')}</strong><span>{visibleStageDetail}</span></div>
            {nextStage && !operationFailed && <div><strong>{t('下一步')}</strong><span>{t(nextStage[1])}</span></div>}
            {operationFailed && <div className="setup-error"><strong>{progress.errorCode || 'SETUP_FAILED'}</strong><span>{t(ERROR_MESSAGES[progress.errorCode || 'SETUP_FAILED'] || ERROR_MESSAGES.SETUP_FAILED)}{progress.awaitingUserConfirmation && <em>{t('安装窗口正在等待确认，请查看错误详情并按 Enter 关闭窗口。')}</em>}</span></div>}
          </div>
        </section>
      )}

      <div className="setup-grid">
        <article className="card setup-card">
          <div className="card-title"><div><span className="step-kicker">STEP 01</span><h2>{t('运行环境')}</h2></div><StatusBadge ok={allReady && !uninstallRestartPending} pending={installRestartPending || installResumePending || uninstallRestartPending} /></div>
          <div className="dependency-list">
            {steps.map((step, index) => (
              <div className="dependency-row" key={step.title}>
                <span className={`dependency-icon ${step.ok ? 'done' : ''}`}>{step.ok ? '✓' : index + 1}</span>
                <div><strong>{step.title}</strong><small>{step.detail}</small></div>
                <span className={step.ok ? 'dot ok' : 'dot'} />
              </div>
            ))}
          </div>
          <button className="primary-button lime" disabled={Boolean(busy) || operationRunning || uninstallRestartPending} onClick={() => action('install', () => window.splatoonDeck.system.install())}>
            {busy === 'install' ? <i className="spinner" /> : '→'} {t(uninstallRestartPending ? '重启后可重新安装' : allReady ? '检查 / 修复依赖' : installRestartPending ? '重启后继续安装' : installResumePending ? '继续安装' : '一键安装依赖')}
          </button>
          <p className="fine-print">{t('安装需要管理员确认和网络连接；首次安装会分阶段进行，并可能要求重启。')}</p>
        </article>

        <article className="card setup-card accent-purple">
          <div className="card-title"><div><span className="step-kicker">STEP 02</span><h2>{t('蓝牙接管')}</h2></div><StatusBadge ok={Boolean(activeBusId)} /></div>
          <div className="adapter-visual"><div className="radio-wave wave-1" /><div className="radio-wave wave-2" /><div className="bluetooth-glyph">ᛒ</div></div>
          <label className="select-label">{t('选择电脑内置蓝牙')}</label>
          <select value={busId} onChange={(event) => setSelectedBusId(event.target.value)} disabled={!allReady || Boolean(activeBusId) || operationRunning}>
            {adapters.length ? adapters.map((adapter) => <option key={adapter.busId} value={adapter.busId}>{adapter.description} · {adapter.busId} · {adapter.state}</option>) : <option value="">{t('未检测到 USB 蓝牙适配器')}</option>}
          </select>
          {activeBusId ? (
            <button className="primary-button purple" disabled={Boolean(busy) || operationRunning} onClick={() => action('release', () => window.splatoonDeck.system.releaseBluetooth())}>↩ {t('归还蓝牙给 Windows')}</button>
          ) : (
            <button className="primary-button purple" disabled={!allReady || !busId || Boolean(busy) || operationRunning} onClick={() => action('attach', () => window.splatoonDeck.system.attachBluetooth(busId))}>⚡ {t('临时接管蓝牙')}</button>
          )}
          <p className="fine-print">{t('断开虚拟手柄不会归还蓝牙；请在此处点击“归还蓝牙给 Windows”，正常退出应用时也会自动归还。')}</p>
        </article>

        <article className="card safety-card">
          <div><span className="step-kicker">SAFETY</span><h2>{t('不留下一滴墨水')}</h2><p>{t('清理只移除本应用创建的 Linux 环境、WSL 运行时、USB 共享记录和 usbipd。安装前已有或正被其他软件使用的组件会保留。')}</p></div>
          <button className="ghost-button danger" disabled={Boolean(busy) || operationRunning || dependenciesRemoved} onClick={() => action('uninstall', () => window.splatoonDeck.system.uninstall())}>{t(busy === 'uninstall' ? '正在清理…' : dependenciesRemoved ? '依赖已卸载' : progress?.lifecycle === 'uninstall-failed' ? '重试清理未完成项目' : '卸载应用依赖')}</button>
        </article>
      </div>

      <article className="card diagnostic-card">
        <div className="diagnostic-head">
          <div><span className="step-kicker">COMPATIBILITY</span><h2>{t('硬件兼容性诊断')}</h2><p>{t('检查 WSL 内核、usbipd、BlueZ、NXBT 和 Linux 蓝牙控制器，不会主动接管设备。')}</p></div>
          <button className="ghost-button" disabled={Boolean(busy) || operationRunning} onClick={runDiagnostic}>{t(busy === 'diagnose' ? '诊断中…' : '运行诊断')}</button>
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

      {showRestartDialog && (
        <div className="setup-dialog-backdrop" role="presentation">
          <div className="setup-restart-dialog" role="dialog" aria-modal="true" aria-labelledby="restart-title">
            <span className="restart-symbol">↻</span>
            <h2 id="restart-title">{t('需要重启 Windows')}</h2>
            <p>{t(status?.restartReason === 'uninstall' ? '重启后，系统会完成本次依赖清理。未完成的清理项目仍可继续重试。' : '重启后再次打开 SplatoonDeck，点击继续安装即可从下一阶段开始。')}</p>
            <div><button className="ghost-button" onClick={() => setDismissedRestart(restartKey)}>{t('稍后我自己重启')}</button><button className="primary-button lime" disabled={busy === 'restart'} onClick={restartWindows}>{t(busy === 'restart' ? '正在重启…' : '立即重启')}</button></div>
          </div>
        </div>
      )}
    </section>
  );
}
