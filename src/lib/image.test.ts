import { describe, expect, it } from 'vitest';
import { createCalibrationPixels, ditherLuminance, estimateScanCost, generateMacro, pixelChecksum, resolveScanDirection, transformLuminance } from './image';

function simulateDrawing(macro: string, width: number, height: number, _startBand: number, direction: 'row' | 'column' = 'row') {
  // Parse macro lines: waits (start with digit), buttons (everything else),
  // and LOOP blocks which NXBT expands inline.
  // The simulator starts at (0, 0) and replays the entire macro including
  // preparation moves (L3 clear, D-pad repositioning) so the cursor state
  // matches what real hardware would do from a cold start.
  const rawLines = macro.split('\n').filter((line) => line.trim() !== '');
  // Expand LOOP blocks into repeated lines.
  const expanded: string[] = [];
  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i];
    const loopMatch = line.match(/^LOOP\s+(\d+)/);
    if (loopMatch) {
      const count = parseInt(loopMatch[1], 10);
      const body: string[] = [];
      i++;
      while (i < rawLines.length && (rawLines[i].startsWith('  ') || rawLines[i].startsWith('\t'))) {
        body.push(rawLines[i].replace(/^\s+/, ''));
        i++;
      }
      for (let r = 0; r < count; r++) expanded.push(...body);
    } else {
      expanded.push(line);
      i++;
    }
  }
  const tokens = expanded.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return { type: 'blank' as const };
    if (/^\d/.test(trimmed)) return { type: 'wait' as const };
    return { type: 'button' as const, button: trimmed.split(' ')[0] };
  });
  const output = new Uint8Array(width * height);
  let x = 0;
  let y = 0;
  for (const token of tokens) {
    if (token.type !== 'button') continue;
    if (token.button === 'A' && y < height && x < width) output[y * width + x] = 1;
    if (token.button === 'DPAD_RIGHT') x = Math.min(width - 1, x + 1);
    if (token.button === 'DPAD_LEFT') x = Math.max(0, x - 1);
    if (token.button === 'DPAD_DOWN') y = Math.min(height - 1, y + 1);
    if (token.button === 'DPAD_UP') y = Math.max(0, y - 1);
    if (token.button.startsWith('L_STICK@')) {
      const spec = token.button.substring(8);
      const xVal = parseInt(spec.substring(0, 4), 10);
      const yVal = parseInt(spec.substring(4, 8), 10);
      if (xVal < 0) x = 0;
      else if (xVal > 0) x = width - 1;
      if (yVal > 0) y = 0;
      else if (yVal < 0) y = height - 1;
    }
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

  it('generates a verified D-pad-only serpentine macro', () => {
    const pixels = new Uint8Array([1, 0, 0, 1, 0, 1, 0, 0]);
    const result = generateMacro(pixels, 4, 2, { pressDurationMs: 50, autoSave: false, scanDirection: 'row' });
    expect(result.blackPixels).toBe(3);
    expect(result.macro).toContain('A 0.12s');
    expect(result.macro).toContain('DPAD_DOWN 0.12s'); // moveTap uses shorter duration
    // Stick boundary reset: always hits LEFT wall (consistent direction).
    expect(result.macro).toContain('L_STICK@-100+000');
    expect(result.macro).not.toContain('L_STICK@+100+000');
    // Brush reset uses LOOP syntax: LOOP 3 / L / release
    expect(result.macro.split('\n').slice(0, 3)).toEqual([
      'LOOP 3', '  L 0.12s', '  0.12s'
    ]);
    expect(result.macro).toContain('L_STICK_PRESS 0.12s');
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
      pressDurationMs: 50, autoSave: false, startRow: 2, endRow: 2, scanDirection: 'row'
    });
    const lines = result.macro.split('\n');
    // startRow=2 means 2 DPAD_DOWN moves, emitted as LOOP 2 with one body line.
    const downLines = lines.filter((line) => line.trim().startsWith('DPAD_DOWN'));
    const loopLine = lines.find((line) => line.startsWith('LOOP 2'));
    expect(downLines.length === 2 || (downLines.length === 1 && !!loopLine)).toBe(true);
    expect(lines.some((line) => line.startsWith('L_STICK_PRESS'))).toBe(false);
    // Prep uses 2 stick wall-bounces (4 lines) + 1 per-row reset (2 lines) = 6.
    expect(lines.filter((line) => line.startsWith('L_STICK@'))).toHaveLength(6);
    expect(lines.filter((line) => line.startsWith('A '))).toHaveLength(1);
    expect(result.plannedBlackPixels).toBe(1);
    expect([...simulateDrawing(result.macro, 4, 4, 2)]).toEqual([...pixels]);
  });

  it('slams cursor to top-left after L3 clear in startBand=0 preparation', () => {
    const pixels = new Uint8Array(6 * 3);
    pixels[0] = 1; // single pixel at top-left
    const result = generateMacro(pixels, 6, 3, { pressDurationMs: 50, autoSave: false, scanDirection: 'row' });
    const lines = result.macro.split('\n');
    const l3Idx = lines.findIndex((l) => l.startsWith('L_STICK_PRESS'));
    expect(l3Idx).toBeGreaterThanOrEqual(0);
    // After L3, stick wall-bounce sends cursor to left wall then top wall.
    const afterL3 = lines.slice(l3Idx);
    expect(afterL3.some((l) => l.trim().startsWith('L_STICK@-100+000'))).toBe(true);
    expect(afterL3.some((l) => l.trim().startsWith('L_STICK@+000+100'))).toBe(true);
    expect([...simulateDrawing(result.macro, 6, 3, 0)]).toEqual([...pixels]);
  });

  it('matches every preview pixel over a multi-row strict drawing plan', () => {
    const width = 7;
    const height = 5;
    const pixels = Uint8Array.from({ length: width * height }, (_, index) => ((index * 7 + Math.floor(index / width)) % 5 === 0 ? 1 : 0));
    const result = generateMacro(pixels, width, height, {
      pressDurationMs: 60, autoSave: false, startRow: 0, endRow: height - 1, scanDirection: 'row'
    });
    expect(result.verified).toBe(true);
    expect(result.plannedBlackPixels).toBe(result.blackPixels);
    expect([...simulateDrawing(result.macro, width, height, 0)]).toEqual([...pixels]);
  });

  it('matches every preview pixel with relative moves', () => {
    const width = 8;
    const height = 4;
    const pixels = new Uint8Array(width * height);
    pixels[0] = 1; pixels[3] = 1; pixels[5] = 1;
    pixels[width + 2] = 1; pixels[width + 6] = 1;
    pixels[2 * width + 1] = 1; pixels[2 * width + 4] = 1;
    pixels[3 * width + 0] = 1; pixels[3 * width + 7] = 1;
    const result = generateMacro(pixels, width, height, {
      pressDurationMs: 50, autoSave: false, startRow: 0, endRow: height - 1, scanDirection: 'row'
    });
    expect(result.verified).toBe(true);
    expect([...simulateDrawing(result.macro, width, height, 0)]).toEqual([...pixels]);
  });

  it('fingerprints the exact 1-bit canvas dimensions and contents', () => {
    const pixels = new Uint8Array([1, 0, 1, 0]);
    expect(pixelChecksum(pixels, 2, 2)).toBe(pixelChecksum(pixels, 2, 2));
    expect(pixelChecksum(pixels, 4, 1)).not.toBe(pixelChecksum(pixels, 2, 2));
    expect(pixelChecksum(new Uint8Array([1, 0, 0, 0]), 2, 2)).not.toBe(pixelChecksum(pixels, 2, 2));
  });

  it('creates the bounded 8 脳 7 hardware calibration pattern', () => {
    const pixels = createCalibrationPixels(12, 10);
    expect(pixels).toHaveLength(120);
    expect([...pixels].reduce((sum, value) => sum + value, 0)).toBe(36);
    expect(pixels[0]).toBe(1);
    expect(pixels[6 * 12 + 7]).toBe(1);
    expect(pixels[7 * 12]).toBe(0);
  });

  it('generates a verified column-scan macro that skips empty columns', () => {
    const width = 5;
    const height = 3;
    const pixels = new Uint8Array(width * height);
    pixels[0] = 1; pixels[6] = 1; pixels[14] = 1;
    const result = generateMacro(pixels, width, height, {
      pressDurationMs: 50, autoSave: false, scanDirection: 'column'
    });
    expect(result.scanDirection).toBe('column');
    expect(result.verified).toBe(true);
    expect(result.plannedBlackPixels).toBe(3);
    expect([...simulateDrawing(result.macro, width, height, 0, 'column')]).toEqual([...pixels]);
  });

  it('resolves scan direction based on non-empty band counts', () => {
    const wide = new Uint8Array(8 * 2);
    for (let i = 0; i < 8; i++) wide[i] = 1;
    expect(resolveScanDirection(wide, 8, 2)).toBe('row');

    const tall = new Uint8Array(2 * 8);
    for (let y = 0; y < 8; y++) tall[y * 2] = 1;
    expect(resolveScanDirection(tall, 2, 8)).toBe('column');
  });

  it('estimates scan cost proportional to non-empty bands times band length', () => {
    const pixels = new Uint8Array(6 * 3);
    pixels[0] = 1; pixels[6] = 1;
    expect(estimateScanCost(pixels, 6, 3, 'row')).toBe(2 * 5);
    expect(estimateScanCost(pixels, 6, 3, 'column')).toBe(1 * 2);
  });

  it('emits stick boundary reset before each content row in row scan', () => {
    const pixels = new Uint8Array([1, 0, 0, 1, 0, 1, 0, 0]);
    const result = generateMacro(pixels, 4, 2, { pressDurationMs: 50, autoSave: false, scanDirection: 'row' });
    const lines = result.macro.split('\n');
    // Both rows reset to LEFT wall, plus prep also slams LEFT.
    // L_STICK@-100+000: prep(1) + row0(1) + row1(1) = 3
    expect(lines.filter((l) => l.startsWith('L_STICK@-100+000')).length).toBe(3);
    // RIGHT wall no longer used
    expect(lines.filter((l) => l.startsWith('L_STICK@+100+000')).length).toBe(0);
    // First stick reset appears before the first A tap
    const firstStickIdx = lines.findIndex((l) => l.startsWith('L_STICK@-100+000'));
    const firstAIdx = lines.findIndex((l) => l.startsWith('A '));
    expect(firstStickIdx).toBeLessThan(firstAIdx);
    // Round-trip still matches
    expect([...simulateDrawing(result.macro, 4, 2, 0)]).toEqual([...pixels]);
  });

  it('emits stick boundary reset before each content column in column scan', () => {
    const width = 5;
    const height = 3;
    const pixels = new Uint8Array(width * height);
    pixels[0] = 1; pixels[6] = 1; pixels[14] = 1;
    const result = generateMacro(pixels, width, height, {
      pressDurationMs: 50, autoSave: false, scanDirection: 'column'
    });
    const lines = result.macro.split('\n');
    expect(lines.some((l) => l.startsWith('L_STICK@+000+100'))).toBe(true);
    expect(lines.filter((l) => l.startsWith('L_STICK@+000-100')).length).toBe(0);
    expect([...simulateDrawing(result.macro, width, height, 0, 'column')]).toEqual([...pixels]);
  });
});
