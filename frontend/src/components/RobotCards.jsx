import { ACCENT } from "../config.js";

function battColor(pct) {
  return pct > 50 ? ACCENT.emerald : pct > 20 ? ACCENT.amber : ACCENT.red;
}

function RobotCard({ robot, selected, onSelect, onCommand }) {
  const pct = Math.max(0, Math.min(100, robot.battery_level || 0));
  const cls = [
    "robot-card",
    selected ? "selected" : "",
    robot.status === "estopped" ? "estopped" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} onClick={() => onSelect(robot.id)}>
      <div className="rc-head">
        <div>
          <div className="rc-name">{robot.id}</div>
          <div className="rc-model">{robot.model || ""}</div>
        </div>
        <span className={`rc-status st-${robot.status}`}>{robot.status}</span>
      </div>

      <div className="rc-task" title={robot.current_task || ""}>
        {robot.current_task || "—"}
      </div>

      <div className="rc-batt-row">
        <div className="batt-track">
          <div
            className="batt-fill"
            style={{ width: `${pct}%`, background: battColor(pct) }}
          />
        </div>
        <span className="rc-batt-val">{pct.toFixed(0)}%</span>
      </div>

      <div className="rc-speed">
        <span>Speed</span>
        <b>{(robot.speed || 0).toFixed(2)} m/s</b>
      </div>

      <div className="rc-actions">
        <button
          className="rc-btn stop"
          onClick={(e) => {
            e.stopPropagation();
            onCommand({ command: "estop", robot_id: robot.id });
          }}
        >
          E-STOP
        </button>
        <button
          className="rc-btn"
          onClick={(e) => {
            e.stopPropagation();
            onCommand({ command: "resume", robot_id: robot.id });
          }}
        >
          RESUME
        </button>
      </div>
    </div>
  );
}

export default function RobotCards({ robots, selectedRobot, onSelect, onCommand }) {
  return (
    <section className="robots-strip" aria-label="Individual robot status">
      <div className="strip-head">
        <h2>Fleet Units</h2>
        <span className="dim">
          {selectedRobot
            ? `► ${selectedRobot} selected — click the grid to dispatch`
            : ""}
        </span>
      </div>
      <div className="robot-cards">
        {robots.map((r) => (
          <RobotCard
            key={r.id}
            robot={r}
            selected={selectedRobot === r.id}
            onSelect={onSelect}
            onCommand={onCommand}
          />
        ))}
      </div>
    </section>
  );
}
