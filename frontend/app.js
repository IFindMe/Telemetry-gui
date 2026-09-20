/* ═══════════════════════════════════════════════════════════
   ROCKET MISSION CONTROL — Frontend Controller
   3D Rocket (Three.js) · Telemetry Charts · Altitude · Horizon
   ═══════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

// ═══ STATE ═══
const history = {
  accelX: [], accelY: [], accelZ: [],
  gyroX: [], gyroY: [],
  altitude: [],
};
const MAX = 180;
let ws = null, lastPacket = performance.now(), packetsWindow = 0, lastRateTime = performance.now();
let metStart = null;
let androidActive = false;
let simPaused = false;
let replaying = false;
let replayPaused = false;
let activeSourceTab = 'serial';

// ═══ UTILITIES ═══
function log(msg, kind = '') {
  const d = document.createElement('div');
  d.className = kind;
  d.textContent = new Date().toLocaleTimeString() + '  ' + msg;
  $('log').prepend(d);
  while ($('log').children.length > 120) $('log').lastChild.remove();
}

function setStatus(online) {
  $('statusDot').classList.toggle('online', online);
  $('statusText').textContent = online ? 'ONLINE' : 'OFFLINE';
}

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!r.ok) throw Error(await r.text());
  return r.json();
}

function val(id, v, dec = 2) { $(id).textContent = Number(v).toFixed(dec); }

// ═══ PORT REFRESH ═══
async function refreshPorts() {
  const ports = await api('/api/ports');
  const old = $('port').value;
  $('port').innerHTML = ports.map(p => `<option value="${p.device}">${p.device} · ${p.description}</option>`).join('');
  if (old) $('port').value = old;
}

async function refreshStatus() {
  const s = await api('/api/status');
  setStatus(s.connected || s.simulating || s.android_imu || s.replaying);

  // Determine source label for port display
  let sourceLabel = '—';
  if (s.connected) sourceLabel = s.port;
  else if (s.simulating) sourceLabel = 'SIM';
  else if (s.android_imu) sourceLabel = 'PHYPOX';
  else if (s.replaying) sourceLabel = 'REPLAY';
  $('portLabel').textContent = sourceLabel;

  $('packets').textContent = s.connected ? s.packets : (s.sim_packets || 0);
  $('invalid').textContent = s.invalid || 0;
  $('connect').textContent = s.connected ? 'DISCONNECT' : 'CONNECT';
  $('recordBtn').classList.toggle('recording', s.recording);
  $('recordBtn').textContent = s.recording ? '■ STOP' : '● REC';

  // Sync simulation button state
  if (s.simulating !== simulating) {
    simulating = s.simulating;
    $('simBtn').textContent = simulating ? '■ STOP SIMULATION' : '▶ SIMULATE FLIGHT';
    $('simBtn').classList.toggle('active', simulating);
    $('simStatus').style.display = simulating ? 'flex' : 'none';
  }

  // Sim speed
  if (s.sim_speed !== undefined) {
    document.querySelectorAll('.sim-speed-btn').forEach(b => b.classList.toggle('active', parseFloat(b.dataset.speed) === s.sim_speed));
  }

  // Sim pause
  if (s.sim_paused !== undefined) {
    simPaused = s.sim_paused;
    $('simPause').textContent = simPaused ? '❚❚ RESUME' : '❚❚ PAUSE';
  }

  // Smooth level
  if (s.smooth_level !== undefined) {
    document.querySelectorAll('.smooth-btn').forEach(b => b.classList.toggle('active', b.dataset.level === s.smooth_level));
  }

  // Android IMU state
  if (s.android_imu !== undefined) {
    androidActive = s.android_imu;
    $('androidBtn').textContent = androidActive ? '■ DISCONNECT' : '📱 CONNECT';
    const statusEl = $('androidStatus');
    if (androidActive && !s.android_data) {
      statusEl.style.display = 'flex';
      statusEl.innerHTML = '<span class="sim-dot" style="background: #ffb800;"></span><span>Connected — no data. Check Phyphox experiment & remote access.</span>';
    } else if (androidActive && s.android_data) {
      statusEl.style.display = 'flex';
      statusEl.innerHTML = '<span class="sim-dot" style="background: #26de81;"></span><span>Android IMU active</span>';
    } else {
      statusEl.style.display = 'none';
    }
  }

  // Replay state
  if (s.replaying !== undefined) {
    replaying = s.replaying;
    $('replayBtn').textContent = replaying ? '■ STOP' : '▶ PLAY';
    $('replayProgress').value = s.replay_total ? (s.replay_position / s.replay_total) * 100 : 0;
    if (s.replay_file) {
      // Ensure the right log is selected
      const opt = $('logSelect').querySelector(`option[value="${s.replay_file}"]`);
      if (opt) $('logSelect').value = s.replay_file;
    }
  }

  // Update compact control status
  updateControlCompact(s);
}

// ═══ BUTTON HANDLERS ═══
$('refresh').onclick = () => refreshPorts().catch(e => log('Port scan: ' + e, 'warn'));

$('connect').onclick = async () => {
  try {
    if ($('connect').textContent === 'DISCONNECT') {
      await api('/api/disconnect', { method: 'POST' });
      log('Serial link closed');
    } else {
      await api('/api/connect', { method: 'POST', body: JSON.stringify({ port: $('port').value, baud: Number($('baud').value) }) });
      log('Serial link opened', 'good');
      metStart = performance.now();
    }
    await refreshStatus();
  } catch (e) { log('Connection: ' + e, 'warn'); }
};

$('recordBtn').onclick = async () => {
  try {
    const s = await api('/api/status');
    await api('/api/recording', { method: 'POST', body: JSON.stringify({ enabled: !s.recording }) });
    log(s.recording ? 'Recording stopped' : 'Recording started', s.recording ? '' : 'good');
    await refreshStatus();
  } catch (e) { log('Recording: ' + e, 'warn'); }
};

$('clearLog').onclick = () => $('log').replaceChildren();

// ═══ SOURCE TAB SWITCHING ═══
function switchSourceTab(name) {
  activeSourceTab = name;
  document.querySelectorAll('.source-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.source-content').forEach(c => c.classList.add('hidden'));
  const panel = $('tab-' + name);
  if (panel) panel.classList.remove('hidden');
  // Update badge
  const labels = { serial: 'SERIAL', sim: 'SIM', android: 'PHYPOX', replay: 'REPLAY' };
  $('sourceLabel').textContent = labels[name] || name;
}
document.querySelectorAll('.source-tab').forEach(tab => {
  tab.onclick = () => switchSourceTab(tab.dataset.tab);
});

// ═══ CONTROL PANEL EXPAND / COLLAPSE ═══
$('controlExpand').onclick = () => {
  const expanded = $('controlExpanded');
  const compact = $('controlCompact');
  const isHidden = expanded.classList.contains('hidden');
  if (isHidden) {
    compact.classList.add('hidden');
    expanded.classList.remove('hidden');
  } else {
    expanded.classList.add('hidden');
    compact.classList.remove('hidden');
  }
};

function updateControlCompact(status) {
  const compact = $('controlCompact');
  const statusText = $('controlStatusText');
  if (!compact || !statusText) return;

  if (status.connected) {
    statusText.textContent = status.port || 'Connected';
    compact.classList.add('connected');
  } else if (status.simulating) {
    statusText.textContent = 'Simulating ' + (status.sim_speed || 1) + 'x';
    compact.classList.add('connected');
  } else if (status.android_imu) {
    statusText.textContent = status.android_ip || 'Phyphox';
    compact.classList.add('connected');
  } else if (status.replaying) {
    statusText.textContent = 'Replaying';
    compact.classList.add('connected');
  } else {
    statusText.textContent = 'Disconnected';
    compact.classList.remove('connected');
  }
}

// ═══ ANDROID IMU ═══
$('androidBtn').onclick = async () => {
  try {
    const ip = $('androidIp').value;
    const port = $('androidPort').value;
    await api('/api/android-source', { method: 'POST', body: JSON.stringify({ enabled: !androidActive, ip, port }) });
    androidActive = !androidActive;
    $('androidBtn').textContent = androidActive ? '■ DISCONNECT' : '📱 CONNECT';
    if (androidActive) {
      log(`Phyphox connecting to ${ip}:${port}...`, 'good');
      log('Ensure: experiment running + Remote Access enabled in Phyphox', '');
    } else {
      log('Phyphox disconnected', 'warn');
    }
    $('androidStatus').style.display = androidActive ? 'flex' : 'none';
    await refreshStatus();
  } catch (e) { log('Android IMU: ' + e, 'warn'); }
};

// ═══ SIMULATION SPEED & PAUSE ═══
document.querySelectorAll('.sim-speed-btn').forEach(btn => {
  btn.onclick = async () => {
    try {
      await api('/api/sim-speed', { method: 'POST', body: JSON.stringify({ speed: parseFloat(btn.dataset.speed) }) });
      document.querySelectorAll('.sim-speed-btn').forEach(b => b.classList.toggle('active', b === btn));
      log('Sim speed → ' + btn.dataset.speed + 'x');
    } catch (e) { log('Sim speed: ' + e, 'warn'); }
  };
});
$('simPause').onclick = async () => {
  try {
    simPaused = !simPaused;
    await api('/api/sim-pause', { method: 'POST', body: JSON.stringify({ paused: simPaused }) });
    $('simPause').textContent = simPaused ? '❚❚ RESUME' : '❚❚ PAUSE';
    log(simPaused ? 'Simulation paused' : 'Simulation resumed', 'warn');
  } catch (e) { log('Sim pause: ' + e, 'warn'); }
};

// ═══ SMOOTH CONTROL ═══
document.querySelectorAll('.smooth-btn').forEach(btn => {
  btn.onclick = async () => {
    try {
      await api('/api/smooth', { method: 'POST', body: JSON.stringify({ level: btn.dataset.level }) });
      document.querySelectorAll('.smooth-btn').forEach(b => b.classList.toggle('active', b === btn));
      log('Smooth → ' + btn.dataset.level);
    } catch (e) { log('Smooth: ' + e, 'warn'); }
  };
});

// ═══ LOG REPLAY ═══
async function refreshLogs() {
  try {
    const data = await api('/api/logs');
    const sel = $('logSelect');
    sel.innerHTML = data.logs.length
      ? data.logs.map(l => `<option value="${l.filename}">${l.filename} (${l.samples} samples)</option>`).join('')
      : '<option value="">— no logs found —</option>';
  } catch (e) { log('Log refresh: ' + e, 'warn'); }
}
$('logRefresh').onclick = () => refreshLogs();

$('replayBtn').onclick = async () => {
  try {
    const file = $('logSelect').value;
    if (!file && !replaying) { log('Select a log file first', 'warn'); return; }
    const speed = parseFloat(document.querySelector('.replay-speed-btn.active')?.dataset.speed || 1);
    await api('/api/replay', { method: 'POST', body: JSON.stringify({ enabled: !replaying, log_file: file, speed }) });
    replaying = !replaying;
    $('replayBtn').textContent = replaying ? '■ STOP' : '▶ PLAY';
    log(replaying ? 'Replay started: ' + file : 'Replay stopped', replaying ? 'good' : 'warn');
    await refreshStatus();
  } catch (e) { log('Replay: ' + e, 'warn'); }
};

$('replayPause').onclick = async () => {
  try {
    replayPaused = !replayPaused;
    await api('/api/replay-pause', { method: 'POST', body: JSON.stringify({ paused: replayPaused }) });
    $('replayPause').textContent = replayPaused ? '❚❚ RESUME' : '❚❚ PAUSE';
    log(replayPaused ? 'Replay paused' : 'Replay resumed', 'warn');
  } catch (e) { log('Replay pause: ' + e, 'warn'); }
};

$('replayProgress').oninput = async (e) => {
  try {
    await api('/api/replay-seek', { method: 'POST', body: JSON.stringify({ fraction: e.target.value / 100 }) });
  } catch (e) { log('Replay seek: ' + e, 'warn'); }
};

document.querySelectorAll('.replay-speed-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.replay-speed-btn').forEach(b => b.classList.toggle('active', b === btn));
  };
});

// ═══ SIMULATION ═══
let simulating = false;

$('simBtn').onclick = async () => {
  try {
    simulating = !simulating;
    await api('/api/simulate', { method: 'POST', body: JSON.stringify({ enabled: simulating }) });
    $('simBtn').textContent = simulating ? '■ STOP SIMULATION' : '▶ SIMULATE FLIGHT';
    $('simBtn').classList.toggle('active', simulating);
    $('simStatus').style.display = simulating ? 'flex' : 'none';
    log(simulating ? 'Simulation started — full flight profile' : 'Simulation stopped', simulating ? 'good' : 'warn');
    await refreshStatus();
  } catch (e) { log('Simulation: ' + e, 'warn'); }
};

// ═══ TELEMETRY UPDATE ═══
function push(k, v) {
  history[k].push(v);
  if (history[k].length > MAX) history[k].shift();
}

function update(d) {
  // Push history
  ['accelX', 'accelY', 'accelZ', 'gyroX', 'gyroY'].forEach(k => push(k, d[k]));
  push('altitude', d.altitude || 0);

  // Use backend-computed derived values
  const alt = d.altitude || 0;
  const vel = d.velocity || 0;
  const gf = d.gforce || 1;

  // Update displays
  val('roll', d.gyroX);
  val('pitch', d.gyroY);
  val('yaw', d.gyroZ);
  val('imuTemp', d.imuTemp, 1);
  val('bmpTemp', d.bmpTemp, 1);
  val('pressure', d.bmpPressure, 1);
  val('altitude', alt, 0);
  val('velocity', vel, 1);
  val('gforce', gf, 2);

  // Raw data
  val('rawAccelX', d.accelX);
  val('rawAccelY', d.accelY);
  val('rawAccelZ', d.accelZ);
  val('rawGyroX', d.gyroX);
  val('rawGyroY', d.gyroY);
  val('rawGyroZ', d.gyroZ);

  // Update 3D rocket
  updateRocket(d.gyroX, d.gyroY, d.gyroZ);

  // Update artificial horizon
  updateHorizon(d.gyroY, d.gyroX);

  // Update altitude gauge
  updateAltGauge(alt);

  // Update flight phase from backend
  updateFlightPhaseDisplay(d.flight_phase || 'STANDBY');

  // Update MET clock
  updateMET();

  packetsWindow++;
  lastPacket = performance.now();
}

// ═══ THREE.JS — 3D ROCKET ═══
let scene, camera, renderer, rocketGroup, stars;
let targetRotX = 0, targetRotZ = 0;

function initRocket3D() {
  const container = $('rocket3d');
  const w = container.clientWidth;
  const h = container.clientHeight;

  // Scene
  scene = new THREE.Scene();

  // Camera
  camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000);
  camera.position.set(0, 2, 8);
  camera.lookAt(0, 0, 0);

  // Renderer
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  // Lights
  const ambientLight = new THREE.AmbientLight(0x334455, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(5, 8, 5);
  scene.add(dirLight);

  const rimLight = new THREE.DirectionalLight(0x00d4ff, 0.3);
  rimLight.position.set(-5, 0, -5);
  scene.add(rimLight);

  // Stars
  const starGeo = new THREE.BufferGeometry();
  const starPositions = new Float32Array(600 * 3);
  for (let i = 0; i < 600; i++) {
    starPositions[i * 3] = (Math.random() - 0.5) * 100;
    starPositions[i * 3 + 1] = (Math.random() - 0.5) * 100;
    starPositions[i * 3 + 2] = (Math.random() - 0.5) * 100;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.7 });
  stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // ── Build Rocket ──
  rocketGroup = new THREE.Group();

  // Body (cylinder)
  const bodyGeo = new THREE.CylinderGeometry(0.3, 0.35, 3.5, 16);
  const bodyMat = new THREE.MeshPhongMaterial({ color: 0xcccccc, specular: 0x444444, shininess: 60 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  rocketGroup.add(body);

  // Nose cone
  const noseGeo = new THREE.ConeGeometry(0.3, 1.2, 16);
  const noseMat = new THREE.MeshPhongMaterial({ color: 0xff4757, specular: 0x662222, shininess: 80 });
  const nose = new THREE.Mesh(noseGeo, noseMat);
  nose.position.y = 2.35;
  rocketGroup.add(nose);

  // Fins (4 fins)
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(0.5, 0);
  finShape.lineTo(0.15, 1.0);
  finShape.lineTo(0, 1.0);
  finShape.lineTo(0, 0);
  const finExtrudeSettings = { depth: 0.04, bevelEnabled: false };
  const finGeo = new THREE.ExtrudeGeometry(finShape, finExtrudeSettings);
  const finMat = new THREE.MeshPhongMaterial({ color: 0x4a6080, specular: 0x222222, shininess: 40 });

  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeo, finMat);
    const angle = (i / 4) * Math.PI * 2;
    fin.position.set(Math.cos(angle) * 0.32, -1.75, Math.sin(angle) * 0.32);
    fin.rotation.y = -angle;
    fin.scale.set(1, 0.6, 1);
    rocketGroup.add(fin);
  }

  // Engine nozzle
  const nozzleGeo = new THREE.CylinderGeometry(0.18, 0.25, 0.4, 12);
  const nozzleMat = new THREE.MeshPhongMaterial({ color: 0x333333, specular: 0x111111, shininess: 20 });
  const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
  nozzle.position.y = -1.95;
  rocketGroup.add(nozzle);

  // Engine glow
  const glowGeo = new THREE.ConeGeometry(0.15, 0.6, 8);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.5 });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.y = -2.35;
  glow.rotation.x = Math.PI;
  rocketGroup.add(glow);

  // Accent stripes
  const stripeGeo = new THREE.CylinderGeometry(0.305, 0.305, 0.08, 16);
  const stripeMat = new THREE.MeshPhongMaterial({ color: 0x00d4ff, emissive: 0x003344 });
  [0.5, 1.0].forEach(y => {
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.y = y;
    rocketGroup.add(stripe);
  });

  scene.add(rocketGroup);

  // Handle resize
  window.addEventListener('resize', () => {
    const w2 = container.clientWidth;
    const h2 = container.clientHeight;
    camera.aspect = w2 / h2;
    camera.updateProjectionMatrix();
    renderer.setSize(w2, h2);
  });
}

function updateRocket(gyroX, gyroY, gyroZ) {
  if (!rocketGroup) return;
  // Smooth rotation driven by telemetry
  // gyroX = roll rate → integrate to roll angle
  // gyroY = pitch rate → integrate to pitch angle
  targetRotX += gyroY * 0.001; // pitch
  targetRotZ += gyroX * 0.001; // roll

  // Clamp
  targetRotX = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, targetRotX));
  targetRotZ = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, targetRotZ));

  // Smooth interpolation
  rocketGroup.rotation.x += (targetRotX - rocketGroup.rotation.x) * 0.1;
  rocketGroup.rotation.z += (targetRotZ - rocketGroup.rotation.z) * 0.1;
  rocketGroup.rotation.y += gyroZ * 0.0005; // yaw

  // Stars drift
  if (stars) stars.rotation.y += 0.0001;
}

function renderRocket() {
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
  requestAnimationFrame(renderRocket);
}

// ═══ ARTIFICIAL HORIZON ═══
function updateHorizon(pitch, roll) {
  const sky = document.querySelector('.horizon-sky');
  const ground = document.querySelector('.horizon-ground');
  if (!sky || !ground) return;

  const pitchDeg = pitch; // degrees from gyro
  const rollDeg = roll;

  const offset = pitchDeg * 1.5; // scale factor
  sky.style.transform = `translateY(${-offset}px)`;
  ground.style.transform = `translateY(${-offset}px)`;

  const horizon = document.querySelector('.horizon-line');
  if (horizon) {
    horizon.style.transform = `translateY(${-offset}px) rotate(${-rollDeg * 0.5}deg)`;
  }

  const aircraft = document.querySelector('.aircraft');
  if (aircraft) {
    aircraft.style.transform = `translate(-50%, -50%) rotate(${-rollDeg * 0.5}deg)`;
  }
}

// ═══ ALTITUDE GAUGE ═══
function updateAltGauge(alt) {
  const maxAlt = Math.max(500, alt + 200); // dynamic range
  const pct = Math.min(Math.max(alt / maxAlt, 0), 1);
  const fillH = pct * 260;
  const pointerY = 280 - fillH; // pointer moves up as altitude increases

  const fill = $('altFill');
  const pointer = $('altPointer');
  const val = $('altGaugeVal');

  if (fill) {
    // Fill from bottom: keep y=280, grow height upward
    fill.setAttribute('y', 280 - fillH);
    fill.setAttribute('height', fillH);
  }
  if (pointer) {
    // Pointer on the right side, points left toward the track
    pointer.setAttribute('points', `68,${pointerY - 5} 74,${pointerY} 68,${pointerY + 5}`);
  }
  if (val) val.textContent = Math.round(alt) + ' m';
}

// ═══ FLIGHT PHASE ═══
function updateFlightPhaseDisplay(phase) {
  const phaseEl = $('flightPhase');
  const phaseText = $('phaseText');

  phaseText.textContent = phase;
  phaseEl.className = 'flight-phase';
  if (['ASCENT', 'LIFTOFF', 'RECOVERY'].includes(phase)) phaseEl.classList.add('nominal');
  else if (['IGNITION'].includes(phase)) phaseEl.classList.add('warning');
  else if (['DESCENT'].includes(phase)) phaseEl.classList.add('nominal');
  else if (['APOGEE'].includes(phase)) phaseEl.classList.add('nominal');

  // Update phase list
  const phaseOrder = { 'STANDBY': 0, 'PRE-FLIGHT': 0, 'IGNITION': 1, 'LIFTOFF': 2, 'ASCENT': 3, 'APOGEE': 4, 'DESCENT': 5, 'RECOVERY': 6 };
  const currentIdx = phaseOrder[phase] || 0;

  document.querySelectorAll('.phase-item').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i < currentIdx) el.classList.add('done');
    else if (i === currentIdx) el.classList.add('active');
  });
}

// ═══ MET CLOCK ═══
function updateMET() {
  if (!metStart) return;
  const elapsed = Math.floor((performance.now() - metStart) / 1000);
  const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  $('met').textContent = `T-${h}:${m}:${s}`;
}

// ═══ CHARTS ═══
function drawChart(canvasId, keys, colors) {
  const c = $(canvasId);
  if (!c) return;
  const ctx = c.getContext('2d');
  const rect = c.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  const w = rect.width;
  const h = rect.height;
  c.width = w * dpr;
  c.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = 'rgba(30,45,61,.5)';
  ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += 30) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // Baseline
  ctx.strokeStyle = 'rgba(139,163,199,.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  const all = keys.flatMap(k => history[k]);
  if (!all.length) return;
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.15;
  lo -= pad;
  hi += pad;

  keys.forEach((k, i) => {
    const a = history[k];
    ctx.strokeStyle = colors[i];
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    a.forEach((v, j) => {
      const x = j / (MAX - 1) * w;
      const y = h - (v - lo) / (hi - lo) * h;
      j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();

    // Glow
    ctx.strokeStyle = colors[i] + '40';
    ctx.lineWidth = 4;
    ctx.beginPath();
    a.forEach((v, j) => {
      const x = j / (MAX - 1) * w;
      const y = h - (v - lo) / (hi - lo) * h;
      j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  });
}

// ═══ SIGNAL BARS ═══
function updateSignal(rate) {
  const bars = ['sig1', 'sig2', 'sig3', 'sig4'];
  bars.forEach(id => $(id).className = 'signal-bar');
  if (rate > 1) $('sig1').classList.add('weak');
  if (rate > 10) $('sig2').classList.add('ok');
  if (rate > 30) $('sig3').classList.add('strong');
  if (rate > 50) $('sig4').classList.add('strong');
}

// ═══ PITCH LINES ═══
function initPitchLines() {
  const container = $('pitchLines');
  if (!container) return;
  [-30, -20, -10, 10, 20, 30].forEach(deg => {
    const line = document.createElement('div');
    line.className = 'pitch-line';
    line.setAttribute('data-deg', deg + '°');
    container.appendChild(line);
  });
}

// ═══ ANIMATION LOOP ═══
function frame() {
  drawChart('accelChart', ['accelX', 'accelY', 'accelZ'], ['#ff6b6b', '#00d4ff', '#26de81']);
  drawChart('gyroChart', ['gyroX', 'gyroY'], ['#a78bfa', '#ffb800']);
  drawChart('altChart', ['altitude'], ['#ffb800']);
  requestAnimationFrame(frame);
}

// ═══ RATE DISPLAY ═══
setInterval(() => {
  const now = performance.now();
  const rate = packetsWindow / Math.max((now - lastRateTime) / 1000, 0.001);
  $('packetRate').textContent = rate.toFixed(0);
  $('streamRate').innerHTML = rate.toFixed(0) + '<span class="unit">/s</span>';
  $('rateBar').style.width = Math.min(rate / 100 * 100, 100) + '%';
  updateSignal(rate);
  packetsWindow = 0;
  lastRateTime = now;
}, 1000);

// ═══ WEBSOCKET ═══
function connectWS() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = () => log('WebSocket connected', 'good');
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'history') m.data.forEach(update);
    else if (m.type === 'telemetry') update(m.data);
  };
  ws.onclose = () => { log('WebSocket disconnected', 'warn'); setTimeout(connectWS, 1500); };
}

// ═══ INIT ═══
initPitchLines();
initRocket3D();
renderRocket();
refreshPorts().then(refreshStatus).then(refreshLogs).catch(e => log('Init: ' + e, 'warn'));
connectWS();
frame();
