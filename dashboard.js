const API = window.MOOVE_API;

const tbody = document.getElementById("tripsTbody");
const elDays = document.getElementById("days");
const elReload = document.getElementById("btnReload");
const wsStatus = document.getElementById("wsStatus");

const kStarted = document.getElementById("k_started");
const kPaused = document.getElementById("k_paused");
const kStale = document.getElementById("k_stale");

const STALE_MIN = 10;

const map = L.map("map").setView([-14.2350, -51.9253], 4);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

const markersByTrip = new Map();
let trips = [];

function fmt(ts){
  if(!ts) return "-";
  const d = new Date(ts);
  return d.toLocaleString("pt-BR");
}

function pill(status){
  const cls = status === "started" ? "started" : status === "paused" ? "paused" : "finished";
  const text = status === "started" ? "Iniciada" : status === "paused" ? "Pausada" : "Finalizada";
  return `<span class="pill ${cls}">${text}</span>`;
}

function isStale(lastSeen){
  if(!lastSeen) return true;
  const ms = Date.now() - new Date(lastSeen).getTime();
  return ms > STALE_MIN * 60 * 1000;
}

function render(){
  tbody.innerHTML = "";
  let started=0, paused=0, stale=0;

  for(const t of trips){
    if (t.status === "started") started++;
    if (t.status === "paused") paused++;
    if (t.status !== "finished" && isStale(t.last_seen_at)) stale++;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${pill(t.status)}</td>
      <td><b>${t.plate}</b></td>
      <td>${t.driver_name}</td>
      <td>${fmt(t.started_at)}</td>
      <td>${fmt(t.last_seen_at)}</td>
      <td>${t.last_speed == null ? "-" : Math.round(t.last_speed)}</td>
    `;
    tr.onclick = () => {
      if (t.last_lat && t.last_lng) map.setView([t.last_lat, t.last_lng], 13);
      const m = markersByTrip.get(t.id);
      if (m) m.openPopup();
    };
    tbody.appendChild(tr);

    // mapa
    if (t.last_lat && t.last_lng && t.status !== "finished") {
      const pos = [t.last_lat, t.last_lng];
      let m = markersByTrip.get(t.id);
      const popup = `
        <div style="min-width:220px">
          <b>${t.plate}</b><br/>
          ${t.driver_name}<br/>
          Status: ${t.status}<br/>
          Último: ${fmt(t.last_seen_at)}<br/>
          Vel: ${t.last_speed==null?'-':Math.round(t.last_speed)} km/h
        </div>
      `;

      if (!m) {
        m = L.marker(pos).addTo(map);
        m.bindPopup(popup);
        markersByTrip.set(t.id, m);
      } else {
        m.setLatLng(pos);
        m.setPopupContent(popup);
      }
    }
  }

  kStarted.textContent = String(started);
  kPaused.textContent = String(paused);
  kStale.textContent = String(stale);
}

async function load(){
  const days = Number(elDays.value || 30);
  const r = await fetch(`${API}/dashboard/trips?days=${days}`);
  const j = await r.json();
  trips = j.trips || [];
  render();
}

function upsertFromWs(p){
  // p: {trip_id, plate, status, lat, lng, speed, last_seen_at}
  const idx = trips.findIndex(x => x.id === p.trip_id);
  if (idx >= 0) {
    const t = trips[idx];
    t.plate = p.plate ?? t.plate;
    t.status = p.status ?? t.status;
    t.last_lat = p.lat ?? t.last_lat;
    t.last_lng = p.lng ?? t.last_lng;
    t.last_speed = p.speed ?? t.last_speed;
    t.last_seen_at = p.last_seen_at ?? t.last_seen_at;
  } else {
    // sem driver_name aqui, então só ignora até reload (ou você pode buscar completo depois)
  }
  render();
}

function connectWs(){
  const wsUrl = API.replace("https://","wss://").replace("http://","ws://");
  const ws = new WebSocket(wsUrl);
  wsStatus.textContent = "WS: conectando...";

  ws.onopen = () => wsStatus.textContent = "WS: online";
  ws.onclose = () => {
    wsStatus.textContent = "WS: offline";
    setTimeout(connectWs, 3000);
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.event === "position") upsertFromWs(msg.payload);
      if (msg.event === "trip_started" || msg.event === "trip_paused" || msg.event === "trip_finished") load();
    } catch {}
  };
}

elReload.onclick = load;
elDays.onchange = load;

load();
connectWs();
