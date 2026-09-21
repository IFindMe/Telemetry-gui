import asyncio
from collections import deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .android_imu import AndroidIMUReader
from .log_replay import LogReplayer
from .log_writer import LogWriter
from .serial_reader import SerialReader
from .simulator import RocketSimulator
from .telemetry import TelemetrySample

BASE = Path(__file__).resolve().parent.parent
app = FastAPI(title="Rocket Mission Control")
reader = SerialReader()
simulator = RocketSimulator()
android_imu = AndroidIMUReader()
log_replayer = LogReplayer()
log_writer = LogWriter()
clients = set()
history = deque(maxlen=1200)

# ═══ FUNNEL SEQUENCING (D3-3a) + SESSION RESET (D2-2e) ═══
# Single global implementation: every broadcast payload AND history entry
# gets (source, session, seq). Counters live here — never in the readers.
_funnel_source: str = ""
_funnel_session: int = 0
_funnel_seq: int = 0


def _begin_session(source: str):
    """Start a new funnel session: full derived-state reset (D2-2e),
    new session_id, seq restarts at 0 (D3-3a). Called on every source START."""
    global _funnel_source, _funnel_session, _funnel_seq
    TelemetrySample.reset()
    _funnel_source = source
    _funnel_session += 1
    _funnel_seq = 0


def _end_session():
    """Close a session: reset derived state so no stale phase/velocity/
    max_alt greets the next session even if its start path is bypassed
    (D2-2e). Called on every source STOP/DISCONNECT."""
    global _funnel_seq
    TelemetrySample.reset()
    _funnel_seq = 0


def _tag_payload(data: dict) -> dict:
    """Stamp one funnel dict with the current (source, session, seq)."""
    global _funnel_seq
    data["source"] = _funnel_source
    data["session"] = _funnel_session
    data["seq"] = _funnel_seq
    _funnel_seq += 1
    return data


async def broadcast(payload):
    dead = []
    for ws in clients:
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


async def sample_handler(sample):
    sample.compute_derived()
    data = _tag_payload(sample.as_dict())
    payload = {"type": "telemetry", "data": data}
    history.append(data)
    if log_writer.recording:
        log_writer.write(sample)
    await broadcast(payload)


async def replay_handler(sample):
    """D2-2c: verbatim replay — recorded derived columns pass through
    untouched. MUST NOT call compute_derived() and MUST NOT write to
    log_writer (no recursive record-of-replay)."""
    data = _tag_payload(sample.as_dict())
    payload = {"type": "telemetry", "data": data}
    history.append(data)
    await broadcast(payload)


reader.on_sample = sample_handler
simulator.on_sample = sample_handler
android_imu.set_handler(sample_handler)


@app.on_event("shutdown")
async def shutdown():
    await reader.disconnect()
    await simulator.stop()
    await android_imu.stop()
    await log_replayer.stop()
    log_writer.stop()


# ═══ STATUS ═══

@app.get("/api/status")
async def status():
    return {
        "connected": reader.connected,
        "port": reader.port,
        "baud": reader.baud,
        "recording": log_writer.recording,
        "packets": reader.packet_count,
        "invalid": reader.invalid_count,
        "simulating": simulator.running,
        "sim_packets": simulator.packet_count,
        "sim_speed": simulator._speed,
        "sim_paused": simulator._paused,
        "android_imu": android_imu.is_running,
        "android_ip": android_imu.ip,
        "android_data": android_imu.data_flowing,
        "replaying": log_replayer.is_running,
        "replay_file": log_replayer.current_file,
        "replay_paused": log_replayer.paused,
        "replay_position": log_replayer.position,
        "replay_total": log_replayer.total_samples,
    }


# ═══ SERIAL PORT ═══

@app.get("/api/ports")
async def ports():
    return reader.ports()


@app.post("/api/connect")
async def connect(payload: dict):
    port = payload.get("port")
    baud = int(payload.get("baud", 115200))
    if not port:
        raise HTTPException(400, "Serial port is required")
    # Stop simulation if running
    if simulator.running:
        await simulator.stop()
    try:
        await reader.connect(port, baud)
    except Exception as exc:
        raise HTTPException(500, str(exc))
    _begin_session("serial")
    return await status()


