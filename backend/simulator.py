"""
Rocket Flight Simulator — generates realistic telemetry without hardware.

Simulates a complete rocket flight profile:
  PRE-FLIGHT → IGNITION → LIFTOFF → ASCENT → APOGEE → DESCENT → RECOVERY

Physics: simplified 1D model with thrust, gravity, drag, and barometric altitude.
"""

import asyncio
import math
import random

from .telemetry import TelemetrySample


class RocketSimulator:
    """Generates synthetic telemetry simulating a rocket flight."""

    # Flight profile constants
    LAUNCH_DELAY = 3.0       # seconds on pad
    IGNITION_DURATION = 1.5  # engine buildup
    THRUST_DURATION = 4.0    # full thrust phase
    THRUST_ACCEL = 50.0      # m/s² (~5G above gravity)
    DRAG_COEFF = 0.002       # aerodynamic drag
    TERMINAL_VEL = -25.0     # m/s terminal velocity under chute
    BASE_PRESSURE = 1013.25  # hPa at sea level
    NOISE_SIGMA = 0.4        # sensor noise level

    def __init__(self):
        self.running = False
        self.task = None
        self.on_sample = None
        self.packet_count = 0

        # Flight state
        self._elapsed = 0.0
        self.alt = 0.0
        self.vel = 0.0
        self.phase = "PRE-FLIGHT"
        self._burnout_alt = 0.0
        self._burnout_vel = 0.0
        self._max_reached = False

        # Speed control
        self._speed = 1.0
        self._paused = False

    async def start(self):
        if self.running:
            return
        self.running = True
        self.packet_count = 0
        self._elapsed = 0.0  # relative time counter
        self.alt = 0.0
        self.vel = 0.0
        self.phase = "PRE-FLIGHT"
        self._burnout_alt = 0.0
        self._burnout_vel = 0.0
        self._max_reached = False
        self.task = asyncio.create_task(self._loop())

    async def stop(self):
        self.running = False
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            self.task = None

    def set_speed(self, speed: float):
        """Set simulation speed multiplier (0.1 to 10.0)."""
        self._speed = max(0.1, min(10.0, speed))

    def pause(self):
        """Pause the simulation."""
        self._paused = True

    def resume(self):
        """Resume the simulation."""
        self._paused = False

    def _noise(self, sigma=None):
        return random.gauss(0, sigma or self.NOISE_SIGMA)

    def _step(self, dt):
        """Advance physics by dt seconds (scaled by speed multiplier)."""
        self._elapsed += dt * self._speed
        t = self._elapsed

        # ── PRE-FLIGHT ──
        if t < self.LAUNCH_DELAY:
            self.phase = "PRE-FLIGHT"
            thrust = 0.0

        # ── IGNITION (linear ramp up) ──
        elif t < self.LAUNCH_DELAY + self.IGNITION_DURATION:
            self.phase = "IGNITION"
            progress = (t - self.LAUNCH_DELAY) / self.IGNITION_DURATION
            thrust = self.THRUST_ACCEL * progress  # linear ramp

        # ── LIFTOFF (just left the pad, still low) ──
        elif self.alt < 20 and self.vel > 0:
            self.phase = "LIFTOFF"
            thrust = self.THRUST_ACCEL

        # ── THRUST (full power, climbing) ──
        elif t < self.LAUNCH_DELAY + self.IGNITION_DURATION + self.THRUST_DURATION:
            self.phase = "ASCENT"
            thrust = self.THRUST_ACCEL

        # ── COASTING (engine off, still going up) ──
        elif self.vel >= 0 and self.alt > 0:
            self.phase = "ASCENT"
            thrust = 0.0

        # ── APOGEE (velocity crosses zero) ──
        elif self.vel < 0 and self.alt > 100 and not self._max_reached:
            self.phase = "APOGEE"
            self._max_reached = True
            self._burnout_alt = self.alt
            self._burnout_vel = self.vel
            thrust = 0.0

        # ── DESCENT ──
        elif self.alt > 50:
            self.phase = "DESCENT"
            thrust = 0.0

        # ── RECOVERY ──
        else:
            self.phase = "RECOVERY"
            thrust = 0.0

        # If still under thrust, save burnout values when engine stops
        if thrust > 0:
            self._burnout_alt = self.alt
            self._burnout_vel = self.vel

        # ── Physics integration ──
        gravity = -9.81
        drag = -self.DRAG_COEFF * self.vel * abs(self.vel) if self.alt > 0 else 0

        # Terminal velocity limit during descent
        if self.phase in ("DESCENT", "RECOVERY") and self.vel < self.TERMINAL_VEL:
            drag = 0  # parachute limits speed

        accel = gravity + thrust / 1.0 + drag  # mass=1kg simplification
        self.vel += accel * dt
        self.alt += self.vel * dt
        self.alt = max(0.0, self.alt)

        # Force terminal velocity in descent
        if self.phase == "RECOVERY":
            self.vel = max(self.vel, self.TERMINAL_VEL)
            if self.alt <= 0:
                self.vel = 0
                self.alt = 0

        return {
            "thrust": thrust,
            "gravity": gravity,
            "drag": drag,
        }

    def _generate_sample(self, physics):
        """Create a TelemetrySample from current flight state."""
        t = self._elapsed
        n = self._noise

        # Accelerometer: measures non-gravitational forces + gravity
        # In free fall: accel_z ≈ 0 (weightless)
        # On pad: accel_z ≈ 9.81 (measuring gravity)
        # Under thrust: accel_z ≈ 9.81 + thrust_accel
        thrust_accel = physics["thrust"]
        accel_z = 9.81 + thrust_accel + n(1.0)
        accel_x = n(1.5) + math.sin(t * 2.5) * 0.8  # vibration
        accel_y = n(1.5) + math.cos(t * 3.0) * 0.8

        # Gyroscope: angular rates (°/s)
        # More turbulence during thrust and descent
        turb = 2.0 if self.phase in ("IGNITION", "ASCENT") else 0.5
        gyro_x = math.sin(t * 1.8) * turb + n(1.0)
        gyro_y = math.cos(t * 2.2) * turb + n(1.0)
        gyro_z = n(0.5)

        # Barometric pressure from altitude
        ratio = max(1.0 - self.alt / 44330.0, 0.01)
        pressure = self.BASE_PRESSURE * math.pow(ratio, 5.255)

        # Temperature: decreases ~6.5°C per 1000m, plus sensor heating
        sensor_heat = 2.0 if self.phase in ("IGNITION", "ASCENT") else 0.0
        temp_imu = 25.0 - self.alt * 0.0065 + sensor_heat + n(0.3)
        temp_bmp = 24.5 - self.alt * 0.0065 + n(0.3)

        # Simulate GPS-like coordinates (small drift around a fixed point)
        base_lat = 34.0522  # example: Los Angeles
        base_lon = -118.2437
        lat = base_lat + self.alt * 0.00001 * math.sin(t * 0.1) + self._noise(0.00001)
        lon = base_lon + self.alt * 0.00001 * math.cos(t * 0.1) + self._noise(0.00001)

        return TelemetrySample(
            time=round(t, 4),
            accelX=round(accel_x, 3),
            accelY=round(accel_y, 3),
            accelZ=round(accel_z, 3),
            gyroX=round(gyro_x, 3),
            gyroY=round(gyro_y, 3),
            gyroZ=round(gyro_z, 3),
            imuTemp=round(temp_imu, 2),
            bmpTemp=round(temp_bmp, 2),
            bmpPressure=round(pressure, 2),
            latitude=round(lat, 6),
            longitude=round(lon, 6),
            altitude=round(self.alt, 2),
            groundSpeed=round(abs(self.vel), 2),
        )

    async def _loop(self):
        """Main simulation loop — 50Hz telemetry."""
        dt = 0.02  # 50Hz
        while self.running:
            if not self._paused:
                physics = self._step(dt)
                sample = self._generate_sample(physics)
                self.packet_count += 1

                if self.on_sample:
                    await self.on_sample(sample)

            await asyncio.sleep(dt)
