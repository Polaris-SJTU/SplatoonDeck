import { createContext, PointerEvent as ReactPointerEvent, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  assignBinding,
  blendMouseDeltaToStick,
  CONTROLLER_ACTIONS,
  ControllerActionId,
  ControllerBindings,
  createDefaultBindings,
  DEFAULT_MOUSE_MOTION,
  formatKeyboardCode,
  formatMouseButton,
  InputDevice,
  loadBindings,
  loadMouseMotionSettings,
  MouseMotionSettings,
  resolveBinding
} from '../lib/controller-mapping';
import {
  buildControllerPlayback,
  finalizeControllerRecording,
  loadControllerPlaybackSettings,
  loadControllerRecording,
  RecordedControllerEvent,
  RecordedControllerMacro,
  ControllerPlaybackSettings
} from '../lib/controller-macro';
import { useI18n } from '../lib/i18n';

type Props = {
  connection: 'offline' | 'connecting' | 'pairing' | 'connected' | 'error';
  message: string;
  inputLocked: boolean;
  playbackActive: boolean;
  playbackProgress: number | null;
  playbackElapsedMs: number;
  onConnect(): Promise<void>;
  onDisconnect(): Promise<void>;
  notify(message: string): void;
};

const BINDINGS_STORAGE_KEY = 'squid-sketch.controller-bindings.v3';
const LEGACY_BINDINGS_STORAGE_KEY = 'squid-sketch.controller-bindings.v2';
const MOUSE_MOTION_STORAGE_KEY = 'squid-sketch.mouse-motion.v3';
const LEGACY_MOUSE_MOTION_STORAGE_KEY = 'squid-sketch.mouse-motion.v2';
const CONTROLLER_MACRO_STORAGE_KEY = 'splatoondeck.controller-macro.v1';
const CONTROLLER_PLAYBACK_STORAGE_KEY = 'splatoondeck.controller-playback.v1';
const MOUSE_REPORT_INTERVAL_MS = 8;
const GROUP_ORDER = ['面键', '肩键', '十字键', '系统键', '左摇杆', '右摇杆'] as const;
const ACTIONS_BY_ID = new Map(CONTROLLER_ACTIONS.map((action) => [action.id, action]));
const ControllerInputLock = createContext(false);
type ControllerInputDispatcher = {
  button(button: string, pressed: boolean): void;
  stick(stick: 'L_STICK' | 'R_STICK', x: number, y: number): void;
};
const ControllerInputDispatch = createContext<ControllerInputDispatcher>({
  button: () => {},
  stick: () => {}
});

function PadButton({ label, command, className = '', accent = '' }: { label: string; command: string; className?: string; accent?: string }) {
  const inputLocked = useContext(ControllerInputLock);
  const dispatch = useContext(ControllerInputDispatch);
  const [pressed, setPressed] = useState(false);
  const change = (value: boolean) => {
    if (inputLocked) { setPressed(false); return; }
    setPressed(value);
    dispatch.button(command, value);
  };
  useEffect(() => { if (inputLocked) setPressed(false); }, [inputLocked]);
  return (
    <button
      disabled={inputLocked}
      className={`pad-button ${className} ${accent} ${pressed ? 'pressed' : ''}`}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); change(true); }}
      onPointerUp={() => change(false)} onPointerCancel={() => change(false)} onLostPointerCapture={() => change(false)} onContextMenu={(event) => event.preventDefault()}
    >{label}</button>
  );
}

function AnalogStick({ side, externalPosition }: { side: 'L' | 'R'; externalPosition?: { x: number; y: number } }) {
  const inputLocked = useContext(ControllerInputLock);
  const dispatch = useContext(ControllerInputDispatch);
  const base = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const update = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (inputLocked) return;
    const rect = base.current!.getBoundingClientRect();
    const radius = rect.width * 0.28;
    let x = event.clientX - (rect.left + rect.width / 2);
    let y = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(x, y);
    if (distance > radius) { x *= radius / distance; y *= radius / distance; }
    setPosition({ x, y });
    dispatch.stick(`${side}_STICK`, Math.round(x / radius * 100), Math.round(-y / radius * 100));
  };
  const release = () => {
    setDragging(false);
    setPosition({ x: 0, y: 0 });
    dispatch.stick(`${side}_STICK`, 0, 0);
  };
  useEffect(() => {
    if (!inputLocked) return;
    setDragging(false);
    setPosition({ x: 0, y: 0 });
  }, [inputLocked]);
  const visualPosition = externalPosition ? { x: externalPosition.x * .31, y: externalPosition.y * -.31 } : position;
  return (
    <div
      ref={base} className={`analog-base ${dragging ? 'dragging' : ''}`}
      aria-disabled={inputLocked}
      onPointerDown={(event) => { if (inputLocked) return; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); update(event); }}
      onPointerMove={(event) => dragging && update(event)} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
      onDoubleClick={() => { if (inputLocked) return; dispatch.button(`${side}_STICK_PRESS`, true); setTimeout(() => dispatch.button(`${side}_STICK_PRESS`, false), 90); }}
    ><div className="analog-ring" /><div className="analog-cap" style={{ transform: `translate(${visualPosition.x}px, ${visualPosition.y}px)` }}><span /></div></div>
  );
}

