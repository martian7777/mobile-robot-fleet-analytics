/* =========================================================================
   Fleet Analytics Dashboard — frontend controller
   - WebSocket live telemetry + alerts
   - Canvas warehouse grid rendering
   - Chart.js battery + KPI sparklines
   - E-Stop / dispatch control dispatch
   ========================================================================= */
"use strict";

const GRID = 40;
const MAP_FEATURES = {
  docks:    [[2, 2], [2, 8], [2, 14]],
  picks:    [[34, 6], [34, 14], [34, 22], [34, 30], [34, 36]],
  drops:    [[8, 34], [16, 34], [24, 34], [32, 34]],
  obstacles:[[20, 20], [21, 20], [20, 21], [12, 25], [28, 12]],
};
const ACCENT = {
  cyan: "#22d3ee", violet: "#a78bfa", emerald: "#34d399",
  amber: "#fbbf24", rose: "#fb7185", red: "#ef4444",
};

// ----- runtime state -------------------------------------------------------
const robots = new Map();        // id -> latest robot snapshot
let selectedRobot = null;
let ws = null;
let reconnectTimer = null;
const sparkData = { availability: [], cycle: [], distance: [], alerts: [] };

// ====================== WebSocket ==========================================
function wsURL() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws/dashboard`;
}

function connect() {
  setConn("connecting", "Connecting…");
  ws = new WebSocket(wsURL());

  ws.onopen = () => setConn("connected", "Live");
  ws.onclose = () => {
    setConn("disconnected", "Reconnecting…");
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2500);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleMessage(msg);
  };
}

function setConn(state, label) {
  const pill = document.getElementById("connStatus");
  pill.dataset.state = state;
  document.getElementById("connLabel").textContent = label;
}

function handleMessage(msg) {
  switch (msg.type) {
    case "snapshot":
      msg.data.robots.forEach((r) => robots.set(r.id, r));
      applyMetrics(msg.data.metrics);
      renderRobotCards();
      break;
    case "telemetry": {
      const d = msg.data;
      const existing = robots.get(d.robot_id) || { id: d.robot_id, model: "" };
      robots.set(d.robot_id, {
        ...existing,
        pos_x: d.pos_x, pos_y: d.pos_y, speed: d.speed,
        battery_level: d.battery_level, orientation: d.orientation,
        current_task: d.active_task, status: d.status,
        total_distance: d.distance_traveled,
      });
      updateRobotCard(d.robot_id);
      break;
    }
    case "alert":
      pushAlert(msg.data);
      break;
    case "command":
      // optimistic reflect handled server-side; nothing to do
      break;
  }
}

// ====================== KPIs + sparklines ==================================
function applyMetrics(m) {
  setText("kpiAvailability", m.fleet_availability);
  setText("kpiCycle", m.avg_cycle_time);
  setText("kpiDistance", formatNum(m.total_distance));
  setText("kpiAlerts", m.active_alerts);

  setText("kpiAvailabilityTrend",
    `${m.active_robots} moving · ${m.charging_robots} charging · ${m.estopped_robots} stopped`);
  setText("kpiCycleTrend", `${m.tasks_completed} done · ${m.task_success_rate}% success`);
  setText("kpiDistanceTrend", `avg battery ${m.avg_battery}%`);
  setText("kpiAlertsTrend", `${m.critical_alerts} critical · last 10 min`);

  pushSpark("availability", m.fleet_availability);
  pushSpark("cycle", m.avg_cycle_time);
  pushSpark("distance", m.total_distance);
  pushSpark("alerts", m.active_alerts);
}

function pushSpark(key, value) {
  const arr = sparkData[key];
  arr.push(value);
  if (arr.length > 30) arr.shift();
  if (sparkCharts[key]) {
    sparkCharts[key].data.labels = arr.map((_, i) => i);
    sparkCharts[key].data.datasets[0].data = arr;
    sparkCharts[key].update("none");
  }
}

// poll metrics every few seconds (cheap aggregate REST call)
async function pollMetrics() {
  try {
    const r = await fetch("/api/fleet/metrics");
    if (r.ok) applyMetrics(await r.json());
  } catch { /* offline; ws snapshot still drives cards */ }
}

// ====================== Robot cards =======================================
function renderRobotCards() {
  const wrap = document.getElementById("robotCards");
  wrap.innerHTML = "";
  [...robots.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .forEach((r) => wrap.appendChild(buildCard(r)));
}

function buildCard(r) {
  const card = document.createElement("div");
  card.className = "robot-card";
  card.id = `card-${r.id}`;
  card.dataset.id = r.id;
  card.onclick = (e) => {
    if (e.target.closest(".rc-btn")) return;
    selectRobot(r.id);
  };
  card.innerHTML = cardInner(r);
  decorateCard(card, r);
  return card;
}

function cardInner(r) {
  return `
    <div class="rc-head">
      <div>
        <div class="rc-name">${r.id}</div>
        <div class="rc-model">${r.model || ""}</div>
      </div>
      <span class="rc-status st-${r.status}">${r.status}</span>
    </div>
    <div class="rc-task" title="${r.current_task || ""}">${r.current_task || "—"}</div>
    <div class="rc-batt-row">
      <div class="batt-track"><div class="batt-fill"></div></div>
      <span class="rc-batt-val"></span>
    </div>
    <div class="rc-speed"><span>Speed</span><b>${(r.speed || 0).toFixed(2)} m/s</b></div>
    <div class="rc-actions">
      <button class="rc-btn stop" data-act="estop">E-STOP</button>
      <button class="rc-btn" data-act="resume">RESUME</button>
    </div>`;
}

function decorateCard(card, r) {
  const fill = card.querySelector(".batt-fill");
  const val = card.querySelector(".rc-batt-val");
  const pct = Math.max(0, Math.min(100, r.battery_level || 0));
  fill.style.width = pct + "%";
  fill.style.background = pct > 50 ? ACCENT.emerald : pct > 20 ? ACCENT.amber : ACCENT.red;
  val.textContent = pct.toFixed(0) + "%";

  card.classList.toggle("estopped", r.status === "estopped");
  card.classList.toggle("selected", selectedRobot === r.id);

  card.querySelectorAll(".rc-btn").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const act = btn.dataset.act;
      sendCommand({ command: act, robot_id: r.id });
    };
  });
}

function updateRobotCard(id) {
  const r = robots.get(id);
  if (!r) return;
  let card = document.getElementById(`card-${id}`);
  if (!card) { renderRobotCards(); return; }

  card.querySelector(".rc-status").className = `rc-status st-${r.status}`;
  card.querySelector(".rc-status").textContent = r.status;
  card.querySelector(".rc-task").textContent = r.current_task || "—";
  card.querySelector(".rc-task").title = r.current_task || "";
  card.querySelector(".rc-speed b").textContent = `${(r.speed || 0).toFixed(2)} m/s`;
  decorateCard(card, r);
}

function selectRobot(id) {
  selectedRobot = selectedRobot === id ? null : id;
  document.querySelectorAll(".robot-card").forEach((c) =>
    c.classList.toggle("selected", c.dataset.id === selectedRobot));
  document.getElementById("dispatchHint").textContent =
    selectedRobot ? `► ${selectedRobot} selected — click the grid to dispatch` : "";
}

// ====================== Alerts feed =======================================
function pushAlert(a) {
  const feed = document.getElementById("alertFeed");
  const li = document.createElement("li");
  li.className = `alert-item ${a.severity}`;
  const t = new Date(a.timestamp || Date.now());
  li.innerHTML = `
    <span class="alert-sev">${a.severity}</span>
    <div class="alert-body">
      <div class="alert-msg" title="${a.message}">${a.message}</div>
      <div class="alert-meta">${a.robot_id} · ${a.code}</div>
    </div>
    <span class="alert-time">${t.toLocaleTimeString()}</span>`;
  feed.prepend(li);
  while (feed.children.length > 40) feed.lastChild.remove();

  if (a.severity === "critical") playAlertSound();
}

function playAlertSound() {
  if (document.getElementById("muteToggle").checked) return;
  // WebAudio beep (independent of bundled <audio>).
  try {
    const ctx = playAlertSound._ctx || (playAlertSound._ctx = new (window.AudioContext || window.webkitAudioContext)());
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square"; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.33);
  } catch { /* autoplay blocked until user interacts */ }
}

// ====================== Controls ==========================================
async function sendCommand(payload) {
  try {
    await fetch("/api/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) { console.warn("command failed", e); }
}

function wireControls() {
  document.getElementById("estopAll").onclick = () => {
    flashScreen();
    sendCommand({ command: "estop_all" });
  };
  document.getElementById("resumeAll").onclick = () => sendCommand({ command: "resume_all" });
}

function flashScreen() {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;inset:0;background:rgba(239,68,68,.25);z-index:9999;pointer-events:none;animation:fadeOut .6s ease forwards";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 600);
}
// inject fadeOut keyframes once
const styleEl = document.createElement("style");
styleEl.textContent = "@keyframes fadeOut{from{opacity:1}to{opacity:0}}";
document.head.appendChild(styleEl);

// ====================== Canvas warehouse ==================================
let canvas, ctx, cell;

function setupCanvas() {
  canvas = document.getElementById("warehouse");
  ctx = canvas.getContext("2d");
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  canvas.addEventListener("click", (e) => {
    if (!selectedRobot) return;
    const rect = canvas.getBoundingClientRect();
    const gx = ((e.clientX - rect.left) / rect.width) * GRID;
    const gy = GRID - ((e.clientY - rect.top) / rect.height) * GRID; // invert Y
    sendCommand({
      command: "dispatch", robot_id: selectedRobot,
      target_x: +gx.toFixed(1), target_y: +gy.toFixed(1),
      target_station: `Manual (${gx.toFixed(0)},${gy.toFixed(0)})`,
    });
  });
}

function resizeCanvas() {
  const size = canvas.clientWidth;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cell = size / GRID;
}

// world (x,y meters, y-up) -> canvas px (y-down)
function toPx(x, y) {
  return [x * cell, (GRID - y) * cell];
}

function drawGrid() {
  const size = canvas.clientWidth;
  ctx.clearRect(0, 0, size, size);

  // subtle grid lines
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(120,150,220,0.06)";
  for (let i = 0; i <= GRID; i += 2) {
    const p = i * cell;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }

  drawZones(MAP_FEATURES.docks, ACCENT.emerald, "DOCK", true);
  drawZones(MAP_FEATURES.picks, ACCENT.cyan, "PICK", true);
  drawZones(MAP_FEATURES.drops, ACCENT.violet, "DROP", true);
  drawObstacles(MAP_FEATURES.obstacles);
}

function drawZones(list, color, label, square) {
  ctx.font = "600 9px JetBrains Mono, monospace";
  list.forEach(([x, y]) => {
    const [px, py] = toPx(x, y);
    const s = cell * 1.6;
    ctx.save();
    ctx.fillStyle = color + "22";
    ctx.strokeStyle = color + "aa";
    ctx.lineWidth = 1.4;
    ctx.shadowColor = color; ctx.shadowBlur = 8;
    if (square) {
      ctx.fillRect(px - s / 2, py - s / 2, s, s);
      ctx.strokeRect(px - s / 2, py - s / 2, s, s);
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.fillText(label, px - s / 2 + 2, py - s / 2 - 3);
    ctx.restore();
  });
}

function drawObstacles(list) {
  list.forEach(([x, y]) => {
    const [px, py] = toPx(x, y);
    ctx.save();
    ctx.fillStyle = ACCENT.rose + "33";
    ctx.strokeStyle = ACCENT.rose;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(px, py, cell * 0.9, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // hazard slashes
    ctx.strokeStyle = ACCENT.rose + "aa";
    ctx.beginPath();
    ctx.moveTo(px - cell * 0.5, py - cell * 0.5);
    ctx.lineTo(px + cell * 0.5, py + cell * 0.5);
    ctx.stroke();
    ctx.restore();
  });
}

function drawRobots() {
  robots.forEach((r) => {
    if (r.pos_x == null) return;
    const [px, py] = toPx(r.pos_x, r.pos_y);
    const color =
      r.status === "estopped" ? ACCENT.red :
      r.status === "charging" ? ACCENT.amber :
      r.status === "moving"   ? ACCENT.emerald : ACCENT.cyan;

    // selection halo
    if (selectedRobot === r.id) {
      ctx.beginPath();
      ctx.arc(px, py, cell * 1.5, 0, Math.PI * 2);
      ctx.strokeStyle = ACCENT.cyan;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // body
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, cell * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // heading indicator
    const o = r.orientation || 0;
    ctx.strokeStyle = "#0a0e1a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(-o) * cell, py + Math.sin(-o) * cell);
    ctx.stroke();
    ctx.restore();

    // label
    ctx.fillStyle = "#e8edff";
    ctx.font = "700 10px Inter, sans-serif";
    ctx.fillText(r.id, px + cell * 0.9, py - cell * 0.6);
    // battery micro-bar
    ctx.fillStyle = "rgba(255,255,255,.15)";
    ctx.fillRect(px - cell, py + cell, cell * 2, 3);
    const pct = Math.max(0, Math.min(100, r.battery_level || 0)) / 100;
    ctx.fillStyle = pct > 0.5 ? ACCENT.emerald : pct > 0.2 ? ACCENT.amber : ACCENT.red;
    ctx.fillRect(px - cell, py + cell, cell * 2 * pct, 3);
  });
}

function renderLoop() {
  drawGrid();
  drawRobots();
  requestAnimationFrame(renderLoop);
}

// ====================== Charts ============================================
let batteryChart;
const sparkCharts = {};

function sparkConfig(color) {
  return {
    type: "line",
    data: { labels: [], datasets: [{
      data: [], borderColor: color, borderWidth: 2,
      fill: true, backgroundColor: color + "22",
      tension: 0.4, pointRadius: 0,
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
      animation: false,
    },
  };
}

function setupCharts() {
  sparkCharts.availability = new Chart(byId("sparkAvailability"), sparkConfig(ACCENT.cyan));
  sparkCharts.cycle = new Chart(byId("sparkCycle"), sparkConfig(ACCENT.violet));
  sparkCharts.distance = new Chart(byId("sparkDistance"), sparkConfig(ACCENT.emerald));
  sparkCharts.alerts = new Chart(byId("sparkAlerts"), sparkConfig(ACCENT.amber));

  batteryChart = new Chart(byId("batteryChart"), {
    type: "bar",
    data: { labels: [], datasets: [{
      label: "Battery %", data: [], borderRadius: 6,
      backgroundColor: [],
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, max: 100, grid: { color: "rgba(120,150,220,.08)" },
             ticks: { color: "#8a96b8" } },
        x: { grid: { display: false }, ticks: { color: "#8a96b8" } },
      },
      animation: { duration: 400 },
    },
  });
}

function updateBatteryChart() {
  if (!batteryChart) return;
  const list = [...robots.values()].sort((a, b) => a.id.localeCompare(b.id));
  batteryChart.data.labels = list.map((r) => r.id);
  batteryChart.data.datasets[0].data = list.map((r) => Math.round(r.battery_level || 0));
  batteryChart.data.datasets[0].backgroundColor = list.map((r) => {
    const p = r.battery_level || 0;
    return p > 50 ? ACCENT.emerald : p > 20 ? ACCENT.amber : ACCENT.red;
  });
  batteryChart.update("none");
}

// ====================== Helpers ===========================================
function byId(id) { return document.getElementById(id); }
function setText(id, v) { const el = byId(id); if (el) el.textContent = v; }
function formatNum(n) { return n >= 1000 ? (n / 1000).toFixed(1) + "k" : Math.round(n); }

function tickClock() {
  byId("clock").textContent = new Date().toLocaleTimeString();
}

// ====================== Boot ==============================================
window.addEventListener("DOMContentLoaded", () => {
  setupCanvas();
  setupCharts();
  wireControls();
  connect();
  renderLoop();

  tickClock(); setInterval(tickClock, 1000);
  setInterval(pollMetrics, 4000);
  setInterval(updateBatteryChart, 1500);
  pollMetrics();

  byId("backendMode").textContent = "v1.0 · live";
});
