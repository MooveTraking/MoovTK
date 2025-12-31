const API = "https://moovtk.onrender.com";
let token = "";
let map;
let markers = {};

function login(){
  fetch(API+"/admin/login",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({email:email.value,password:password.value})
  }).then(r=>r.json()).then(j=>{
    if(j.token){
      token=j.token;
      login.style.display="none";
      panel.style.display="grid";
      initMap();
      startStream();
    } else msg.innerText=j.error;
  });
}

function initMap(){
  map = L.map("map").setView([-27.6,-48.5],7);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
}

function startStream(){
  const ev = new EventSource(API+"/admin/stream?token="+token);
  ev.onmessage = e=>{
    const data = JSON.parse(e.data);
    vehicles.innerHTML="";
    count.innerText=data.live.length;

    data.live.forEach(v=>{
      vehicles.innerHTML+=`<div class="vehicle">${v.plate}<br><small>${v.driver_name}</small></div>`;
      if(v.lat){
        if(!markers[v.trip_id]){
          markers[v.trip_id]=L.marker([v.lat,v.lng]).addTo(map);
        } else {
          markers[v.trip_id].setLatLng([v.lat,v.lng]);
        }
      }
    });
  };
}

setInterval(()=>clock.innerText=new Date().toLocaleTimeString(),1000);
