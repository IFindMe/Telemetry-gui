import asyncio
from collections import deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .serial_reader import SerialReader

BASE = Path(__file__).resolve().parent.parent
app = FastAPI(title="Telemetry Ground Station")
reader = SerialReader()
clients = set()
history = deque(maxlen=1200)


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
    payload = {"type": "telemetry", "data": sample.as_dict()}
    history.append(sample.as_dict())
    await broadcast(payload)


reader.on_sample = sample_handler


@app.on_event("shutdown")
async def shutdown():
    await reader.disconnect()


@app.get("/api/status")
async def status():
    return {
        "connected": reader.connected,
        "port": reader.port,
        "baud": reader.baud,
        "recording": reader.recording,
        "packets": reader.packet_count,
        "invalid": reader.invalid_count,
    }


@app.get("/api/ports")
async def ports():
    return reader.ports()


@app.post("/api/connect")
async def connect(payload: dict):
    port = payload.get("port")
    baud = int(payload.get("baud", 115200))
    if not port:
        raise HTTPException(400, "Serial port is required")
    try:
        await reader.connect(port, baud)
    except Exception as exc:
        raise HTTPException(500, str(exc))
    return await status()


@app.post("/api/disconnect")
async def disconnect():
    await reader.disconnect()
    return await status()


@app.post("/api/recording")
async def recording(payload: dict):
    if payload.get("enabled"):
        reader.start_recording()
    else:
        reader.stop_recording()
    return await status()


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


app.mount("/static", StaticFiles(directory=BASE / "frontend"), name="static")


@app.get("/")
async def index():
    return FileResponse(BASE / "frontend" / "index.html")
