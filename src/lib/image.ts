export const CANVAS_WIDTH = 320;
export const CANVAS_HEIGHT = 120;

export type DitherMode = 'threshold' | 'floyd-steinberg' | 'atkinson' | 'bayer';
export type FitMode = 'contain' | 'cover' | 'stretch';
export type ScanDirection = 'auto' | 'row' | 'column';

export type ImageSettings = {
  brightness: number;
  contrast: number;
  threshold: number;
  dither: DitherMode;
  fit: FitMode;
  invert: boolean;
};

export type MacroOptions = {
  pressDurationMs: number;
  autoSave: boolean;
  startRow?: number;
  endRow?: number;
  scanDirection?: ScanDirection;
};

export type MacroResult = {
  macro: string;
  inputCount: number;
  durationMs: number;
  preparationDurationMs: number;
  blackPixels: number;
  plannedBlackPixels: number;
  pixelChecksum: string;
  verified: true;
  scanDirection: 'row' | 'column';
  skippedBands: number;
  totalBands: number;
  contentFirstBand: number;
  contentLastBand: number;
  pixelTimestamps: number[];
};

export const NXBT_HZ = 132;

/**
 * Convert a theoretical millisecond duration to the actual wall-clock time
 * NXBT will take per macro line.  NXBT's mainloop runs at 132 Hz and checks
 * `time_delta > timer_length` (strict >) once per tick, then loads the next
 * line on the following tick.  So the actual duration per line is:
 *   (floor(duration_s * 132) + 2) / 132  seconds
 * The +2 = +1 for strict >, +1 because the next line starts on the next tick.
 */
export function nxbtMs(ms: number): number {
  const ticks = Math.floor((ms / 1000) * NXBT_HZ) + 2;
  return (ticks / NXBT_HZ) * 1000;
}
const STICK_LEFT = 'L_STICK@-100+000';
const STICK_RIGHT = 'L_STICK@+100+000';
const STICK_UP = 'L_STICK@+000+100';
const STICK_DOWN = 'L_STICK@+000-100';
const STICK_CENTER = 'L_STICK@+000+000';
// NXBT treats a duration-only macro line as a passive wait: it does not
// update the HID report, so the previous button remains held.  Every release
// and delay must therefore send an explicit all-neutral controller state.
const NEUTRAL_INPUT = 'L_STICK@+000+000 R_STICK@+000+000';
export function transformLuminance(value: number, brightness: number, contrast: number) {
  const brightened = value + brightness * 2.55;
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  return Math.max(0, Math.min(255, factor * (brightened - 128) + 128));
}

export function ditherLuminance(
  source: Float32Array,
  width: number,
  height: number,
  mode: DitherMode,
  threshold: number,
  invert = false
) {
  const values = new Float32Array(source);
  const output = new Uint8Array(width * height);
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const spread = (index: number, error: number, entries: Array<[number, number, number]>) => {
    const x = index % width;
    const y = Math.floor(index / width);
    for (const [dx, dy, factor] of entries) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) values[ny * width + nx] += error * factor;
    }
  };

  for (let i = 0; i < values.length; i++) {
    let localThreshold = threshold;
    if (mode === 'bayer') localThreshold += (bayer[(i % width) % 4 + (Math.floor(i / width) % 4) * 4] - 7.5) * 8;
    const white = values[i] >= localThreshold;
    const black = invert ? white : !white;
    output[i] = black ? 1 : 0;
    if (mode === 'floyd-steinberg') {
      const quantized = white ? 255 : 0;
      spread(i, values[i] - quantized, [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]]);
    } else if (mode === 'atkinson') {
      const quantized = white ? 255 : 0;
      spread(i, values[i] - quantized, [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]]);
    }
  }
  return output;
}

