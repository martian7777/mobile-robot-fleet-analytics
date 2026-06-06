import "../chartSetup.js";
import { Line } from "react-chartjs-2";

const OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: { x: { display: false }, y: { display: false } },
  animation: false,
};

export default function Sparkline({ data, color }) {
  const chartData = {
    labels: data.map((_, i) => i),
    datasets: [
      {
        data,
        borderColor: color,
        borderWidth: 2,
        fill: true,
        backgroundColor: color + "22",
        tension: 0.4,
        pointRadius: 0,
      },
    ],
  };
  return <Line data={chartData} options={OPTIONS} />;
}
