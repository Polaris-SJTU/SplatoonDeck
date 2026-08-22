import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { CANVAS_HEIGHT, CANVAS_WIDTH, createCalibrationPixels, DitherMode, DrawPathPoint, FitMode, formatDuration, generateMacro, getDrawPath, ImageSettings, processImage, resolveScanDirection, ScanDirection } from '../lib/image';
import { estimateResumeRow } from '../lib/drawing-state';
import { useI18n } from '../lib/i18n';

type Props = {
  connection: 'offline' | 'connecting' | 'pairing' | 'connected' | 'error';
  progress: number | null;
  elapsedMs: number;
  onNeedController(): void;
  notify(message: string): void;
};

const defaultSettings: ImageSettings = { brightness: 0, contrast: 12, threshold: 128, dither: 'floyd-steinberg', fit: 'contain', invert: false };

function Range({ label, value, min, max, disabled = false, onChange }: { label: string; value: number; min: number; max: number; disabled?: boolean; onChange(value: number): void }) {
  return <label className="range-control"><span>{label}<b>{value}</b></span><input disabled={disabled} type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function RowRange({ label, value, min, max, disabled, onChange }: { label: string; value: number; min: number; max: number; disabled: boolean; onChange(value: number): void }) {
  const update = (value: number) => onChange(Math.max(min, Math.min(max, Math.round(value))));
  return <div className="row-range-control">
    <div><span>{label}</span><label><input aria-label={label} disabled={disabled} type="number" min={min} max={max} value={value} onChange={(event) => update(Number(event.target.value))} /><em>/ {max}</em></label></div>
    <input disabled={disabled} type="range" min={min} max={max} value={value} onChange={(event) => update(Number(event.target.value))} />
  </div>;
}

function PixelPreview({ pixels, drawPath, drawCount, isDrawing }: { pixels: Uint8Array; drawPath: DrawPathPoint[]; drawCount: number; isDrawing: boolean }) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || pixels.length !== CANVAS_WIDTH * CANVAS_HEIGHT) return;
    context.imageSmoothingEnabled = false;
    const imageData = context.createImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
    const drawn = new Set<number>();
    if (isDrawing) {
      const limit = Math.min(drawCount, drawPath.length);
      for (let i = 0; i < limit; i++) drawn.add(drawPath[i].y * CANVAS_WIDTH + drawPath[i].x);
    }
    for (let index = 0; index < pixels.length; index++) {
      const offset = index * 4;
      if (isDrawing && drawn.has(index)) {
        imageData.data[offset] = 235;
        imageData.data[offset + 1] = 50;
        imageData.data[offset + 2] = 90;
        imageData.data[offset + 3] = 255;
      } else {
        const value = pixels[index] ? 12 : 250;
        imageData.data[offset] = value;
        imageData.data[offset + 1] = value;
        imageData.data[offset + 2] = value;
        imageData.data[offset + 3] = 255;
      }
    }
    context.putImageData(imageData, 0, 0);
  }, [pixels, drawPath, drawCount, isDrawing]);
  return <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} aria-label={t('320 × 120 像素绘制预览')} />;
}

