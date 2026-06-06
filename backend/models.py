"""SQLAlchemy declarative models for the Fleet Analytics platform.

Schema overview
---------------
* ``robots``         - static per-robot metadata + last-known status.
* ``telemetry_logs`` - high-frequency time-series of pose / speed / battery.
* ``alert_logs``     - warning & critical diagnostics raised by robots.
* ``delivery_tasks`` - lifecycle of delivery/picking assignments.
"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Index,
)
from sqlalchemy.orm import relationship

from database import Base


class Robot(Base):
    __tablename__ = "robots"

    id = Column(String(32), primary_key=True)            # e.g. "Atlas-1"
    model = Column(String(64), nullable=False)
    max_speed = Column(Float, nullable=False)            # m/s
    battery_capacity = Column(Float, nullable=False)     # Wh

    # Last-known live state (denormalised for fast fleet snapshots).
    status = Column(String(32), default="idle", nullable=False)  # idle|moving|charging|estopped|error
    battery_level = Column(Float, default=100.0)         # %
    pos_x = Column(Float, default=0.0)
    pos_y = Column(Float, default=0.0)
    orientation = Column(Float, default=0.0)             # radians
    current_task = Column(String(128), default="")
    total_distance = Column(Float, default=0.0)          # meters
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    telemetry = relationship("TelemetryLog", back_populates="robot", cascade="all, delete-orphan")
    alerts = relationship("AlertLog", back_populates="robot", cascade="all, delete-orphan")
    tasks = relationship("DeliveryTask", back_populates="robot", cascade="all, delete-orphan")


class TelemetryLog(Base):
    __tablename__ = "telemetry_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    robot_id = Column(String(32), ForeignKey("robots.id", ondelete="CASCADE"), nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)

    pos_x = Column(Float, nullable=False)
    pos_y = Column(Float, nullable=False)
    speed = Column(Float, nullable=False)                # m/s
    battery_level = Column(Float, nullable=False)        # %
    orientation = Column(Float, nullable=False)          # radians
    distance_traveled = Column(Float, default=0.0)       # cumulative meters
    active_task = Column(String(128), default="")
    status = Column(String(32), default="idle")

    robot = relationship("Robot", back_populates="telemetry")

    __table_args__ = (
        Index("ix_telemetry_robot_time", "robot_id", "timestamp"),
    )


class AlertLog(Base):
    __tablename__ = "alert_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    robot_id = Column(String(32), ForeignKey("robots.id", ondelete="CASCADE"), nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)

    severity = Column(String(16), nullable=False)        # info|warning|critical
    code = Column(String(48), nullable=False)            # e.g. LIDAR_OBSCURED
    message = Column(String(256), nullable=False)
    acknowledged = Column(Boolean, default=False)

    robot = relationship("Robot", back_populates="alerts")

    __table_args__ = (
        Index("ix_alert_robot_time", "robot_id", "timestamp"),
        Index("ix_alert_severity", "severity"),
    )


class DeliveryTask(Base):
    __tablename__ = "delivery_tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    robot_id = Column(String(32), ForeignKey("robots.id", ondelete="CASCADE"), nullable=False)

    target_station = Column(String(64), nullable=False)
    target_x = Column(Float, nullable=False)
    target_y = Column(Float, nullable=False)
    start_time = Column(DateTime, default=datetime.utcnow, nullable=False)
    end_time = Column(DateTime, nullable=True)
    status = Column(String(32), default="in_progress")   # in_progress|completed|failed|aborted
    success = Column(Boolean, default=False)

    robot = relationship("Robot", back_populates="tasks")

    __table_args__ = (
        Index("ix_task_robot_status", "robot_id", "status"),
    )
