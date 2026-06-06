import { useEffect, useRef } from "react";
import { GRID, MAP_FEATURES, ACCENT } from "../config.js";

export default function WarehouseMap({ robots, selectedRobot, onDispatch }) {
  const canvasRef = useRef(null);
  const cellRef = useRef(0);
  // Latest props for the draw routine without re-binding listeners.
  const stateRef = useRef({ robots, selectedRobot });
  stateRef.current = { robots, selectedRobot };

  // world (x,y meters, y-up) -> canvas px (y-down)
  const toPx = (x, y) => [x * cellRef.current, (GRID - y) * cellRef.current];

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const resize = () => {
      const size = canvas.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cellRef.current = size / GRID;
    };

    const drawZones = (list, color, label) => {
      const cell = cellRef.current;
      ctx.font = "600 9px JetBrains Mono, monospace";
      list.forEach(([x, y]) => {
        const [px, py] = toPx(x, y);
        const s = cell * 1.6;
        ctx.save();
        ctx.fillStyle = color + "22";
        ctx.strokeStyle = color + "aa";
        ctx.lineWidth = 1.4;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.fillRect(px - s / 2, py - s / 2, s, s);
        ctx.strokeRect(px - s / 2, py - s / 2, s, s);
        ctx.shadowBlur = 0;
        ctx.fillStyle = color;
        ctx.fillText(label, px - s / 2 + 2, py - s / 2 - 3);
        ctx.restore();
      });
    };

    const drawObstacles = (list) => {
      const cell = cellRef.current;
      list.forEach(([x, y]) => {
        const [px, py] = toPx(x, y);
        ctx.save();
        ctx.fillStyle = ACCENT.rose + "33";
        ctx.strokeStyle = ACCENT.rose;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(px, py, cell * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = ACCENT.rose + "aa";
        ctx.beginPath();
        ctx.moveTo(px - cell * 0.5, py - cell * 0.5);
        ctx.lineTo(px + cell * 0.5, py + cell * 0.5);
        ctx.stroke();
        ctx.restore();
      });
    };

    const drawGrid = () => {
      const cell = cellRef.current;
      const size = canvas.clientWidth;
      ctx.clearRect(0, 0, size, size);

      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(120,150,220,0.06)";
      for (let i = 0; i <= GRID; i += 2) {
        const p = i * cell;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
      }

      drawZones(MAP_FEATURES.docks, ACCENT.emerald, "DOCK");
      drawZones(MAP_FEATURES.picks, ACCENT.cyan, "PICK");
      drawZones(MAP_FEATURES.drops, ACCENT.violet, "DROP");
      drawObstacles(MAP_FEATURES.obstacles);
    };

    const drawRobots = () => {
      const cell = cellRef.current;
      const { robots: list, selectedRobot: sel } = stateRef.current;
      list.forEach((r) => {
        if (r.pos_x == null) return;
        const [px, py] = toPx(r.pos_x, r.pos_y);
        const color =
          r.status === "estopped" ? ACCENT.red :
          r.status === "charging" ? ACCENT.amber :
          r.status === "moving" ? ACCENT.emerald : ACCENT.cyan;

        if (sel === r.id) {
          ctx.beginPath();
          ctx.arc(px, py, cell * 1.5, 0, Math.PI * 2);
          ctx.strokeStyle = ACCENT.cyan;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, py, cell * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        const o = r.orientation || 0;
        ctx.strokeStyle = "#0a0e1a";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(-o) * cell, py + Math.sin(-o) * cell);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = "#e8edff";
        ctx.font = "700 10px Inter, sans-serif";
        ctx.fillText(r.id, px + cell * 0.9, py - cell * 0.6);

        ctx.fillStyle = "rgba(255,255,255,.15)";
        ctx.fillRect(px - cell, py + cell, cell * 2, 3);
        const pct = Math.max(0, Math.min(100, r.battery_level || 0)) / 100;
        ctx.fillStyle = pct > 0.5 ? ACCENT.emerald : pct > 0.2 ? ACCENT.amber : ACCENT.red;
        ctx.fillRect(px - cell, py + cell, cell * 2 * pct, 3);
      });
    };

    let raf;
    const loop = () => {
      drawGrid();
      drawRobots();
      raf = requestAnimationFrame(loop);
    };

    resize();
    loop();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const handleClick = (e) => {
    if (!stateRef.current.selectedRobot) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const gx = ((e.clientX - rect.left) / rect.width) * GRID;
    const gy = GRID - ((e.clientY - rect.top) / rect.height) * GRID; // invert Y
    onDispatch(gx, gy);
  };

  return (
    <div className="map-wrap">
      <canvas id="warehouse" ref={canvasRef} onClick={handleClick} />
    </div>
  );
}
