# Power BI Integration Guide — AMR Fleet Analytics

This guide explains how to connect **Power BI Desktop** to the live PostgreSQL
database that backs the Fleet Analytics Dashboard, and how to build three
operational report pages. Sample CSV files are bundled so you can prototype
visuals immediately, even before connecting to the live database.

---

## 1. Two ways to get data into Power BI

### Option A — Live connection to PostgreSQL (recommended)

The `db` container publishes PostgreSQL on **`localhost:5432`**.

| Setting        | Value                       |
|----------------|-----------------------------|
| Server         | `localhost`                 |
| Port           | `5432`                      |
| Database       | `fleet`                     |
| Username       | `fleet`                     |
| Password       | `fleet`                     |

Steps:

1. Ensure the stack is running: `docker-compose up --build -d`.
2. In Power BI Desktop → **Home → Get Data → PostgreSQL database**.
3. Enter `localhost` as the server and `fleet` as the database.
4. Choose **DirectQuery** for always-live dashboards, or **Import** for snapshots.
   > DirectQuery keeps tiles in sync with the warehouse floor in near-real-time.
5. Select the tables: `robots`, `telemetry_logs`, `alert_logs`, `delivery_tasks`.
6. **Load**.

> **Driver note:** Power BI's PostgreSQL connector needs the *Npgsql* provider.
> If prompted, install it from the link Power BI shows (one-time setup).

### Option B — Quick prototyping from the sample CSVs

If you don't want to run Docker yet, use the bundled CSVs in this folder:

- `sample_robots.csv`
- `sample_telemetry_logs.csv`
- `sample_alert_logs.csv`
- `sample_delivery_tasks.csv`

In Power BI: **Get Data → Text/CSV**, import each file, then create the same
relationships described below.

---

## 2. Data model & relationships

Create these relationships in the Power BI **Model** view (all *one-to-many*
from `robots` to the log tables on `id` → `robot_id`):

```
robots[id] 1 ─── * telemetry_logs[robot_id]
robots[id] 1 ─── * alert_logs[robot_id]
robots[id] 1 ─── * delivery_tasks[robot_id]
```

Mark `telemetry_logs[timestamp]` and `alert_logs[timestamp]` as date/time
columns, and (optionally) add a dedicated **Date table** for time intelligence.

---

## 3. Suggested DAX measures

```DAX
Fleet Availability % =
VAR Total = DISTINCTCOUNT( robots[id] )
VAR Down  = CALCULATE( DISTINCTCOUNT( robots[id] ),
                       robots[status] IN { "estopped", "error" } )
RETURN DIVIDE( Total - Down, Total ) * 100

Avg Cycle Time (s) =
AVERAGEX(
    FILTER( delivery_tasks, delivery_tasks[status] = "completed" ),
    DATEDIFF( delivery_tasks[start_time], delivery_tasks[end_time], SECOND )
)

Task Success Rate % =
DIVIDE(
    CALCULATE( COUNTROWS( delivery_tasks ), delivery_tasks[status] = "completed" ),
    CALCULATE( COUNTROWS( delivery_tasks ),
               delivery_tasks[status] IN { "completed", "failed", "aborted" } )
) * 100

Total Distance (km) = SUM( robots[total_distance] ) / 1000

Critical Alerts (24h) =
CALCULATE(
    COUNTROWS( alert_logs ),
    alert_logs[severity] = "critical",
    alert_logs[timestamp] >= NOW() - 1
)
```

---

## 4. Three report pages to build

### Page 1 — Operational Efficiency
- **KPI cards:** Fleet Availability %, Avg Cycle Time, Task Success Rate, Total Distance (km).
- **Line chart:** completed tasks per hour (`delivery_tasks[end_time]`).
- **Bar chart:** tasks completed by robot.
- **Gauge:** current average battery (`AVERAGE(robots[battery_level])`).

### Page 2 — Safety & Alerts
- **Stacked column:** alert count by `severity` over time.
- **Table:** most recent critical alerts (`alert_logs` filtered to `critical`).
- **Donut:** alerts by `code` (LIDAR_FAILURE, OBSTACLE_COLLISION, …).
- **Card:** Critical Alerts (24h) measure.

### Page 3 — Fleet Maintenance
- **Matrix:** robot × avg speed × total distance (driveline wear proxy).
- **Scatter:** `total_distance` vs alert count per robot (reliability view).
- **Bar:** battery level by robot with conditional formatting (<20% = red).
- **Map / table:** last-known position from `telemetry_logs` (latest per robot).

---

## 5. Refresh cadence

- **DirectQuery:** set page refresh in **Format → Page refresh** (e.g. every 5s)
  for a live operations wall display.
- **Import mode:** schedule refresh via **Transform Data → Refresh**, or publish
  to the Power BI Service and configure a Scheduled Refresh against the gateway.

---

## 6. Exporting fresh CSVs from the live DB (optional)

To regenerate the sample CSVs from the running database:

```bash
docker exec -t fleet-db psql -U fleet -d fleet \
  -c "\copy (SELECT * FROM telemetry_logs) TO STDOUT WITH CSV HEADER" > sample_telemetry_logs.csv
```

Repeat for `robots`, `alert_logs`, and `delivery_tasks`.
