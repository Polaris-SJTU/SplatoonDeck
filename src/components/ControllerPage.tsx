import { createContext, PointerEvent as ReactPointerEvent, useContext, useEffect, useMemo, useRef, useState } from 'react';
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

type Props = {
  connection: 'offline' | 'connecting' | 'pairing' | 'connected' | 'error';
  message: string;
  inputLocked: boolean;
  onConnect(): Promise<void>;
  onDisconnect(): Promise<void>;
};

const BINDINGS_STORAGE_KEY = 'squid-sketch.controller-bindings.v3';
const LEGACY_BINDINGS_STORAGE_KEY = 'squid-sketch.controller-bindings.v2';
const MOUSE_MOTION_STORAGE_KEY = 'squid-sketch.mouse-motion.v3';
const LEGACY_MOUSE_MOTION_STORAGE_KEY = 'squid-sketch.mouse-motion.v2';
const GROUP_ORDER = ['面键', '肩键', '十字键', '系统键', '左摇杆', '右摇杆'] as const;
const ACTIONS_BY_ID = new Map(CONTROLLER_ACTIONS.map((action) => [action.id, action]));
const ControllerInputLock = createContext(false);

function PadButton({ label, command, className = '', accent = '' }: { label: string; command: string; className?: string; accent?: string }) {
  const inputLocked = useContext(ControllerInputLock);
  const [pressed, setPressed] = useState(false);
  const change = (value: boolean) => {
    if (inputLocked) { setPressed(false); return; }
    setPressed(value);
    window.squidSketch.controller.button(command, value);
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
    window.squidSketch.controller.stick(`${side}_STICK`, Math.round(x / radius * 100), Math.round(-y / radius * 100));
  };
  const release = () => {
    setDragging(false);
    setPosition({ x: 0, y: 0 });
    window.squidSketch.controller.stick(`${side}_STICK`, 0, 0);
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
      onDoubleClick={() => { if (inputLocked) return; window.squidSketch.controller.button(`${side}_STICK_PRESS`, true); setTimeout(() => window.squidSketch.controller.button(`${side}_STICK_PRESS`, false), 90); }}
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

export default function ControllerPage({ connection, message, inputLocked, onConnect, onDisconnect }: Props) {
  const connected = connection === 'connected';
  const connectionBusy = connection === 'connecting' || connection === 'pairing';
  const stageRef = useRef<HTMLDivElement>(null);
  const [bindings, setBindings] = useState(loadInitialBindings);
  const [mouseMotion, setMouseMotion] = useState(loadInitialMouseMotion);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [capturing, setCapturing] = useState<{ actionId: ControllerActionId; device: InputDevice } | null>(null);
  const [mouseLocked, setMouseLocked] = useState(false);
  const [mouseVector, setMouseVector] = useState({ x: 0, y: 0 });

  const groupedActions = useMemo(() => GROUP_ORDER.map((group) => ({
    group,
    actions: CONTROLLER_ACTIONS.filter((action) => action.group === group)
  })), []);

  useEffect(() => localStorage.setItem(BINDINGS_STORAGE_KEY, JSON.stringify(bindings)), [bindings]);
  useEffect(() => localStorage.setItem(MOUSE_MOTION_STORAGE_KEY, JSON.stringify(mouseMotion)), [mouseMotion]);

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
    let motionFrame: number | null = null;
    const pendingMovement = { x: 0, y: 0 };
    let rawMovementY = 0;
    let rawMovementAt = 0;

    const clamp = (value: number) => Math.max(-100, Math.min(100, Math.round(value)));
    const emitStick = (stick: 'L_STICK' | 'R_STICK') => {
      const directions = stickDirections[stick];
      const digitalX = (directions.has('RIGHT') ? 100 : 0) - (directions.has('LEFT') ? 100 : 0);
      const digitalY = (directions.has('UP') ? 100 : 0) - (directions.has('DOWN') ? 100 : 0);
      window.squidSketch.controller.stick(stick, clamp(digitalX + motion[stick].x), clamp(digitalY + motion[stick].y));
    };
    const setAction = (actionId: ControllerActionId, pressed: boolean, source: string) => {
      const action = ACTIONS_BY_ID.get(actionId)!;
      let sources = actionSources.get(actionId);
      if (!sources) { sources = new Set(); actionSources.set(actionId, sources); }
      const wasPressed = sources.size > 0;
      if (pressed) sources.add(source); else sources.delete(source);
      const isPressed = sources.size > 0;
      if (wasPressed === isPressed) return;
      if (action.kind === 'button') window.squidSketch.controller.button(actionId, isPressed);
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
      window.squidSketch.controller.stick('L_STICK', 0, 0);
      window.squidSketch.controller.stick('R_STICK', 0, 0);
      if (motionTimer !== null) window.clearTimeout(motionTimer);
      if (displayTimer !== null) window.clearTimeout(displayTimer);
      if (motionFrame !== null) window.cancelAnimationFrame(motionFrame);
      motionFrame = null;
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
    const rawPointerMove = (event: Event) => {
      const pointer = event as PointerEvent;
      if (pointer.pointerType !== 'mouse') return;
      rawMovementY = pointer.movementY;
      rawMovementAt = Date.now();
    };
    const mousemove = (event: MouseEvent) => {
      if (!connected || inputLocked || document.pointerLockElement !== stageRef.current || mouseMotion.target === 'off') return;
      const stick = mouseMotion.target;
      const movementY = event.movementY === 0 && Date.now() - rawMovementAt < 24 ? rawMovementY : event.movementY;
      pendingMovement.x += event.movementX;
      pendingMovement.y += movementY;
      if (motionFrame !== null) return;
      motionFrame = window.requestAnimationFrame(() => {
        motionFrame = null;
        const movement = { ...pendingMovement };
        pendingMovement.x = 0; pendingMovement.y = 0;
        motion[stick] = blendMouseDeltaToStick(motion[stick], movement.x, movement.y, mouseMotion);
        setMouseVector(motion[stick]);
        emitStick(stick);
        if (motionTimer !== null) window.clearTimeout(motionTimer);
        if (displayTimer !== null) window.clearTimeout(displayTimer);
        motionTimer = window.setTimeout(() => { motion[stick] = { x: 0, y: 0 }; emitStick(stick); }, 60);
        displayTimer = window.setTimeout(() => setMouseVector({ x: 0, y: 0 }), 140);
      });
    };
    const contextmenu = (event: MouseEvent) => {
      if (connected && resolveBinding(bindings, 'mouse', 2) && !(event.target instanceof Element && event.target.closest('.mapping-dialog'))) event.preventDefault();
    };
    const pointerLockChange = () => {
      const locked = document.pointerLockElement === stageRef.current;
      setMouseLocked(locked);
      if (!locked) setMouseVector({ x: 0, y: 0 });
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
  }, [bindings, capturing, connected, inputLocked, mappingOpen, mouseMotion]);

  useEffect(() => {
    if (inputLocked && document.pointerLockElement) document.exitPointerLock();
  }, [inputLocked]);

  const openMapping = () => {
    if (inputLocked) return;
    if (document.pointerLockElement) document.exitPointerLock();
    setCapturing(null); setMappingOpen(true);
  };
  const closeMapping = () => { setCapturing(null); setMappingOpen(false); };
  const toggleMouseControl = () => {
    if (mouseMotion.target === 'off') { openMapping(); return; }
    if (document.pointerLockElement === stageRef.current) document.exitPointerLock();
    else if (connected && !inputLocked) stageRef.current?.requestPointerLock();
  };
  const restoreDefaults = () => {
    setBindings(createDefaultBindings());
    setMouseMotion({ ...DEFAULT_MOUSE_MOTION });
    setCapturing(null);
  };
  const bindingHint = (actionId: ControllerActionId) => {
    const binding = bindings[actionId];
    return binding.keyboard ? formatKeyboardCode(binding.keyboard) : formatMouseButton(binding.mouse);
  };

  return (
    <section className="page controller-page">
      <header className="page-header compact">
        <div><span className="eyebrow">TAKE CONTROL</span><h1>虚拟 <span>Pro Controller</span></h1><p>鼠标、触控和键盘都能操作；双击摇杆可按下 L3 / R3。</p></div>
        <div className="controller-header-actions">
          <button disabled={inputLocked} className="ghost-button mapping-open-button" onClick={openMapping}>⌨ 自定义映射</button>
          {mouseMotion.target !== 'off' && <button className={`ghost-button mouse-control-button ${mouseLocked ? 'active' : ''}`} onClick={toggleMouseControl} disabled={!connected || inputLocked}>{mouseLocked ? '鼠标控制中 · Esc 退出' : `启用鼠标 → ${mouseMotion.target === 'L_STICK' ? '左摇杆' : '右摇杆'}`}</button>}
          {mouseMotion.target !== 'off' && <div className="mouse-sensitivity-quick"><span>横向</span><input aria-label="鼠标横向灵敏度" disabled={inputLocked} type="range" min="0.5" max="10" step="0.5" value={mouseMotion.sensitivityX} onChange={(event) => setMouseMotion((current) => ({ ...current, sensitivityX: Number(event.target.value) }))} /><b>{mouseMotion.sensitivityX.toFixed(1)}</b><span>纵向</span><input aria-label="鼠标纵向灵敏度" disabled={inputLocked} type="range" min="0.5" max="10" step="0.5" value={mouseMotion.sensitivityY} onChange={(event) => setMouseMotion((current) => ({ ...current, sensitivityY: Number(event.target.value) }))} /><b>{mouseMotion.sensitivityY.toFixed(1)}</b></div>}
          <button
            className={`connect-button ${connected ? 'ghost-button danger' : 'primary-button lime'}`}
            onClick={connected ? onDisconnect : onConnect}
            disabled={inputLocked || connectionBusy}
          >
            {!connected && (connectionBusy ? <i className="spinner" /> : 'ᛒ')}{' '}
            {connected ? '断开连接' : connection === 'pairing' ? '等待 Switch 2 配对' : connection === 'connecting' ? '正在连接 Switch 2' : '连接 Switch 2'}
          </button>
        </div>
      </header>

      <ControllerInputLock.Provider value={inputLocked}><div ref={stageRef} className={`controller-stage ${connected ? 'live' : ''} ${mouseLocked ? 'mouse-locked' : ''} ${inputLocked ? 'input-locked' : ''}`}>
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
        {mouseLocked && <div className="mouse-lock-hud"><strong>鼠标正在控制{mouseMotion.target === 'L_STICK' ? '左' : '右'}摇杆</strong><span>X {Math.round(mouseVector.x)} · Y {Math.round(mouseVector.y)} · Esc 退出</span></div>}
        {inputLocked && <div className="controller-lock-notice"><strong>自动绘制进行中</strong><span>手柄输入已锁定，请在涂鸦工坊停止绘制后操作</span></div>}
        <div className={`controller-state-card ${connection}`}><i /><div><strong>{connected ? 'LIVE INPUT' : connection === 'pairing' ? 'PAIRING' : 'STANDBY'}</strong><span>{message}</span></div></div>
      </div></ControllerInputLock.Provider>

      <div className="key-guide">
        <span><kbd>1 2 3 4</kbd> 十字键</span>
        <span><kbd>W A S D</kbd> 左摇杆</span>
        <span><kbd>{bindingHint('B')} / {bindingHint('A')}</kbd> B / A</span>
        <span><kbd>{bindingHint('Y')} / {bindingHint('X')}</kbd> Y / X</span>
        <span><kbd>{bindingHint('L')} / {bindingHint('ZL')}</kbd> L / ZL</span>
        <span><kbd>{bindingHint('R')} / {bindingHint('ZR')}</kbd> R / ZR</span>
        <span><kbd>鼠标移动</kbd> 右摇杆</span>
        <button disabled={inputLocked} className="key-guide-edit" onClick={openMapping}>编辑全部映射 →</button>
      </div>

      {mappingOpen && createPortal(<div className="mapping-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) closeMapping(); }}>
        <div className="mapping-dialog" role="dialog" aria-modal="true" aria-labelledby="mapping-title">
          <header className="mapping-header">
            <div><span className="eyebrow">INPUT LAB</span><h2 id="mapping-title">键盘与鼠标映射</h2><p>点击一个映射槽，再按下想使用的键。重复绑定会自动从旧动作移除。</p></div>
            <div className="mapping-header-actions"><button className="ghost-button" onClick={restoreDefaults}>恢复默认</button><button className="mapping-close" onClick={closeMapping} aria-label="关闭映射设置">×</button></div>
          </header>

          <section className="mouse-motion-settings">
            <div className="motion-copy"><strong>鼠标移动</strong><span>启用后，在手柄页点击“启用鼠标”，使用指针锁定连续控制摇杆。</span></div>
            <label><span>控制目标</span><select value={mouseMotion.target} onChange={(event) => setMouseMotion((current) => ({ ...current, target: event.target.value as MouseMotionSettings['target'] }))}><option value="off">关闭</option><option value="L_STICK">左摇杆</option><option value="R_STICK">右摇杆</option></select></label>
            <div className="axis-sensitivity"><label className="sensitivity-control"><span>横向灵敏度 <b>{mouseMotion.sensitivityX.toFixed(1)}</b></span><input aria-label="映射设置鼠标横向灵敏度" type="range" min="0.5" max="10" step="0.5" value={mouseMotion.sensitivityX} onChange={(event) => setMouseMotion((current) => ({ ...current, sensitivityX: Number(event.target.value) }))} /></label><label className="sensitivity-control"><span>纵向灵敏度 <b>{mouseMotion.sensitivityY.toFixed(1)}</b></span><input aria-label="映射设置鼠标纵向灵敏度" type="range" min="0.5" max="10" step="0.5" value={mouseMotion.sensitivityY} onChange={(event) => setMouseMotion((current) => ({ ...current, sensitivityY: Number(event.target.value) }))} /></label></div>
            <label className="motion-check"><input type="checkbox" checked={mouseMotion.invertX} onChange={(event) => setMouseMotion((current) => ({ ...current, invertX: event.target.checked }))} /><span>反转 X</span></label>
            <label className="motion-check"><input type="checkbox" checked={mouseMotion.invertY} onChange={(event) => setMouseMotion((current) => ({ ...current, invertY: event.target.checked }))} /><span>反转 Y</span></label>
          </section>

          <div className="mapping-columns"><span>手柄动作</span><span>键盘</span><span>鼠标按键</span></div>
          <div className="mapping-groups">
            {groupedActions.map(({ group, actions }) => <section className="mapping-group" key={group}>
              <h3>{group}</h3>
              {actions.map((action) => {
                const binding = bindings[action.id];
                const keyboardCapturing = capturing?.actionId === action.id && capturing.device === 'keyboard';
                const mouseCapturing = capturing?.actionId === action.id && capturing.device === 'mouse';
                return <div className="mapping-row" key={action.id}>
                  <strong>{action.label}</strong>
                  <div className="binding-cell"><button aria-label={`${action.label} 键盘映射`} className={`binding-slot ${keyboardCapturing ? 'capturing' : ''} ${binding.keyboard ? '' : 'empty'}`} onClick={() => setCapturing({ actionId: action.id, device: 'keyboard' })}>{keyboardCapturing ? '请按键…' : formatKeyboardCode(binding.keyboard)}</button>{binding.keyboard && <button className="binding-clear" aria-label={`清除 ${action.label} 的键盘映射`} onClick={() => changeBinding(action.id, 'keyboard', null)}>×</button>}</div>
                  <div className="binding-cell"><button aria-label={`${action.label} 鼠标映射`} className={`binding-slot ${mouseCapturing ? 'capturing' : ''} ${binding.mouse === null ? 'empty' : ''}`} onClick={() => setCapturing({ actionId: action.id, device: 'mouse' })}>{mouseCapturing ? '请按鼠标键…' : formatMouseButton(binding.mouse)}</button>{binding.mouse !== null && <button className="binding-clear" aria-label={`清除 ${action.label} 的鼠标映射`} onClick={() => changeBinding(action.id, 'mouse', null)}>×</button>}</div>
                </div>;
              })}
            </section>)}
          </div>
          <footer className="mapping-footer"><span>鼠标按键映射在页面空白区域生效，避免与直接点击虚拟手柄冲突。</span><div><button className="ghost-button" onClick={() => { setBindings(emptyBindings()); setCapturing(null); }}>清空按键映射</button><button className="primary-button lime" onClick={closeMapping}>完成</button></div></footer>
        </div>
      </div>, document.body)}
    </section>
  );
}
