export type InputDevice = 'keyboard' | 'mouse';

export type ControllerActionId =
  | 'DPAD_UP' | 'DPAD_DOWN' | 'DPAD_LEFT' | 'DPAD_RIGHT'
  | 'A' | 'B' | 'X' | 'Y'
  | 'L' | 'ZL' | 'R' | 'ZR'
  | 'MINUS' | 'PLUS' | 'CAPTURE' | 'HOME'
  | 'L_STICK_PRESS' | 'R_STICK_PRESS'
  | 'L_STICK_UP' | 'L_STICK_DOWN' | 'L_STICK_LEFT' | 'L_STICK_RIGHT'
  | 'R_STICK_UP' | 'R_STICK_DOWN' | 'R_STICK_LEFT' | 'R_STICK_RIGHT';

export type InputBinding = {
  keyboard: string | null;
  mouse: number | null;
};

export type ControllerBindings = Record<ControllerActionId, InputBinding>;

export type MouseMotionSettings = {
  target: 'off' | 'L_STICK' | 'R_STICK';
  sensitivityX: number;
  sensitivityY: number;
  invertX: boolean;
  invertY: boolean;
};

export type ControllerAction = {
  id: ControllerActionId;
  label: string;
  group: '面键' | '肩键' | '十字键' | '系统键' | '左摇杆' | '右摇杆';
  kind: 'button' | 'stick';
  stick?: 'L_STICK' | 'R_STICK';
  axis?: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
};

export const CONTROLLER_ACTIONS: ControllerAction[] = [
  { id: 'A', label: 'A', group: '面键', kind: 'button' },
  { id: 'B', label: 'B', group: '面键', kind: 'button' },
  { id: 'X', label: 'X', group: '面键', kind: 'button' },
  { id: 'Y', label: 'Y', group: '面键', kind: 'button' },
  { id: 'L', label: 'L', group: '肩键', kind: 'button' },
  { id: 'ZL', label: 'ZL', group: '肩键', kind: 'button' },
  { id: 'R', label: 'R', group: '肩键', kind: 'button' },
  { id: 'ZR', label: 'ZR', group: '肩键', kind: 'button' },
  { id: 'DPAD_UP', label: '上', group: '十字键', kind: 'button' },
  { id: 'DPAD_DOWN', label: '下', group: '十字键', kind: 'button' },
  { id: 'DPAD_LEFT', label: '左', group: '十字键', kind: 'button' },
  { id: 'DPAD_RIGHT', label: '右', group: '十字键', kind: 'button' },
  { id: 'MINUS', label: '−', group: '系统键', kind: 'button' },
  { id: 'PLUS', label: '+', group: '系统键', kind: 'button' },
  { id: 'CAPTURE', label: '截图', group: '系统键', kind: 'button' },
  { id: 'HOME', label: 'HOME', group: '系统键', kind: 'button' },
  { id: 'L_STICK_PRESS', label: 'L3', group: '系统键', kind: 'button' },
  { id: 'R_STICK_PRESS', label: 'R3', group: '系统键', kind: 'button' },
  { id: 'L_STICK_UP', label: '向上', group: '左摇杆', kind: 'stick', stick: 'L_STICK', axis: 'UP' },
  { id: 'L_STICK_DOWN', label: '向下', group: '左摇杆', kind: 'stick', stick: 'L_STICK', axis: 'DOWN' },
  { id: 'L_STICK_LEFT', label: '向左', group: '左摇杆', kind: 'stick', stick: 'L_STICK', axis: 'LEFT' },
  { id: 'L_STICK_RIGHT', label: '向右', group: '左摇杆', kind: 'stick', stick: 'L_STICK', axis: 'RIGHT' },
  { id: 'R_STICK_UP', label: '向上', group: '右摇杆', kind: 'stick', stick: 'R_STICK', axis: 'UP' },
  { id: 'R_STICK_DOWN', label: '向下', group: '右摇杆', kind: 'stick', stick: 'R_STICK', axis: 'DOWN' },
  { id: 'R_STICK_LEFT', label: '向左', group: '右摇杆', kind: 'stick', stick: 'R_STICK', axis: 'LEFT' },
  { id: 'R_STICK_RIGHT', label: '向右', group: '右摇杆', kind: 'stick', stick: 'R_STICK', axis: 'RIGHT' }
];

const DEFAULT_KEYBOARD: Partial<Record<ControllerActionId, string>> = {
  DPAD_UP: 'Digit1', DPAD_DOWN: 'Digit2', DPAD_LEFT: 'Digit3', DPAD_RIGHT: 'Digit4',
  L_STICK_UP: 'KeyW', L_STICK_DOWN: 'KeyS', L_STICK_LEFT: 'KeyA', L_STICK_RIGHT: 'KeyD',
  B: 'Space', X: 'Tab', Y: 'KeyR', A: 'KeyF',
  L: 'KeyT', ZL: 'ShiftLeft', L_STICK_PRESS: 'KeyQ',
  PLUS: 'Equal', MINUS: 'Minus', HOME: 'KeyH', CAPTURE: 'KeyC'
};

