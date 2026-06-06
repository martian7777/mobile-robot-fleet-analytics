"""Fleet Analytics Dashboard - FastAPI backend.

Responsibilities
----------------
1. Ingestion API  : the simulator / ROS2 bridge POSTs telemetry, alerts, tasks.
2. Fleet API      : aggregate KPIs + per-robot snapshots for the dashboard.
3. WebSockets     : push live telemetry + alerts to the browser (zero-latency).
4. Control API    : accept E-Stop / dispatch commands and relay them back to
                    connected simulators over a command WebSocket channel.
5. Static hosting : serve the premium HTML/JS/CSS dashboard.
"""

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Set

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db, init_db, wait_for_db, SessionLocal

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("fleet.api")

STATIC_DIR = Path(__file__).parent / "static"


# --------------------------------------------------------------------------- #
# Connection manager - fans out events to dashboard clients, and holds the
# command queue consumed by simulator clients.
# --------------------------------------------------------------------------- #
class ConnectionManager:
    def __init__(self) -> None:
        self.dashboard_clients: Set[WebSocket] = set()
        # commands waiting to be delivered to the simulator(s)
        self.command_queue: "asyncio.Queue[dict]" = asyncio.Queue()
        self.simulator_clients: Set[WebSocket] = set()

    async def connect_dashboard(self, ws: WebSocket) -> None:
        await ws.accept()
        self.dashboard_clients.add(ws)
        logger.info("Dashboard client connected (%d total).", len(self.dashboard_clients))

    def disconnect_dashboard(self, ws: WebSocket) -> None:
        self.dashboard_clients.discard(ws)

    async def connect_simulator(self, ws: WebSocket) -> None:
        await ws.accept()
        self.simulator_clients.add(ws)
        logger.info("Simulator client connected (%d total).", len(self.simulator_clients))

    def disconnect_simulator(self, ws: WebSocket) -> None:
        self.simulator_clients.discard(ws)

    async def broadcast(self, message: dict) -> None:
        """Send a JSON message to every dashboard client; prune dead sockets."""
        if not self.dashboard_clients:
            return
        payload = json.dumps(message, default=str)
        dead: List[WebSocket] = []
        for ws in self.dashboard_clients:
            try:
                await ws.send_text(payload)
            except Exception:  # noqa: BLE001  - client vanished
                dead.append(ws)
        for ws in dead:
            self.dashboard_clients.discard(ws)

    async def push_command(self, command: dict) -> None:
        await self.command_queue.put(command)


manager = ConnectionManager()


# --------------------------------------------------------------------------- #
# App lifespan - wait for DB, create schema, seed nothing (simulator registers).
# --------------------------------------------------------------------------- #
@asynccontextmanager
async def lifespan(app: FastAPI):
    wait_for_db()
    init_db()
    logger.info("Backend startup complete.")
    yield
    logger.info("Backend shutting down.")


app = FastAPI(title="Fleet Analytics Dashboard API", version="1.0.0", lifespan=lifespan)


# --------------------------------------------------------------------------- #
# Ingestion endpoints
# --------------------------------------------------------------------------- #
@app.post("/api/robots/register", response_model=schemas.RobotOut)
def register_robot(payload: schemas.RobotRegister, db: Session = Depends(get_db)):
    robot = db.get(models.Robot, payload.id)
    if robot is None:
        robot = models.Robot(
            id=payload.id,
            model=payload.model,
            max_speed=payload.max_speed,
            battery_capacity=payload.battery_capacity,
        )
        db.add(robot)
    else:  # refresh metadata on restart
        robot.model = payload.model
        robot.max_speed = payload.max_speed
        robot.battery_capacity = payload.battery_capacity
    db.commit()
    db.refresh(robot)
    return robot


@app.post("/api/telemetry")
async def ingest_telemetry(payload: schemas.TelemetryIn, db: Session = Depends(get_db)):
    robot = db.get(models.Robot, payload.robot_id)
    if robot is None:
        raise HTTPException(status_code=404, detail="Unknown robot; register first.")

    log = models.TelemetryLog(
        robot_id=payload.robot_id,
        pos_x=payload.pos_x,
        pos_y=payload.pos_y,
        speed=payload.speed,
        battery_level=payload.battery_level,
        orientation=payload.orientation,
        distance_traveled=payload.distance_traveled,
        active_task=payload.active_task,
        status=payload.status,
    )
    db.add(log)

    # update denormalised live state on the robot row
    robot.battery_level = payload.battery_level
    robot.pos_x = payload.pos_x
    robot.pos_y = payload.pos_y
    robot.orientation = payload.orientation
    robot.current_task = payload.active_task
    robot.status = payload.status
    robot.total_distance = payload.distance_traveled
    db.commit()

    await manager.broadcast({"type": "telemetry", "data": payload.model_dump()})
    return {"ok": True}


