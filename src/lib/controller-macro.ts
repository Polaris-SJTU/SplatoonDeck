export type RecordedButtonEvent = {
  atMs: number;
  type: 'button';
  button: string;
  pressed: boolean;
};

export type RecordedStickEvent = {
  atMs: number;
  type: 'stick';
  stick: 'L_STICK' | 'R_STICK';
  x: number;
  y: number;
};

export type RecordedControllerEvent = RecordedButtonEvent | RecordedStickEvent;

export type RecordedControllerMacro = {
  version: 1;
  createdAt: string;
  durationMs: number;
  events: RecordedControllerEvent[];
};

export type ControllerPlaybackMacro = {
  macro: string;
  durationMs: number;
  inputCount: number;
};

export type ControllerPlaybackSettings = {
  mode: 'count' | 'infinite';
  repeatCount: number;
};

export const DEFAULT_CONTROLLER_PLAYBACK_SETTINGS: ControllerPlaybackSettings = {
  mode: 'count',
  repeatCount: 1
};

const BUTTONS = new Set([
  'A', 'B', 'X', 'Y', 'L', 'ZL', 'R', 'ZR',
  'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT',
  'MINUS', 'PLUS', 'CAPTURE', 'HOME', 'L_STICK_PRESS', 'R_STICK_PRESS'
]);
const RELEASE_FRAME_MS = 50;
const MAX_REPEAT_COUNT = 999;

const clampAxis = (value: number) => Math.max(-100, Math.min(100, Math.round(value)));
const clampTime = (value: number, durationMs: number) => Math.max(0, Math.min(durationMs, Math.round(value)));

function validEvent(value: unknown, durationMs: number): RecordedControllerEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Partial<RecordedControllerEvent>;
  if (typeof event.atMs !== 'number' || !Number.isFinite(event.atMs)) return null;
  const atMs = clampTime(event.atMs, durationMs);
  if (event.type === 'button' && typeof event.button === 'string' && BUTTONS.has(event.button) && typeof event.pressed === 'boolean') {
    return { atMs, type: 'button', button: event.button, pressed: event.pressed };
  }
  if (event.type === 'stick' && (event.stick === 'L_STICK' || event.stick === 'R_STICK') && typeof event.x === 'number' && typeof event.y === 'number' && Number.isFinite(event.x) && Number.isFinite(event.y)) {
    return { atMs, type: 'stick', stick: event.stick, x: clampAxis(event.x), y: clampAxis(event.y) };
  }
  return null;
}

export function loadControllerRecording(raw: string | null): RecordedControllerMacro | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RecordedControllerMacro>;
    if (value.version !== 1 || typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs) || !Array.isArray(value.events)) return null;
    const durationMs = Math.max(1, Math.round(value.durationMs));
    const events = value.events.map((event) => validEvent(event, durationMs)).filter((event): event is RecordedControllerEvent => event !== null);
    if (!events.length) return null;
    return {
      version: 1,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString(),
      durationMs,
      events: events.map((event, index) => ({ event, index })).sort((a, b) => a.event.atMs - b.event.atMs || a.index - b.index).map(({ event }) => event)
    };
  } catch {
    return null;
  }
}

export function loadControllerPlaybackSettings(raw: string | null): ControllerPlaybackSettings {
  if (!raw) return { ...DEFAULT_CONTROLLER_PLAYBACK_SETTINGS };
  try {
    const value = JSON.parse(raw) as Partial<ControllerPlaybackSettings>;
    return {
      mode: value.mode === 'infinite' ? 'infinite' : 'count',
      repeatCount: Math.max(1, Math.min(MAX_REPEAT_COUNT, Math.round(Number(value.repeatCount) || 1)))
    };
  } catch {
    return { ...DEFAULT_CONTROLLER_PLAYBACK_SETTINGS };
  }
}

export function finalizeControllerRecording(events: RecordedControllerEvent[], durationMs: number, createdAt = new Date().toISOString()): RecordedControllerMacro | null {
  const duration = Math.max(1, Math.round(durationMs));
  const sanitized = events.map((event) => validEvent(event, duration)).filter((event): event is RecordedControllerEvent => event !== null);
  if (!sanitized.length) return null;
  const buttons = new Set<string>();
  const sticks: Record<'L_STICK' | 'R_STICK', { x: number; y: number }> = {
    L_STICK: { x: 0, y: 0 }, R_STICK: { x: 0, y: 0 }
  };
  for (const event of sanitized) {
    if (event.type === 'button') {
      if (event.pressed) buttons.add(event.button); else buttons.delete(event.button);
    } else {
      sticks[event.stick] = { x: event.x, y: event.y };
    }
  }
  for (const button of buttons) sanitized.push({ atMs: duration, type: 'button', button, pressed: false });
  for (const stick of ['L_STICK', 'R_STICK'] as const) {
    if (sticks[stick].x || sticks[stick].y) sanitized.push({ atMs: duration, type: 'stick', stick, x: 0, y: 0 });
  }
  const ordered = sanitized.map((event, index) => ({ event, index })).sort((a, b) => a.event.atMs - b.event.atMs || a.index - b.index).map(({ event }) => event);
  return { version: 1, createdAt, durationMs: duration, events: ordered };
}

function signedAxis(value: number) {
  const rounded = clampAxis(value);
  return `${rounded >= 0 ? '+' : '-'}${Math.abs(rounded).toString().padStart(3, '0')}`;
}

function durationToken(durationMs: number) {
  return `${Math.max(1, Math.round(durationMs)) / 1000}s`;
}

export function buildControllerPlayback(recording: RecordedControllerMacro): ControllerPlaybackMacro {
  const loaded = loadControllerRecording(JSON.stringify(recording));
  if (!loaded) return { macro: '', durationMs: 0, inputCount: 0 };
  const buttons = new Set<string>();
  const sticks: Record<'L_STICK' | 'R_STICK', { x: number; y: number }> = {
    L_STICK: { x: 0, y: 0 }, R_STICK: { x: 0, y: 0 }
  };
  const lines: string[] = [];
  let cursor = 0;
  let eventIndex = 0;
  const stateLine = (durationMs: number) => [
    ...[...buttons].sort(),
    `L_STICK@${signedAxis(sticks.L_STICK.x)}${signedAxis(sticks.L_STICK.y)}`,
    `R_STICK@${signedAxis(sticks.R_STICK.x)}${signedAxis(sticks.R_STICK.y)}`,
    durationToken(durationMs)
  ].join(' ');

  while (eventIndex < loaded.events.length) {
    const atMs = loaded.events[eventIndex].atMs;
    if (atMs > cursor) lines.push(stateLine(atMs - cursor));
    while (eventIndex < loaded.events.length && loaded.events[eventIndex].atMs === atMs) {
      const event = loaded.events[eventIndex++];
      if (event.type === 'button') {
        if (event.pressed) buttons.add(event.button); else buttons.delete(event.button);
      } else {
        sticks[event.stick] = { x: event.x, y: event.y };
      }
    }
    cursor = atMs;
  }
  if (loaded.durationMs > cursor) lines.push(stateLine(loaded.durationMs - cursor));
  buttons.clear();
  sticks.L_STICK = { x: 0, y: 0 };
  sticks.R_STICK = { x: 0, y: 0 };
  lines.push(stateLine(RELEASE_FRAME_MS));
  return { macro: lines.join('\n'), durationMs: loaded.durationMs + RELEASE_FRAME_MS, inputCount: loaded.events.length };
}
