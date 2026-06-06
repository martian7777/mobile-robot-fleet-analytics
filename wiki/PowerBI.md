# 📊 Power BI Analytics & Reporting

This page provides documentation for the business intelligence integration, covering relational models, calculated DAX measures, and dashboard report layouts.

---

## 🔌 1. DB Connection Configuration

Power BI connects directly to the time-series logs inside PostgreSQL, allowing managers to audit warehouse efficiency without impacting the real-time operational database.

### DirectQuery vs. Import Modes
- **DirectQuery Mode (Recommended):** Power BI does not store telemetry data. Instead, it queries the PostgreSQL database dynamically as visuals are opened or refreshed. This allows the layout to show near-real-time warehouse states.
- **Import Mode:** Imports data snapshots into the local memory cache. Best for historical reporting and complex DAX analytics covering large timeframes.

---

## 📐 2. Relational Model Schema

To prevent duplication and maintain database integrity, Power BI reports must follow a **Star Schema** centered on the `robots` dimension table:

```text
    +------------------+             +--------------------+
    |  telemetry_logs  |             |     alert_logs     |
    +------------------+             +--------------------+
    | - id (PK)        |             | - id (PK)          |
    | - robot_id (FK)  |◀----+ +----▶| - robot_id (FK)    |
    | - speed          |     | |     | - severity         |
    | - battery_level  |     | |     | - message          |
    | - timestamp      |     | |     | - timestamp        |
    +------------------+     │ │     +--------------------+
                             │ │
                        +----+─+----+
                        |  robots   |  (Dimension Table)
                        +-----------+
                        | - id (PK) |
                        | - model   |
                        +----+─+----+
                             │ │
    +------------------+     │ │     +--------------------+
    |  delivery_tasks  |◀----+ +----▶|     date_table     |  (Optional dimension)
    +------------------+             +--------------------+
    | - id (PK)        |             | - date_key (PK)    |
    | - robot_id (FK)  |             | - day / month / yr |
    | - status         |             +--------------------+
    | - start_time     |
    | - end_time       |
    +------------------+
```

### Relational Configuration
- Create a **One-to-Many ($1 \rightarrow *$)** connection from `robots[id]` to `telemetry_logs[robot_id]`.
- Create a **One-to-Many ($1 \rightarrow *$)** connection from `robots[id]` to `alert_logs[robot_id]`.
- Create a **One-to-Many ($1 \rightarrow *$)** connection from `robots[id]` to `delivery_tasks[robot_id]`.
- Enforce **Single Direction** cross-filtering (filtering flows from the `robots` table down to the log tables).

---

## 📈 3. DAX Formulas Reference

Ensure you define these calculated measures inside the Power BI model:

### A. Fleet Availability %
Calculates the proportion of the fleet that is active and available (not in an `error` or `estopped` state).
```dax
Fleet Availability % = 
VAR Total = DISTINCTCOUNT( robots[id] )
VAR Down  = CALCULATE( DISTINCTCOUNT( robots[id] ), 
                       robots[status] IN { "estopped", "error" } )
RETURN DIVIDE( Total - Down, Total ) * 100
```

### B. Average Cycle Time (s)
Measures the average duration in seconds for an AMR to complete a picking-to-delivery task cycle.
```dax
Avg Cycle Time (s) = 
AVERAGEX(
    FILTER( delivery_tasks, delivery_tasks[status] = "completed" ),
    DATEDIFF( delivery_tasks[start_time], delivery_tasks[end_time], SECOND )
)
```

### C. Task Success Rate %
Calculates successfully completed delivery tasks as a percentage of all ended tasks.
```dax
Task Success Rate % = 
DIVIDE(
    CALCULATE( COUNTROWS( delivery_tasks ), delivery_tasks[status] = "completed" ),
    CALCULATE( COUNTROWS( delivery_tasks ), 
               delivery_tasks[status] IN { "completed", "failed", "aborted" } )
) * 100
```

### D. Total Distance (km)
Sums the odometer distances logged by all AMRs and converts the value from meters to kilometers.
```dax
Total Distance (km) = SUM( robots[total_distance] ) / 1000
```

### E. Critical Alerts (24h)
Flags critical diagnostic events raised within the past 24 hours.
```dax
Critical Alerts (24h) = 
CALCULATE(
    COUNTROWS( alert_logs ),
    alert_logs[severity] = "critical",
    alert_logs[timestamp] >= NOW() - 1
)
```

---

## 🎛 4. Dashboard Visual Specifications

### Page 1: Operational Efficiency (Real-Time Floor KPIs)
- **Primary KPIs:** Arrange 4 Card Visuals horizontally across the top containing `Fleet Availability %`, `Avg Cycle Time (s)`, `Task Success Rate %`, and `Total Distance (km)`.
- **Delivery Throughput:** Line chart plotting completed tasks (y-axis) against hourly time buckets (x-axis: `delivery_tasks[end_time]`).
- **Robot Efficiency:** Bar chart showing completed tasks count grouped by `robots[id]`.
- **Battery Gauge:** Radial gauge showing average current charge (value: `AVERAGE(robots[battery_level])`, min: 0, max: 100).

### Page 2: Safety & Alerts (Risk & Auditing)
- **Alert Log Grid:** A Table visual showing recent critical alerts, filtered to show only `alert_logs[severity] = "critical"`. Columns: `Timestamp`, `Robot ID`, `Code`, and `Message`.
- **Fault Categories:** Donut chart representing alert codes (value: count of alerts, legend: `alert_logs[code]`). Shows which hardware failures (e.g. `LIDAR_OBSCURED` vs. `WHEEL_SLIP`) occur most frequently.
- **Safety Indicator:** Single Card displaying `Critical Alerts (24h)` with conditional color rules (green if 0, yellow if 1-2, red if $>2$).

### Page 3: Maintenance Planner (Lifecycles & Wear)
- **Wear Matrix:** Table matrix plotting `Robot ID` rows against columns: `Average speed`, `Alert Count`, and `Total Distance`. Used to identify AMRs that require scheduling for mechanical inspection.
- **Reliability Scatter:** Scatter plot mapping `Total Distance` (x-axis) vs. `Alert Count` (y-axis), with dots detailed by `Robot ID`. Highlights units exhibiting high fault counts relative to total operation.
- **Battery Level Visual:** Horizontal bar chart showing battery levels by robot. Add conditional rules: if value $< 20$ fill red, if $20-50$ fill orange, and if $> 50$ fill green.
