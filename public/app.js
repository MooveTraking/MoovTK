const API = "https://moovtk.onrender.com";

const fCpf = () => document.getElementById("fCpf");
const fName = () => document.getElementById("fName");
const fPlate = () => document.getElementById("fPlate");
const fPass = () => document.getElementById("fPass");


let token = "";
let map = null;
let markers = {};

window.addEventListener("load", () => {
  window.emailEl = document.getElementById("email");
  window.passwordEl = document.getElementById("password");
  window.msgEl = document.getElementById("msg");
  window.loginEl = document.getElementById("login");
  window.panelEl = document.getElementById("panel");
  window.vehiclesEl = document.getElementById("vehicles");
  window.countEl = document.getElementById("count");
  window.clockEl = document.getElementById("clock");
});

async function login() {
  try {
    msgEl.innerText = "Conectando…";

    const res = await fetch(API + "/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: emailEl.value,
        password: passwordEl.value
      })
    });

    const data = await res.json();

    if (!res.ok) {
      msgEl.innerText = data.error || "Falha no login";
      return;
    }

    token = data.token;

    loginEl.style.display = "none";
    panelEl.style.display = "grid";

    initMap();
    startStream();

  } catch (e) {
    msgEl.innerText = "Erro: " + e.message;
  }
}

function initMap() {
  map = L.map("map").setView([-27.6, -48.5], 7);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);
}

function startStream() {
  const ev = new EventSource(API + "/admin/stream?token=" + encodeURIComponent(token));

  ev.addEventListener("live", (e) => {
    const data = JSON.parse(e.data);

    vehiclesEl.innerHTML = "";
    countEl.innerText = data.live.length;

    data.live.forEach(v => {
      const div = document.createElement("div");
      div.className = "vehicle";
      div.innerHTML = `<b>${v.plate}</b><br><small>${v.driver_name}</small>`;
      vehiclesEl.appendChild(div);

      if (v.lat && v.lng) {
        if (!markers[v.trip_id]) {
          markers[v.trip_id] = L.marker([v.lat, v.lng]).addTo(map);
        } else {
          markers[v.trip_id].setLatLng([v.lat, v.lng]);
        }
      }
    });
  });

  ev.onerror = () => {
    msgEl.innerText = "Erro na conexão em tempo real.";
  };
}

setInterval(() => {
  if (clockEl) clockEl.innerText = new Date().toLocaleTimeString();
}, 1000);


document.getElementById("btnAdd").onclick = () => {
  const f = document.getElementById("driverForm");
  f.style.display = f.style.display === "none" ? "block" : "none";
};

document.getElementById("btnSaveDriver").addEventListener("click", createDriver);

async function createDriver() {
  try {
    const cpf = fCpf().value.trim();
    const name = fName().value.trim();
    const plate = fPlate().value.trim();
    const password = fPass().value.trim();

    if (!cpf || !name || !plate || !password) {
      alert("Preencha todos os campos");
      return;
    }

    const res = await fetch(API + "/admin/create-driver", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify({ cpf, name, plate, password })
    });

    const j = await res.json();

    if (!res.ok) {
      alert(j.error || "Erro ao criar motorista");
      return;
    }

    alert("Motorista criado com sucesso");

    fCpf().value = "";
    fName().value = "";
    fPlate().value = "";
    fPass().value = "";
  } catch (e) {
    alert("Falha: " + e.message);
  }
}
