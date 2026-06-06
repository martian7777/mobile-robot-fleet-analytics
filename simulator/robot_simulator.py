"""Warehouse fleet simulator for the Fleet Analytics Dashboard.

Models a 40x40 industrial warehouse grid populated with picking bays, drop-off
stations, charging docks and obstacle zones, then drives a fleet of AMRs around
it. Each robot follows a task loop (pick -> drop), discharges its battery, may
emit diagnostic alerts, and automatically returns to a charging dock when low.

ROS2 compatibility
------------------
The node publishes to ``/amr/telemetry``, ``/amr/alerts``, ``/amr/tasks`` and
subscribes to ``/amr/commands`` exactly as a real ROS2 deployment would. It
tries to ``import rclpy``; if ROS2 is not installed it falls back to the bundled
:mod:`mock_rclpy`, so behaviour is identical on a developer laptop.

Telemetry/alerts/tasks are additionally forwarded to the FastAPI backend over
HTTP (acting as the "ROS2-to-API bridge"), and control commands are received
from the backend over a WebSocket so the dashboard's E-Stop / dispatch buttons
take effect live.
"""

from __future__ import annotations

import math
import os
import random
import threading
import time
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

import requests

# --- ROS2 client: real rclpy if present, else the in-repo mock --------------- #
try:  # pragma: no cover - depends on host
    import rclpy  # type: ignore
    from rclpy.node import Node  # type: ignore

    USING_REAL_ROS2 = True
except Exception:  # noqa: BLE001
    import mock_rclpy as rclpy  # type: ignore
    from mock_rclpy import Node  # type: ignore

    USING_REAL_ROS2 = False

# WebSocket client for receiving commands from the backend.
try:
    import websocket  # websocket-client
except Exception:  # noqa: BLE001
    websocket = None


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
API_BASE = os.getenv("API_BASE", "http://backend:8000")
WS_URL = os.getenv("WS_URL", "ws://backend:8000/ws/simulator")
GRID = int(os.getenv("GRID_SIZE", "40"))
TICK = float(os.getenv("SIM_TICK", "0.5"))           # seconds per simulation step
TELEMETRY_EVERY = float(os.getenv("TELEMETRY_EVERY", "1.0"))

LOW_BATTERY = 20.0
FULL_BATTERY = 95.0

# Named map features (x, y) on the 40x40 grid.
CHARGING_DOCKS = [(2, 2), (2, 8), (2, 14)]
PICKING_BAYS = [(34, 6), (34, 14), (34, 22), (34, 30), (34, 36)]
DROPOFF_STATIONS = [(8, 34), (16, 34), (24, 34), (32, 34)]
OBSTACLE_ZONES = [(20, 20), (21, 20), (20, 21), (12, 25), (28, 12)]

WARNING_CODES = [
    ("warning", "LIDAR_OBSCURED", "Lidar partially obscured - reduced perception"),
    ("warning", "HIGH_MOTOR_TEMP", "Drive motor temperature elevated"),
    ("warning", "WHEEL_SLIP", "Wheel slippage detected on floor segment"),
    ("warning", "PAYLOAD_SHIFT", "Payload center-of-mass shift detected"),
]
CRITICAL_CODES = [
    ("critical", "OBSTACLE_COLLISION", "Imminent obstacle - emergency avoidance engaged"),
    ("critical", "LIDAR_FAILURE", "Lidar sensor failure - navigation degraded"),
    ("critical", "BATTERY_CRITICAL", "Battery critically low"),
]


@dataclass
class RobotState:
    rid: str
    model: str
    max_speed: float            # m/s
    battery_capacity: float     # Wh
    discharge_rate: float       # % per tick while moving
    error_rate: float           # probability of a diagnostic per tick

    x: float
    y: float
    orientation: float = 0.0
    battery: float = 100.0
    speed: float = 0.0
    status: str = "idle"        # idle|moving|charging|estopped|error
    total_distance: float = 0.0

    target: Optional[Tuple[float, float]] = None
    target_name: str = ""
    task_id: Optional[int] = None
    phase: str = "to_pick"      # to_pick|to_drop|to_charge
    estopped: bool = False


