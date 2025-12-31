const API = "https://moovtk.onrender.com";
let token = "";

async function login(){
  const r = await fetch(API+"/admin/login",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      email:email.value,
      password:password.value
    })
  });
  const j = await r.json();
  if(j.token){
    token = j.token;
    login.style.display="none";
    app.style.display="block";
    loadTrips();
    startStream();
  } else msg.innerText = j.error;
}

async function createDriver(){
  await fetch(API+"/admin/drivers",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization":"Bearer "+token
    },
    body:JSON.stringify({
      cpf:cpf.value,
      name:name.value,
      plate:plate.value,
      phone:phone.value,
      password:pass.value
    })
  });
}

async function loadTrips(){
  const r = await fetch(API+"/admin/trips?status=active",{
    headers:{Authorization:"Bearer "+token}
  });
  const j = await r.json();
  trips.innerHTML = "<tr><th>Motorista</th><th>Placa</th></tr>";
  j.trips.forEach(t=>{
    trips.innerHTML+=`<tr><td>${t.driver_name}</td><td>${t.plate}</td></tr>`;
  });
}

function startStream(){
  const ev = new EventSource(API+"/admin/stream?token="+token);
  ev.onmessage = e => {
    const d = JSON.parse(e.data);
    if(d.live[0]){
      map.src=`https://maps.google.com/maps?q=${d.live[0].lat},${d.live[0].lng}&z=10&output=embed`;
    }
  }
}
