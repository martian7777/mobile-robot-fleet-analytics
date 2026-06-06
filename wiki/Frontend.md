# 🎨 React Frontend Specification

This page outlines the client-side single-page application (SPA), documenting component structures, state sync mechanics, and the coordinate mapping systems of the warehouse map.

---

## 🛠 1. Technology Stack & Design System

The frontend is constructed to provide a high-frequency, glassmorphic dark interface suitable for a control room environment.
- **Framework:** React 18 + Vite (configured for rapid Hot Module Replacement).
- **Styling:** Vanilla CSS (`index.css`) utilizing modern CSS custom variables, glassmorphism overlays (`backdrop-filter: blur`), and custom animations (e.g. flashing critical warning states).
- **Charts:** Chart.js (configured via React wraps) and native inline SVG rendering (for sparkline aggregates).

---

## 🔄 2. State Management & Live Sync (`useFleet.js`)

All live data is centralized inside the `useFleet` React hook, which coordinates WebSocket frame events and cheap REST metrics polling.

```text
               +-------------------------------------------------+
               |                   useFleet()                    |
               +-------------------------------------------------+
                       │                                 │
         (Every 4s HTTP Poll)                     (WS /ws/dashboard)
                       ▼                                 ▼
           GET /api/fleet/metrics                   Message Event
                       │                                 │
                       ▼                                 ▼
                 Update Metrics               [snapshot]  --> Load initial fleet
                                              [telemetry] --> Update AMR coords/battery
                                              [alert]     --> Prepend to alert logs
```

### Hook Responsibilities
1. **WebSocket Lifecycle:** Connects to `/ws/dashboard`. If disconnected, it triggers an automated reconnect routine with a fixed backoff of **`2.5 seconds`**.
2. **Keyed State Management:** Tracks active AMRs inside a `Map` reference (`robotsRef`) to allow $O(1)$ updates as high-frequency telemetry arrives. Telemetry states are then sorted by AMR ID and projected into React state array for rendering.
3. **Data Throttling & Polling:** Polling on `/api/fleet/metrics` runs on a 4-second interval. It updates the aggregate KPI cards, while the high-frequency positions are pushed via the WebSocket stream.
4. **Command Dispatcher:** Exposes `sendCommand(payload)` which posts control commands (E-Stop, Resume, Dispatch) to the `/api/control` API endpoint.

---

## 🗺 3. HTML5 Canvas Map Renderer (`WarehouseMap.jsx`)

The warehouse map represents a $40\text{m} \times 40\text{m}$ grid rendered onto an HTML5 `<canvas>` element.

### Coordinate Conversion Math
The robot simulator and backend operate in **World Coordinates (Meters)**, with the origin `(0,0)` at the **lower-left corner** of the warehouse floor (Y-up configuration).
Conversely, the HTML5 Canvas operates in **Screen Coordinates (Pixels)**, with the origin `(0,0)` at the **top-left corner** (Y-down configuration).

```text
World Space (meters)                         Canvas Screen Space (pixels)
  (0, 40) ----------- (40, 40)                  (0, 0) ----------- (Width, 0)
     |                   |                         |                   |
     |      Robot (x,y)  |      =====>             |      Pixel (px,py)|
     |                   |                         |                   |
  (0, 0)  ----------- (40, 0)                   (0, Height) ------- (Width, Height)
```

The mathematical mapping conversions are structured as:
$$p_x = x \cdot \left(\frac{\text{Canvas Width}}{40}\right)$$
$$p_y = \text{Canvas Height} - \left(y \cdot \left(\frac{\text{Canvas Height}}{40}\right)\right)$$

### Render Layers
The Canvas repaint function runs on every telemetry tick and renders elements in order:
1. **Grid Lines:** Draw $1\text{m}$ grid increments with subtle alpha lines.
2. **Static Station Landmarks:** 
   - Docks (charging stations) at the bottom grid boundary.
   - Picking Bays and Drop-off locations.
   - Red cross-hatched Obstacle collision zones.
3. **Robot Vectors:**
   - Draw circles representing the physical AMR boundaries.
   - Draw heading lines (using $x + \cos(\theta)$ and $y + \sin(\theta)$ orientation math) to represent the direction the robot is facing.
   - Draw target path lines from the robot's current position to its current destination.
4. **Interactive Overlays:** Shows target indicators and coordinates when an operator selects a robot and hovers over dispatchable grid positions.

---

## 🎛 4. UI Components Catalog

```text
frontend/src/components/
├── TopBar.jsx            # Fleet status banner (Connected/Disconnected), Global E-Stop, Resume
├── KpiGrid.jsx           # Aggregates 5 core KPIs; renders inline SVG sparkline histories
├── Sparkline.jsx         # Highly optimized SVG paths mapping historical numeric metrics
├── WarehouseMap.jsx      # HTML5 Canvas rendering engine for layout and click dispatching
├── BatteryChart.jsx      # Chart.js bar graph matching battery cells across the fleet
├── AlertFeed.jsx         # Live diagnostic feed. Criticals play alarm audio and flash the tab
└── RobotCards.jsx        # Telemetry detail panels: speed, battery %, current state, and E-Stop
```

### Component Details

#### `AlertFeed.jsx`
- Listens for new alert items.
- Retains up to 40 logs in memory.
- If a log contains `severity = "critical"`, it flashes a warning background and plays a localized synthetic alert chime (using an `Audio` instance).
- Provides buttons to make POST requests to `/api/alerts/{id}/ack` which flags the database entry.

#### `KpiGrid.jsx` & `Sparkline.jsx`
- Displays cards for Fleet Availability, Active Robots, Total Distance, and Alert Counts.
- Renders historical trends using a simple SVG `<polyline>` with points scaled dynamically, eliminating the performance overhead of full plotting libraries for small UI cards.

#### `RobotCards.jsx`
- Houses indicators for active states: `idle`, `moving`, `charging`, `estopped`, `error`.
- Displays dynamic progress bars showing battery charge (green for $>50\%$, orange for $20\%-50\%$, flashing red for $<20\%$).
- Contains E-Stop toggle actions specific to that robot ID.