export function createCalibrationPixels(width = CANVAS_WIDTH, height = CANVAS_HEIGHT) {
  if (width < 8 || height < 7) throw new Error('校准图画布至少需要 8 × 7 像素');
  const pixels = new Uint8Array(width * height);
  const pattern = [
    '11111111',
    '10000001',
    '10111101',
    '10100101',
    '10111101',
    '10000001',
    '11111111'
  ];
  pattern.forEach((row, y) => {
    [...row].forEach((value, x) => { pixels[y * width + x] = value === '1' ? 1 : 0; });
  });
  return pixels;
}

export function pixelChecksum(pixels: Uint8Array, width: number, height: number) {
  if (pixels.length !== width * height) throw new Error('像素数据尺寸不匹配');
  let hash = 0x811c9dc5;
  const mix = (value: number) => {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  mix(width); mix(width >>> 8); mix(height); mix(height >>> 8);
  for (const pixel of pixels) mix(pixel ? 1 : 0);
  return hash.toString(16).padStart(8, '0').toUpperCase();
}

export function processImage(image: HTMLImageElement, settings: ImageSettings) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法创建图像画布');

  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  let dx = 0;
  let dy = 0;
  let dw = canvas.width;
  let dh = canvas.height;
  if (settings.fit !== 'stretch') {
    const scale = settings.fit === 'cover'
      ? Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight)
      : Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
    dw = sourceWidth * scale;
    dh = sourceHeight * scale;
    dx = (canvas.width - dw) / 2;
    dy = (canvas.height - dh) / 2;
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, dx, dy, dw, dh);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const luminance = new Float32Array(canvas.width * canvas.height);
  for (let i = 0; i < luminance.length; i++) {
    const offset = i * 4;
    const value = imageData.data[offset] * 0.2126 + imageData.data[offset + 1] * 0.7152 + imageData.data[offset + 2] * 0.0722;
    luminance[i] = transformLuminance(value, settings.brightness, settings.contrast);
  }
  const pixels = ditherLuminance(luminance, canvas.width, canvas.height, settings.dither, settings.threshold, settings.invert);
  for (let i = 0; i < pixels.length; i++) {
    const value = pixels[i] ? 12 : 250;
    const offset = i * 4;
    imageData.data[offset] = value;
    imageData.data[offset + 1] = value;
    imageData.data[offset + 2] = value;
    imageData.data[offset + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  return { pixels };
}

const BOUNDARY_RESET_COST = 28;
type BandSegment = { edge: 'start' | 'end'; positions: number[] };
type BandPlan = { segments: BandSegment[]; movementCost: number };

/**
 * Plan one row/column from calibrated canvas edges.  Besides choosing the
 * nearest edge, the planner may split widely separated content into a start
 * cluster and an end cluster.  This avoids crossing a large empty gap with
 * hundreds of fallible D-pad taps and is faster whenever the saved movement
 * outweighs one additional stick-to-wall calibration.
 */
function planBand(positions: number[], limit: number, allowEndAnchor = true): BandPlan {
  if (positions.length === 0) return { segments: [], movementCost: 0 };
  const startCost = BOUNDARY_RESET_COST + positions[positions.length - 1];
  if (!allowEndAnchor) {
    return { segments: [{ edge: 'start', positions: [...positions] }], movementCost: startCost };
  }
  const endCost = BOUNDARY_RESET_COST + (limit - 1 - positions[0]);
  let best: BandPlan = startCost <= endCost
    ? { segments: [{ edge: 'start', positions: [...positions] }], movementCost: startCost }
    : { segments: [{ edge: 'end', positions: [...positions].reverse() }], movementCost: endCost };

  for (let split = 0; split < positions.length - 1; split++) {
    const splitCost = BOUNDARY_RESET_COST * 2
      + positions[split]
      + (limit - 1 - positions[split + 1]);
    if (splitCost >= best.movementCost) continue;
    best = {
      segments: [
        { edge: 'start', positions: positions.slice(0, split + 1) },
        { edge: 'end', positions: positions.slice(split + 1).reverse() }
      ],
      movementCost: splitCost
    };
  }
  return best;
}

function getBandPositions(pixels: Uint8Array, width: number, height: number, direction: 'row' | 'column', band: number) {
  const positions: number[] = [];
  const limit = direction === 'row' ? width : height;
  for (let position = 0; position < limit; position++) {
    const index = direction === 'row' ? band * width + position : position * width + band;
    if (pixels[index]) positions.push(position);
  }
  return positions;
}

export function estimateScanCost(pixels: Uint8Array, width: number, height: number, direction: 'row' | 'column') {
  // Boundary calibration is deliberately retained for strict positioning.
  // Express its fixed time as an equivalent number of discrete moves so auto
  // mode compares adaptive anchoring + travel + paint taps.
  let cost = 0;
  let lastContentBand = -1;
  const bandCount = direction === 'row' ? height : width;
  const limit = direction === 'row' ? width : height;
  for (let band = 0; band < bandCount; band++) {
    const positions = getBandPositions(pixels, width, height, direction, band);
    if (positions.length === 0) continue;
    cost += planBand(positions, limit, direction === 'row').movementCost + positions.length * 1.5;
    lastContentBand = band;
  }
  return cost + Math.max(0, lastContentBand);
}

export function resolveScanDirection(pixels: Uint8Array, width: number, height: number): 'row' | 'column' {
  return estimateScanCost(pixels, width, height, 'row') <= estimateScanCost(pixels, width, height, 'column') ? 'row' : 'column';
}

export type DrawPathPoint = { x: number; y: number };

/** Returns the ordered list of pixel coordinates that will be painted. */
export function getDrawPath(pixels: Uint8Array, width: number, height: number, options: MacroOptions): DrawPathPoint[] {
  const preference = options.scanDirection ?? 'auto';
  const scanDirection: 'row' | 'column' = preference === 'column' ? 'column' : preference === 'row' ? 'row' : resolveScanDirection(pixels, width, height);
  const startBand = Math.max(0, Math.min((scanDirection === 'row' ? height : width) - 1, Math.round(options.startRow ?? 0)));
  const endBand = Math.max(startBand, Math.min((scanDirection === 'row' ? height : width) - 1, Math.round(options.endRow ?? (scanDirection === 'row' ? height : width) - 1)));
  const path: DrawPathPoint[] = [];
  const limit = scanDirection === 'row' ? width : height;
  for (let band = startBand; band <= endBand; band++) {
    const positions = getBandPositions(pixels, width, height, scanDirection, band);
    for (const segment of planBand(positions, limit, scanDirection === 'row').segments) {
      for (const position of segment.positions) {
        path.push(scanDirection === 'row' ? { x: position, y: band } : { x: band, y: position });
      }
    }
  }
  return path;
}

export function generateMacro(pixels: Uint8Array, width: number, height: number, options: MacroOptions): MacroResult {
  if (pixels.length !== width * height) throw new Error('pixel data size mismatch');
  // D-pad taps must be long enough to span multiple controller reports, but
  // stay well below the game's key-repeat window.  The previous 120–200 ms
  // hold could be interpreted as two cursor steps.  Action buttons retain a
  // longer pulse because some Switch menus sample them more slowly.
  const movePressMs = Math.max(35, Math.min(90, Math.round(options.pressDurationMs)));
  const moveReleaseMs = movePressMs;
  const actionPressMs = Math.max(65, movePressMs);
  const actionReleaseMs = Math.max(50, moveReleaseMs);
  const sec = (ms: number) => (ms / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  const preference = options.scanDirection ?? 'auto';
  const scanDirection: 'row' | 'column' = preference === 'column' ? 'column' : preference === 'row' ? 'row' : resolveScanDirection(pixels, width, height);
  const startBand = Math.max(0, Math.min((scanDirection === 'row' ? height : width) - 1, Math.round(options.startRow ?? 0)));
  const endBand = Math.max(startBand, Math.min((scanDirection === 'row' ? height : width) - 1, Math.round(options.endRow ?? (scanDirection === 'row' ? height : width) - 1)));

  const lines: string[] = [];
  let inputCount = 0;
  let totalMs = 0;
  const plannedPixels = new Uint8Array(width * height);
  const pixelTimestamps: number[] = [];
  const tapLines = (button: string, pressMs: number, releaseMs: number) => [
    `${button} ${sec(pressMs)}s`,
    `${NEUTRAL_INPUT} ${sec(releaseMs)}s`
  ];
  const appendTap = (button: string, pressMs: number, releaseMs: number) => {
    const reports = tapLines(button, pressMs, releaseMs);
    lines.push(...reports);
    inputCount += reports.length;
    totalMs += nxbtMs(pressMs) + nxbtMs(releaseMs);
  };
  const tap = (button: string) => {
    appendTap(button, actionPressMs, actionReleaseMs);
  };
  // Every move includes an explicit neutral report. Consecutive commands stay
  // distinct rising edges instead of becoming one long held input in NXBT.
  const moveTap = (button: string) => {
    appendTap(button, movePressMs, moveReleaseMs);
  };
  const wait = (ms: number) => {
    // Keep waits neutral too.  This matters after L3 clear and before menu
    // actions, where a duration-only line would extend the prior button hold.
    lines.push(`${NEUTRAL_INPUT} ${(ms / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}s`);
    inputCount += 1;
    totalMs += nxbtMs(ms);
  };
  // Emit a LOOP block that repeats a single-button tap N times.
  // NXBT expands this internally, dramatically reducing macro text size
  // for long D-pad sequences (canvas repositioning, band advancement).
  const loopTap = (button: string, count: number, action = false) => {
    if (count <= 0) return;
    const pressMs = action ? actionPressMs : movePressMs;
    const releaseMs = action ? actionReleaseMs : moveReleaseMs;
    const reports = tapLines(button, pressMs, releaseMs);
    if (count === 1) {
      lines.push(...reports);
      inputCount += reports.length;
      totalMs += nxbtMs(pressMs) + nxbtMs(releaseMs);
    } else {
      lines.push(`LOOP ${count}`, ...reports.map((report) => `  ${report}`));
      inputCount += count * reports.length;
      totalMs += count * (nxbtMs(pressMs) + nxbtMs(releaseMs));
    }
  };

  // Push the left stick to full deflection for ms, then release to center.
  // The cursor slides to the canvas wall and stops, guaranteeing a known
  // position that eliminates all accumulated D-pad drift from prior rows.
  const stickHold = (stickSpec: string, ms: number) => {
    lines.push(`${stickSpec} ${sec(ms)}s`);
    inputCount += 1;
    totalMs += nxbtMs(ms);
    const settleMs = Math.max(100, moveReleaseMs * 2);
    lines.push(`${STICK_CENTER} ${sec(settleMs)}s`);
    inputCount += 1;
    totalMs += nxbtMs(settleMs);
  };
  // --- Preparation ---
  // Reset brush to smallest size.
  loopTap('L', 3, true);
  if (startBand === 0) {
    tap('L_STICK_PRESS'); // L3 clears the canvas
    wait(500); // let the clear animation finish
  }
  // Slam cursor to top-left corner using stick wall-bounce. Faster and
  // more reliable than hundreds of D-pad taps — the cursor slides to the
  // edge and stops automatically, guaranteeing position (0, 0).
  stickHold(STICK_LEFT, 2500);
  stickHold(STICK_UP, 2500);
  if (scanDirection === 'row') {
    loopTap('DPAD_DOWN', startBand);
  } else {
    loopTap('DPAD_RIGHT', startBand);
  }
  const preparationDurationMs = totalMs;

  // --- Content-bounded, independently calibrated band drawing ---
  // All positioning uses D-pad for reliable 1-pixel steps.
  // Helper: move cursor horizontally from currentX to targetX.
  const moveX = (curX: number, targetX: number): number => {
    const delta = targetX - curX;
    if (delta > 0) loopTap('DPAD_RIGHT', delta);
    else if (delta < 0) loopTap('DPAD_LEFT', -delta);
    return targetX;
  };
  // Helper: move cursor vertically from currentY to targetY.
  const moveY = (curY: number, targetY: number): number => {
    const delta = targetY - curY;
    if (delta > 0) loopTap('DPAD_DOWN', delta);
    else if (delta < 0) loopTap('DPAD_UP', -delta);
    return targetY;
  };
  if (scanDirection === 'row') {
    for (let y = startBand; y <= endBand; y++) {
      const positions = getBandPositions(pixels, width, height, 'row', y);
      const plan = planBand(positions, width, true);
      if (plan.segments.length === 0) {
        if (y < endBand) moveTap('DPAD_DOWN');
        continue;
      }
      for (const segment of plan.segments) {
        stickHold(segment.edge === 'start' ? STICK_LEFT : STICK_RIGHT, 2500);
        let currentX = segment.edge === 'start' ? 0 : width - 1;
        for (const targetX of segment.positions) {
          currentX = moveX(currentX, targetX);
          const index = y * width + currentX;
          tap('A');
          plannedPixels[index] = 1;
          pixelTimestamps.push(totalMs - preparationDurationMs);
        }
      }
      if (y < endBand) moveTap('DPAD_DOWN');
    }
  } else {
    for (let x = startBand; x <= endBand; x++) {
      const positions = getBandPositions(pixels, width, height, 'column', x);
      // Isolate the only variable under test: column scans always anchor from
      // the top, while all pulse timings remain identical to the confirmed
      // 45 ms baseline.
      const plan = planBand(positions, height, false);
      if (plan.segments.length === 0) {
        if (x < endBand) moveTap('DPAD_RIGHT');
        continue;
      }
      for (const segment of plan.segments) {
        stickHold(segment.edge === 'start' ? STICK_UP : STICK_DOWN, 2500);
        let currentY = segment.edge === 'start' ? 0 : height - 1;
        for (const targetY of segment.positions) {
          currentY = moveY(currentY, targetY);
          const index = currentY * width + x;
          tap('A');
          plannedPixels[index] = 1;
          pixelTimestamps.push(totalMs - preparationDurationMs);
        }
      }
      if (x < endBand) moveTap('DPAD_RIGHT');
    }
  }

  // --- Verification ---
  let plannedBlackPixels = 0;
  for (let y = startBand; y <= endBand; y++) {
    const limit = scanDirection === 'row' ? width : height;
    for (let i = 0; i < limit; i++) {
      const index = scanDirection === 'row' ? y * width + i : i * width + y;
      const expected = pixels[index] ? 1 : 0;
      if (plannedPixels[index] !== expected) throw new Error(`drawing path verification failed at band ${y + 1}, position ${i + 1}`);
      plannedBlackPixels += expected;
    }
  }
  if (options.autoSave) {
    tap('PLUS');
    wait(500);
    moveTap('DPAD_RIGHT');
    tap('A');
  }
  const blackPixels = pixels.reduce((sum, value) => sum + value, 0);
  // Compute optimization stats: how many bands were skipped and the
  // content bounding box within the selected scan range.
  const totalBands = endBand - startBand + 1;
  let skippedBands = 0;
  let contentFirstBand = -1;
  let contentLastBand = -1;
  for (let b = startBand; b <= endBand; b++) {
    const hasContent = scanDirection === 'row'
      ? pixels.slice(b * width, (b + 1) * width).some((v) => v)
      : pixels.filter((_, i) => i % width === b).some((v) => v);
    if (hasContent) {
      if (contentFirstBand < 0) contentFirstBand = b;
      contentLastBand = b;
    } else {
      skippedBands++;
    }
  }
  return {
    macro: lines.join('\n'), inputCount, durationMs: totalMs,
    preparationDurationMs, blackPixels, plannedBlackPixels,
    pixelChecksum: pixelChecksum(pixels, width, height), verified: true, scanDirection,
    skippedBands, totalBands, contentFirstBand, contentLastBand, pixelTimestamps
  };
}

export function formatDuration(milliseconds: number) {
  const seconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`;
}