# --------------------------------------------------------------------------- #
# Backend bridge (HTTP) - resilient to the backend not being up yet.
# --------------------------------------------------------------------------- #
class BackendBridge:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.session = requests.Session()

    def _post(self, path: str, payload: dict) -> Optional[dict]:
        try:
            r = self.session.post(f"{self.base}{path}", json=payload, timeout=5)
            if r.ok:
                return r.json()
        except requests.RequestException:
            pass
        return None

    def _put(self, path: str, payload: dict) -> Optional[dict]:
        try:
            r = self.session.put(f"{self.base}{path}", json=payload, timeout=5)
            if r.ok:
                return r.json()
        except requests.RequestException:
            pass
        return None

    def wait_until_ready(self, attempts: int = 60, delay: float = 2.0) -> None:
        for i in range(attempts):
            try:
                r = self.session.get(f"{self.base}/healthz", timeout=3)
                if r.ok:
                    print(f"[SIM] Backend ready after {i+1} attempt(s).", flush=True)
                    return
            except requests.RequestException:
                pass
            time.sleep(delay)
        print("[SIM] WARNING: backend never reported healthy; continuing anyway.", flush=True)

    def register(self, r: RobotState) -> None:
        self._post("/api/robots/register", {
            "id": r.rid, "model": r.model,
            "max_speed": r.max_speed, "battery_capacity": r.battery_capacity,
        })

    def telemetry(self, r: RobotState) -> None:
        self._post("/api/telemetry", {
            "robot_id": r.rid, "pos_x": round(r.x, 3), "pos_y": round(r.y, 3),
            "speed": round(r.speed, 3), "battery_level": round(r.battery, 2),
            "orientation": round(r.orientation, 4),
            "distance_traveled": round(r.total_distance, 2),
            "active_task": r.target_name, "status": r.status,
        })

    def alert(self, rid: str, severity: str, code: str, message: str) -> None:
        self._post("/api/alerts", {
            "robot_id": rid, "severity": severity, "code": code, "message": message,
        })

    def open_task(self, r: RobotState) -> Optional[int]:
        res = self._post("/api/tasks", {
            "robot_id": r.rid, "target_station": r.target_name,
            "target_x": r.target[0], "target_y": r.target[1],
        })
        return res.get("id") if res else None

    def close_task(self, task_id: int, success: bool) -> None:
        self._put("/api/tasks", {
            "task_id": task_id, "status": "completed" if success else "failed",
            "success": success,
        })


