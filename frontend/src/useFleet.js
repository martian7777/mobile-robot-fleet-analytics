import { useCallback, useEffect, useRef, useState } from "react";

/* =========================================================================
   useFleet — owns the live fleet state for the dashboard.

   - Opens the /ws/dashboard WebSocket, applies snapshot/telemetry/alert frames.
   - Auto-reconnects with a fixed backoff.
   - Polls /api/fleet/metrics on an interval as a cheap aggregate refresh.
   - Exposes sendCommand() for the control endpoints (E-Stop / dispatch).

   Returns plain React state so components re-render on change:
     { robots, metrics, alerts, conn, sendCommand }
   ========================================================================= */

const MAX_ALERTS = 40;

function wsURL() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws/dashboard`;
}

export function useFleet() {
  // robots kept as a Map in a ref (fast keyed updates), mirrored to state array.
  const robotsRef = useRef(new Map());
  const [robots, setRobots] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [conn, setConn] = useState({ state: "connecting", label: "Connecting…" });

  const wsRef = useRef(null);
  const reconnectRef = useRef(null);

  const flushRobots = useCallback(() => {
    setRobots(
      [...robotsRef.current.values()].sort((a, b) => a.id.localeCompare(b.id))
    );
  }, []);

  const handleMessage = useCallback(
    (msg) => {
      switch (msg.type) {
        case "snapshot": {
          msg.data.robots.forEach((r) => robotsRef.current.set(r.id, r));
          setMetrics(msg.data.metrics);
          flushRobots();
          break;
        }
        case "telemetry": {
          const d = msg.data;
          const existing =
            robotsRef.current.get(d.robot_id) || { id: d.robot_id, model: "" };
          robotsRef.current.set(d.robot_id, {
            ...existing,
            pos_x: d.pos_x,
            pos_y: d.pos_y,
            speed: d.speed,
            battery_level: d.battery_level,
            orientation: d.orientation,
            current_task: d.active_task,
            status: d.status,
            total_distance: d.distance_traveled,
          });
          flushRobots();
          break;
        }
        case "alert": {
          const a = msg.data;
          setAlerts((prev) => [a, ...prev].slice(0, MAX_ALERTS));
          break;
        }
        case "command":
        case "task":
        default:
          break;
      }
    },
    [flushRobots]
  );

  // ---- WebSocket lifecycle (open once, auto-reconnect) --------------------
  useEffect(() => {
    let closedByUnmount = false;

    const connect = () => {
      setConn({ state: "connecting", label: "Connecting…" });
      const ws = new WebSocket(wsURL());
      wsRef.current = ws;

      ws.onopen = () => setConn({ state: "connected", label: "Live" });
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        handleMessage(msg);
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (closedByUnmount) return;
        setConn({ state: "disconnected", label: "Reconnecting…" });
        clearTimeout(reconnectRef.current);
        reconnectRef.current = setTimeout(connect, 2500);
      };
    };

    connect();
    return () => {
      closedByUnmount = true;
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [handleMessage]);

  // ---- Metrics polling (cheap aggregate REST refresh) --------------------
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/fleet/metrics");
        if (r.ok && alive) setMetrics(await r.json());
      } catch {
        /* offline; ws snapshot still drives the cards */
      }
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const sendCommand = useCallback(async (payload) => {
    try {
      await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.warn("command failed", e);
    }
  }, []);

  return { robots, metrics, alerts, conn, sendCommand };
}
