import { useEffect, useState } from "react";
import { ACCENT } from "../config.js";
import Sparkline from "./Sparkline.jsx";

const MAX_POINTS = 30;
const DASH = "—";

function fmtNum(n) {
  if (n == null) return DASH;
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : Math.round(n);
}

export default function KpiGrid({ metrics }) {
  const [spark, setSpark] = useState({
    availability: [],
    cycle: [],
    distance: [],
    alerts: [],
  });

  useEffect(() => {
    if (!metrics) return;
    setSpark((prev) => {
      const push = (key, value) =>
        [...prev[key], value].slice(-MAX_POINTS);
      return {
        availability: push("availability", metrics.fleet_availability),
        cycle: push("cycle", metrics.avg_cycle_time),
        distance: push("distance", metrics.total_distance),
        alerts: push("alerts", metrics.active_alerts),
      };
    });
  }, [metrics]);

  const m = metrics;
  const cards = [
    {
      accent: "cyan",
      icon: "⚙",
      label: "Fleet Availability",
      value: m ? m.fleet_availability : DASH,
      unit: "%",
      trend: m
        ? `${m.active_robots} moving · ${m.charging_robots} charging · ${m.estopped_robots} stopped`
        : `${DASH} operational`,
      spark: spark.availability,
      color: ACCENT.cyan,
    },
    {
      accent: "violet",
      icon: "⏱",
      label: "Avg Cycle Time",
      value: m ? m.avg_cycle_time : DASH,
      unit: "s",
      trend: m
        ? `${m.tasks_completed} done · ${m.task_success_rate}% success`
        : `${DASH} per task`,
      spark: spark.cycle,
      color: ACCENT.violet,
    },
    {
      accent: "emerald",
      icon: "📍",
      label: "Total Distance",
      value: m ? fmtNum(m.total_distance) : DASH,
      unit: "m",
      trend: m ? `avg battery ${m.avg_battery}%` : `${DASH} fleet-wide`,
      spark: spark.distance,
      color: ACCENT.emerald,
    },
    {
      accent: "amber",
      icon: "⚠",
      label: "Active Alerts",
      value: m ? m.active_alerts : DASH,
      unit: "",
      trend: m
        ? `${m.critical_alerts} critical · last 10 min`
        : `${DASH} last 10 min`,
      spark: spark.alerts,
      color: ACCENT.amber,
    },
  ];

  return (
    <section className="kpi-grid" aria-label="Fleet key performance indicators">
      {cards.map((c) => (
        <article key={c.label} className="kpi-card glass" data-accent={c.accent}>
          <div className="kpi-top">
            <span className="kpi-label">{c.label}</span>
            <span className="kpi-icon">{c.icon}</span>
          </div>
          <div className="kpi-value">
            <span>{c.value}</span>
            {c.unit && <small>{c.unit}</small>}
          </div>
          <div className="kpi-trend">{c.trend}</div>
          <div className="kpi-spark">
            <Sparkline data={c.spark} color={c.color} />
          </div>
        </article>
      ))}
    </section>
  );
}
