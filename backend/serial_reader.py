import asyncio
from datetime import datetime

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
        TelemetrySample.reset_base_pressure()
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
        self.port = None

    async def _loop(self):
        while self.connected and self.serial:
            try:
                while self.serial.in_waiting:
                    raw = self.serial.readline()
                    line = raw.decode("utf-8", errors="replace").strip()
                    if not line:
                        self.invalid_count += 1
                        continue
                    sample = TelemetrySample.parse(line)
                    if sample is None:
                        self.invalid_count += 1
                        continue
                    self.packet_count += 1
                    await self.on_sample(sample)
                await asyncio.sleep(0.005)
            except (serial.SerialException, OSError) as exc:
                self.last_error = str(exc)
                self.connected = False
                break

    async def on_sample(self, sample: TelemetrySample):
        pass
