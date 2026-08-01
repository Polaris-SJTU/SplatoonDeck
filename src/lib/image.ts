export const CANVAS_WIDTH = 320;
export const CANVAS_HEIGHT = 120;

export type DitherMode = 'threshold' | 'floyd-steinberg' | 'atkinson' | 'bayer';
export type FitMode = 'contain' | 'cover' | 'stretch';

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
  cautious: boolean;
  autoSave: boolean;
  startRow?: number;
  endRow?: number;
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
};

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

export function generateMacro(pixels: Uint8Array, width: number, height: number, options: MacroOptions): MacroResult {
  if (pixels.length !== width * height) throw new Error('像素数据尺寸不匹配');
  const duration = Math.max(35, Math.min(200, Math.round(options.pressDurationMs)));
  const startRow = Math.max(0, Math.min(height - 1, Math.round(options.startRow ?? 0)));
  const endRow = Math.max(startRow, Math.min(height - 1, Math.round(options.endRow ?? height - 1)));
  const seconds = (duration / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  const lines: string[] = [];
  let inputCount = 0;
  let currentX = 0;
  let direction = 1;
  const plannedPixels = new Uint8Array(width * height);
  const tap = (button: string) => {
    lines.push(`${button} ${seconds}s`, `${seconds}s`);
    inputCount += 2;
  };
  // Splatoon 3 clamps brush size and cursor movement at their boundaries, so
  // repeated inputs make the starting state deterministic without user setup.
  for (let i = 0; i < 3; i++) tap('L');
  if (startRow === 0) tap('L_STICK_PRESS');
  for (let i = 0; i < width + 2; i++) tap('DPAD_LEFT');
  for (let i = 0; i < height + 2; i++) tap('DPAD_UP');
  for (let y = 0; y < startRow; y++) tap('DPAD_DOWN');
  const preparationDurationMs = inputCount * duration;

  for (let y = startRow; y <= endRow; y++) {
    // Visit all 320 coordinates in every row. This fixed raster path means the
    // preview matrix and the controller plan cannot disagree about position.
    for (let step = 0; step < width; step++) {
      const index = y * width + currentX;
      if (pixels[index]) {
        tap('A');
        plannedPixels[index] = 1;
      }
      if (step === width - 1) break;
      tap(direction > 0 ? 'DPAD_RIGHT' : 'DPAD_LEFT');
      currentX += direction;
    }
    if (options.cautious) {
      for (let i = 0; i < 2; i++) tap(direction > 0 ? 'DPAD_RIGHT' : 'DPAD_LEFT');
    }
    if (y < endRow) tap('DPAD_DOWN');
    direction *= -1;
  }

  let plannedBlackPixels = 0;
  for (let y = startRow; y <= endRow; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const expected = pixels[index] ? 1 : 0;
      if (plannedPixels[index] !== expected) throw new Error(`绘制路径校验失败：第 ${y + 1} 行，第 ${x + 1} 列`);
      plannedBlackPixels += expected;
    }
  }
  if (options.autoSave) tap('MINUS');
  const blackPixels = pixels.reduce((sum, value) => sum + value, 0);
  return {
    macro: lines.join('\n'), inputCount, durationMs: inputCount * duration,
    preparationDurationMs, blackPixels, plannedBlackPixels,
    pixelChecksum: pixelChecksum(pixels, width, height), verified: true
  };
}

export function formatDuration(milliseconds: number) {
  const seconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`;
}
