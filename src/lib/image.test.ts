import { describe, expect, it } from 'vitest';
import { createCalibrationPixels, ditherLuminance, generateMacro, pixelChecksum, transformLuminance } from './image';

function simulateDrawing(macro: string, width: number, height: number, startRow: number) {
  const commands = macro.split('\n').filter((line) => /^[A-Z]/.test(line)).map((line) => line.split(' ')[0]);
  const preparationCommands = 3 + (startRow === 0 ? 1 : 0) + (width + 2) + (height + 2) + startRow;
  const output = new Uint8Array(width * height);
  let x = 0;
  let y = startRow;
  for (const command of commands.slice(preparationCommands)) {
    if (command === 'A' && y < height) output[y * width + x] = 1;
    if (command === 'DPAD_RIGHT') x = Math.min(width - 1, x + 1);
    if (command === 'DPAD_LEFT') x = Math.max(0, x - 1);
    if (command === 'DPAD_DOWN') y = Math.min(height - 1, y + 1);
  }
  return output;
}

describe('image pipeline', () => {
  it('thresholds luminance into black and white pixels', () => {
    expect([...ditherLuminance(new Float32Array([0, 127, 128, 255]), 4, 1, 'threshold', 128)]).toEqual([1, 1, 0, 0]);
  });

  it('adjusts brightness while keeping values clamped', () => {
    expect(transformLuminance(250, 100, 0)).toBe(255);
    expect(transformLuminance(5, -100, 0)).toBe(0);
  });

  it('generates a verified fixed-raster serpentine macro', () => {
    const pixels = new Uint8Array([1, 0, 0, 1, 0, 1, 0, 0]);
    const result = generateMacro(pixels, 4, 2, { pressDurationMs: 50, cautious: false, autoSave: false });
    expect(result.blackPixels).toBe(3);
    expect(result.macro).toContain('A 0.05s');
    expect(result.macro).toContain('DPAD_DOWN 0.05s');
    expect(result.macro.split('\n').slice(0, 6)).toEqual([
      'L 0.05s', '0.05s', 'L 0.05s', '0.05s', 'L 0.05s', '0.05s'
    ]);
    expect(result.macro).toContain('L_STICK_PRESS 0.05s');
    expect(result.preparationDurationMs).toBeGreaterThan(0);
    expect(result.inputCount).toBeGreaterThan(0);
    expect(result.verified).toBe(true);
    expect(result.plannedBlackPixels).toBe(3);
    expect([...simulateDrawing(result.macro, 4, 2, 0)]).toEqual([...pixels]);
  });

  it('supports a bounded row range for resume and batch drawing', () => {
    const pixels = new Uint8Array(4 * 4);
    pixels[2 * 4] = 1;
    const result = generateMacro(pixels, 4, 4, {
      pressDurationMs: 50, cautious: false, autoSave: false, startRow: 2, endRow: 2
    });
    const lines = result.macro.split('\n');
    expect(lines.filter((line) => line.startsWith('DPAD_DOWN'))).toHaveLength(2);
    expect(lines.some((line) => line.startsWith('L_STICK_PRESS'))).toBe(false);
    expect(lines.filter((line) => line.startsWith('DPAD_LEFT'))).toHaveLength(6);
    expect(lines.filter((line) => line.startsWith('DPAD_UP'))).toHaveLength(6);
    expect(lines.filter((line) => line.startsWith('A '))).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith('DPAD_RIGHT'))).toHaveLength(3);
    expect(result.plannedBlackPixels).toBe(1);
    expect([...simulateDrawing(result.macro, 4, 4, 2)]).toEqual([...pixels]);
  });

  it('matches every preview pixel over a multi-row strict drawing plan', () => {
    const width = 7;
    const height = 5;
    const pixels = Uint8Array.from({ length: width * height }, (_, index) => ((index * 7 + Math.floor(index / width)) % 5 === 0 ? 1 : 0));
    const result = generateMacro(pixels, width, height, {
      pressDurationMs: 60, cautious: true, autoSave: false, startRow: 0, endRow: height - 1
    });
    expect(result.verified).toBe(true);
    expect(result.plannedBlackPixels).toBe(result.blackPixels);
    expect([...simulateDrawing(result.macro, width, height, 0)]).toEqual([...pixels]);
  });

  it('fingerprints the exact 1-bit canvas dimensions and contents', () => {
    const pixels = new Uint8Array([1, 0, 1, 0]);
    expect(pixelChecksum(pixels, 2, 2)).toBe(pixelChecksum(pixels, 2, 2));
    expect(pixelChecksum(pixels, 4, 1)).not.toBe(pixelChecksum(pixels, 2, 2));
    expect(pixelChecksum(new Uint8Array([1, 0, 0, 0]), 2, 2)).not.toBe(pixelChecksum(pixels, 2, 2));
  });

  it('creates the bounded 8 × 7 hardware calibration pattern', () => {
    const pixels = createCalibrationPixels(12, 10);
    expect(pixels).toHaveLength(120);
    expect([...pixels].reduce((sum, value) => sum + value, 0)).toBe(36);
    expect(pixels[0]).toBe(1);
    expect(pixels[6 * 12 + 7]).toBe(1);
    expect(pixels[7 * 12]).toBe(0);
  });
});
