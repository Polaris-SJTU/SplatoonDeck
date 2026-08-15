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
const STICK_UP = 'L_STICK@+000+100';
const STICK_CENTER = 'L_STICK@+000+000';
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

export function estimateScanCost(pixels: Uint8Array, width: number, height: number, direction: 'row' | 'column') {
  // Boundary calibration is deliberately retained for strict positioning.
  // Express its fixed time as an equivalent number of discrete moves so auto
  // mode compares the real work: calibration + travel + paint taps.
  const boundaryResetCost = 28;
  let cost = 0;
  let lastContentBand = -1;
  if (direction === 'row') {
    for (let y = 0; y < height; y++) {
      let last = -1;
      let black = 0;
      for (let x = 0; x < width; x++) {
        if (!pixels[y * width + x]) continue;
        last = x;
        black++;
      }
      if (last >= 0) {
        cost += boundaryResetCost + last + black * 1.5;
        lastContentBand = y;
      }
    }
    return cost + Math.max(0, lastContentBand);
  }
  for (let x = 0; x < width; x++) {
    let last = -1;
    let black = 0;
    for (let y = 0; y < height; y++) {
      if (!pixels[y * width + x]) continue;
      last = y;
      black++;
    }
    if (last >= 0) {
      cost += boundaryResetCost + last + black * 1.5;
      lastContentBand = x;
    }
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
  if (scanDirection === 'row') {
    const firstBlack = new Int32Array(height).fill(-1);
    const lastBlack = new Int32Array(height).fill(-1);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (pixels[y * width + x]) { if (firstBlack[y] < 0) firstBlack[y] = x; lastBlack[y] = x; }
    for (let y = startBand; y <= endBand; y++) {
      if (firstBlack[y] < 0) continue;
      for (let x = firstBlack[y]; x <= lastBlack[y]; x++) {
        if (pixels[y * width + x]) path.push({ x, y });
      }
    }
  } else {
    const firstBlack = new Int32Array(width).fill(-1);
    const lastBlack = new Int32Array(width).fill(-1);
    for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) if (pixels[y * width + x]) { if (firstBlack[x] < 0) firstBlack[x] = y; lastBlack[x] = y; }
    for (let x = startBand; x <= endBand; x++) {
      if (firstBlack[x] < 0) continue;
      for (let y = firstBlack[x]; y <= lastBlack[x]; y++) {
        if (pixels[y * width + x]) path.push({ x, y });
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
  const tap = (button: string) => {
    lines.push(`${button} ${sec(actionPressMs)}s`, `${sec(actionReleaseMs)}s`);
    inputCount += 2;
    totalMs += nxbtMs(actionPressMs) + nxbtMs(actionReleaseMs);
  };
  // Every move includes an explicit neutral phase, so consecutive commands
  // are distinct rising edges rather than a held direction with auto-repeat.
  const moveTap = (button: string) => {
    lines.push(`${button} ${sec(movePressMs)}s`, `${sec(moveReleaseMs)}s`);
    inputCount += 2;
    totalMs += nxbtMs(movePressMs) + nxbtMs(moveReleaseMs);
  };
  const wait = (ms: number) => {
    lines.push(`${(ms / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}s`);
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
    if (count === 1) {
      lines.push(`${button} ${sec(pressMs)}s`, `${sec(releaseMs)}s`);
      inputCount += 2;
      totalMs += nxbtMs(pressMs) + nxbtMs(releaseMs);
    } else {
      lines.push(`LOOP ${count}`, `  ${button} ${sec(pressMs)}s`, `  ${sec(releaseMs)}s`);
      inputCount += count * 2;
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
    const firstBlack = new Int32Array(height).fill(-1);
    const lastBlack = new Int32Array(height).fill(-1);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[y * width + x]) {
          if (firstBlack[y] < 0) firstBlack[y] = x;
          lastBlack[y] = x;
        }
      }
    }
    let currentX = 0;
    for (let y = startBand; y <= endBand; y++) {
      if (firstBlack[y] < 0) {
        if (y < endBand) moveTap('DPAD_DOWN');
        continue;
      }
      // Stick boundary reset: always slam cursor to the LEFT wall.
      // Consistent wall eliminates any directional bias in stick behavior.
      stickHold(STICK_LEFT, 2500);
      currentX = 0;
      currentX = moveX(currentX, firstBlack[y]);
      const scanEnd = lastBlack[y];
      const scanLen = scanEnd - currentX + 1;
      for (let step = 0; step < scanLen; step++) {
        const index = y * width + currentX;
       if (pixels[index]) { tap('A'); plannedPixels[index] = 1; pixelTimestamps.push(totalMs - preparationDurationMs); }
       if (step < scanLen - 1) {
         moveTap('DPAD_RIGHT');
          currentX += 1;
        }
      }
      if (y < endBand) moveTap('DPAD_DOWN');
    }
  } else {
    const firstBlack = new Int32Array(width).fill(-1);
    const lastBlack = new Int32Array(width).fill(-1);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (pixels[y * width + x]) {
          if (firstBlack[x] < 0) firstBlack[x] = y;
          lastBlack[x] = y;
        }
      }
    }
    let currentY = 0;
    for (let x = startBand; x <= endBand; x++) {
      if (firstBlack[x] < 0) {
        if (x < endBand) moveTap('DPAD_RIGHT');
        continue;
      }
      // Stick boundary reset: always slam cursor to the TOP wall.
      // Consistent wall eliminates any directional bias in stick behavior.
      stickHold(STICK_UP, 2500);
      currentY = 0;
      currentY = moveY(currentY, firstBlack[x]);
      const scanEnd = lastBlack[x];
      const scanLen = scanEnd - currentY + 1;
      for (let step = 0; step < scanLen; step++) {
        const index = currentY * width + x;
        if (pixels[index]) { tap('A'); plannedPixels[index] = 1; pixelTimestamps.push(totalMs - preparationDurationMs); }
        if (step < scanLen - 1) {
          moveTap('DPAD_DOWN');
          currentY += 1;
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
