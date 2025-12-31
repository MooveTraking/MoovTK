const API = "https://moovtk.onrender.com";

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


document.getElementById("btnAdd").onclick = ()=>{
  const f = document.getElementById("driverForm");
  f.style.display = f.style.display=="none"?"block":"none";
};

async function createDriver(){
  const cpf = document.getElementById("fCpf").value;
  const name = document.getElementById("fName").value;
  const plate = document.getElementById("fPlate").value;
  const password = document.getElementById("fPass").value;

  const res = await fetch(API+"/admin/create-driver",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization":"Bearer "+token
    },
    body:JSON.stringify({cpf,name,plate,password})
  });

  const j = await res.json();
  alert(j.success?"Motorista criado":"Erro: "+j.error);
}

