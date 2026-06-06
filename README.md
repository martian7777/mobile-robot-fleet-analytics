# 🤖 Fleet Analytics Dashboard for Mobile Robots (AMRs)

An **industrial-grade, end-to-end fleet analytics platform** for Autonomous
Mobile Robots. It bridges physical robotics telemetry (ROS2-style pub/sub) with
industrial data engineering (PostgreSQL + FastAPI) and operations intelligence
(live grid monitoring, alert streams, KPIs, and Power BI integration).

Runs anywhere Docker runs — **no ROS2 installation required** — while remaining
100% deployable as a real ROS2 node.

---

## ✨ Features

- **Warehouse fleet simulator** — 5 distinct AMRs on a 40×40 grid with picking
  bays, drop-off stations, charging docks and obstacle zones; realistic battery
  discharge, auto-recharge, navigation and random diagnostics.
- **ROS2-compatible** — publishes `/amr/telemetry`, `/amr/alerts`, `/amr/tasks`
  and subscribes to `/amr/commands`. Uses native `rclpy` if installed, otherwise
  an identical in-process mock bus ([simulator/mock_rclpy.py](simulator/mock_rclpy.py)).
- **FastAPI backend** — ingestion API, fleet KPI aggregation, WebSocket live
  streaming, and a control interface (E-Stop / dispatch).
- **PostgreSQL** — time-series telemetry, alerts, delivery tasks, robot metadata.
- **Premium dashboard** — dark, glassmorphic UI with a canvas warehouse map,
  glowing KPI cards + sparklines, per-robot battery/speed tiles, a live alert
  feed (with sound + flashing criticals), and interactive E-Stop / dispatch.
- **Power BI integration** — connect directly to PostgreSQL, plus ready-made
  DAX measures and sample CSVs ([powerbi/readme.md](powerbi/readme.md)).

---

## 🏗 Architecture

```
 AMR Simulator (ROS2 node / mock)
        │  publishes telemetry, alerts, tasks
        │  (HTTP bridge → backend)            ◀── /amr/commands (WebSocket)
        ▼
   FastAPI Backend ──── REST + WebSockets ────▶  Premium Web Dashboard
        │                                              (E-Stop / dispatch)
        ▼ stores
   PostgreSQL  ──── SQL / DirectQuery ────▶  Power BI
```

---

## 🚀 Quick start (Docker)

```bash
docker-compose up --build
```

Then open **http://localhost:8000**.

| Service    | URL / Port                    | Purpose                          |
|------------|-------------------------------|----------------------------------|
| Dashboard  | http://localhost:8000         | Live operations UI               |
| REST API   | http://localhost:8000/docs    | OpenAPI / Swagger explorer       |
| PostgreSQL | localhost:5432 (fleet/fleet)  | DB for Power BI / DirectQuery     |

Stop with `docker-compose down` (add `-v` to wipe the database volume).

---

## 🧪 Verification

```bash
# 1. Bring the stack up
docker-compose up --build -d

# 2. Check the API
curl http://localhost:8000/healthz
curl http://localhost:8000/api/fleet/status
curl http://localhost:8000/api/fleet/metrics

# 3. Confirm telemetry is landing in the DB
docker exec -t fleet-db psql -U fleet -d fleet -c "SELECT count(*) FROM telemetry_logs;"
```

**Manual UI checks**
- Robots move across the 2D grid in real time.
- Battery bars deplete; low robots return to a dock and recharge.
- The alert feed streams warnings/criticals (criticals flash + beep).
- Click **GLOBAL E-STOP** → all robots halt; **RESUME ALL** → they continue.
- Select a robot card, then click the grid to **dispatch** it to that point.

---

## 🛠 Local development (without Docker)

**Backend**
```bash
cd backend
pip install -r requirements.txt
# point at a local Postgres (or run only the db service via docker-compose)
set DATABASE_URL=postgresql+psycopg2://fleet:fleet@localhost:5432/fleet   # Windows
uvicorn main:app --reload --port 8000
```

**Simulator**
```bash
cd simulator
pip install -r requirements.txt
set API_BASE=http://localhost:8000
set WS_URL=ws://localhost:8000/ws/simulator
python robot_simulator.py
```

---

## 📁 Project structure

```
robotics/
├─ docker-compose.yml          # 3-service orchestration
├─ backend/                    # FastAPI + dashboard + DB layer
│  ├─ main.py                  # API, WebSockets, control, static hosting
│  ├─ database.py models.py schemas.py
│  ├─ requirements.txt  Dockerfile
│  └─ static/                  # index.html · css/styles.css · js/app.js
├─ simulator/                  # Warehouse fleet simulator
│  ├─ robot_simulator.py       # physics, navigation, battery, alerts
│  ├─ mock_rclpy.py            # ROS2 fallback (rclpy-compatible)
│  ├─ requirements.txt  Dockerfile
└─ powerbi/                    # BI guide + sample CSVs
   └─ readme.md, sample_*.csv
```

---

## 🔌 Deploying as a real ROS2 node

`robot_simulator.py` is written against the standard `rclpy` API. On a machine
with ROS2 (e.g. Humble) installed, `import rclpy` succeeds and the node runs as a
genuine ROS2 participant — the same publishers/subscriptions, no code changes.
Without ROS2, it transparently falls back to `mock_rclpy`.
