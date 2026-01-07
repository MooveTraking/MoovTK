const API = "https://moovtk.onrender.com";

console.log("APP LOADED");

const fCpf = () => document.getElementById("fCpf");
const fName = () => document.getElementById("fName");
const fPlate = () => document.getElementById("fPlate");
const fPass = () => document.getElementById("fPass");


let token = localStorage.getItem("admin_token") || "";
let map = null;
let markers = {};

window.addEventListener("load", () => {
  window.emailEl = document.getElementById("email");
  window.passEl = document.getElementById("password");
  window.btnLogin = document.getElementById("btnLogin");
  window.msgEl = document.getElementById("msg");

  window.loginDiv = document.getElementById("login");
  window.panelDiv = document.getElementById("panel");
  window.btnLogout = document.getElementById("btnLogout");

  window.btnCreate = document.getElementById("btnCreate");
  window.msgCreate = document.getElementById("msgCreate");

  window.driversEl = document.getElementById("drivers");
  window.vehiclesEl = document.getElementById("vehicles");

  window.countEl = document.getElementById("count");
  window.clockEl = document.getElementById("clock");

  btnLogin.addEventListener("click", doLogin);
  btnLogout.addEventListener("click", doLogout);
  btnCreate.addEventListener("click", createDriver);

  if (token) {
    showPanel();
  } else {
    showLogin();
  }

  map = L.map("map").setView([-27.6, -48.5], 7);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);
});

function showLogin() {
  loginDiv.style.display = "block";
  panelDiv.style.display = "none";
}

function showPanel() {
  loginDiv.style.display = "none";
  panelDiv.style.display = "block";

  loadDrivers();
  startStream();
}

async function doLogin() {
  msgEl.innerText = "";

  const email = (emailEl.value || "").trim();
  const password = (passEl.value || "").trim();

  if (!email || !password) {
    msgEl.innerText = "Informe email e senha.";
    return;
  }

  try {
    const r = await fetch(API + "/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await r.json();

    if (!r.ok) {
      msgEl.innerText = data.error || "Erro no login.";
      return;
    }

    token = data.token;
    localStorage.setItem("admin_token", token);

    showPanel();
  } catch (e) {
    msgEl.innerText = "Falha de rede.";
  }
}

function doLogout() {
  token = "";
  localStorage.removeItem("admin_token");
  showLogin();
}

async function createDriver() {
  msgCreate.innerText = "";

  const cpf = (fCpf().value || "").trim();
  const name = (fName().value || "").trim();
  const plate = (fPlate().value || "").trim();
  const password = (fPass().value || "").trim();

  if (!cpf || !name || !plate || !password) {
    msgCreate.innerText = "Preencha CPF, nome, placa e senha.";
    return;
  }

  try {
    const r = await fetch(API + "/admin/drivers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify({ cpf, name, plate, password })
    });

    const data = await r.json();

    if (!r.ok) {
      msgCreate.innerText = data.error || "Erro ao cadastrar.";
      return;
    }

    fCpf().value = "";
    fName().value = "";
    fPlate().value = "";
    fPass().value = "";

    msgCreate.innerText = "Motorista cadastrado.";
    loadDrivers();
  } catch (e) {
    msgCreate.innerText = "Falha de rede.";
  }
}

async function loadDrivers() {
  try {
    const r = await fetch(API + "/admin/drivers", {
      headers: { "Authorization": "Bearer " + token }
    });
    const data = await r.json();

    driversEl.innerHTML = "";
    (data.drivers || []).forEach(d => {
      const div = document.createElement("div");
      div.className = "driver";
      div.innerHTML = `<b>${d.name}</b><br>${d.cpf}<br>${d.plate}`;
      driversEl.appendChild(div);
    });
  } catch (e) {}
}

function startStream() {
  const ev = new EventSource(API + "/admin/stream?token=" + encodeURIComponent(token));

  ev.addEventListener("live", (e) => {
    const data = JSON.parse(e.data);

    vehiclesEl.innerHTML = "";
    countEl.innerText = data.live.len;

    (data.live.rows || []).forEach(v => {
      const item = document.createElement("div");
      item.className = "vehicle";
      item.innerHTML = `<b>${v.plate}</b><br>${v.name}<br>${new Date(v.ts).toLocaleString()}`;
      vehiclesEl.appendChild(item);

      const key = v.plate;
      const latlng = [v.lat, v.lng];

      if (!markers[key]) {
        markers[key] = L.marker(latlng).addTo(map).bindPopup(key);
      } else {
        markers[key].setLatLng(latlng);
      }
    });

    clockEl.innerText = new Date(data.ts).toLocaleTimeString();
  });
}
