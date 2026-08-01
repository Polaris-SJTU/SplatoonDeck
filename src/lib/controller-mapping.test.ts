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
    expect(mouseDeltaToStick(20, -4, settings)).toEqual({ x: -100, y: 9 });
  });

  it('migrates the old combined sensitivity to both axes', () => {
    const settings = loadMouseMotionSettings(JSON.stringify({ target: 'R_STICK', sensitivity: 4.5 }));
    expect(settings.sensitivityX).toBe(4.5);
    expect(settings.sensitivityY).toBe(4.5);
  });

  it('preserves vertical movement when the following mouse event only moves horizontally', () => {
    const settings = loadMouseMotionSettings(JSON.stringify({ target: 'R_STICK', sensitivityX: 3, sensitivityY: 3 }));
    const vertical = blendMouseDeltaToStick({ x: 0, y: 0 }, 0, -5, settings);
    const thenHorizontal = blendMouseDeltaToStick(vertical, 5, 0, settings);
    expect(vertical).toEqual({ x: 0, y: 15 });
    expect(thenHorizontal).toEqual({ x: 15, y: 5.25 });
  });

  it('applies a visibly different gain at low and high sensitivity', () => {
    const low = loadMouseMotionSettings(JSON.stringify({ target: 'R_STICK', sensitivityX: .5, sensitivityY: 3 }));
    const high = loadMouseMotionSettings(JSON.stringify({ target: 'R_STICK', sensitivityX: 10, sensitivityY: 3 }));
    expect(mouseDeltaToStick(5, 0, low).x).toBeCloseTo(5.625);
    expect(mouseDeltaToStick(5, 0, high).x).toBeCloseTo(41.25);
  });
});
