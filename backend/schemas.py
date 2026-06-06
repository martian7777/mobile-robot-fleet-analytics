"""Pydantic schemas for request validation and response serialization."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------- #
# Ingestion payloads (posted by the ROS2-to-API bridge / simulator)
# --------------------------------------------------------------------------- #
class TelemetryIn(BaseModel):
    robot_id: str
    pos_x: float
    pos_y: float
    speed: float
    battery_level: float
    orientation: float = 0.0
    distance_traveled: float = 0.0
    active_task: str = ""
    status: str = "idle"


class AlertIn(BaseModel):
    robot_id: str
    severity: str = Field(..., pattern="^(info|warning|critical)$")
    code: str
    message: str


class TaskIn(BaseModel):
    robot_id: str
    target_station: str
    target_x: float
    target_y: float


class TaskUpdate(BaseModel):
    task_id: int
    status: str
    success: bool = False


class RobotRegister(BaseModel):
    id: str
    model: str
    max_speed: float
    battery_capacity: float


# --------------------------------------------------------------------------- #
# Control commands (dashboard -> backend -> simulation)
# --------------------------------------------------------------------------- #
class CommandIn(BaseModel):
    command: str = Field(..., description="estop | resume | dispatch | estop_all | resume_all")
    robot_id: Optional[str] = None
    target_x: Optional[float] = None
    target_y: Optional[float] = None
    target_station: Optional[str] = None


# --------------------------------------------------------------------------- #
# Response models
# --------------------------------------------------------------------------- #
class RobotOut(BaseModel):
    id: str
    model: str
    max_speed: float
    battery_capacity: float
    status: str
    battery_level: float
    pos_x: float
    pos_y: float
    orientation: float
    current_task: str
    total_distance: float
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class AlertOut(BaseModel):
    id: int
    robot_id: str
    timestamp: datetime
    severity: str
    code: str
    message: str
    acknowledged: bool

    class Config:
        from_attributes = True


class TaskOut(BaseModel):
    id: int
    robot_id: str
    target_station: str
    target_x: float
    target_y: float
    start_time: datetime
    end_time: Optional[datetime]
    status: str
    success: bool

    class Config:
        from_attributes = True


class FleetMetrics(BaseModel):
    total_robots: int
    active_robots: int
    charging_robots: int
    estopped_robots: int
    fleet_availability: float          # %
    avg_battery: float                 # %
    total_distance: float              # meters
    active_alerts: int
    critical_alerts: int
    tasks_completed: int
    tasks_in_progress: int
    task_success_rate: float           # %
    avg_cycle_time: float              # seconds


class FleetStatus(BaseModel):
    robots: List[RobotOut]
    metrics: FleetMetrics