const DEFAULT_MOUSE: Partial<Record<ControllerActionId, number>> = {
  ZR: 0,
  R: 2
};

export function createDefaultBindings(): ControllerBindings {
  return Object.fromEntries(CONTROLLER_ACTIONS.map(({ id }) => [id, {
    keyboard: DEFAULT_KEYBOARD[id] ?? null,
    mouse: DEFAULT_MOUSE[id] ?? null
  }])) as ControllerBindings;
}

export const DEFAULT_MOUSE_MOTION: MouseMotionSettings = {
  target: 'R_STICK',
  sensitivityX: 3,
  sensitivityY: 3,
  invertX: false,
  invertY: false
};

export function loadMouseMotionSettings(raw: string | null): MouseMotionSettings {
  if (!raw) return { ...DEFAULT_MOUSE_MOTION };
  try {
    const saved = JSON.parse(raw) as Partial<MouseMotionSettings> & { sensitivity?: number };
    const clampSensitivity = (value: unknown, fallback: number) => typeof value === 'number' ? Math.min(10, Math.max(.5, value)) : fallback;
    const legacySensitivity = clampSensitivity(saved.sensitivity, DEFAULT_MOUSE_MOTION.sensitivityX);
    return {
      target: saved.target === 'L_STICK' || saved.target === 'R_STICK' ? saved.target : 'off',
      sensitivityX: clampSensitivity(saved.sensitivityX, legacySensitivity),
      sensitivityY: clampSensitivity(saved.sensitivityY, legacySensitivity),
      invertX: saved.invertX === true,
      invertY: saved.invertY === true
    };
  } catch {
    return { ...DEFAULT_MOUSE_MOTION };
  }
}

export function mouseDeltaToStick(movementX: number, movementY: number, settings: MouseMotionSettings) {
  const clamp = (value: number) => Math.max(-100, Math.min(100, value));
  const gainX = .75 + settings.sensitivityX * .75;
  const gainY = .75 + settings.sensitivityY * .75;
  return {
    x: clamp(movementX * gainX * (settings.invertX ? -1 : 1)),
    y: clamp(-movementY * gainY * (settings.invertY ? -1 : 1))
  };
}

export function blendMouseDeltaToStick(
  current: { x: number; y: number },
  movementX: number,
  movementY: number,
  settings: MouseMotionSettings
) {
  const delta = mouseDeltaToStick(movementX, movementY, settings);
  const clamp = (value: number) => Math.max(-100, Math.min(100, value));
  return {
    x: clamp(movementX === 0 ? current.x * .35 : delta.x),
    y: clamp(movementY === 0 ? current.y * .35 : delta.y)
  };
}

export function loadBindings(raw: string | null): ControllerBindings {
  const defaults = createDefaultBindings();
  if (!raw) return defaults;
  try {
    const saved = JSON.parse(raw) as Partial<Record<ControllerActionId, Partial<InputBinding>>>;
    for (const action of CONTROLLER_ACTIONS) {
      const binding = saved[action.id];
      if (!binding) continue;
      defaults[action.id] = {
        keyboard: typeof binding.keyboard === 'string' ? binding.keyboard : null,
        mouse: Number.isInteger(binding.mouse) && binding.mouse! >= 0 && binding.mouse! <= 4 ? binding.mouse! : null
      };
    }
  } catch {
    return defaults;
  }
  return defaults;
}

export function assignBinding(
  bindings: ControllerBindings,
  actionId: ControllerActionId,
  device: InputDevice,
  value: string | number | null
): ControllerBindings {
  const next = structuredClone(bindings);
  if (value !== null) {
    for (const action of CONTROLLER_ACTIONS) {
      if (action.id !== actionId && next[action.id][device] === value) next[action.id][device] = null as never;
    }
  }
  if (device === 'keyboard') next[actionId].keyboard = typeof value === 'string' ? value : null;
  else next[actionId].mouse = typeof value === 'number' ? value : null;
  return next;
}

export function resolveBinding(bindings: ControllerBindings, device: InputDevice, value: string | number) {
  return CONTROLLER_ACTIONS.find(({ id }) => bindings[id][device] === value)?.id ?? null;
}

const KEY_LABELS: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Enter: 'Enter', Backspace: 'Backspace', Space: 'Space', Escape: 'Esc', Minus: '−', Equal: '+',
  Tab: 'Tab', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'Page Up', PageDown: 'Page Down', ShiftLeft: '左 Shift', ShiftRight: '右 Shift',
  ControlLeft: '左 Ctrl', ControlRight: '右 Ctrl', AltLeft: '左 Alt', AltRight: '右 Alt'
};

export function formatKeyboardCode(code: string | null) {
  if (!code) return '未设置';
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `小键盘 ${code.slice(6)}`;
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function formatMouseButton(button: number | null) {
  if (button === null) return '未设置';
  return ['鼠标左键', '鼠标中键', '鼠标右键', '鼠标后退键', '鼠标前进键'][button] ?? `鼠标键 ${button}`;
}
