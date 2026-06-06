import { useEffect, useState } from "react";

export default function TopBar({ conn, onEstopAll, onResumeAll }) {
  const [clock, setClock] = useState(() => new Date().toLocaleTimeString());

  useEffect(() => {
    const id = setInterval(() => setClock(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="topbar glass">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span className="pulse-dot" />
        </div>
        <div className="brand-text">
          <h1>AMR Fleet Analytics</h1>
          <p>Warehouse Operations · Live Telemetry</p>
        </div>
      </div>

      <div className="topbar-status">
        <div className="conn-pill" data-state={conn.state}>
          <span className="conn-dot" />
          <span>{conn.label}</span>
        </div>
        <div className="clock">{clock}</div>
        <button
          className="btn btn-danger estop-global"
          onClick={onEstopAll}
          title="Halt the entire fleet"
        >
          <span className="estop-ring" /> GLOBAL E-STOP
        </button>
        <button
          className="btn btn-ghost"
          onClick={onResumeAll}
          title="Resume the entire fleet"
        >
          RESUME ALL
        </button>
      </div>
    </header>
  );
}