@app.post("/api/disconnect")
async def disconnect():
    await reader.disconnect()
    _end_session()
    return await status()


# ═══ RECORDING ═══

@app.post("/api/recording")
async def recording(payload: dict):
    if payload.get("enabled"):
        log_writer.start()
    else:
        log_writer.stop()
    return await status()


# ═══ SIMULATION ═══

@app.post("/api/simulate")
async def simulate(payload: dict):
    enabled = payload.get("enabled", False)
    if enabled:
        # Stop serial if connected
        if reader.connected:
            await reader.disconnect()
        _begin_session("sim")
        await simulator.start()
        history.clear()
    else:
        await simulator.stop()
        _end_session()
    return await status()


# ═══ ANDROID IMU ═══

@app.post("/api/android-source")
async def android_source(payload: dict):
    enabled = payload.get("enabled", False)
    ip = payload.get("ip", "100.100.1.34")
    port = int(payload.get("port", 8080))

    if enabled:
        # Stop other sources
        if simulator.running:
            await simulator.stop()
        if reader.connected:
            await reader.disconnect()

        android_imu.ip = ip
        android_imu.port = port
        android_imu.base_url = f"http://{ip}:{port}"
        _begin_session("android")
        await android_imu.start(sample_handler)
    else:
        await android_imu.stop()
        _end_session()

    return await status()


# ═══ LOG REPLAY ═══

@app.get("/api/logs")
async def list_logs():
    return {"logs": log_replayer.list_logs()}


@app.post("/api/replay")
async def replay(payload: dict):
    enabled = payload.get("enabled", False)
    if enabled:
        log_file = payload.get("log_file")
        if not log_file:
            raise HTTPException(400, "log_file is required")
        # Resolve to logs/ directory if just a filename
        if not ("/" in log_file or "\\" in log_file):
            log_file = str(Path("logs") / log_file)
        speed = float(payload.get("speed", 1.0))
        # D2-2d: recompute toggle (default False = verbatim reproduction).
        recompute = bool(payload.get("recompute", False))
        # Stop other sources
        if simulator.running:
            await simulator.stop()
        if reader.connected:
            await reader.disconnect()
        if android_imu.is_running:
            await android_imu.stop()
        _begin_session("replay")
        history.clear()
        handler = sample_handler if recompute else replay_handler
        await log_replayer.start(log_file, handler, speed, recompute=recompute)
    else:
        await log_replayer.stop()
        _end_session()
    return await status()


@app.post("/api/replay-pause")
async def replay_pause(payload: dict):
    paused = payload.get("paused", True)
    if paused:
        log_replayer.pause()
    else:
        log_replayer.resume()
    return await status()


@app.post("/api/replay-speed")
async def replay_speed(payload: dict):
    speed = float(payload.get("speed", 1.0))
    log_replayer.set_speed(speed)
    return await status()


@app.post("/api/replay-seek")
async def replay_seek(payload: dict):
    fraction = payload.get("fraction")
    if fraction is not None:
        log_replayer.seek_fraction(float(fraction))
    else:
        timestamp = float(payload.get("timestamp", 0))
        log_replayer.seek(timestamp)
    return await status()


# ═══ SIMULATION CONTROLS ═══

@app.post("/api/sim-speed")
async def sim_speed(payload: dict):
    speed = float(payload.get("speed", 1.0))
    simulator.set_speed(speed)
    return await status()


@app.post("/api/sim-pause")
async def sim_pause(payload: dict):
    paused = payload.get("paused", True)
    if paused:
        simulator.pause()
    else:
        simulator.resume()
    return await status()


# ═══ WEBSOCKET ═══

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    await ws.send_json({"type": "history", "data": list(history)})
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        clients.discard(ws)
    except Exception:
        clients.discard(ws)


# ═══ STATIC FILES ═══

app.mount("/static", StaticFiles(directory=BASE / "frontend"), name="static")


@app.get("/")
async def index():
    return FileResponse(BASE / "frontend" / "index.html")
