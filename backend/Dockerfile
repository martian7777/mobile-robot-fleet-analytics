# syntax=docker/dockerfile:1
# NOTE: this Dockerfile expects the *repository root* as its build context
# (see docker-compose.yml) so it can build the Vite + React frontend alongside
# the FastAPI backend.

# ---- Stage 0: build the Vite + React dashboard -----------------------------
# vite.config.js emits the production bundle into ../backend/static, so building
# from /app/frontend lands the assets at /app/backend/static.
FROM node:20-slim AS frontend

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 1: build python deps into a wheelhouse (cache-friendly) ----------
FROM python:3.12-slim AS builder

WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt

# ---- Stage 2: lean runtime -------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# libpq is needed at runtime by psycopg2.
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /wheels /wheels
COPY backend/requirements.txt .
RUN pip install --no-cache-dir --no-index --find-links=/wheels -r requirements.txt \
    && rm -rf /wheels

# Application code (flat module layout: `import main`, `import models`, ...).
COPY backend/ .

# Built dashboard from the frontend stage (served at / and /static).
COPY --from=frontend /app/backend/static ./static

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -fsS http://localhost:8000/healthz || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
