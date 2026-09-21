"""
Android IMU Reader — reads live accelerometer data from Phyphox.

Protocol: HTTP REST API exposed by Phyphox's remote interface.
  - Control:  GET http://<ip>:8080/control?cmd=start|stop|clear
  - Get data: GET http://<ip>:8080/get?accX=full&accY=full&accZ=full&acc_time=full
  - Incremental: GET http://<ip>:8080/get?accX=<ts>|acc_time&accY=<ts>|acc_time&accZ=<ts>|acc_time&acc_time=<ts>

Phyphox uses threshold-based incremental fetch: request values where the
independent variable (acc_time) exceeds a threshold. The "|" syntax ties
a buffer to a reference buffer's threshold.

Docs: https://phyphox.org/docs/remote-interface/
"""

import asyncio
import time
from typing import Callable, Optional

import httpx

from .telemetry import TelemetrySample


class AndroidIMUReader:
    """Reads IMU data from Phyphox via HTTP polling."""

    def __init__(self, ip: str = "100.100.1.34", port: int = 8080):
        self.ip = ip
        self.port = port
        self.base_url = f"http://{ip}:{port}"
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._sample_handler: Optional[Callable] = None
        self._poll_interval = 0.1  # 10 Hz polling
        self._client: Optional[httpx.AsyncClient] = None
        self._data_flowing = False
        self._last_time: float = -1.0  # last acc_time received (for incremental fetch)
        self._first_fetch = True  # first fetch uses full mode to get baseline

    async def start(self, sample_handler: Callable):
        """Start polling IMU data. sample_handler receives TelemetrySample objects."""
        if self._running:
            return

        self._sample_handler = sample_handler
        self._running = True
        self._last_time = -1.0
        self._first_fetch = True
        self._client = httpx.AsyncClient(timeout=5.0)

        # Start measurement on the device
        try:
            resp = await self._client.get(f"{self.base_url}/control?cmd=start")
            print(f"[AndroidIMU] Start command sent: {resp.status_code}")
        except Exception as e:
            print(f"[AndroidIMU] Failed to send start command: {e}")

        self._task = asyncio.create_task(self._poll_loop())

    async def stop(self):
        """Stop polling IMU data."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

        # Stop measurement on the device
        if self._client:
            try:
                resp = await self._client.get(f"{self.base_url}/control?cmd=stop")
                print(f"[AndroidIMU] Stop command sent: {resp.status_code}")
            except Exception:
                pass
            await self._client.aclose()
            self._client = None

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def data_flowing(self) -> bool:
        return self._data_flowing

    def set_handler(self, handler: Callable):
        """Set the sample handler callback."""
        self._sample_handler = handler

    async def _poll_loop(self):
        """Continuously poll Phyphox for accelerometer data."""
        empty_warned = False

        while self._running:
            try:
                if self._first_fetch:
                    # First fetch: get full buffer to establish baseline
                    url = f"{self.base_url}/get?accX=full&accY=full&accZ=full&acc_time=full"
                else:
                    # Incremental: get only new data since last timestamp
                    # Phyphox threshold syntax: buffer=threshold|reference_buffer
                    # URL-encode "|" as "%7C"
                    ts = f"{self._last_time:.6f}"
                    url = (f"{self.base_url}/get"
                           f"?accX={ts}%7Cacc_time"
                           f"&accY={ts}%7Cacc_time"
                           f"&accZ={ts}%7Cacc_time"
                           f"&acc_time={ts}")

                resp = await self._client.get(url)
                if resp.status_code == 200:
                    data = resp.json()
                    buffers = data.get("buffer", {})
                    status = data.get("status", {})

                    if not buffers and not empty_warned:
                        print("[AndroidIMU] WARNING: Device returned empty buffers. "
                              "Make sure Phyphox is in an accelerometer experiment "
                              "and remote access is enabled.")
                        empty_warned = True
                    elif buffers:
                        empty_warned = False
                        self._process_response(data)
                else:
                    print(f"[AndroidIMU] HTTP {resp.status_code}")
            except httpx.ConnectError:
                print(f"[AndroidIMU] Connection failed to {self.base_url}")
            except Exception as e:
                print(f"[AndroidIMU] Poll error: {e}")

            await asyncio.sleep(self._poll_interval)

    def _process_response(self, data: dict):
        """Process a Phyphox response and emit TelemetrySample objects."""
        buffers = data.get("buffer", {})

        if not buffers:
            return

        def get_buf(name):
            b = buffers.get(name, {})
            if isinstance(b, dict):
                return b.get("buffer", [])
            return []

        acc_x_data = get_buf("accX")
        acc_y_data = get_buf("accY")
        acc_z_data = get_buf("accZ")
        acc_time_data = get_buf("acc_time")

        if not acc_x_data and not acc_y_data and not acc_z_data:
            return

        # Determine number of samples
        n = max(len(acc_x_data), len(acc_y_data), len(acc_z_data))
        if n == 0:
            return

        self._data_flowing = True

        # After first full fetch, switch to incremental mode
        if self._first_fetch:
            self._first_fetch = False
            # Update last_time from this response
            if acc_time_data:
                last_t = float(acc_time_data[-1]) if acc_time_data[-1] is not None else -1.0
                if last_t > self._last_time:
                    self._last_time = last_t
            # Still emit these samples (they're new to us)
            # But skip if it's a huge initial buffer — just take the last few
            if n > 50:
                # Only emit the last 10 samples from initial fetch
                offset = n - 10
                acc_x_data = acc_x_data[offset:]
                acc_y_data = acc_y_data[offset:]
                acc_z_data = acc_z_data[offset:]
                acc_time_data = acc_time_data[offset:] if acc_time_data else []
                n = 10
        else:
            # Update last_time for next incremental fetch
            if acc_time_data:
                last_t = float(acc_time_data[-1]) if acc_time_data[-1] is not None else -1.0
                if last_t > self._last_time:
                    self._last_time = last_t

        # Emit each sample
        for i in range(n):
            def safe(arr, idx):
                if idx < len(arr):
                    v = arr[idx]
                    return float(v) if v is not None else 0.0
                return 0.0

            ax = safe(acc_x_data, i)
            ay = safe(acc_y_data, i)
            az = safe(acc_z_data, i)

            now = time.time()

            sample = TelemetrySample(
                time=now,
                accelX=ax,
                accelY=ay,
                accelZ=az,
                gyroX=0.0,
                gyroY=0.0,
                gyroZ=0.0,
                imuTemp=25.0,
                bmpTemp=25.0,
                bmpPressure=0.0,
            )

            # Lock altitude/velocity so compute_derived doesn't overwrite
            sample._altitude_locked = True

            # IMU-derived altitude via double integration of vertical acceleration
            if not hasattr(self, '_vel_z'):
                self._vel_z = 0.0
                self._alt_imu = 0.0
                self._last_imu_time = now

            dt = now - self._last_imu_time
            if 0 < dt < 1.0:
                net_accel_z = az - 9.81
                self._vel_z += net_accel_z * dt
                self._alt_imu += self._vel_z * dt
                self._alt_imu = max(-100, min(10000, self._alt_imu))
                self._vel_z = max(-100, min(500, self._vel_z))

            self._last_imu_time = now

            sample.altitude = self._alt_imu
            sample.velocity = self._vel_z

            # Compute derived values (gforce, phase — altitude/velocity locked)
            sample.compute_derived()

            # Emit sample
            if self._sample_handler:
                if asyncio.iscoroutinefunction(self._sample_handler):
                    try:
                        loop = asyncio.get_running_loop()
                        loop.create_task(self._sample_handler(sample))
                    except RuntimeError:
                        pass
                else:
                    self._sample_handler(sample)
