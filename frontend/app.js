const $=id=>document.getElementById(id);
const history={accelX:[],accelY:[],accelZ:[],gyroX:[],gyroY:[],gyroZ:[],imuTemp:[],bmpTemp:[],bmpPressure:[]};
const max=180;
let ws=null,lastPacket=performance.now(),packetsWindow=0,lastRateTime=performance.now();

function log(msg,kind=""){const d=document.createElement("div");d.className=kind;d.textContent=new Date().toLocaleTimeString()+"  "+msg;$("log").prepend(d);while($("log").children.length>100)$("log").lastChild.remove()}
function setStatus(online){$("statusDot").classList.toggle("online",online);$("statusText").textContent=online?"CONNECTED":"DISCONNECTED"}
async function api(url,opts={}){const r=await fetch(url,{headers:{"Content-Type":"application/json"},...opts});if(!r.ok)throw Error(await r.text());return r.json()}
async function refreshPorts(){const ports=await api("/api/ports");const old=$("port").value;$("port").innerHTML=ports.map(p=>`<option value="${p.device}">${p.device} · ${p.description}</option>`).join("");if(old)$("port").value=old}
async function refreshStatus(){const s=await api("/api/status");setStatus(s.connected);$("portLabel").textContent=s.port||"—";$("packets").textContent=s.packets;$("invalid").textContent=s.invalid;$("connect").textContent=s.connected?"Disconnect":"Connect";$("recordBtn").classList.toggle("recording",s.recording);$("recordBtn").textContent=s.recording?"■ Recording":"● Record"}

$("refresh").onclick=()=>refreshPorts().catch(e=>log("Port scan failed: "+e,"warn"));
$("connect").onclick=async()=>{try{if($("connect").textContent==="Disconnect"){await api("/api/disconnect",{method:"POST"});log("Serial link closed")}else{await api("/api/connect",{method:"POST",body:JSON.stringify({port:$("port").value,baud:Number($("baud").value)})});log("Serial link opened","good")}await refreshStatus()}catch(e){log("Connection error: "+e,"warn")}};
$("recordBtn").onclick=async()=>{try{const s=await api("/api/status");await api("/api/recording",{method:"POST",body:JSON.stringify({enabled:!s.recording})});log(s.recording?"Recording stopped":"Recording started",s.recording?"":"good");await refreshStatus()}catch(e){log("Recording error: "+e,"warn")}};
$("clearLog").onclick=()=>$("log").replaceChildren();

function push(k,v){history[k].push(v);if(history[k].length>max)history[k].shift()}
function value(id,v,dec=2){$(id).textContent=Number(v).toFixed(dec)}
function update(d){
  ["accelX","accelY","accelZ","gyroX","gyroY","gyroZ","imuTemp","bmpTemp","bmpPressure"].forEach(k=>push(k,d[k]));
  value("imuTemp",d.imuTemp);value("bmpTemp",d.bmpTemp);value("pressure",d.bmpPressure);value("roll",d.gyroX);value("pitch",d.gyroY);
  packetsWindow++;lastPacket=performance.now();
}
function drawChart(canvas,keys){
  const c=$(canvas),ctx=c.getContext("2d"),rect=c.getBoundingClientRect(),dpr=devicePixelRatio||1,w=rect.width,h=rect.height;
  c.width=w*dpr;c.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
  ctx.strokeStyle="rgba(120,150,165,.13)";ctx.lineWidth=1;
  for(let x=0;x<w;x+=55){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}
  for(let y=0;y<h;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
  const all=keys.flatMap(k=>history[k]);if(!all.length)return;let lo=Math.min(...all),hi=Math.max(...all);if(hi===lo){hi+=1;lo-=1}const pad=(hi-lo)*.12;lo-=pad;hi+=pad;
  [["#42d9e8",keys[0]],["#b995ff",keys[1]],["#62e69b",keys[2]]].forEach(([color,k])=>{const a=history[k];ctx.strokeStyle=color;ctx.lineWidth=1.7;ctx.beginPath();a.forEach((v,i)=>{const x=i/(max-1)*w,y=h-(v-lo)/(hi-lo)*h;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke()})
}
function frame(){drawChart("accelChart",["accelX","accelY","accelZ"]);drawChart("gyroChart",["gyroX","gyroY","gyroZ"]);requestAnimationFrame(frame)}
setInterval(()=>{const now=performance.now();const rate=packetsWindow/Math.max((now-lastRateTime)/1000,0.001);$("packetRate").textContent=rate.toFixed(0);$("streamRate").textContent=rate.toFixed(0);$("rateBar").style.width=Math.min(rate/100*100,100)+"%";packetsWindow=0;lastRateTime=now},1000);

function connectWS(){ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host+"/ws");ws.onopen=()=>log("WebSocket telemetry channel ready","good");ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==="history")m.data.forEach(update);else if(m.type==="telemetry")update(m.data)};ws.onclose=()=>{log("WebSocket disconnected","warn");setTimeout(connectWS,1500)}}
window.addEventListener("resize",()=>{});
refreshPorts().then(refreshStatus).catch(e=>log("Dashboard initialization failed: "+e,"warn"));connectWS();frame();
