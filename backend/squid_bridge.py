#!/usr/bin/env python3
"""JSON-lines bridge between Electron and NXBT.

The process runs as root inside the dedicated SquidSketch WSL distribution.
Only stdout JSON messages are part of the protocol; diagnostics go to stderr.
"""

from __future__ import annotations

import argparse
import json
import queue
import subprocess
import sys
import threading
import time
import traceback


def emit(event_type: str, **payload) -> None:
    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def read_commands(target: queue.Queue) -> None:
    try:
        for line in sys.stdin:
            try:
                target.put(json.loads(line))
            except json.JSONDecodeError as exc:
                emit("log", level="warning", message=f"Invalid command: {exc}")
    finally:
        target.put({"type": "shutdown"})


def ensure_bluez() -> None:
    """Start the isolated distro's Bluetooth services before loading NXBT."""
    systemd = subprocess.run(
        ["systemctl", "start", "dbus.service", "bluetooth.service"],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    if systemd.returncode == 0:
        return
    # This fallback keeps repaired/older installs usable before systemd has
    # restarted once after /etc/wsl.conf was written.
    for service in ("dbus", "bluetooth"):
        subprocess.run(
            ["service", service, "start"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )


def active_packet(nx, buttons: set[str], sticks: dict[str, tuple[int, int]]):
    packet = nx.create_input_packet()
    for button in buttons:
        if button == "L_STICK_PRESS":
            packet["L_STICK"]["PRESSED"] = True
        elif button == "R_STICK_PRESS":
            packet["R_STICK"]["PRESSED"] = True
        elif button in packet:
            packet[button] = True
    for stick, (x, y) in sticks.items():
        if stick in packet:
            packet[stick]["X_VALUE"] = max(-100, min(100, int(x)))
            packet[stick]["Y_VALUE"] = max(-100, min(100, int(y)))
    return packet


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reconnect", action="store_true")
    args = parser.parse_args()

    try:
        ensure_bluez()
        import nxbt
    except Exception as exc:  # pragma: no cover - runs in WSL
        emit("error", message=f"NXBT 加载失败：{exc}", code="NXBT_IMPORT")
        return 2

    nx = None
    controller_index = None
    try:
        emit("starting", message="正在启动 BlueZ 与 NXBT")
        nx = nxbt.Nxbt(disable_logging=True)
        # NXBT creates multiprocessing.Manager workers. On Python 3.12,
        # forking those workers after a live stdin reader thread can deadlock.
        commands: queue.Queue = queue.Queue()
        threading.Thread(target=read_commands, args=(commands,), daemon=True).start()
        reconnect_address = None
        if args.reconnect:
            known = nx.get_switch_addresses()
            reconnect_address = known or None

        controller_index = nx.create_controller(
            nxbt.PRO_CONTROLLER,
            colour_body=[34, 230, 156],
            colour_buttons=[15, 16, 20],
            reconnect_address=reconnect_address,
        )
        emit(
            "pairing",
            reconnect=bool(reconnect_address),
            message=(
                "正在重新连接上次的 Switch 2"
                if reconnect_address
                else "请在 Switch 2 打开手柄 → 更改握法/顺序"
            ),
        )

        while nx.state[controller_index]["state"] != "connected":
            state = nx.state[controller_index]["state"]
            if state == "crashed":
                raise RuntimeError(str(nx.state[controller_index].get("errors") or "Controller crashed"))
            try:
                command = commands.get(timeout=0.05)
                if command.get("type") == "shutdown":
                    return 0
            except queue.Empty:
                pass

        emit("connected", message="Pro Controller 已连接")

        buttons: set[str] = set()
        sticks = {"L_STICK": (0, 0), "R_STICK": (0, 0)}
        dirty_release = False
        active_macro = None
        macro_started = 0.0
        macro_duration = 0
        stop_requested = False
        next_tick = time.perf_counter()

        while True:
            while True:
                try:
                    command = commands.get_nowait()
                except queue.Empty:
                    break

                kind = command.get("type")
                if kind == "shutdown":
                    emit("disconnecting", message="正在关闭虚拟手柄")
                    return 0
                if kind == "button" and not active_macro:
                    name = str(command.get("button", "")).upper()
                    if command.get("pressed"):
                        buttons.add(name)
                    else:
                        buttons.discard(name)
                        dirty_release = True
                elif kind == "stick" and not active_macro:
                    stick = str(command.get("stick", "L_STICK")).upper()
                    if stick in sticks:
                        sticks[stick] = (int(command.get("x", 0)), int(command.get("y", 0)))
                        dirty_release = True
                elif kind == "macro":
                    if active_macro:
                        emit("error", message="已有绘制任务正在运行", code="MACRO_BUSY")
                    else:
                        buttons.clear()
                        sticks = {"L_STICK": (0, 0), "R_STICK": (0, 0)}
                        nx.set_controller_input(controller_index, active_packet(nx, buttons, sticks))
                        active_macro = nx.macro(controller_index, str(command.get("macro", "")), block=False)
                        macro_started = time.monotonic()
                        stop_requested = False
                        metadata = command.get("metadata") or {}
                        macro_duration = max(1, int(metadata.get("durationMs", 1)))
                        emit("macro_started", macroId=active_macro, metadata=metadata)
                elif kind == "stop_macro" and active_macro:
                    nx.stop_macro(controller_index, active_macro, block=False)
                    stop_requested = True
                    emit("macro_stopping", macroId=active_macro)

            if active_macro:
                finished = nx.state[controller_index]["finished_macros"]
                if active_macro in finished:
                    emit("macro_stopped" if stop_requested else "macro_completed", macroId=active_macro)
                    active_macro = None
                    stop_requested = False
                else:
                    elapsed = int((time.monotonic() - macro_started) * 1000)
                    emit("macro_progress", progress=min(0.995, elapsed / macro_duration), elapsedMs=elapsed)
                    time.sleep(0.2)
                    continue

            has_input = bool(buttons) or any(x or y for x, y in sticks.values())
            if has_input or dirty_release:
                nx.set_controller_input(controller_index, active_packet(nx, buttons, sticks))
                dirty_release = has_input

            next_tick += 1 / 120
            time.sleep(max(0, next_tick - time.perf_counter()))
            if next_tick < time.perf_counter() - 0.1:
                next_tick = time.perf_counter()
    except KeyboardInterrupt:
        return 0
    except Exception as exc:  # pragma: no cover - hardware path
        emit("error", message=str(exc), detail=traceback.format_exc(), code="BRIDGE_FAILURE")
        return 1
    finally:
        if nx is not None and controller_index is not None:
            try:
                nx.remove_controller(controller_index)
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
