const API = "https://moovtk.onrender.com";

const el = (id) => document.getElementById(id);

const STORAGE = {
  driverToken: "moove_driver_token",
  driverInfo: "moove_driver_info",
  tripId: "moove_trip_id",
  queue: "moove_queue_positions"
};

let watchId = null;
let sentCount = 0;

function nowTs() {
  return Date.now();
}

function setMsg(text, isError=false) {
  const msg = el("tk-msg");
  msg.innerText = text || "";
  msg.classList.toggle("tk-msg-error", !!isError);
}

function setLoginMsg(text, isError=false) {
  const msg = el("tk-login-msg");
  msg.innerText = text || "";
  msg.classList.toggle("tk-msg-error", !!isError);
}

function getToken() {
  return localStorage.getItem(STORAGE.driverToken) || "";
}

function setToken(t) {
  localStorage.setItem(STORAGE.driverToken, t);
}

function clearToken() {
  localStorage.removeItem(STORAGE.driverToken);
}

function setDriverInfo(info) {
  localStorage.setItem(STORAGE.driverInfo, JSON.stringify(info || {}));
}

function getDriverInfo() {
  try { return JSON.parse(localStorage.getItem(STORAGE.driverInfo) || "{}"); } catch { return {}; }
}

function setTripId(id) {
  localStorage.setItem(STORAGE.tripId, id || "");
}

function getTripId() {
  return localStorage.getItem(STORAGE.tripId) || "";
}

function clearTripId() {
  localStorage.removeItem(STORAGE.tripId);
}

function getQueue() {
  try { return JSON.parse(localStorage.getItem(STORAGE.queue) || "[]"); } catch { return []; }
}

function setQueue(arr) {
  localStorage.setItem(STORAGE.queue, JSON.stringify(arr || []));
}

function pushQueue(item) {
  const q = getQueue();
  q.push(item);
  setQueue(q);
}

function shiftQueue() {
  const q = getQueue();
  const item = q.shift();
  setQueue(q);
  return item;
}

function updateCounters() {
  el("tk-sent").innerText = String(sentCount);
  el("tk-pending").innerText = String(getQueue().length);
}

function formatCpf(cpf) {
  return (cpf || "").trim();
}

async function apiPost(path, body, token) {
  const r = await fetch(API + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "Authorization": "Bearer " + token } : {})
    },
    body: JSON.stringify(body || {})
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data && data.error ? data.error : ("Erro HTTP " + r.status);
    throw new Error(msg);
  }
  return data;
}

function showPanel() {
  el("tk-login").style.display = "none";
  el("tk-panel").style.display = "block";

  const info = getDriverInfo();
  el("tk-name").innerText = info.name || "—";
  el("tk-cpf-view").innerText = info.cpf || "—";
  el("tk-plate").innerText = info.plate || "—";

  const tripId = getTripId();
  if (tripId) {
    el("tk-trip").innerText = tripId;
    el("tk-state").innerText = "Em rota";
    el("tk-btn-start").disabled = true;
    el("tk-btn-stop").disabled = false;
  } else {
    el("tk-trip").innerText = "—";
    el("tk-state").innerText = "Parado";
    el("tk-btn-start").disabled = false;
    el("tk-btn-stop").disabled = true;
  }

  updateCounters();
}

function showLogin() {
  el("tk-login").style.display = "block";
  el("tk-panel").style.display = "none";
}

async function doLogin() {
  setLoginMsg("");
  const cpf = formatCpf(el("tk-cpf").value);
  const pass = (el("tk-pass").value || "").trim();
  if (!cpf || !pass) return setLoginMsg("CPF e senha obrigatórios.", true);

  try {
    const data = await apiPost("/driver/login", { identifier: cpf, password: pass }, "");
    setToken(data.token);
    setDriverInfo({ ...data.driver });
    setLoginMsg("OK. Entrando...");
    showPanel();
    setTimeout(() => setLoginMsg(""), 800);
  } catch (e) {
    setLoginMsg(e.message || "Falha no login.", true);
  }
}

