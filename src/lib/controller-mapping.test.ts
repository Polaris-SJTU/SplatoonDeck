import { describe, expect, it } from 'vitest';
import {
  assignBinding,
  blendMouseDeltaToStick,
  createDefaultBindings,
  formatKeyboardCode,
  loadBindings,
  loadMouseMotionSettings,
  mouseDeltaToStick,
  resolveBinding
} from './controller-mapping';

describe('controller input mappings', () => {
  it('uses the game-oriented keyboard and mouse defaults', () => {
    const bindings = createDefaultBindings();
    expect(resolveBinding(bindings, 'keyboard', 'Digit1')).toBe('DPAD_UP');
    expect(resolveBinding(bindings, 'keyboard', 'Digit2')).toBe('DPAD_DOWN');
    expect(resolveBinding(bindings, 'keyboard', 'Digit3')).toBe('DPAD_LEFT');
    expect(resolveBinding(bindings, 'keyboard', 'Digit4')).toBe('DPAD_RIGHT');
    expect(resolveBinding(bindings, 'keyboard', 'KeyW')).toBe('L_STICK_UP');
    expect(resolveBinding(bindings, 'keyboard', 'KeyS')).toBe('L_STICK_DOWN');
    expect(resolveBinding(bindings, 'keyboard', 'KeyA')).toBe('L_STICK_LEFT');
    expect(resolveBinding(bindings, 'keyboard', 'KeyD')).toBe('L_STICK_RIGHT');
    expect(resolveBinding(bindings, 'keyboard', 'Space')).toBe('B');
    expect(resolveBinding(bindings, 'keyboard', 'Tab')).toBe('X');
    expect(resolveBinding(bindings, 'keyboard', 'KeyR')).toBe('Y');
    expect(resolveBinding(bindings, 'keyboard', 'KeyF')).toBe('A');
    expect(resolveBinding(bindings, 'keyboard', 'ShiftLeft')).toBe('ZL');
    expect(resolveBinding(bindings, 'keyboard', 'KeyT')).toBe('L');
    expect(resolveBinding(bindings, 'keyboard', 'KeyQ')).toBe('L_STICK_PRESS');
    expect(resolveBinding(bindings, 'keyboard', 'Minus')).toBe('MINUS');
    expect(resolveBinding(bindings, 'keyboard', 'Equal')).toBe('PLUS');
    expect(resolveBinding(bindings, 'mouse', 0)).toBe('ZR');
    expect(resolveBinding(bindings, 'mouse', 2)).toBe('R');
    expect(loadMouseMotionSettings(null).target).toBe('R_STICK');
  });

  it('moves a duplicate input to the newly assigned action', () => {
    const bindings = assignBinding(createDefaultBindings(), 'B', 'keyboard', 'KeyF');
    expect(bindings.A.keyboard).toBeNull();
    expect(bindings.B.keyboard).toBe('KeyF');
  });

  it('loads valid saved values and ignores unsafe mouse button values', () => {
    const bindings = loadBindings(JSON.stringify({ A: { keyboard: 'Space', mouse: 4 }, B: { keyboard: null, mouse: 12 } }));
    expect(bindings.A).toEqual({ keyboard: 'Space', mouse: 4 });
    expect(bindings.B.mouse).toBeNull();
    expect(formatKeyboardCode(bindings.A.keyboard)).toBe('Space');
  });

  it('clamps mouse sensitivity and converts relative movement to stick values', () => {
    const settings = loadMouseMotionSettings(JSON.stringify({ target: 'R_STICK', sensitivityX: 20, sensitivityY: 2, invertX: true, invertY: false }));
    expect(settings.sensitivityX).toBe(10);
    expect(settings.sensitivityY).toBe(2);
    const vector = mouseDeltaToStick(20, -4, settings);
    expect(vector.x).toBeLessThan(-99);
    expect(vector.y).toBeGreaterThan(26);
    expect(vector.y).toBeLessThan(27);
  });

  it('migrates the old combined sensitivity to both axes', () => {
    const settings = loadMouseMotionSettings(JSON.stringify({ target: 'R_STICK', sensitivity: 4.5 }));
    expect(settings.sensitivityX).toBe(4.5);
    expect(settings.sensitivityY).toBe(4.5);
  });

  it('does not leave a decaying axis tail on the following frame', () => {
    const settings = loadMouseMotionSettings(JSON.stringify({ target: 'R_STICK', sensitivityX: 3, sensitivityY: 3 }));
    const vertical = blendMouseDeltaToStick({ x: 0, y: 0 }, 0, -5, settings);
    const thenHorizontal = blendMouseDeltaToStick(vertical, 5, 0, settings);
    expect(vertical.x).toBe(0);
    expect(vertical.y).toBeGreaterThan(33);
    expect(thenHorizontal.x).toBeGreaterThan(33);
    expect(thenHorizontal.y).toBe(0);
  });

  it('applies a visibly different pre-saturation curve at low and high sensitivity', () => {
    const low = loadMouseMotionSettings(JSON.stringify({ target: 'R_STICK', sensitivityX: .5, sensitivityY: 3 }));
    const high = loadMouseMotionSettings(JSON.stringify({ target: 'R_STICK', sensitivityX: 10, sensitivityY: 3 }));
    const lowX = mouseDeltaToStick(5, 0, low).x;
    const highX = mouseDeltaToStick(5, 0, high).x;
    expect(lowX).toBeGreaterThan(24);
    expect(lowX).toBeLessThan(25);
    expect(highX).toBeGreaterThan(78);
    expect(highX).toBeGreaterThan(lowX * 3);
  });

  it('keeps horizontal and vertical sensitivity independent', () => {
    const horizontalFast = loadMouseMotionSettings(JSON.stringify({ target: 'R_STICK', sensitivityX: 8, sensitivityY: 1 }));
    const verticalFast = loadMouseMotionSettings(JSON.stringify({ target: 'R_STICK', sensitivityX: 1, sensitivityY: 8 }));
    const a = mouseDeltaToStick(4, -4, horizontalFast);
    const b = mouseDeltaToStick(4, -4, verticalFast);
    expect(a.x).toBeGreaterThan(a.y * 2);
    expect(b.y).toBeGreaterThan(b.x * 2);
    expect(a.x).toBeCloseTo(b.y, 8);
    expect(a.y).toBeCloseTo(b.x, 8);
  });

  it('lifts one-count mouse motion above the in-game stick deadzone', () => {
    const low = loadMouseMotionSettings(JSON.stringify({ target: 'R_STICK', sensitivityX: .5, sensitivityY: .5 }));
    const high = loadMouseMotionSettings(JSON.stringify({ target: 'R_STICK', sensitivityX: 10, sensitivityY: 10 }));
    const lowVector = mouseDeltaToStick(1, -1, low);
    const highVector = mouseDeltaToStick(1, -1, high);
    expect(lowVector.x).toBeGreaterThan(12);
    expect(lowVector.y).toBeGreaterThan(12);
    expect(highVector.x).toBeGreaterThan(lowVector.x * 2);
    expect(highVector.y).toBeGreaterThan(lowVector.y * 2);
  });
});