@app.post("/api/alerts", response_model=schemas.AlertOut)
async def ingest_alert(payload: schemas.AlertIn, db: Session = Depends(get_db)):
    if db.get(models.Robot, payload.robot_id) is None:
        raise HTTPException(status_code=404, detail="Unknown robot.")
    alert = models.AlertLog(
        robot_id=payload.robot_id,
        severity=payload.severity,
        code=payload.code,
        message=payload.message,
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)

    await manager.broadcast({"type": "alert", "data": schemas.AlertOut.model_validate(alert).model_dump()})
    return alert


@app.post("/api/tasks", response_model=schemas.TaskOut)
async def create_task(payload: schemas.TaskIn, db: Session = Depends(get_db)):
    if db.get(models.Robot, payload.robot_id) is None:
        raise HTTPException(status_code=404, detail="Unknown robot.")
    task = models.DeliveryTask(
        robot_id=payload.robot_id,
        target_station=payload.target_station,
        target_x=payload.target_x,
        target_y=payload.target_y,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    await manager.broadcast({"type": "task", "data": schemas.TaskOut.model_validate(task).model_dump()})
    return task


@app.put("/api/tasks", response_model=schemas.TaskOut)
async def update_task(payload: schemas.TaskUpdate, db: Session = Depends(get_db)):
    task = db.get(models.DeliveryTask, payload.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Unknown task.")
    task.status = payload.status
    task.success = payload.success
    if payload.status in ("completed", "failed", "aborted"):
        task.end_time = datetime.utcnow()
    db.commit()
    db.refresh(task)
    await manager.broadcast({"type": "task", "data": schemas.TaskOut.model_validate(task).model_dump()})
    return task


# --------------------------------------------------------------------------- #
# Fleet query endpoints
# --------------------------------------------------------------------------- #
def _compute_metrics(db: Session) -> schemas.FleetMetrics:
    robots = db.query(models.Robot).all()
    total = len(robots)
    active = sum(1 for r in robots if r.status == "moving")
    charging = sum(1 for r in robots if r.status == "charging")
    estopped = sum(1 for r in robots if r.status == "estopped")
    operational = sum(1 for r in robots if r.status not in ("error", "estopped"))
    avg_battery = (sum(r.battery_level for r in robots) / total) if total else 0.0
    total_distance = sum(r.total_distance for r in robots)

    since = datetime.utcnow() - timedelta(minutes=10)
    active_alerts = (
        db.query(func.count(models.AlertLog.id))
        .filter(models.AlertLog.timestamp >= since, models.AlertLog.acknowledged.is_(False))
        .scalar()
        or 0
    )
    critical_alerts = (
        db.query(func.count(models.AlertLog.id))
        .filter(
            models.AlertLog.timestamp >= since,
            models.AlertLog.severity == "critical",
            models.AlertLog.acknowledged.is_(False),
        )
        .scalar()
        or 0
    )

    completed = (
        db.query(func.count(models.DeliveryTask.id))
        .filter(models.DeliveryTask.status == "completed")
        .scalar()
        or 0
    )
    in_progress = (
        db.query(func.count(models.DeliveryTask.id))
        .filter(models.DeliveryTask.status == "in_progress")
        .scalar()
        or 0
    )
    failed = (
        db.query(func.count(models.DeliveryTask.id))
        .filter(models.DeliveryTask.status.in_(("failed", "aborted")))
        .scalar()
        or 0
    )
    finished = completed + failed
    success_rate = (completed / finished * 100.0) if finished else 100.0

    # average cycle time over completed tasks
    cycle_rows = (
        db.query(models.DeliveryTask.start_time, models.DeliveryTask.end_time)
        .filter(models.DeliveryTask.status == "completed", models.DeliveryTask.end_time.isnot(None))
        .all()
    )
    if cycle_rows:
        avg_cycle = sum((e - s).total_seconds() for s, e in cycle_rows) / len(cycle_rows)
    else:
        avg_cycle = 0.0

    return schemas.FleetMetrics(
        total_robots=total,
        active_robots=active,
        charging_robots=charging,
        estopped_robots=estopped,
        fleet_availability=round((operational / total * 100.0) if total else 0.0, 1),
        avg_battery=round(avg_battery, 1),
        total_distance=round(total_distance, 1),
        active_alerts=active_alerts,
        critical_alerts=critical_alerts,
        tasks_completed=completed,
        tasks_in_progress=in_progress,
        task_success_rate=round(success_rate, 1),
        avg_cycle_time=round(avg_cycle, 1),
    )


@app.get("/api/fleet/status", response_model=schemas.FleetStatus)
def fleet_status(db: Session = Depends(get_db)):
    robots = db.query(models.Robot).order_by(models.Robot.id).all()
    return schemas.FleetStatus(
        robots=[schemas.RobotOut.model_validate(r) for r in robots],
        metrics=_compute_metrics(db),
    )


@app.get("/api/fleet/metrics", response_model=schemas.FleetMetrics)
def fleet_metrics(db: Session = Depends(get_db)):
    return _compute_metrics(db)


@app.get("/api/robots", response_model=List[schemas.RobotOut])
def list_robots(db: Session = Depends(get_db)):
    return db.query(models.Robot).order_by(models.Robot.id).all()


@app.get("/api/alerts", response_model=List[schemas.AlertOut])
def list_alerts(limit: int = 50, db: Session = Depends(get_db)):
    return (
        db.query(models.AlertLog)
        .order_by(models.AlertLog.timestamp.desc())
        .limit(min(limit, 200))
        .all()
    )


@app.post("/api/alerts/{alert_id}/ack")
def ack_alert(alert_id: int, db: Session = Depends(get_db)):
    alert = db.get(models.AlertLog, alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="Unknown alert.")
    alert.acknowledged = True
    db.commit()
    return {"ok": True}


@app.get("/api/tasks", response_model=List[schemas.TaskOut])
def list_tasks(limit: int = 50, db: Session = Depends(get_db)):
    return (
        db.query(models.DeliveryTask)
        .order_by(models.DeliveryTask.start_time.desc())
        .limit(min(limit, 200))
        .all()
    )


@app.get("/api/telemetry/{robot_id}", response_model=List[schemas.TelemetryIn])
def robot_history(robot_id: str, limit: int = 100, db: Session = Depends(get_db)):
    rows = (
        db.query(models.TelemetryLog)
        .filter(models.TelemetryLog.robot_id == robot_id)
        .order_by(models.TelemetryLog.timestamp.desc())
        .limit(min(limit, 500))
        .all()
    )
    return [
        schemas.TelemetryIn(
            robot_id=r.robot_id,
            pos_x=r.pos_x,
            pos_y=r.pos_y,
            speed=r.speed,
            battery_level=r.battery_level,
            orientation=r.orientation,
            distance_traveled=r.distance_traveled,
            active_task=r.active_task,
            status=r.status,
        )
        for r in rows
    ]


# --------------------------------------------------------------------------- #
# Control endpoints (dashboard -> simulation)
# --------------------------------------------------------------------------- #
@app.post("/api/control")
async def control(cmd: schemas.CommandIn, db: Session = Depends(get_db)):
    command = cmd.model_dump(exclude_none=True)

    # Optimistically reflect E-Stop in the live robot status so the dashboard
    # responds instantly even before the simulator confirms.
    if cmd.command in ("estop", "estop_all"):
        q = db.query(models.Robot)
        if cmd.command == "estop" and cmd.robot_id:
            q = q.filter(models.Robot.id == cmd.robot_id)
        for robot in q.all():
            robot.status = "estopped"
        db.commit()

    await manager.push_command(command)
    await manager.broadcast({"type": "command", "data": command})
    logger.info("Queued command: %s", command)
    return {"ok": True, "queued": command}


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


# --------------------------------------------------------------------------- #
# WebSocket endpoints
# --------------------------------------------------------------------------- #
@app.websocket("/ws/dashboard")
async def ws_dashboard(ws: WebSocket):
    """Browser dashboards subscribe here for live telemetry + alerts."""
    await manager.connect_dashboard(ws)
    # Send an immediate snapshot so the UI is populated before the next tick.
    db = SessionLocal()
    try:
        robots = db.query(models.Robot).order_by(models.Robot.id).all()
        snapshot = {
            "type": "snapshot",
            "data": {
                "robots": [schemas.RobotOut.model_validate(r).model_dump() for r in robots],
                "metrics": _compute_metrics(db).model_dump(),
            },
        }
        await ws.send_text(json.dumps(snapshot, default=str))
    finally:
        db.close()

    try:
        while True:
            # We don't expect dashboard->server traffic, but keep the socket
            # alive and drain any ping frames.
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect_dashboard(ws)


@app.websocket("/ws/simulator")
async def ws_simulator(ws: WebSocket):
    """Simulators connect here to receive queued control commands."""
    await manager.connect_simulator(ws)
    try:
        while True:
            command = await manager.command_queue.get()
            await ws.send_text(json.dumps(command, default=str))
    except WebSocketDisconnect:
        manager.disconnect_simulator(ws)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Simulator socket error: %s", exc)
        manager.disconnect_simulator(ws)


# --------------------------------------------------------------------------- #
# Static dashboard hosting (must be mounted last so /api routes win)
# --------------------------------------------------------------------------- #
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.get("/")
    def index():
        return FileResponse(str(STATIC_DIR / "index.html"))