function emptyBindings(): ControllerBindings {
  return Object.fromEntries(CONTROLLER_ACTIONS.map(({ id }) => [id, { keyboard: null, mouse: null }])) as ControllerBindings;
}

function loadInitialBindings() {
  const current = localStorage.getItem(BINDINGS_STORAGE_KEY);
  if (current) return loadBindings(current);
  const legacy = localStorage.getItem(LEGACY_BINDINGS_STORAGE_KEY);
  return legacy ? assignBinding(loadBindings(legacy), 'L_STICK_PRESS', 'keyboard', 'KeyQ') : createDefaultBindings();
}

function loadInitialMouseMotion() {
  return loadMouseMotionSettings(localStorage.getItem(MOUSE_MOTION_STORAGE_KEY) ?? localStorage.getItem(LEGACY_MOUSE_MOTION_STORAGE_KEY));
}

function loadInitialControllerMacro() {
  return loadControllerRecording(localStorage.getItem(CONTROLLER_MACRO_STORAGE_KEY));
}

function loadInitialPlaybackSettings() {
  return loadControllerPlaybackSettings(localStorage.getItem(CONTROLLER_PLAYBACK_STORAGE_KEY));
}

type ActiveRecorder = {
  startedAt: number;
  events: RecordedControllerEvent[];
  buttons: Map<string, boolean>;
  sticks: Record<'L_STICK' | 'R_STICK', { x: number; y: number }>;
};