# --------------------------------------------------------------------------- #
# The simulator node
# --------------------------------------------------------------------------- #
class FleetSimulator(Node):
    def __init__(self) -> None:
        super().__init__("warehouse_fleet_simulator")
        self.bridge = BackendBridge(API_BASE)
        self.robots: Dict[str, RobotState] = {}
        self._last_telemetry = 0.0

        # ROS2 publishers / subscriber (mirrors a real deployment).
        self.pub_telemetry = self.create_publisher(dict, "/amr/telemetry", 10)
        self.pub_alerts = self.create_publisher(dict, "/amr/alerts", 10)
        self.pub_tasks = self.create_publisher(dict, "/amr/tasks", 10)
        self.sub_commands = self.create_subscription(dict, "/amr/commands", self._on_command, 10)

        self._build_fleet()

    # ----- fleet construction ------------------------------------------- #
    def _build_fleet(self) -> None:
        specs = [
            # rid,     model,         max_speed, capacity, discharge, error
            ("Atlas-1", "Atlas-HD",   1.6, 1200, 0.45, 0.010),
            ("Atlas-2", "Atlas-HD",   1.6, 1200, 0.50, 0.012),
            ("Titan-1", "Titan-XL",   1.2, 2000, 0.35, 0.008),
            ("Titan-2", "Titan-XL",   1.2, 2000, 0.40, 0.014),
            ("Swift-1", "Swift-Lite", 2.2,  800, 0.65, 0.016),
        ]
        for rid, model, spd, cap, dis, err in specs:
            dock = random.choice(CHARGING_DOCKS)
            r = RobotState(
                rid=rid, model=model, max_speed=spd, battery_capacity=cap,
                discharge_rate=dis, error_rate=err,
                x=float(dock[0]), y=float(dock[1]),
                battery=random.uniform(55, 100),
            )
            self.robots[rid] = r

        self.bridge.wait_until_ready()
        for r in self.robots.values():
            self.bridge.register(r)
            self._assign_next_task(r)
        self.get_logger().info(
            f"Fleet of {len(self.robots)} AMRs initialised "
            f"({'REAL ROS2' if USING_REAL_ROS2 else 'mock rclpy'})."
        )

    # ----- task assignment ---------------------------------------------- #
    def _assign_next_task(self, r: RobotState) -> None:
        if r.battery <= LOW_BATTERY:
            r.phase = "to_charge"
            r.target = min(CHARGING_DOCKS, key=lambda d: self._dist(r, d))
            r.target_name = f"Charging Dock {r.target}"
            r.task_id = None
            return

        if r.phase in ("to_charge", "to_drop", "idle"):
            r.phase = "to_pick"
            r.target = random.choice(PICKING_BAYS)
            r.target_name = f"Pick @ Bay {r.target}"
        else:  # finished picking -> deliver
            r.phase = "to_drop"
            r.target = random.choice(DROPOFF_STATIONS)
            r.target_name = f"Drop @ Station {r.target}"

        r.task_id = self.bridge.open_task(r)
        self.pub_tasks.publish({"robot_id": r.rid, "target": r.target, "phase": r.phase})

    # ----- per-tick physics --------------------------------------------- #
    def step(self) -> None:
        for r in self.robots.values():
            self._step_robot(r)

        now = time.monotonic()
        if now - self._last_telemetry >= TELEMETRY_EVERY:
            self._last_telemetry = now
            for r in self.robots.values():
                self.bridge.telemetry(r)
                self.pub_telemetry.publish({"robot_id": r.rid, "x": r.x, "y": r.y})

    def _step_robot(self, r: RobotState) -> None:
        if r.estopped:
            r.status = "estopped"
            r.speed = 0.0
            return

        # Charging behaviour.
        if r.phase == "to_charge" and self._arrived(r):
            r.status = "charging"
            r.speed = 0.0
            r.battery = min(100.0, r.battery + 2.5)
            if r.battery >= FULL_BATTERY:
                self._assign_next_task(r)
            return

        if r.target is None:
            self._assign_next_task(r)
            return

        # Move toward target.
        if self._arrived(r):
            self._on_arrival(r)
            return

        r.status = "moving"
        tx, ty = r.target
        dx, dy = tx - r.x, ty - r.y
        dist = math.hypot(dx, dy)
        r.orientation = math.atan2(dy, dx)

        step_len = min(r.max_speed * TICK, dist)
        # Slow down near obstacle zones (and occasionally raise an alert).
        if self._near_obstacle(r):
            step_len *= 0.4

        r.x += math.cos(r.orientation) * step_len
        r.y += math.sin(r.orientation) * step_len
        r.speed = step_len / TICK
        r.total_distance += step_len

        # Battery discharge while moving.
        r.battery = max(0.0, r.battery - r.discharge_rate)
        if r.battery <= LOW_BATTERY and r.phase != "to_charge":
            self.bridge.alert(r.rid, "critical", "BATTERY_CRITICAL",
                              f"{r.rid} battery at {r.battery:.0f}% - returning to dock")
            self.pub_alerts.publish({"robot_id": r.rid, "code": "BATTERY_CRITICAL"})
            self._assign_next_task(r)

        # Random diagnostics.
        self._maybe_emit_alert(r)

    def _on_arrival(self, r: RobotState) -> None:
        r.x, r.y = float(r.target[0]), float(r.target[1])
        r.speed = 0.0
        if r.task_id is not None:
            self.bridge.close_task(r.task_id, success=True)
        # advance the pick->drop->pick loop
        self._assign_next_task(r)

    # ----- alerts -------------------------------------------------------- #
    def _maybe_emit_alert(self, r: RobotState) -> None:
        if random.random() < r.error_rate:
            sev, code, msg = random.choice(WARNING_CODES)
            self.bridge.alert(r.rid, sev, code, f"{r.rid}: {msg}")
            self.pub_alerts.publish({"robot_id": r.rid, "code": code})
        elif self._near_obstacle(r) and random.random() < 0.05:
            sev, code, msg = random.choice(CRITICAL_CODES[:1])
            self.bridge.alert(r.rid, sev, code, f"{r.rid}: {msg}")
            self.pub_alerts.publish({"robot_id": r.rid, "code": code})

    # ----- command handling (from /amr/commands) ------------------------ #
    def _on_command(self, msg: dict) -> None:
        cmd = msg.get("command")
        rid = msg.get("robot_id")
        self.get_logger().info(f"Command received: {msg}")

        if cmd == "estop_all":
            for r in self.robots.values():
                r.estopped = True
                r.status = "estopped"
        elif cmd == "resume_all":
            for r in self.robots.values():
                r.estopped = False
        elif cmd == "estop" and rid in self.robots:
            self.robots[rid].estopped = True
            self.robots[rid].status = "estopped"
        elif cmd == "resume" and rid in self.robots:
            self.robots[rid].estopped = False
        elif cmd == "dispatch" and rid in self.robots:
            r = self.robots[rid]
            tx = float(msg.get("target_x", r.x))
            ty = float(msg.get("target_y", r.y))
            r.estopped = False
            r.phase = "to_drop"  # treat manual dispatch as a one-off move
            r.target = (max(0, min(GRID, tx)), max(0, min(GRID, ty)))
            r.target_name = msg.get("target_station", f"Manual @ ({tx:.0f},{ty:.0f})")
            r.task_id = self.bridge.open_task(r)

    # ----- geometry helpers --------------------------------------------- #
    @staticmethod
    def _dist(r: RobotState, p: Tuple[float, float]) -> float:
        return math.hypot(p[0] - r.x, p[1] - r.y)

    def _arrived(self, r: RobotState, eps: float = 0.4) -> bool:
        return r.target is not None and self._dist(r, r.target) <= eps

    def _near_obstacle(self, r: RobotState, radius: float = 2.5) -> bool:
        return any(math.hypot(ox - r.x, oy - r.y) <= radius for ox, oy in OBSTACLE_ZONES)


