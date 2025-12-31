const API = window.MOOVE_API;
const lsKey = "moove_admin_token";

const elEmail = document.getElementById("email");
const elPass = document.getElementById("password");
const elMsg = document.getElementById("loginMsg");

const elDName = document.getElementById("dname");
const elDCpf = document.getElementById("dcpf");
const elDPhone = document.getElementById("dphone");
const elDPlate = document.getElementById("dplate");
const elDPass = document.getElementById("dpass");
const elCreateMsg = document.getElementById("createMsg");
const tbody = document.getElementById("driversTbody");

function token() { return localStorage.getItem(lsKey) || ""; }

async function api(path, opts={}) {
  const headers = Object.assign({ "Content-Type":"application/json" }, opts.headers || {});
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const r = await fetch(`${API}${path}`, { ...opts, headers });
  const j = await r.json().catch(()=> ({}));
  if (!r.ok) throw new Error(j.error || "Erro");
  return j;
}

async function loadDrivers() {
  tbody.innerHTML = "";
  try {
    const r = await api("/admin/drivers");
    for (const d of r.drivers) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${d.id}</td>
        <td>${d.name}</td>
        <td>${d.cpf}</td>
        <td>${d.phone}</td>
        <td><b>${d.plate}</b></td>
        <td>${d.is_active ? "Sim" : "Não"}</td>
      `;
      tbody.appendChild(tr);
    }
  } catch (e) {}
}

document.getElementById("btnLogin").onclick = async () => {
  elMsg.textContent = "Entrando...";
  try {
    const r = await fetch(`${API}/admin/login`, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ email: elEmail.value.trim(), password: elPass.value })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Falha no login");
    localStorage.setItem(lsKey, j.token);
    elMsg.textContent = "OK. Token salvo.";
    await loadDrivers();
  } catch (e) {
    elMsg.textContent = e.message;
  }
};

document.getElementById("btnCreate").onclick = async () => {
  elCreateMsg.textContent = "Criando...";
  try {
    const payload = {
      name: elDName.value.trim(),
      cpf: elDCpf.value.trim(),
      phone: elDPhone.value.trim(),
      plate: elDPlate.value.trim(),
      password: elDPass.value
    };
    const r = await api("/admin/drivers", { method:"POST", body: JSON.stringify(payload) });
    elCreateMsg.textContent = `Criado: ${r.driver.name} (${r.driver.plate})`;
    await loadDrivers();
  } catch (e) {
    elCreateMsg.textContent = e.message;
  }
};

loadDrivers();