export default function ControllerPage({ connection, message, inputLocked, playbackActive, playbackProgress, playbackElapsedMs, onConnect, onDisconnect, notify }: Props) {
  const { locale, t, tx } = useI18n();
  const connected = connection === 'connected';
  const connectionBusy = connection === 'connecting' || connection === 'pairing';
  const stageRef = useRef<HTMLDivElement>(null);
  const [bindings, setBindings] = useState(loadInitialBindings);
  const [mouseMotion, setMouseMotion] = useState(loadInitialMouseMotion);
  const mouseMotionRef = useRef(mouseMotion);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [capturing, setCapturing] = useState<{ actionId: ControllerActionId; device: InputDevice } | null>(null);
  const [mouseLocked, setMouseLocked] = useState(false);
  const [mouseVector, setMouseVector] = useState({ x: 0, y: 0 });
  const [recording, setRecording] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [recordingEventCount, setRecordingEventCount] = useState(0);
  const [recordedMacro, setRecordedMacro] = useState<RecordedControllerMacro | null>(loadInitialControllerMacro);
  const [playbackSettings, setPlaybackSettings] = useState<ControllerPlaybackSettings>(loadInitialPlaybackSettings);
  const [playbackLaunching, setPlaybackLaunching] = useState(false);
  const recorderRef = useRef<ActiveRecorder | null>(null);

  const recordButton = useCallback((button: string, pressed: boolean) => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const previous = recorder.buttons.get(button) ?? false;
    if (previous === pressed) return;
    recorder.buttons.set(button, pressed);
    recorder.events.push({ atMs: Math.max(0, Math.round(performance.now() - recorder.startedAt)), type: 'button', button, pressed });
  }, []);

  const recordStick = useCallback((stick: 'L_STICK' | 'R_STICK', x: number, y: number) => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const next = { x: Math.max(-100, Math.min(100, Math.round(x))), y: Math.max(-100, Math.min(100, Math.round(y))) };
    const previous = recorder.sticks[stick];
    if (previous.x === next.x && previous.y === next.y) return;
    recorder.sticks[stick] = next;
    recorder.events.push({ atMs: Math.max(0, Math.round(performance.now() - recorder.startedAt)), type: 'stick', stick, ...next });
  }, []);

  const sendButton = useCallback((button: string, pressed: boolean) => {
    window.squidSketch.controller.button(button, pressed);
    recordButton(button, pressed);
  }, [recordButton]);

  const sendStick = useCallback((stick: 'L_STICK' | 'R_STICK', x: number, y: number) => {
    window.squidSketch.controller.stick(stick, x, y);
    recordStick(stick, x, y);
  }, [recordStick]);

  const inputDispatch = useMemo(() => ({ button: sendButton, stick: sendStick }), [sendButton, sendStick]);

  const groupedActions = useMemo(() => GROUP_ORDER.map((group) => ({
    group,
    actions: CONTROLLER_ACTIONS.filter((action) => action.group === group)
  })), []);

  useEffect(() => localStorage.setItem(BINDINGS_STORAGE_KEY, JSON.stringify(bindings)), [bindings]);
  useEffect(() => {
    mouseMotionRef.current = mouseMotion;
    localStorage.setItem(MOUSE_MOTION_STORAGE_KEY, JSON.stringify(mouseMotion));
  }, [mouseMotion]);
  useEffect(() => localStorage.setItem(CONTROLLER_PLAYBACK_STORAGE_KEY, JSON.stringify(playbackSettings)), [playbackSettings]);

  useEffect(() => {
    if (!recording) return;
    const update = () => {
      const recorder = recorderRef.current;
      if (!recorder) return;
      setRecordingElapsedMs(Math.max(0, Math.round(performance.now() - recorder.startedAt)));
      setRecordingEventCount(recorder.events.length);
    };
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const macro = finalizeControllerRecording(recorder.events, performance.now() - recorder.startedAt);
    if (macro) localStorage.setItem(CONTROLLER_MACRO_STORAGE_KEY, JSON.stringify(macro));
    recorderRef.current = null;
  }, []);

  const startRecording = () => {
    if (!connected) { notify(t('请先连接虚拟 Pro Controller')); return; }
    if (inputLocked || playbackLaunching) return;
    recorderRef.current = {
      startedAt: performance.now(),
      events: [],
      buttons: new Map(),
      sticks: { L_STICK: { x: 0, y: 0 }, R_STICK: { x: 0, y: 0 } }
    };
    setRecordingElapsedMs(0);
    setRecordingEventCount(0);
    setRecording(true);
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const macro = finalizeControllerRecording(recorder.events, performance.now() - recorder.startedAt);
    recorderRef.current = null;
    setRecording(false);
    if (!macro) { notify(t('没有记录到手柄操作')); return; }
    setRecordedMacro(macro);
    setRecordingElapsedMs(macro.durationMs);
    setRecordingEventCount(macro.events.length);
    localStorage.setItem(CONTROLLER_MACRO_STORAGE_KEY, JSON.stringify(macro));
    notify(t('录制已保存'));
  };

  const clearRecording = () => {
    if (recording || playbackActive || playbackLaunching) return;
    setRecordedMacro(null);
    setRecordingElapsedMs(0);
    setRecordingEventCount(0);
    localStorage.removeItem(CONTROLLER_MACRO_STORAGE_KEY);
    notify(t('录制内容已清空'));
  };

  const startPlayback = async () => {
    if (!connected) { notify(t('请先连接虚拟 Pro Controller')); return; }
    if (!recordedMacro) { notify(t('没有可回放的录制内容')); return; }
    if (inputLocked || recording || playbackLaunching) return;
    const playback = buildControllerPlayback(recordedMacro);
    if (!playback.macro) { notify(t('没有可回放的录制内容')); return; }
    if (document.pointerLockElement) document.exitPointerLock();
    setPlaybackLaunching(true);
    try {
      const result = await window.squidSketch.controller.runMacro(playback.macro, {
        kind: 'controller-recording',
        durationMs: playbackSettings.mode === 'count' ? playback.durationMs * playbackSettings.repeatCount : playback.durationMs,
        cycleDurationMs: playback.durationMs,
        repeatMode: playbackSettings.mode,
        repeatCount: playbackSettings.mode === 'count' ? playbackSettings.repeatCount : 0,
        inputCount: playback.inputCount,
        createdAt: recordedMacro.createdAt
      });
      if (!result.ok) notify(t('宏回放启动失败'));
    } catch (error) {
      notify(tx(error instanceof Error ? error.message : String(error)));
    } finally {
      setPlaybackLaunching(false);
    }
  };

  const stopPlayback = async () => {
    try {
      const result = await window.squidSketch.controller.stopMacro();
      if (!result.ok) notify(t('宏回放停止失败'));
    } catch (error) {
      notify(tx(error instanceof Error ? error.message : String(error)));
    }
  };

  const changeBinding = (actionId: ControllerActionId, device: InputDevice, value: string | number | null) => {
    setBindings((current) => assignBinding(current, actionId, device, value));
  };

  useEffect(() => {
    if (!capturing) return;
    const captureKey = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopPropagation();
      if (event.code === 'Escape') { setCapturing(null); return; }
      changeBinding(capturing.actionId, 'keyboard', event.code);
      setCapturing(null);
    };
    const captureMouse = (event: MouseEvent) => {
      if (capturing.device !== 'mouse' || event.button > 4) return;
      event.preventDefault(); event.stopPropagation();
      changeBinding(capturing.actionId, 'mouse', event.button);
      setCapturing(null);
    };
    if (capturing.device === 'keyboard') window.addEventListener('keydown', captureKey, true);
    else window.addEventListener('mousedown', captureMouse, true);
    return () => {
      window.removeEventListener('keydown', captureKey, true);
      window.removeEventListener('mousedown', captureMouse, true);
    };
  }, [capturing]);

  useEffect(() => {
    if (!mappingOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.code === 'Escape' && !capturing) setMappingOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mappingOpen, capturing]);

  useEffect(() => {
    const activeInputs = new Map<string, ControllerActionId>();
    const actionSources = new Map<ControllerActionId, Set<string>>();
    const stickDirections: Record<'L_STICK' | 'R_STICK', Set<string>> = { L_STICK: new Set(), R_STICK: new Set() };
    const motion: Record<'L_STICK' | 'R_STICK', { x: number; y: number }> = { L_STICK: { x: 0, y: 0 }, R_STICK: { x: 0, y: 0 } };
    let motionTimer: number | null = null;
    let displayTimer: number | null = null;
    let motionFlushTimer: number | null = null;
    let motionVisualFrame: number | null = null;
    let lastMotionReportAt = Number.NEGATIVE_INFINITY;
    const pendingMovement = { x: 0, y: 0 };
    let lastRawPointerAt = Number.NEGATIVE_INFINITY;

    const clamp = (value: number) => Math.max(-100, Math.min(100, Math.round(value)));
    const emitStick = (stick: 'L_STICK' | 'R_STICK') => {
      const directions = stickDirections[stick];
      const digitalX = (directions.has('RIGHT') ? 100 : 0) - (directions.has('LEFT') ? 100 : 0);
      const digitalY = (directions.has('UP') ? 100 : 0) - (directions.has('DOWN') ? 100 : 0);
      sendStick(stick, clamp(digitalX + motion[stick].x), clamp(digitalY + motion[stick].y));
    };
    const setAction = (actionId: ControllerActionId, pressed: boolean, source: string) => {
      const action = ACTIONS_BY_ID.get(actionId)!;
      let sources = actionSources.get(actionId);
      if (!sources) { sources = new Set(); actionSources.set(actionId, sources); }
      const wasPressed = sources.size > 0;
      if (pressed) sources.add(source); else sources.delete(source);
      const isPressed = sources.size > 0;
      if (wasPressed === isPressed) return;
      if (action.kind === 'button') sendButton(actionId, isPressed);
      else if (action.stick && action.axis) {
        if (isPressed) stickDirections[action.stick].add(action.axis);
        else stickDirections[action.stick].delete(action.axis);
        emitStick(action.stick);
      }
    };
    const pressInput = (source: string, actionId: ControllerActionId) => {
      if (activeInputs.has(source)) return;
      activeInputs.set(source, actionId); setAction(actionId, true, source);
    };
    const releaseInput = (source: string) => {
      const actionId = activeInputs.get(source);
      if (!actionId) return;
      activeInputs.delete(source); setAction(actionId, false, source);
    };
    const releaseAll = () => {
      for (const [source] of activeInputs) releaseInput(source);
      stickDirections.L_STICK.clear(); stickDirections.R_STICK.clear();
      motion.L_STICK = { x: 0, y: 0 }; motion.R_STICK = { x: 0, y: 0 };
      setMouseVector({ x: 0, y: 0 });
      sendStick('L_STICK', 0, 0);
      sendStick('R_STICK', 0, 0);
      if (motionTimer !== null) window.clearTimeout(motionTimer);
      if (displayTimer !== null) window.clearTimeout(displayTimer);
      if (motionFlushTimer !== null) window.clearTimeout(motionFlushTimer);
      if (motionVisualFrame !== null) window.cancelAnimationFrame(motionVisualFrame);
      motionFlushTimer = null;
      motionVisualFrame = null;
      pendingMovement.x = 0; pendingMovement.y = 0;
    };
    const keydown = (event: KeyboardEvent) => {
      if (!connected || inputLocked || mappingOpen || capturing) return;
      const actionId = resolveBinding(bindings, 'keyboard', event.code);
      if (!actionId) return;
      event.preventDefault(); pressInput(`keyboard:${event.code}`, actionId);
    };
    const keyup = (event: KeyboardEvent) => releaseInput(`keyboard:${event.code}`);
    const mousedown = (event: MouseEvent) => {
      if (!connected || inputLocked || mappingOpen || capturing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('button, .analog-base, .mapping-dialog')) return;
      const actionId = resolveBinding(bindings, 'mouse', event.button);
      if (!actionId) return;
      event.preventDefault(); pressInput(`mouse:${event.button}`, actionId);
    };
    const mouseup = (event: MouseEvent) => releaseInput(`mouse:${event.button}`);
    const flushMouseMovement = () => {
      motionFlushTimer = null;
      lastMotionReportAt = performance.now();
      const movement = { ...pendingMovement };
      pendingMovement.x = 0; pendingMovement.y = 0;
      const currentSettings = mouseMotionRef.current;
      if (currentSettings.target === 'off' || (movement.x === 0 && movement.y === 0)) return;
      const stick = currentSettings.target;
      motion[stick] = blendMouseDeltaToStick(motion[stick], movement.x, movement.y, currentSettings);
      // Send motion at the same cadence as the 120 Hz bridge instead of
      // waiting for Chromium's usually-60 Hz paint frame.  The visual HUD is
      // still coalesced through rAF so input latency improves without causing
      // unnecessary React renders.
      emitStick(stick);
      if (motionVisualFrame === null) {
        motionVisualFrame = window.requestAnimationFrame(() => {
          motionVisualFrame = null;
          setMouseVector(motion[stick]);
        });
      }
      if (motionTimer !== null) window.clearTimeout(motionTimer);
      if (displayTimer !== null) window.clearTimeout(displayTimer);
      // Two to three 120 Hz controller reports apply the impulse while keeping
      // stop latency close to a native FPS mouse.
      motionTimer = window.setTimeout(() => { motion[stick] = { x: 0, y: 0 }; emitStick(stick); }, 24);
      displayTimer = window.setTimeout(() => setMouseVector({ x: 0, y: 0 }), 48);
    };
    const queueMouseMovement = (movementX: number, movementY: number) => {
      const settings = mouseMotionRef.current;
      if (!connected || inputLocked || document.pointerLockElement !== stageRef.current || settings.target === 'off') return;
      pendingMovement.x += movementX;
      pendingMovement.y += movementY;
      if (motionFlushTimer !== null) return;
      const elapsed = performance.now() - lastMotionReportAt;
      const delay = Math.max(0, MOUSE_REPORT_INTERVAL_MS - elapsed);
      motionFlushTimer = window.setTimeout(flushMouseMovement, delay);
    };
    const rawPointerMove = (event: Event) => {
      const pointer = event as PointerEvent;
      if (pointer.pointerType !== 'mouse') return;
      lastRawPointerAt = performance.now();
      queueMouseMovement(pointer.movementX, pointer.movementY);
    };
    const mousemove = (event: MouseEvent) => {
      // Chromium emits mousemove alongside pointerrawupdate.  Ignore the
      // coalesced duplicate when raw input is flowing, but retain mousemove as
      // a fallback on systems where raw pointer events are unavailable.
      if (performance.now() - lastRawPointerAt < 32) return;
      queueMouseMovement(event.movementX, event.movementY);
    };
    const contextmenu = (event: MouseEvent) => {
      if (connected && resolveBinding(bindings, 'mouse', 2) && !(event.target instanceof Element && event.target.closest('.mapping-dialog'))) event.preventDefault();
    };
    const pointerLockChange = () => {
      const locked = document.pointerLockElement === stageRef.current;
      setMouseLocked(locked);
      if (!locked) releaseAll();
    };
    const visibility = () => { if (document.hidden) releaseAll(); };

    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup);
    window.addEventListener('mousedown', mousedown); window.addEventListener('mouseup', mouseup); window.addEventListener('mousemove', mousemove);
    window.addEventListener('pointerrawupdate', rawPointerMove as EventListener);
    window.addEventListener('contextmenu', contextmenu); window.addEventListener('blur', releaseAll);
    document.addEventListener('pointerlockchange', pointerLockChange); document.addEventListener('visibilitychange', visibility);
    return () => {
      releaseAll();
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup);
      window.removeEventListener('mousedown', mousedown); window.removeEventListener('mouseup', mouseup); window.removeEventListener('mousemove', mousemove);
      window.removeEventListener('pointerrawupdate', rawPointerMove as EventListener);
      window.removeEventListener('contextmenu', contextmenu); window.removeEventListener('blur', releaseAll);
      document.removeEventListener('pointerlockchange', pointerLockChange); document.removeEventListener('visibilitychange', visibility);
    };
  }, [bindings, capturing, connected, inputLocked, mappingOpen, sendButton, sendStick]);

  useEffect(() => {
    if (inputLocked && document.pointerLockElement) document.exitPointerLock();
  }, [inputLocked]);

  const openMapping = () => {
    if (inputLocked || recording) return;
    if (document.pointerLockElement) document.exitPointerLock();
    setCapturing(null); setMappingOpen(true);
  };
  const closeMapping = () => { setCapturing(null); setMappingOpen(false); };
  const toggleMouseControl = async () => {
    if (mouseMotion.target === 'off') { openMapping(); return; }
    if (document.pointerLockElement === stageRef.current) document.exitPointerLock();
    else if (connected && !inputLocked && stageRef.current) {
      try {
        // Raw/unadjusted movement matches FPS controls by bypassing Windows
        // pointer acceleration.  Fall back cleanly on older Chromium builds.
        await stageRef.current.requestPointerLock({ unadjustedMovement: true });
      } catch {
        await stageRef.current.requestPointerLock();
      }
    }
  };
  const restoreDefaults = () => {
    setBindings(createDefaultBindings());
    setMouseMotion({ ...DEFAULT_MOUSE_MOTION });
    setCapturing(null);
  };
  const bindingHint = (actionId: ControllerActionId) => {
    const binding = bindings[actionId];
    return binding.keyboard ? formatKeyboardCode(binding.keyboard, locale) : formatMouseButton(binding.mouse, locale);
  };
  const visibleEvents = recording ? recorderRef.current?.events ?? [] : recordedMacro?.events ?? [];
  const displayedDurationMs = recording ? recordingElapsedMs : recordedMacro?.durationMs ?? 0;
  const displayedEventCount = recording ? recordingEventCount : recordedMacro?.events.length ?? 0;
  const playbackCycleMs = recordedMacro ? buildControllerPlayback(recordedMacro).durationMs : 0;
  const playbackRound = playbackCycleMs > 0 ? Math.floor(playbackElapsedMs / playbackCycleMs) + 1 : 1;
  const displayedRound = playbackSettings.mode === 'count' ? Math.min(playbackSettings.repeatCount, playbackRound) : playbackRound;
  const eventPreview = visibleEvents.slice(-10);
  const timelineEvents = visibleEvents.length <= 80
    ? visibleEvents
    : visibleEvents.filter((_, index) => index % Math.ceil(visibleEvents.length / 80) === 0);
  const describeEvent = (event: RecordedControllerEvent) => event.type === 'button'
    ? `${event.button} ${t(event.pressed ? '按下' : '松开')}`
    : `${t(event.stick === 'L_STICK' ? '左摇杆' : '右摇杆')} ${event.x}, ${event.y}`;
  const statusKey = recording ? '录制中' : playbackActive ? '回放中' : recordedMacro ? '已录制' : '尚未录制宏';

  return (
    <section className="page controller-page">
      <header className="page-header compact">
        <div><span className="eyebrow">TAKE CONTROL</span><h1>{t('虚拟 ')}<span>Pro Controller</span></h1><p>{t('鼠标、触控和键盘都能操作；双击摇杆可按下 L3 / R3。')}</p></div>
        <div className="controller-header-actions">
          <button disabled={inputLocked || recording} className="ghost-button mapping-open-button" onClick={openMapping}>⌨ {t('自定义映射')}</button>
          {mouseMotion.target !== 'off' && <button className={`ghost-button mouse-control-button ${mouseLocked ? 'active' : ''}`} onClick={toggleMouseControl} disabled={!connected || inputLocked}>{mouseLocked ? t('鼠标控制中 · Esc 退出') : t('启用鼠标 → {{stick}}', { stick: t(mouseMotion.target === 'L_STICK' ? '左摇杆' : '右摇杆') })}</button>}
          {mouseMotion.target !== 'off' && <div className="mouse-sensitivity-quick"><span>{t('横向')}</span><input aria-label={t('鼠标横向灵敏度')} disabled={inputLocked || recording} type="range" min="0.5" max="10" step="0.5" value={mouseMotion.sensitivityX} onChange={(event) => setMouseMotion((current) => ({ ...current, sensitivityX: Number(event.target.value) }))} /><b>{mouseMotion.sensitivityX.toFixed(1)}</b><span>{t('纵向')}</span><input aria-label={t('鼠标纵向灵敏度')} disabled={inputLocked || recording} type="range" min="0.5" max="10" step="0.5" value={mouseMotion.sensitivityY} onChange={(event) => setMouseMotion((current) => ({ ...current, sensitivityY: Number(event.target.value) }))} /><b>{mouseMotion.sensitivityY.toFixed(1)}</b></div>}
          <button
            className={`connect-button ${connected ? 'ghost-button danger' : 'primary-button lime'}`}
            onClick={connected ? onDisconnect : onConnect}
            disabled={inputLocked || recording || connectionBusy}
          >
            {!connected && (connectionBusy ? <i className="spinner" /> : 'ᛒ')}{' '}
            {t(connected ? '断开连接' : connection === 'pairing' ? '等待 Switch 2 配对' : connection === 'connecting' ? '正在连接 Switch 2' : '连接 Switch 2')}
          </button>
        </div>
      </header>

      <ControllerInputDispatch.Provider value={inputDispatch}><ControllerInputLock.Provider value={inputLocked}><div ref={stageRef} className={`controller-stage ${connected ? 'live' : ''} ${mouseLocked ? 'mouse-locked' : ''} ${inputLocked ? 'input-locked' : ''}`}>
        <div className="stage-grid" />
        <div className="controller-shadow" />
        <div className="pro-controller">
          <div className="shoulders"><PadButton label="ZL" command="ZL" className="trigger trigger-left" /><PadButton label="L" command="L" className="bumper bumper-left" /><PadButton label="R" command="R" className="bumper bumper-right" /><PadButton label="ZR" command="ZR" className="trigger trigger-right" /></div>
          <div className="grip grip-left" /><div className="grip grip-right" />
          <div className="controller-body">
            <div className="top-meta"><PadButton label="−" command="MINUS" className="meta-button" /><div className="status-led"><i /><i /><i /><i /></div><PadButton label="+" command="PLUS" className="meta-button" /></div>
            <div className="left-controls">
              <AnalogStick side="L" externalPosition={mouseLocked && mouseMotion.target === 'L_STICK' ? mouseVector : undefined} />
              <div className="dpad">
                <PadButton label="▲" command="DPAD_UP" className="dpad-up" />
                <PadButton label="◀" command="DPAD_LEFT" className="dpad-left" />
                <div className="dpad-center" />
                <PadButton label="▶" command="DPAD_RIGHT" className="dpad-right" />
                <PadButton label="▼" command="DPAD_DOWN" className="dpad-down" />
              </div>
            </div>
            <div className="controller-center">
              <div className="center-panel"><div className="ink-logo">SD</div><span>PRO CONTROLLER</span></div>
              <div className="system-row">
                <PadButton label="▣" command="CAPTURE" className="system-button capture" />
                <PadButton label="⌂" command="HOME" className="system-button home" />
              </div>
            </div>
            <div className="right-controls">
              <div className="face-buttons">
                <PadButton label="X" command="X" className="face face-x" accent="blue" />
                <PadButton label="Y" command="Y" className="face face-y" accent="green" />
                <PadButton label="A" command="A" className="face face-a" accent="red" />
                <PadButton label="B" command="B" className="face face-b" accent="yellow" />
              </div>
              <AnalogStick side="R" externalPosition={mouseLocked && mouseMotion.target === 'R_STICK' ? mouseVector : undefined} />
            </div>
          </div>
        </div>
        {mouseLocked && <div className="mouse-lock-hud"><strong>{t('鼠标正在控制{{stick}}', { stick: t(mouseMotion.target === 'L_STICK' ? '左摇杆' : '右摇杆') })}</strong><span>X {Math.round(mouseVector.x)} · Y {Math.round(mouseVector.y)} · {t('Esc 退出')}</span></div>}
        {inputLocked && <div className="controller-lock-notice"><strong>{t(playbackActive ? '宏回放进行中' : '自动绘制进行中')}</strong><span>{t(playbackActive ? '正在按录制节奏执行，手柄输入已锁定' : '手柄输入已锁定，请在涂鸦工坊停止绘制后操作')}</span></div>}
        <div className={`controller-state-card ${connection}`}><i /><div><strong>{connected ? 'LIVE INPUT' : connection === 'pairing' ? 'PAIRING' : 'STANDBY'}</strong><span>{tx(message)}</span></div></div>
      </div></ControllerInputLock.Provider></ControllerInputDispatch.Provider>

      <div className="key-guide">
        <span><kbd>1 2 3 4</kbd> {t('十字键')}</span>
        <span><kbd>W A S D</kbd> {t('左摇杆')}</span>
        <span><kbd>{bindingHint('B')} / {bindingHint('A')}</kbd> B / A</span>
        <span><kbd>{bindingHint('Y')} / {bindingHint('X')}</kbd> Y / X</span>
        <span><kbd>{bindingHint('L')} / {bindingHint('ZL')}</kbd> L / ZL</span>
        <span><kbd>{bindingHint('R')} / {bindingHint('ZR')}</kbd> R / ZR</span>
        <span><kbd>{t('鼠标移动')}</kbd> {t('右摇杆')}</span>
        <button disabled={inputLocked || recording} className="key-guide-edit" onClick={openMapping}>{t('编辑全部映射 →')}</button>
      </div>

      <section className={`controller-macro-panel ${recording ? 'recording' : ''} ${playbackActive ? 'playing' : ''}`}>
        <div className="macro-panel-copy">
          <div><span className="step-kicker">ACTION REPLAY</span><h2>{t('宏录制与回放')}</h2></div>
          <p>{t('记录按键、摇杆和操作间隔，之后按原始节奏重新执行。')}</p>
          <span className={`macro-status ${recording ? 'recording' : playbackActive ? 'playing' : recordedMacro ? 'ready' : ''}`}><i />{t(statusKey)}</span>
        </div>

        <div className="macro-summary">
          <span>{t('持续时间')}<strong>{t('{{seconds}} 秒', { seconds: (displayedDurationMs / 1000).toFixed(1) })}</strong></span>
          <span>{t('事件')}<strong>{displayedEventCount.toLocaleString(locale)}</strong></span>
          <span>{t('保存位置')}<strong>{t('仅保存在本机')}</strong></span>
        </div>

        <div className="macro-timeline-wrap">
          <div className="macro-timeline-label"><span>{t('事件时间线')}</span><b>{recording ? '● REC' : playbackActive ? `▶ ${t('第 {{round}} 轮', { round: displayedRound })}` : ''}</b></div>
          <div className="macro-timeline">
            {timelineEvents.map((event, index) => <i
              key={`${event.atMs}-${index}`}
              className={event.type}
              style={{ left: `${displayedDurationMs > 0 ? Math.min(100, event.atMs / displayedDurationMs * 100) : 0}%` }}
              title={`${(event.atMs / 1000).toFixed(2)}s · ${describeEvent(event)}`}
            />)}
            {playbackActive && <em style={{ left: `${Math.max(0, Math.min(100, (playbackProgress ?? 0) * 100))}%` }} />}
          </div>
          <div className="macro-event-strip">
            {eventPreview.length ? eventPreview.map((event, index) => <span key={`${event.atMs}-${index}`}><time>{(event.atMs / 1000).toFixed(2)}s</time>{describeEvent(event)}</span>) : <small>{t('录制会捕获屏幕手柄、键盘、鼠标按键和鼠标移动。')}</small>}
          </div>
        </div>

        <div className="macro-playback-config">
          <strong>{t('回放方式')}</strong>
          <label className={playbackSettings.mode === 'count' ? 'active' : ''}><input disabled={recording || playbackActive || playbackLaunching} type="radio" checked={playbackSettings.mode === 'count'} onChange={() => setPlaybackSettings((current) => ({ ...current, mode: 'count' }))} />{t('指定次数')}</label>
          <label className="macro-repeat-count"><input aria-label={t('回放次数')} disabled={recording || playbackActive || playbackLaunching || playbackSettings.mode !== 'count'} type="number" min="1" max="999" value={playbackSettings.repeatCount} onChange={(event) => setPlaybackSettings((current) => ({ ...current, repeatCount: Math.max(1, Math.min(999, Number(event.target.value) || 1)) }))} /><span>{t('次')}</span></label>
          <label className={playbackSettings.mode === 'infinite' ? 'active' : ''}><input disabled={recording || playbackActive || playbackLaunching} type="radio" checked={playbackSettings.mode === 'infinite'} onChange={() => setPlaybackSettings((current) => ({ ...current, mode: 'infinite' }))} />{t('无限循环')}</label>
          {playbackActive && <span className="macro-round-status">{playbackSettings.mode === 'infinite' ? t('第 {{round}} 轮 · 无限循环', { round: displayedRound }) : t('第 {{round}} / {{total}} 轮', { round: displayedRound, total: playbackSettings.repeatCount })}</span>}
        </div>

        <div className="macro-actions">
          {recording
            ? <button className="primary-button hot-pink" onClick={stopRecording}>■ {t('停止录制')}</button>
            : <button className="ghost-button macro-record-button" disabled={!connected || inputLocked || playbackLaunching} onClick={startRecording}>● {t('开始录制')}</button>}
          {playbackActive
            ? <button className="primary-button hot-pink" onClick={stopPlayback}>■ {t('停止回放')}</button>
            : <button className="primary-button lime" disabled={!connected || !recordedMacro || recording || inputLocked || playbackLaunching} onClick={startPlayback}>{playbackLaunching ? <i className="spinner" /> : '▶'} {t(playbackLaunching ? '正在启动回放…' : '回放')}</button>}
          <button className="ghost-button" disabled={!recordedMacro || recording || playbackActive || playbackLaunching} onClick={clearRecording}>{t('清空')}</button>
        </div>
      </section>

      {mappingOpen && createPortal(<div className="mapping-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) closeMapping(); }}>
        <div className="mapping-dialog" role="dialog" aria-modal="true" aria-labelledby="mapping-title">
          <header className="mapping-header">
            <div><span className="eyebrow">INPUT LAB</span><h2 id="mapping-title">{t('键盘与鼠标映射')}</h2><p>{t('点击一个映射槽，再按下想使用的键。重复绑定会自动从旧动作移除。')}</p></div>
            <div className="mapping-header-actions"><button className="ghost-button" onClick={restoreDefaults}>{t('恢复默认')}</button><button className="mapping-close" onClick={closeMapping} aria-label={t('关闭映射设置')}>×</button></div>
          </header>

          <section className="mouse-motion-settings">
            <div className="motion-copy"><strong>{t('鼠标移动')}</strong><span>{t('启用后，在手柄页点击“启用鼠标”，使用指针锁定连续控制摇杆。')}</span></div>
            <label><span>{t('控制目标')}</span><select value={mouseMotion.target} onChange={(event) => setMouseMotion((current) => ({ ...current, target: event.target.value as MouseMotionSettings['target'] }))}><option value="off">{t('关闭')}</option><option value="L_STICK">{t('左摇杆')}</option><option value="R_STICK">{t('右摇杆')}</option></select></label>
            <div className="axis-sensitivity"><label className="sensitivity-control"><span>{t('横向灵敏度')} <b>{mouseMotion.sensitivityX.toFixed(1)}</b></span><input aria-label={t('鼠标横向灵敏度')} type="range" min="0.5" max="10" step="0.5" value={mouseMotion.sensitivityX} onChange={(event) => setMouseMotion((current) => ({ ...current, sensitivityX: Number(event.target.value) }))} /></label><label className="sensitivity-control"><span>{t('纵向灵敏度')} <b>{mouseMotion.sensitivityY.toFixed(1)}</b></span><input aria-label={t('鼠标纵向灵敏度')} type="range" min="0.5" max="10" step="0.5" value={mouseMotion.sensitivityY} onChange={(event) => setMouseMotion((current) => ({ ...current, sensitivityY: Number(event.target.value) }))} /></label></div>
            <label className="motion-check"><input type="checkbox" checked={mouseMotion.invertX} onChange={(event) => setMouseMotion((current) => ({ ...current, invertX: event.target.checked }))} /><span>{t('反转 X')}</span></label>
            <label className="motion-check"><input type="checkbox" checked={mouseMotion.invertY} onChange={(event) => setMouseMotion((current) => ({ ...current, invertY: event.target.checked }))} /><span>{t('反转 Y')}</span></label>
          </section>

          <div className="mapping-columns"><span>{t('手柄动作')}</span><span>{t('键盘')}</span><span>{t('鼠标按键')}</span></div>
          <div className="mapping-groups">
            {groupedActions.map(({ group, actions }) => <section className="mapping-group" key={group}>
              <h3>{t(group)}</h3>
              {actions.map((action) => {
                const binding = bindings[action.id];
                const keyboardCapturing = capturing?.actionId === action.id && capturing.device === 'keyboard';
                const mouseCapturing = capturing?.actionId === action.id && capturing.device === 'mouse';
                return <div className="mapping-row" key={action.id}>
                  <strong>{t(action.label)}</strong>
                  <div className="binding-cell"><button aria-label={`${t(action.label)} · ${t('键盘')}`} className={`binding-slot ${keyboardCapturing ? 'capturing' : ''} ${binding.keyboard ? '' : 'empty'}`} onClick={() => setCapturing({ actionId: action.id, device: 'keyboard' })}>{keyboardCapturing ? t('请按键…') : formatKeyboardCode(binding.keyboard, locale)}</button>{binding.keyboard && <button className="binding-clear" aria-label={`× ${t(action.label)} · ${t('键盘')}`} onClick={() => changeBinding(action.id, 'keyboard', null)}>×</button>}</div>
                  <div className="binding-cell"><button aria-label={`${t(action.label)} · ${t('鼠标按键')}`} className={`binding-slot ${mouseCapturing ? 'capturing' : ''} ${binding.mouse === null ? 'empty' : ''}`} onClick={() => setCapturing({ actionId: action.id, device: 'mouse' })}>{mouseCapturing ? t('请按鼠标键…') : formatMouseButton(binding.mouse, locale)}</button>{binding.mouse !== null && <button className="binding-clear" aria-label={`× ${t(action.label)} · ${t('鼠标按键')}`} onClick={() => changeBinding(action.id, 'mouse', null)}>×</button>}</div>
                </div>;
              })}
            </section>)}
          </div>
          <footer className="mapping-footer"><span>{t('鼠标按键映射在页面空白区域生效，避免与直接点击虚拟手柄冲突。')}</span><div><button className="ghost-button" onClick={() => { setBindings(emptyBindings()); setCapturing(null); }}>{t('清空按键映射')}</button><button className="primary-button lime" onClick={closeMapping}>{t('完成')}</button></div></footer>
        </div>
      </div>, document.body)}
    </section>
  );
}