# --------------------------------------------------------------------------- #
# Command WebSocket listener - bridges backend commands onto /amr/commands.
# --------------------------------------------------------------------------- #
def start_command_listener(sim: FleetSimulator) -> None:
    if websocket is None:
        print("[SIM] websocket-client not available; control commands disabled.", flush=True)
        return

    def run() -> None:
        while rclpy.ok():
            try:
                ws = websocket.create_connection(WS_URL, timeout=10)
                print(f"[SIM] Connected to command channel {WS_URL}", flush=True)
                while rclpy.ok():
                    raw = ws.recv()
                    if not raw:
                        break
                    import json
                    command = json.loads(raw)
                    # Hand the command to the node's command handler (the same
                    # path a real ROS2 /amr/commands subscription would take).
                    sim._on_command(command)
            except Exception as exc:  # noqa: BLE001
                print(f"[SIM] Command channel error ({exc}); retrying in 3s.", flush=True)
                time.sleep(3)

    t = threading.Thread(target=run, daemon=True)
    t.start()


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
def main() -> None:
    rclpy.init()
    sim = FleetSimulator()

    # Drive the physics from a ROS2 timer so the same loop works under real ROS2.
    sim.create_timer(TICK, sim.step)
    start_command_listener(sim)

    try:
        while rclpy.ok():
            rclpy.spin_once(sim, timeout_sec=TICK)
    except KeyboardInterrupt:
        pass
    finally:
        sim.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
