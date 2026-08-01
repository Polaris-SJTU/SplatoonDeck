export function drawingScanPercent(startRow: number, endRow: number, progress: number, canvasHeight: number) {
  const safeHeight = Math.max(1, canvasHeight);
  const safeStart = Math.max(1, Math.min(safeHeight, Math.round(startRow)));
  const safeEnd = Math.max(safeStart, Math.min(safeHeight, Math.round(endRow)));
  const safeProgress = Math.max(0, Math.min(1, progress));
  const row = (safeStart - 1) + (safeEnd - safeStart + 1) * safeProgress;
  return Math.max(0, Math.min(100, row / safeHeight * 100));
}

export function estimateResumeRow(startRow: number, endRow: number, progress: number) {
  const safeStart = Math.max(1, Math.round(startRow));
  const safeEnd = Math.max(safeStart, Math.round(endRow));
  const safeProgress = Math.max(0, Math.min(1, progress));
  return Math.max(safeStart, Math.min(safeEnd, safeStart + Math.floor((safeEnd - safeStart + 1) * safeProgress)));
}
