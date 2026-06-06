import { useCallback, useState } from "react";
import { useFleet } from "./useFleet.js";
import { GRID } from "./config.js";
import TopBar from "./components/TopBar.jsx";
import KpiGrid from "./components/KpiGrid.jsx";
import WarehouseMap from "./components/WarehouseMap.jsx";
import BatteryChart from "./components/BatteryChart.jsx";
import AlertFeed from "./components/AlertFeed.jsx";
import RobotCards from "./components/RobotCards.jsx";

export default function App() {
  const { robots, metrics, alerts, conn, sendCommand } = useFleet();
  const [selectedRobot, setSelectedRobot] = useState(null);
  const [flashing, setFlashing] = useState(false);

  const selectRobot = useCallback(
    (id) => setSelectedRobot((cur) => (cur === id ? null : id)),
    []
  );

  const estopAll = useCallback(() => {
    setFlashing(true);
    setTimeout(() => setFlashing(false), 600);
    sendCommand({ command: "estop_all" });
  }, [sendCommand]);

  const resumeAll = useCallback(
    () => sendCommand({ command: "resume_all" }),
    [sendCommand]
  );

  // dispatch the selected robot to a clicked grid point (world coords, y-up)
  const dispatch = useCallback(
    (gx, gy) => {
      if (!selectedRobot) return;
      sendCommand({
        command: "dispatch",
        robot_id: selectedRobot,
        target_x: +gx.toFixed(1),
        target_y: +gy.toFixed(1),
        target_station: `Manual (${gx.toFixed(0)},${gy.toFixed(0)})`,
      });
    },
    [selectedRobot, sendCommand]
  );

  return (
    <>
      {flashing && <div className="estop-flash" />}

      <TopBar conn={conn} onEstopAll={estopAll} onResumeAll={resumeAll} />

      <KpiGrid metrics={metrics} />

      <main className="layout">
        <section className="panel glass map-panel">
          <div className="panel-head">
            <h2>
              Live Warehouse Grid <span className="dim">{GRID} × {GRID} m</span>
            </h2>
            <div className="legend">
              <span><i className="lg dock" />Dock</span>
              <span><i className="lg pick" />Pick Bay</span>
              <span><i className="lg drop" />Drop</span>
              <span><i className="lg obs" />Obstacle</span>
              <span><i className="lg bot" />AMR</span>
            </div>
          </div>
          <WarehouseMap
            robots={robots}
            selectedRobot={selectedRobot}
            onDispatch={dispatch}
          />
          <p className="hint">
            Tip: select a robot card, then click the grid to{" "}
            <strong>dispatch</strong> it.
          </p>
        </section>

        <aside className="side">
          <section className="panel glass charts-panel">
            <div className="panel-head"><h2>Fleet Battery</h2></div>
            <div className="chart-box">
              <BatteryChart robots={robots} />
            </div>
          </section>

          <AlertFeed alerts={alerts} />
        </aside>
      </main>

      <RobotCards
        robots={robots}
        selectedRobot={selectedRobot}
        onSelect={selectRobot}
        onCommand={sendCommand}
      />

      <footer className="footer">
        <span>Fleet Analytics Dashboard · ROS2-compatible AMR telemetry</span>
        <span className="dim">v1.0 · live</span>
      </footer>
    </>
  );
}
