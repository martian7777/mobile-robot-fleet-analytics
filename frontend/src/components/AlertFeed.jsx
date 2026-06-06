import { useEffect, useRef, useState } from "react";

// Short WebAudio "beep" for critical alerts — independent of any <audio> tag.
function makeBeeper() {
  let ctx;
  return () => {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.33);
    } catch {
      /* autoplay blocked until first user interaction */
    }
  };
}

export default function AlertFeed({ alerts }) {
  const [muted, setMuted] = useState(false);
  const beep = useRef(makeBeeper()).current;
  const seenTop = useRef(null);

  // Beep when a new critical alert arrives at the head of the feed.
  useEffect(() => {
    const top = alerts[0];
    if (!top) return;
    const key = top.id ?? `${top.robot_id}-${top.timestamp}-${top.message}`;
    if (key !== seenTop.current) {
      if (seenTop.current !== null && top.severity === "critical" && !muted) {
        beep();
      }
      seenTop.current = key;
    }
  }, [alerts, muted, beep]);

  return (
    <section className="panel glass alerts-panel">
      <div className="panel-head">
        <h2>Live Alert Feed</h2>
        <label className="mute-toggle">
          <input
            type="checkbox"
            checked={muted}
            onChange={(e) => setMuted(e.target.checked)}
          />{" "}
          <span>🔔</span>
        </label>
      </div>
      <ul className="alert-feed">
        {alerts.map((a, i) => {
          const t = new Date(a.timestamp || Date.now());
          return (
            <li
              key={a.id ?? `${a.timestamp}-${i}`}
              className={`alert-item ${a.severity}`}
            >
              <span className="alert-sev">{a.severity}</span>
              <div className="alert-body">
                <div className="alert-msg" title={a.message}>
                  {a.message}
                </div>
                <div className="alert-meta">
                  {a.robot_id} · {a.code}
                </div>
              </div>
              <span className="alert-time">{t.toLocaleTimeString()}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
