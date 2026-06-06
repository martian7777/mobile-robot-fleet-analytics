"""SQLAlchemy engine initialization and session management.

Reads the connection string from the ``DATABASE_URL`` environment variable so
the same code runs under Docker-Compose (pointing at the ``db`` service) and on a
local developer machine (pointing at ``localhost``). A short retry loop tolerates
the PostgreSQL container still booting when the backend first comes up.
"""

import os
import time
import logging

from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import declarative_base, sessionmaker

logger = logging.getLogger("fleet.database")

# Default targets the docker-compose ``db`` service; override locally with e.g.
#   postgresql+psycopg2://fleet:fleet@localhost:5432/fleet
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://fleet:fleet@db:5432/fleet",
)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,   # transparently recycle dead connections
    pool_size=10,
    max_overflow=20,
    future=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)

Base = declarative_base()


def get_db():
    """FastAPI dependency that yields a scoped session and always closes it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def wait_for_db(max_attempts: int = 30, delay: float = 2.0) -> None:
    """Block until the database accepts connections (or raise after retries)."""
    from sqlalchemy import text

    for attempt in range(1, max_attempts + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            logger.info("Database is ready (attempt %s).", attempt)
            return
        except OperationalError as exc:
            logger.warning(
                "Database not ready (attempt %s/%s): %s", attempt, max_attempts, exc
            )
            time.sleep(delay)
    raise RuntimeError("Database did not become available in time.")


def init_db() -> None:
    """Create all tables. Safe to call repeatedly (idempotent)."""
    import models  # noqa: F401  (ensure models are registered)

    Base.metadata.create_all(bind=engine)
    logger.info("Database schema ensured.")
