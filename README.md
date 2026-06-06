# 🤖 AMR Fleet Analytics Dashboard

[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)

An **industrial-grade, end-to-end fleet analytics platform** for Autonomous Mobile Robots (AMRs). It bridges physical robotics telemetry (ROS2-style pub/sub) with industrial data engineering (PostgreSQL + FastAPI) and operations intelligence (live grid monitoring, alert streams, KPIs, and Power BI integration).

The platform is designed to run out-of-the-box using Docker (no local ROS2 installation required) while remaining 100% deployable on real physical AMRs running ROS2.

> [!NOTE]
> For in-depth technical specifications, database schemas, and implementation write-ups, check out the **[Project Wiki](WIKI.md)**.

---

## 📖 Table of Contents
- [✨ Features](#-features)
- [🏗 Architecture](#-architecture)
- [🚀 Quick Start (Docker)](#-quick-start-docker)
- [🧪 Verification & Operations](#-verification--operations)
- [🛠 Local Development (Without Docker)](#-local-development-without-docker)
- [📁 Project Structure](#-project-structure)
- [🔌 Deploying as a Real ROS2 Node](#-deploying-as-a-real-ros2-node)
- [📚 Repository Wiki](#-repository-wiki)

---

## ✨ Features

- **Warehouse Fleet Simulator** — Simulates 5 distinct AMRs (models, battery capacity, speeds) moving on a $40 \times 40\text{m}$ grid with picking bays, drop-off stations, charging docks, and obstacle collision zones. Features realistic battery discharge, auto-recharging logic, and random fault/diagnostic generation.
- **React Frontend Dashboard** — A premium, high-fidelity React single-page application built with Vite:
  - **Dynamic Canvas Map**: Renders live AMR coordinates, orientation vectors, paths, charging status, and station locations. Allows interactive click-to-dispatch.
  - **KPIs & Sparklines**: Real-time aggregate fleet metrics (availability, active count, task success rates) mapped alongside SVG trend sparklines.
  - **Individual AMR Panels**: Battery percentages, status indicators, and operational logs.
  - **Global Control System**: System-wide E-Stop (with red flashing screen warning) and resume actions.
  - **Live Alert Feed**: Real-time logs for collision warnings and sensor errors, featuring sound notifications for critical events.
- **FastAPI Backend** — High-performance ingestion REST API, fleet KPI calculations, WebSocket connection hubs (dashboard fans, simulator commands), and static asset hosting.
- **Robust Data Storage** — PostgreSQL database logging time-series telemetry, alerts, delivery tasks, and robot metadata.
- **ROS2 Compatible** — Communicates over topics like `/amr/telemetry`, `/amr/alerts`, and `/amr/tasks`. Uses native `rclpy` if available, falling back to an in-process mock bus if ROS2 is not installed locally.
- **Power BI Integration** — Connection guidelines, pre-configured DAX measures, and sample datasets for building operational reports.

---

## 🏗 Architecture

```mermaid
graph TD
    subgraph Simulation
        A[AMR Simulator / ROS2 Node] <-->|WS commands / API telemetry| B(FastAPI Backend)
    end

    subgraph Data Tier
        B <-->|SQLAlchemy / psycopg2| C[(PostgreSQL Database)]
    end

    subgraph Operations UI
        B <-->|WebSockets & REST| D[Vite + React Dashboard]
        C -.->|DirectQuery / CSV| E[Power BI Desktop]
    end

    style A fill:#4CAF50,stroke:#333,stroke-width:2px,color:#fff
    style B fill:#009688,stroke:#333,stroke-width:2px,color:#fff
    style C fill:#316192,stroke:#333,stroke-width:2px,color:#fff
    style D fill:#61DAFB,stroke:#333,stroke-width:2px,color:#000
    style E fill:#F2C811,stroke:#333,stroke-width:2px,color:#000
```

---

## 🚀 Quick Start (Docker)

Spin up the entire pipeline (FastAPI backend, PostgreSQL database, simulator, and compiled React frontend) in a single command:

```bash
docker-compose up --build
```

Once running, the services are exposed on the following ports:

| Service | Port / URL | Purpose |
| :--- | :--- | :--- |
| **Dashboard** | [http://localhost:8000](http://localhost:8000) | Live operations UI & Map control |
| **REST API Docs** | [http://localhost:8000/docs](http://localhost:8000/docs) | Interactive Swagger/OpenAPI explorer |
| **PostgreSQL** | `localhost:5432` | Time-series data repository (User/Pass: `fleet`/`fleet`) |

To shut down the stack, use:
```bash
docker-compose down -v
```
*(Add `-v` to clear the PostgreSQL database volumes if you want a clean slate).*

---

## 🧪 Verification & Operations

### 1. Ingestion Check
Verify the API is healthy and receiving simulated telemetry data:

```bash
# Check service health
curl http://localhost:8000/healthz

# Fetch active fleet status snapshot
curl http://localhost:8000/api/fleet/status

# Fetch aggregate KPIs
curl http://localhost:8000/api/fleet/metrics
```

### 2. Database Logs Check
Confirm that telemetry packets are being persisted in PostgreSQL:

```bash
docker exec -t fleet-db psql -U fleet -d fleet -c "SELECT count(*) FROM telemetry_logs;"
```

### 3. Interactive Operations
Open the dashboard at `http://localhost:8000` and test the controls:
- **Interactive Dispatch**: Click on any robot card, select a target point on the 2D grid, and watch the robot recalculate and follow its path in real-time.
- **Global E-Stop**: Click **GLOBAL E-STOP**. The dashboard will flash red, and all robots will halt immediately. Click **RESUME ALL** to restore operational states.
- **Low Battery Auto-Docking**: Watch robots whose batteries drop below 20% abort their active missions, navigate back to a charging station, and dock until they reach 100%.

---

## 🛠 Local Development (Without Docker)

> [!IMPORTANT]
> Ensure you have a local PostgreSQL instance running or start only the db service using Docker: `docker-compose up -d db`.

### 1. Backend API
```bash
cd backend
pip install -r requirements.txt
set DATABASE_URL=postgresql+psycopg2://fleet:fleet@localhost:5432/fleet
uvicorn main:app --reload --port 8000
```

### 2. Robot Simulator
```bash
cd simulator
pip install -r requirements.txt
set API_BASE=http://localhost:8000
set WS_URL=ws://localhost:8000/ws/simulator
python robot_simulator.py
```

### 3. React Frontend
```bash
cd frontend
npm install
npm run dev      # Runs on http://localhost:5173 (proxies API & WS requests to 8000)
```

To build the frontend static assets for production deployment served by FastAPI:
```bash
cd frontend
npm run build    # Outputs to ../backend/static/
```

---

## 📁 Project Structure

```text
robotics/
├── docker-compose.yml          # Container orchestration (DB, backend, simulator)
├── README.md                   # Repository landing page
├── WIKI.md                     # Wiki hub
├── wiki/                       # Detailed wiki documentation pages
│   ├── Architecture.md         # Architecture, ROS2, and mock message bus
│   ├── Frontend.md             # React structures, canvas map, and state hooks
│   ├── Backend.md              # FastAPI, routes, websockets, and schema
│   ├── Simulator.md            # AMR physical simulation details and pathing
│   └── PowerBI.md              # Connecting DB, DAX equations, and report setups
├── backend/                    # FastAPI Server & DB Layer
│   ├── main.py                 # Core routing, WebSocket managers, static routes
│   ├── database.py             # DB connection pool initialization
│   ├── models.py               # SQLAlchemy schemas (Postgres)
│   ├── schemas.py              # Pydantic schemas (REST/WS validations)
│   └── static/                 # Directory serving compiled React code
├── frontend/                   # React + Vite Client code
│   ├── package.json            # NPM dependencies
│   ├── src/                    # Components & State hooks
│   │   ├── useFleet.js         # Custom hook managing WebSockets & telemetry
│   │   └── components/         # AlertFeed, BatteryChart, WarehouseMap, etc.
│   └── vite.config.js          # Dev proxy configs
├── simulator/                  # Python AMR Fleet Simulator
│   ├── robot_simulator.py      # Simulation loop, physics, battery, paths
│   └── mock_rclpy.py           # Fallback ROS2 mock node interface
└── powerbi/                    # BI Reports
    ├── readme.md               # Guide to connecting Power BI to PostgreSQL
    └── sample_robots.csv       # Preloaded datasets for offline report building
```

---

## 🔌 Deploying as a Real ROS2 Node

The simulator code is natively written using the `rclpy` interface. When run on a machine containing a ROS2 environment (such as ROS2 Humble):
1. The script will automatically detect `rclpy`.
2. It will bypass the local mock bus and publish real messages on the `/amr/telemetry`, `/amr/alerts`, and `/amr/tasks` ROS2 topics.
3. Subscriptions to control topics like `/amr/commands` will interact with standard ROS2 nodes in your workspace.

---

## 📚 Repository Wiki

For detailed guides and deep dives into individual components, refer to our sub-pages:
- **[Wiki Index](WIKI.md)** — Hub for all wiki entries.
- **[System Architecture](wiki/Architecture.md)** — Data model, protocols, and ROS2 bridging.
- **[React Frontend Docs](wiki/Frontend.md)** — Canvas layout, WebSockets, and state.
- **[FastAPI Backend Specs](wiki/Backend.md)** — API endpoints, WebSockets, and DB setup.
- **[AMR Simulator Logic](wiki/Simulator.md)** — Movement physics, battery charts, and navigation paths.
- **[Power BI Integration Guide](wiki/PowerBI.md)** — Relational tables, DAX measures, and CSV schemas.
