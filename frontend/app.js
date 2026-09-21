/* ═══════════════════════════════════════════════════════════
   ROCKET MISSION CONTROL — Frontend Controller
   3D Rocket (Three.js) · Telemetry Charts · Altitude · Horizon
   ═══════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

// S5: tiny element cache — update() runs per packet, skip repeated DOM lookups.
// Static page: IDs never appear late, so caching null is safe.
const elCache = {};
function el(id) {
  if (!(id in elCache)) elCache[id] = $(id) || null;
  return elCache[id];
}

// ═══ STATE ═══
const history = {
  accelX: [], accelY: [], accelZ: [],
  gyroX: [], gyroY: [], gyroZ: [],
  altitude: [], velocity: [],
};
const MAX = 180;
let ws = null, lastPacket = performance.now(), packetsWindow = 0, lastRateTime = performance.now();
let metStartMcu = null;   // first MCU timestamp received
let lastMcuTime = 0;       // last MCU timestamp (for duplicate detection)
let frozen = false;         // true when no data for >2s
let freezeTimeout = null;
let androidActive = false;
let simPaused = false;
const phaseReached = {};
let replaying = false;
let replayPaused = false;
let activeSourceTab = 'serial';
let simulating = false;   // S4: declared with state (was :318) — refreshStatus() reads it
let chartsDirty = true;     // S5: set by update(), consumed by frame() — no new data, no redraw
let lastPhaseShown = null;  // S5: skip phase DOM churn when phase unchanged
let lastMetSecond = -1;     // S5: MET text updates 1×/s, not per packet

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

function val(id, v, dec = 2) {
  const e = el(id);
  if (!e) return;   // S4: one missing element must not abort the packet's render
  const s = Number(v).toFixed(dec);
  if (e.textContent !== s) e.textContent = s;   // S5: skip redundant writes
}

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
    // Update replay time display
    const rPos = s.replay_position || 0;
    const rTot = s.replay_total || 0;
    const fmt = n => { const m = Math.floor(n / 60); const sec = Math.floor(n % 60); return m + ':' + String(sec).padStart(2, '0'); };
    $('replayTime').textContent = fmt(rPos) + ' / ' + fmt(rTot);
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
  // Animate: hide current, show new
  document.querySelectorAll('.source-content').forEach(c => {
    if (!c.classList.contains('hidden')) {
      c.style.opacity = '0';
      c.style.transform = 'translateY(-6px)';
      setTimeout(() => {
        c.classList.add('hidden');
        c.style.opacity = '';
        c.style.transform = '';
      }, 150);
    }
  });
  setTimeout(() => {
    const panel = $('tab-' + name);
    if (panel) {
      panel.classList.remove('hidden');
      panel.style.opacity = '0';
      panel.style.transform = 'translateY(6px)';
      requestAnimationFrame(() => {
        panel.style.transition = 'opacity .2s, transform .2s';
        panel.style.opacity = '1';
        panel.style.transform = 'translateY(0)';
        setTimeout(() => { panel.style.transition = ''; }, 200);
      });
    }
  }, 160);
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
// (S4: `let simulating` lives in STATE above — declare-before-use for refreshStatus)
$('simBtn').onclick = async () => {
  try {
    simulating = !simulating;
    await api('/api/simulate', { method: 'POST', body: JSON.stringify({ enabled: simulating }) });
    $('simBtn').textContent = simulating ? '■ STOP SIMULATION' : '▶ SIMULATE FLIGHT';
    $('simBtn').classList.toggle('active', simulating);
    $('simStatus').style.display = simulating ? 'flex' : 'none';
    log(simulating ? 'Simulation started — full flight profile' : 'Simulation stopped', simulating ? 'good' : 'warn');
    if (simulating) {
      Object.keys(phaseReached).forEach(k => delete phaseReached[k]);
      ['phasePre', 'phaseIgn', 'phaseLife', 'phaseAsc', 'phaseApo', 'phaseDes', 'phaseRec'].forEach(id => { const el = $(id); if (el) el.textContent = '—'; });
    }
    await refreshStatus();
  } catch (e) { log('Simulation: ' + e, 'warn'); }
};

// ═══ TELEMETRY UPDATE ═══
function push(k, v) {
  if (!history[k]) return;
  history[k].push(v);
  if (history[k].length > MAX) history[k].shift();
}

function update(d) {
  // ── Duplicate / freeze logic ──
  if (d.time === lastMcuTime) return;   // same packet, skip
  lastMcuTime = d.time;
  frozen = false;
  const fo = el('freezeOverlay');   // S5: cached + conditional — was 2 uncached lookups/packet
  if (fo && !fo.classList.contains('hidden')) fo.classList.add('hidden');
  clearTimeout(freezeTimeout);
  freezeTimeout = setTimeout(() => {
    frozen = true;
    const fo2 = el('freezeOverlay');
    if (fo2) fo2.classList.remove('hidden');
  }, 2000);

  // ── MET clock — MCU time ──
  if (metStartMcu === null) metStartMcu = d.time;

  // Push history
  ['accelX', 'accelY', 'accelZ', 'gyroX', 'gyroY', 'gyroZ'].forEach(k => push(k, d[k]));
  push('altitude', d.altitude || 0);
  push('velocity', d.velocity || 0);

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
  val('rawLat', d.latitude, 6);
  val('rawLon', d.longitude, 6);
  val('rawGpsAlt', d.altitude, 2);
  val('rawGndSpeed', d.groundSpeed, 2);

  // Update 3D rocket
  updateRocket(d);

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
  chartsDirty = true;   // S5: charts redraw on new data only (consumed by frame())
}

// ═══ THREE.JS — 3D ROCKET ═══
let scene, camera, renderer, rocketGroup, stars;
let exhaustFlame, exhaustGlow;
let rocketState = {
  altitude: 0, velocity: 0, phase: 'PRE-FLIGHT',
  tiltX: 0, tiltZ: 0, yaw: 0,
  targetTiltX: 0, targetTiltZ: 0, targetYaw: 0,
  turbX: 0, turbZ: 0,
  prevAlt: 0, prevTime: 0,
  maxAlt: 500, // will be updated from telemetry
};

function initRocket3D() {
  const container = $('rocket3d');
  const w = container.clientWidth;
  const h = container.clientHeight;

  // Scene
  scene = new THREE.Scene();

  // Camera — fixed ground spectator, far enough to see full vertical trajectory
  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 500);
  camera.position.set(0, 3, 30);
  camera.lookAt(0, 8, 0);

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
  rocketGroup.scale.setScalar(1.2);

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

  // ── Ground plane ──
  const groundGeo = new THREE.PlaneGeometry(80, 80);
  const groundMat = new THREE.MeshPhongMaterial({ color: 0x1a2a1a, transparent: true, opacity: 0.5 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.3;
  scene.add(ground);

  // Handle resize
  window.addEventListener('resize', () => {
    const w2 = container.clientWidth;
    const h2 = container.clientHeight;
    camera.aspect = w2 / h2;
    camera.updateProjectionMatrix();
    renderer.setSize(w2, h2);
  });
}

function updateRocket(d) {
  if (!rocketGroup) return;

  const alt = d.altitude || 0;
  const vel = d.velocity || 0;
  const phase = d.flight_phase || 'PRE-FLIGHT';
  const ax = d.accelX || 0;
  const ay = d.accelY || 0;
  const gz = d.gyroZ || 0;
  const now = performance.now() / 1000;
  const S = rocketState;

  // Track max altitude for scaling
  if (alt > S.maxAlt) S.maxAlt = Math.max(alt, 100);

  // ── Vertical position ──
  const altNorm = Math.min(alt / S.maxAlt, 1.0);
  const targetY = altNorm * 10;
  rocketGroup.position.y += (targetY - rocketGroup.position.y) * 0.15;

  // ── Shrink as it goes up (gentle) ──
  const scale = 1.0 - altNorm * 0.2;
  rocketGroup.scale.setScalar(Math.max(scale, 0.55));

  // ── Camera tilt (subtle, keeps rocket in frame) ──
  const lookY = 5 + altNorm * 10;
  camera.lookAt(0, lookY, 0);

  // ── Exhaust ──
  const exhaust = rocketGroup.children.find(c =>
    c.material && c.material.color && c.material.color.getHex() === 0xff6600
  );
  if (exhaust) {
    const thrusting = (phase === 'IGNITION' || phase === 'LIFTOFF' || phase === 'ASCENT');
    exhaust.material.opacity = thrusting ? 0.4 + Math.random() * 0.3 : 0.05;
    exhaust.scale.y = thrusting ? 0.8 + Math.random() * 0.6 : 0.15;
  }

  // ── Phase-based orientation ──
  switch (phase) {
    case 'PRE-FLIGHT':
      S.targetTiltX = Math.sin(now * 0.3) * 0.02;
      S.targetTiltZ = Math.cos(now * 0.2) * 0.02;
      S.targetYaw = 0;
      break;

    case 'IGNITION':
      S.targetTiltX = Math.sin(now * 15) * 0.03;
      S.targetTiltZ = Math.cos(now * 12) * 0.03;
      S.targetYaw = 0;
      break;

    case 'LIFTOFF':
      S.targetTiltX = Math.sin(now * 20) * 0.04 + ax * 0.05;
      S.targetTiltZ = Math.cos(now * 18) * 0.04 + ay * 0.05;
      S.targetYaw += gz * 0.0003;
      break;

    case 'ASCENT':
      S.turbX += (ax * 0.08 - S.turbX) * 0.1;
      S.turbZ += (ay * 0.08 - S.turbZ) * 0.1;
      S.targetTiltX = S.turbX + Math.sin(now * 0.5) * 0.05;
      S.targetTiltZ = S.turbZ + Math.cos(now * 0.4) * 0.05;
      S.targetYaw += gz * 0.0004;
      S.targetTiltX += altNorm * 0.15;
      break;

    case 'APOGEE': {
      const apoProgress = Math.min(Math.abs(vel) / 20, 1.0);
      S.targetTiltX = 0.3 + apoProgress * 0.8;
      S.targetTiltZ = Math.sin(now * 0.8) * 0.2;
      S.targetYaw += gz * 0.001 + 0.01;
      break;
    }

    case 'DESCENT': {
      const descendSpeed = Math.min(Math.abs(vel) / 30, 1.0);
      S.targetTiltX = 1.2 + Math.sin(now * 0.6) * 0.4;
      S.targetTiltZ = Math.cos(now * 0.5) * 0.5 * descendSpeed;
      S.targetYaw += 0.02 + descendSpeed * 0.03;
      if (altNorm < 0.1) {
        S.targetTiltX *= 0.3;
        S.targetTiltZ *= 0.3;
      }
      break;
    }

    case 'RECOVERY':
      S.targetTiltX *= 0.85;
      S.targetTiltZ *= 0.85;
      S.targetYaw *= 0.9;
      break;
  }

  // ── Smooth interpolation ──
  S.tiltX += (S.targetTiltX - S.tiltX) * 0.08;
  S.tiltZ += (S.targetTiltZ - S.tiltZ) * 0.08;
  S.yaw += (S.targetYaw - S.yaw) * 0.08;

  rocketGroup.rotation.x = S.tiltX;
  rocketGroup.rotation.z = S.tiltZ;
  rocketGroup.rotation.y = S.yaw;

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

  const fill = el('altFill');
  const pointer = el('altPointer');
  const val = el('altGaugeVal');

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
  // Record timestamp when each phase is first reached (once per phase — always runs)
  const timeMap = { 'PRE-FLIGHT': 'phasePre', 'IGNITION': 'phaseIgn', 'LIFTOFF': 'phaseLife', 'ASCENT': 'phaseAsc', 'APOGEE': 'phaseApo', 'DESCENT': 'phaseDes', 'RECOVERY': 'phaseRec' };
  const id = timeMap[phase];
  let firstReach = false;
  if (id && !phaseReached[id]) {
    phaseReached[id] = true;
    firstReach = true;
    const el = $(id);
    if (el) {
      const now = new Date();
      el.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    }
  }
  // S5: phase pill/list DOM only changes on phase transition — skip per-packet churn
  if (phase === lastPhaseShown && !firstReach) return;
  lastPhaseShown = phase;

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

// ═══ MET CLOCK (MCU time) ═══
function updateMET() {
  if (metStartMcu === null) return;
  const metSeconds = Math.max(0, lastMcuTime - metStartMcu);
  const whole = Math.floor(metSeconds);
  if (whole === lastMetSecond) return;   // S5: text changes 1×/s, not per packet
  lastMetSecond = whole;
  const h = String(Math.floor(metSeconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((metSeconds % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(metSeconds % 60)).padStart(2, '0');
  const metEl = el('met');
  if (metEl) metEl.textContent = `T-${h}:${m}:${s}`;
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

  const all = keys.filter(k => history[k]).flatMap(k => history[k]);
  if (!all.length) return;
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.15;
  lo -= pad;
  hi += pad;

  keys.forEach((k, i) => {
    const a = history[k];
    if (!a || !a.length) return;
    ctx.strokeStyle = colors[i];
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    a.forEach((v, j) => {
      const x = (j + MAX - a.length) / (MAX - 1) * w;   // S5: right-align short buffer (full buffer: identical to before)
      const y = h - (v - lo) / (hi - lo) * h;
      j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();

    // Glow
    ctx.strokeStyle = colors[i] + '40';
    ctx.lineWidth = 4;
    ctx.beginPath();
    a.forEach((v, j) => {
      const x = (j + MAX - a.length) / (MAX - 1) * w;   // S5: right-align short buffer (full buffer: identical to before)
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
// S5: redraw charts only when new data arrived (chartsDirty set by update()).
// Previously: full clear + 2 polyline passes × 3 charts every rAF regardless.
function frame() {
  if (chartsDirty) {
    chartsDirty = false;
    drawChart('accelChart', ['accelX', 'accelY', 'accelZ'], ['#ff6b6b', '#00d4ff', '#26de81']);
    drawChart('gyroChart', ['gyroX', 'gyroY', 'gyroZ'], ['#a78bfa', '#ffb800', '#2dd4bf']);
    drawChart('altChart', ['altitude'], ['#ffb800']);
  }
  requestAnimationFrame(frame);
}
window.addEventListener('resize', () => { chartsDirty = true; });   // S5: re-render grid on resize even with no data

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
    if (m.type === 'history') {
      // S5: backend keeps 1200 but charts hold MAX — replay only the tail so a
      // fresh connect during 50 Hz sim doesn't synchronously fan out 1200 packets.
      const arr = Array.isArray(m.data) ? m.data : [];
      (arr.length > MAX ? arr.slice(-MAX) : arr).forEach(update);
    }
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

// ═══ PHASE HELP TOOLTIPS ═══
(function initTooltips() {
  const tip = document.createElement('div');
  tip.className = 'phase-tip';
  document.body.appendChild(tip);

  document.addEventListener('mouseover', e => {
    const h = e.target.closest('.phase-help');
    if (!h) return;
    tip.textContent = h.dataset.tip;
    tip.style.opacity = '1';
  });

  document.addEventListener('mouseout', e => {
    const h = e.target.closest('.phase-help');
    if (!h) return;
    tip.style.opacity = '0';
  });

  document.addEventListener('mousemove', e => {
    if (tip.style.opacity === '0') return;
    tip.style.left = e.clientX + 12 + 'px';
    tip.style.top = e.clientY - 10 + 'px';
  });
})();