export default function StudioPage({ connection, progress, elapsedMs, onNeedController, notify }: Props) {
  const { locale, t, tx } = useI18n();
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState('');
  const [settings, setSettings] = useState(defaultSettings);
  const [pixels, setPixels] = useState<Uint8Array | null>(null);
  const [speed, setSpeed] = useState(45);
  const [scanDirection, setScanDirection] = useState<ScanDirection>('auto');
  const [startRow, setStartRow] = useState(1);
  const [endRow, setEndRow] = useState(CANVAS_HEIGHT);
  const [launching, setLaunching] = useState(false);
  const [resumeEstimate, setResumeEstimate] = useState<number | null>(null);
  const resolvedDirection: 'row' | 'column' = scanDirection === 'auto' && pixels ? resolveScanDirection(pixels, CANVAS_WIDTH, CANVAS_HEIGHT) : scanDirection === 'column' ? 'column' : 'row';
  const bandMax = resolvedDirection === 'row' ? CANVAS_HEIGHT : CANVAS_WIDTH;

  // Process image when source or settings change.
  useEffect(() => {
    if (!source) return;
    const result = processImage(source, settings);
    setPixels(result.pixels);
  }, [source, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset row/column range to full when a new image is loaded or when
  // the resolved scan direction changes (including auto direction flips).
  useEffect(() => {
    setStartRow(1);
    setEndRow(bandMax);
  }, [bandMax, source]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (progress !== null) setLaunching(false); }, [progress]);

  const macro = useMemo(() => pixels ? generateMacro(pixels, CANVAS_WIDTH, CANVAS_HEIGHT, {
    pressDurationMs: speed, autoSave: true, startRow: startRow - 1, endRow: endRow - 1, scanDirection
  }) : null, [pixels, speed, startRow, endRow, scanDirection]);

  const drawPath = useMemo(() => pixels ? getDrawPath(pixels, CANVAS_WIDTH, CANVAS_HEIGHT, {
    pressDurationMs: speed, autoSave: false, startRow: startRow - 1, endRow: endRow - 1, scanDirection
  }) : [], [pixels, startRow, endRow, scanDirection]);

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { notify(t('请选择 PNG、JPG 或 WebP 图片')); return; }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { setSource(image); setFileName(file.name); };
    image.onerror = () => { URL.revokeObjectURL(url); notify(t('图片读取失败')); };
    image.src = url;
  };

  const loadCalibration = () => {
    const calibration = createCalibrationPixels();
    setSource(null);
    setPixels(calibration);
    setFileName('Splatoon 3 · 8×7 真机校准图');
    setStartRow(1);
    setEndRow(7);
    setScanDirection('row');
    notify(t('校准图已载入：开始后会自动清空、选择最小画笔并定位光标'));
  };

  const start = async () => {
    if (connection !== 'connected') { onNeedController(); notify(t('请先连接虚拟 Pro Controller')); return; }
    if (!macro) { notify(t('请先导入图片')); return; }
    setLaunching(true); setResumeEstimate(null);
    try {
      const result = await window.splatoonDeck.controller.runMacro(macro.macro, {
        kind: 'drawing',
        durationMs: macro.durationMs, preparationDurationMs: macro.preparationDurationMs,
        inputCount: macro.inputCount, fileName, startRow, endRow,
        canvasWidth: CANVAS_WIDTH, canvasHeight: CANVAS_HEIGHT,
        plannedBlackPixels: macro.plannedBlackPixels, pixelChecksum: macro.pixelChecksum
      });
      if (!result.ok) { setLaunching(false); notify(t('绘制指令发送失败，请检查虚拟手柄连接')); }
    } catch (error) {
      setLaunching(false); notify(tx(error instanceof Error ? error.message : String(error)));
    }
  };

  const running = progress !== null && progress < 1;
  const parametersLocked = running || launching;
  // Use the real elapsed time reported by the Python bridge (measured
  // with time.monotonic) instead of re-deriving from progress, which is
  // capped at 0.995 and loses precision near the end.
  const realElapsedMs = running ? elapsedMs : 0;
  const drawingDurationMs = macro ? Math.max(1, macro.durationMs - macro.preparationDurationMs) : 1;
  const drawingProgress = macro ? Math.max(0, Math.min(1, (realElapsedMs - macro.preparationDurationMs) / drawingDurationMs)) : 0;
  // Count how many pixels have been painted based on actual per-pixel
  // timestamps from the macro, so the red preview stays in sync with
  // real hardware timing instead of a linear estimate.
  const drawElapsedMs = running && macro ? Math.max(0, realElapsedMs - macro.preparationDurationMs) : 0;
  const drawCount = useMemo(() => {
    if (!macro || macro.pixelTimestamps.length === 0) return 0;
    const ts = macro.pixelTimestamps;
    // Binary search for the last timestamp <= drawElapsedMs.
    let lo = 0, hi = ts.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ts[mid] <= drawElapsedMs) lo = mid + 1; else hi = mid; }
    return lo;
  }, [macro, drawElapsedMs]);
  const preparing = running && !!macro && realElapsedMs < macro.preparationDurationMs;
  const remainingMs = macro ? Math.max(0, macro.durationMs - realElapsedMs) : 0;
  const stop = async () => {
    const estimate = estimateResumeRow(startRow, endRow, drawingProgress);
    setResumeEstimate(estimate);
    const result = await window.splatoonDeck.controller.stopMacro();
    if (!result.ok) notify(t('停止指令发送失败，请稍后重试'));
  };
  const changeStartRow = (value: number) => { setStartRow(value); if (value > endRow) setEndRow(value); };
  const changeEndRow = (value: number) => { setEndRow(value); if (value < startRow) setStartRow(value); };
  return (
    <section className="page studio-page">
      <header className="page-header compact"><div><span className="eyebrow">INK LAB</span><h1>320 × 120 <span>{t('涂鸦工坊')}</span></h1><p>{t('导入图片、实时抖动预览，再让虚拟手柄逐像素复刻到游戏画布。')}</p></div><div className="canvas-chip"><strong>38,400</strong><span>PIXELS</span></div></header>

      <div className="studio-layout">
        <article className={`card upload-panel ${parametersLocked ? 'controls-locked' : ''}`} aria-disabled={parametersLocked}>
          <div className="panel-heading"><span className="step-kicker">SOURCE</span><h2>{t('导入图片')}</h2></div>
          <label className={`drop-zone ${source ? 'has-image' : ''}`}>
            <input disabled={parametersLocked} type="file" accept="image/png,image/jpeg,image/webp,image/bmp" onChange={chooseFile} />
            {source ? <><img src={source.src} alt={t('原图')} /><div className="replace-overlay">{t('点击更换图片')}</div></> : <><div className="upload-glyph">↥</div><strong>{t('把图片扔进来')}</strong><span>{t('或点击选择 PNG / JPG / WebP')}</span><small>{t('会自动适配为黑白像素图')}</small></>}
          </label>
          <button disabled={parametersLocked} className="ghost-button wide" onClick={loadCalibration}>✦ {t('载入 8×7 真机校准图')}</button>
          {fileName && <div className="file-chip"><span>IMG</span><div><strong>{t(fileName)}</strong><small>{t('已载入并本地处理')}</small></div></div>}

          <div className="panel-heading settings-heading"><span className="step-kicker">TUNE</span><h2>{t('图像调校')}</h2></div>
          <div className="segmented">
            {(['contain', 'cover', 'stretch'] as FitMode[]).map((fit) => <button disabled={parametersLocked} key={fit} className={settings.fit === fit ? 'active' : ''} onClick={() => setSettings({ ...settings, fit })}>{t(fit === 'contain' ? '完整' : fit === 'cover' ? '裁满' : '拉伸')}</button>)}
          </div>
          <Range disabled={parametersLocked} label={t('亮度')} value={settings.brightness} min={-100} max={100} onChange={(brightness) => setSettings({ ...settings, brightness })} />
          <Range disabled={parametersLocked} label={t('对比度')} value={settings.contrast} min={-100} max={100} onChange={(contrast) => setSettings({ ...settings, contrast })} />
          <Range disabled={parametersLocked} label={t('黑白阈值')} value={settings.threshold} min={20} max={235} onChange={(threshold) => setSettings({ ...settings, threshold })} />
          <label className="select-label">{t('抖动算法')}</label>
          <select disabled={parametersLocked} value={settings.dither} onChange={(event) => setSettings({ ...settings, dither: event.target.value as DitherMode })}>
            <option value="floyd-steinberg">Floyd–Steinberg · {t('细腻')}</option><option value="atkinson">Atkinson · {t('清爽')}</option><option value="bayer">Bayer 4×4 · {t('网点')}</option><option value="threshold">{t('纯阈值 · 线稿')}</option>
          </select>
          <label className="toggle-row"><span><strong>{t('反转黑白')}</strong><small>{t('适合深色底图')}</small></span><input disabled={parametersLocked} type="checkbox" checked={settings.invert} onChange={(event) => setSettings({ ...settings, invert: event.target.checked })} /><i /></label>
        </article>

        <article className="card preview-panel">
          <div className="preview-top"><div className="panel-heading"><span className="step-kicker">GAME PREVIEW</span><h2>{t('游戏画布预览')}</h2></div><span className={`resolution-badge ${macro?.verified ? 'verified' : ''}`}>320 × 120 · 1 BIT{macro?.verified ? ` · ${t('路径已校验')}` : ''}</span></div>
          <div className={`pixel-canvas ${pixels ? '' : 'empty'}`}>
            <div className="canvas-grid" />
            {pixels ? <PixelPreview pixels={pixels} drawPath={drawPath} drawCount={drawCount} isDrawing={running && !preparing} /> : <div><span>⌁</span><strong>{t('等待你的作品')}</strong><small>{t('左侧导入图片后会在这里实时预览')}</small></div>}
            {running && !preparing && drawPath.length > 0 && (() => { const ci = Math.min(drawCount, drawPath.length - 1); const cx = drawPath[ci].x / CANVAS_WIDTH * 100; const cy = drawPath[ci].y / CANVAS_HEIGHT * 100; return <div className="cursor-dot" style={{ left: `${cx}%`, top: `${cy}%` }} />; })()}
          </div>
          <div className="pixel-stats">
            <div><span className="stat-dot black" /><span>{t('黑色像素')}</span><strong>{macro?.blackPixels.toLocaleString(locale) ?? '—'}</strong></div>
            <div><span className="stat-dot white" /><span>{t('白色像素')}</span><strong>{macro ? (CANVAS_WIDTH * CANVAS_HEIGHT - macro.blackPixels).toLocaleString(locale) : '—'}</strong></div>
            <div><span className="stat-dot purple" /><span>{t('输入指令')}</span><strong>{macro?.inputCount.toLocaleString(locale) ?? '—'}</strong></div>
          </div>

          <div className={`draw-config ${parametersLocked ? 'controls-locked' : ''}`}>
            <div className="panel-heading"><span className="step-kicker">PRINT</span><h2>{t('自动绘制')}</h2></div>
            <div className="segmented">
              {(['auto', 'row', 'column'] as ScanDirection[]).map((dir) => <button disabled={parametersLocked} key={dir} className={scanDirection === dir ? 'active' : ''} onClick={() => setScanDirection(dir)}>{t(dir === 'auto' ? '自动' : dir === 'row' ? '逐行' : '逐列')}</button>)}
            </div>
            <Range disabled={parametersLocked} label={t('单步脉冲 (ms)')} value={speed} min={35} max={90} onChange={setSpeed} />
            <RowRange label={t(resolvedDirection === 'row' ? '续画起始行' : '续画起始列')} value={startRow} min={1} max={bandMax} disabled={parametersLocked} onChange={changeStartRow} />
            <RowRange label={t(resolvedDirection === 'row' ? '本批结束行' : '本批结束列')} value={endRow} min={1} max={bandMax} disabled={parametersLocked} onChange={changeEndRow} />
            
            {!running && resumeEstimate !== null && <div className="resume-row-card"><div><strong>{t('绘制已中止')}</strong><span>{t('根据停止时进度，建议从第 {{position}} {{unit}}附近续画；请对照游戏画面修正。', { position: resumeEstimate, unit: t(resolvedDirection === 'row' ? '行' : '列') })}</span></div><button onClick={() => changeStartRow(resumeEstimate)}>{t('使用第 {{position}} {{unit}}', { position: resumeEstimate, unit: t(resolvedDirection === 'row' ? '行' : '列') })}</button></div>}
            <div className="draw-summary"><span>{t('预计耗时')}<strong>{macro ? formatDuration(macro.durationMs, locale) : '—'}</strong></span><span>{t('绘制范围')}<strong>{startRow}–{endRow} {t(resolvedDirection === 'row' ? '行' : '列')}</strong></span><span>{t('启动准备')}<strong>{t('全自动')}</strong></span></div>
            {macro && macro.skippedBands > 0 && <div className="draw-summary"><span>{t('跳过空白')}<strong>{macro.skippedBands} / {macro.totalBands} {t(resolvedDirection === 'row' ? '行' : '列')}</strong></span><span>{t('内容范围')}<strong>{macro.contentFirstBand + 1}–{macro.contentLastBand + 1} {t(resolvedDirection === 'row' ? '行' : '列')}</strong></span>{scanDirection === 'auto' && <span>{t('扫描方向')}<strong>{t(macro.scanDirection === 'row' ? '逐行' : '逐列')}</strong></span>}</div>}
            {running && <div className="progress-block"><div><strong>{t(preparing ? '正在准备画布…' : '正在喷墨…')}</strong><span>{Math.round((progress ?? 0) * 100)}%</span></div><div className="progress-remaining"><span>{t('剩余时间')}</span><strong>{formatDuration(remainingMs, locale)}</strong></div><div className="progress-track"><i style={{ width: `${(progress ?? 0) * 100}%` }} /></div></div>}
            <div className="draw-actions">
              {running ? <button className="ghost-button danger wide" onClick={stop}>■ {t('停止绘制')}</button> : <button className="primary-button hot-pink wide" disabled={!pixels || launching} onClick={start}>{launching ? t('正在发送绘制指令…') : connection === 'connected' ? `▶ ${t('开始自动绘制')}` : t('连接手柄后开始')}</button>}
            </div>
            <p className="fine-print center">{t('每次方向移动都包含独立按下与松开帧；逐行固定从左边界归位，逐列固定从顶部边界归位。预览和绘制共用同一份 320 × 120 二值矩阵。')}</p>
          </div>
        </article>
      </div>
    </section>
  );
}