async function startTrip() {
  setMsg("");
  try {
    const token = getToken();
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");

    // VERIFICA SE JÁ TEM VIAGEM ATIVA DESTE MOTORISTA
    const checkRes = await fetch(API + "/driver/active-trip", {
      headers: { Authorization: "Bearer " + token }
    }).catch(() => null);
    
    if (checkRes && checkRes.ok) {
      const checkData = await checkRes.json();
      if (checkData.active && checkData.trip_id) {
        const confirmar = confirm("ATENÇÃO: Você já tem uma viagem em andamento. Deseja finalizá-la antes de iniciar nova?");
        if (confirmar) {
          await finishTrip();
        } else {
          setMsg("Operação cancelada. Finalize a viagem atual primeiro.", true);
          return;
        }
      }
    }

    // INICIA NOVA VIAGEM
    const data = await apiPost("/trip/start", {}, token);
    setTripId(data.trip_id);
    el("tk-trip").innerText = data.trip_id;
    el("tk-state").innerText = "Em rota";
    el("tk-btn-start").disabled = true;
    el("tk-btn-stop").disabled = false;

    startWatching();
    setMsg("Viagem iniciada. GPS ativo.");
  } catch (e) {
    setMsg(e.message || "Erro ao iniciar viagem.", true);
  }
}

async function finishTrip() {
  setMsg("");
  try {
    const token = getToken();
    const tripId = getTripId();
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");
    if (!tripId) throw new Error("Nenhuma viagem ativa.");

    await flushQueue();
    await apiPost("/trip/finish", { trip_id: tripId }, token);

    stopWatching();
    clearTripId();

    el("tk-trip").innerText = "—";
    el("tk-state").innerText = "Parado";
    el("tk-btn-start").disabled = false;
    el("tk-btn-stop").disabled = true;

    setMsg("Viagem finalizada.");
  } catch (e) {
    setMsg(e.message || "Erro ao finalizar viagem.", true);
  }
}

function stopWatching() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

function startWatching() {
  if (!("geolocation" in navigator)) {
    setMsg("GPS não disponível neste dispositivo.", true);
    return;
  }

  if (watchId !== null) return;

  watchId = navigator.geolocation.watchPosition(
    (pos) => onGeo(pos),
    (err) => {
      setMsg("Erro de GPS: " + (err && err.message ? err.message : "sem detalhes"), true);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 15000,
      timeout: 20000
    }
  );
}

function kmhFromMps(mps) {
  if (typeof mps !== "number") return null;
  return mps * 3.6;
}

function onGeo(pos) {
  const tripId = getTripId();
  if (!tripId) return;

  const c = pos.coords || {};
  const payload = {
    trip_id: tripId,
    ts: nowTs(),
    lat: c.latitude,
    lng: c.longitude,
    speed: typeof c.speed === "number" ? kmhFromMps(c.speed) : null,
    heading: typeof c.heading === "number" ? c.heading : null,
    accuracy: typeof c.accuracy === "number" ? c.accuracy : null
  };

  el("tk-last").innerText = "Último GPS: " + new Date(payload.ts).toLocaleString();
  el("tk-acc").innerText = payload.accuracy ? (Math.round(payload.accuracy) + " m") : "—";
  el("tk-speed").innerText = payload.speed ? (payload.speed.toFixed(1) + " km/h") : "—";

  if (!navigator.onLine) {
    pushQueue(payload);
    updateCounters();
    return;
  }

  sendPosition(payload);
}

async function sendPosition(payload) {
  try {
    const token = getToken();
    await apiPost("/position", payload, token);
    sentCount++;
    updateCounters();
  } catch (e) {
    pushQueue(payload);
    updateCounters();
  }
}

async function flushQueue() {
  if (!navigator.onLine) return;
  const token = getToken();
  if (!token) return;

  let attempts = 0;
  while (getQueue().length > 0 && attempts < 500) {
    attempts++;
    const item = shiftQueue();
    try {
      await apiPost("/position", item, token);
      sentCount++;
    } catch (e) {
      const q = getQueue();
      q.unshift(item);
      setQueue(q);
      break;
    }
  }
  updateCounters();
}

function doLogout() {
  stopWatching();
  clearTripId();
  setQueue([]);
  sentCount = 0;
  clearToken();
  setDriverInfo({});
  setMsg("");
  setLoginMsg("");
  showLogin();
}

window.addEventListener("online", () => {
  flushQueue();
});

window.addEventListener("load", () => {
  el("tk-btn-login").addEventListener("click", doLogin);
  el("tk-btn-start").addEventListener("click", startTrip);
  el("tk-btn-stop").addEventListener("click", finishTrip);
  el("tk-btn-logout").addEventListener("click", doLogout);

  el("tk-pass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });

  const token = getToken();
  if (token) {
    showPanel();
    const tripId = getTripId();
    if (tripId) startWatching();
  } else {
    showLogin();
  }

  flushQueue();
});
