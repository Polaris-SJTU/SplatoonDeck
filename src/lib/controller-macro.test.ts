import { describe, expect, it } from 'vitest';
import { buildControllerPlayback, finalizeControllerRecording, loadControllerPlaybackSettings, loadControllerRecording } from './controller-macro';

describe('controller macro recording', () => {
  it('preserves button timing and emits a final neutral report', () => {
    const recording = finalizeControllerRecording([
      { atMs: 100, type: 'button', button: 'A', pressed: true },
      { atMs: 260, type: 'button', button: 'A', pressed: false }
    ], 400, '2026-08-15T00:00:00.000Z');
    expect(recording).not.toBeNull();
    const playback = buildControllerPlayback(recording!);
    expect(playback.durationMs).toBe(450);
    expect(playback.macro.split('\n')).toEqual([
      'L_STICK@+000+000 R_STICK@+000+000 0.1s',
      'A L_STICK@+000+000 R_STICK@+000+000 0.16s',
      'L_STICK@+000+000 R_STICK@+000+000 0.14s',
      'L_STICK@+000+000 R_STICK@+000+000 0.05s'
    ]);
  });

  it('records simultaneous buttons and analog stick positions as full states', () => {
    const recording = finalizeControllerRecording([
      { atMs: 0, type: 'button', button: 'ZR', pressed: true },
      { atMs: 0, type: 'stick', stick: 'R_STICK', x: 35, y: -80 },
      { atMs: 120, type: 'stick', stick: 'R_STICK', x: 0, y: 0 },
      { atMs: 180, type: 'button', button: 'ZR', pressed: false }
    ], 200)!;
    const playback = buildControllerPlayback(recording);
    expect(playback.macro).toContain('ZR L_STICK@+000+000 R_STICK@+035-080 0.12s');
    expect(playback.macro).toContain('ZR L_STICK@+000+000 R_STICK@+000+000 0.06s');
  });

  it('adds releases for controls still active when recording stops', () => {
    const recording = finalizeControllerRecording([
      { atMs: 10, type: 'button', button: 'B', pressed: true },
      { atMs: 20, type: 'stick', stick: 'L_STICK', x: -100, y: 0 }
    ], 300)!;
    expect(recording.events.slice(-2)).toEqual([
      { atMs: 300, type: 'button', button: 'B', pressed: false },
      { atMs: 300, type: 'stick', stick: 'L_STICK', x: 0, y: 0 }
    ]);
    expect(buildControllerPlayback(recording).macro).toContain('B L_STICK@-100+000 R_STICK@+000+000 0.28s');
  });

  it('rejects invalid saved data and filters unsafe commands', () => {
    expect(loadControllerRecording('{bad json')).toBeNull();
    expect(loadControllerRecording(JSON.stringify({ version: 1, durationMs: 100, events: [{ atMs: 0, type: 'button', button: 'SHUTDOWN', pressed: true }] }))).toBeNull();
  });

  it('loads bounded finite and infinite playback settings', () => {
    expect(loadControllerPlaybackSettings(null)).toEqual({ mode: 'count', repeatCount: 1 });
    expect(loadControllerPlaybackSettings('{"mode":"count","repeatCount":7}')).toEqual({ mode: 'count', repeatCount: 7 });
    expect(loadControllerPlaybackSettings('{"mode":"infinite","repeatCount":9999}')).toEqual({ mode: 'infinite', repeatCount: 999 });
    expect(loadControllerPlaybackSettings('broken')).toEqual({ mode: 'count', repeatCount: 1 });
  });
});
