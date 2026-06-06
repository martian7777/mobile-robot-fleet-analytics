import "../chartSetup.js";
import { Bar } from "react-chartjs-2";
import { ACCENT } from "../config.js";

const OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    y: {
      beginAtZero: true,
      max: 100,
      grid: { color: "rgba(120,150,220,.08)" },
      ticks: { color: "#8a96b8" },
    },
    x: { grid: { display: false }, ticks: { color: "#8a96b8" } },
  },
  animation: { duration: 400 },
};

function battColor(pct) {
  return pct > 50 ? ACCENT.emerald : pct > 20 ? ACCENT.amber : ACCENT.red;
}

export default function BatteryChart({ robots }) {
  const data = {
    labels: robots.map((r) => r.id),
    datasets: [
      {
        label: "Battery %",
        data: robots.map((r) => Math.round(r.battery_level || 0)),
        backgroundColor: robots.map((r) => battColor(r.battery_level || 0)),
        borderRadius: 6,
      },
    ],
  };
  return <Bar data={data} options={OPTIONS} />;
}
