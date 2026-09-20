import asyncio
import csv
from datetime import datetime
from pathlib import Path

import serial
import serial.tools.list_ports

from .telemetry import TelemetrySample


class SerialReader:
    def __init__(self):
        self.serial = None
        self.task = None
        self.connected = False
        self.port = None
        self.baud = 115200
        self.recording = False
        self.csv_file = None
        self.csv_writer = None
        self.packet_count = 0
        self.invalid_count = 0
        self.last_error = None
        self.started_at = None

    @staticmethod
    def ports():
        return [
            {"device": p.device, "description": p.description or p.device}
            for p in serial.tools.list_ports.comports()
        ]

    async def connect(self, port: str, baud: int):
        await self.disconnect()
        self.serial = serial.Serial(port, baud, timeout=0)
        self.port = port
        self.baud = baud
        self.connected = True
        self.last_error = None
        self.packet_count = 0
        self.invalid_count = 0
        self.started_at = datetime.now()
        self.task = asyncio.create_task(self._loop())

    async def disconnect(self):
        self.connected = False
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            self.task = None
        if self.serial:
            self.serial.close()
        self.serial = None
        self.stop_recording()
        self.port = None

    def start_recording(self):
        if self.recording:
            return
        Path("logs").mkdir(exist_ok=True)
        path = Path("logs") / f"telemetry_{datetime.now():%Y%m%d_%H%M%S}.csv"
        self.csv_file = path.open("w", newline="", encoding="utf-8")
        self.csv_writer = csv.writer(self.csv_file)
        self.csv_writer.writerow([
            "time", "accelX", "accelY", "accelZ",
            "gyroX", "gyroY", "gyroZ", "imuTemp", "bmpTemp", "bmpPressure",
        ])
        self.recording = True

    def stop_recording(self):
        if self.csv_file:
            self.csv_file.close()
        self.csv_file = None
        self.csv_writer = None
        self.recording = False

    async def _loop(self):
        while self.connected and self.serial:
            try:
                while self.serial.in_waiting:
                    raw = self.serial.readline()
                    line = raw.decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    sample = TelemetrySample.parse(line)
                    if sample is None:
                        self.invalid_count += 1
                        continue
                    self.packet_count += 1
                    if self.csv_writer:
                        self.csv_writer.writerow([getattr(sample, f) for f in [
                            "time", "accelX", "accelY", "accelZ", "gyroX", "gyroY",
                            "gyroZ", "imuTemp", "bmpTemp", "bmpPressure"
                        ]])
                        self.csv_file.flush()
                    await self.on_sample(sample)
                await asyncio.sleep(0.005)
            except (serial.SerialException, OSError) as exc:
                self.last_error = str(exc)
                self.connected = False
                break

    async def on_sample(self, sample: TelemetrySample):
        pass
