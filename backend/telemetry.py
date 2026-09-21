import math
from dataclasses import dataclass

FIELDS = [
    "time", "accelX", "accelY", "accelZ",
    "gyroX", "gyroY", "gyroZ", "imuTemp", "bmpTemp", "bmpPressure",
    "latitude", "longitude", "altitude", "groundSpeed",
]

# ═══ FLIGHT PHASE DEFINITIONS ═══
# Each phase has entry/exit conditions with hysteresis bands
# to prevent rapid flipping between phases.
#
# Phase Logic:
#   PRE-FLIGHT  → On the ground, idle. Altitude < 10m, velocity near zero.
#   IGNITION    → Engine firing detected. High G-force (>2G) but barely moved.
#   LIFTOFF     → Rocket is leaving the pad. Velocity > 10 m/s, alt > 10m.
#   ASCENT      → Climbing under power or coasting. Velocity > 0, alt > 100m.
#   APOGEE      → Reached peak, velocity crosses zero. vel < 0, alt > 100m.
#   DESCENT     → Falling back down. velocity < -1 m/s.
#   RECOVERY    → Near ground after descent. alt < 50m, slowing down.

PHASE_ORDER = ["PRE-FLIGHT", "IGNITION", "LIFTOFF", "ASCENT", "APOGEE", "DESCENT", "RECOVERY"]


@dataclass
class TelemetrySample:
    time: float
    accelX: float
    accelY: float
    accelZ: float
    gyroX: float
    gyroY: float
    gyroZ: float
    imuTemp: float
    bmpTemp: float
    bmpPressure: float
    latitude: float = 0.0
    longitude: float = 0.0
    altitude: float = 0.0
    groundSpeed: float = 0.0

    # Derived fields (per-sample)
    velocity: float = 0.0
    gforce: float = 1.0
    flight_phase: str = "PRE-FLIGHT"
    # D2-2b: source-declared opt-out. The IMU path sets this True so its
    # double-integrated velocity survives compute_derived(); serial/sim
    # leave it False and get altitude-delta velocity. Read-checked below —
    # never a write-only flag.
    velocity_locked: bool = False

    # Class-level state (persists across samples)
    _prev_alt: float = 0.0
    _prev_time: float = 0.0
    _prev_velocity: float = 0.0
    _initialized: bool = False
    _phase_lock_count: int = 0
    _current_phase: str = "PRE-FLIGHT"
    _max_altitude: float = 0.0
    _max_reached: bool = False

    @classmethod
    def parse(cls, line: str):
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 10:
            return None
        try:
            values = [float(p) for p in parts[:14]]
        except ValueError:
            return None
        # Pad to 14 fields if fewer were sent
        while len(values) < 14:
            values.append(0.0)
        return cls(*values)

    def compute_derived(self):
        """Compute velocity, g-force, flight phase, and max altitude from raw MCU data."""
        now = self.time  # MCU timestamp

        if not TelemetrySample._initialized:
            TelemetrySample._prev_time = now
            TelemetrySample._prev_alt = self.altitude
            TelemetrySample._initialized = True

        dt = now - TelemetrySample._prev_time
        if dt <= 0:
            # D3-3c: duplicate/out-of-order stamp — hold last velocity
            # instead of fabricating with 0.01; keep last-good anchor
            # (_prev_alt/_prev_time NOT advanced). Gforce/phase/max_alt
            # below still compute normally.
            if not self.velocity_locked:
                self.velocity = TelemetrySample._prev_velocity
        else:
            TelemetrySample._prev_time = now
            # Velocity from altitude delta using MCU time (serial/sim only).
            # D2-2b: a source-locked (IMU-integrated) velocity is preserved.
            # D1-1a: self.altitude is never assigned here — ingress owns it.
            raw_vel = (self.altitude - TelemetrySample._prev_alt) / max(dt, 0.001)
            raw_vel = max(-200.0, min(200.0, raw_vel))
            TelemetrySample._prev_alt = self.altitude
            if not self.velocity_locked:
                self.velocity = raw_vel
            TelemetrySample._prev_velocity = self.velocity

        # G-force from accelerometer
        self.gforce = math.sqrt(self.accelX**2 + self.accelY**2 + self.accelZ**2) / 9.81

        # Flight phase detection with hysteresis
        self._detect_phase_with_hysteresis()

        # Max altitude tracking
        if self.altitude > TelemetrySample._max_altitude:
            TelemetrySample._max_altitude = self.altitude

    def _detect_phase_with_hysteresis(self):
        """
        Phase detection with hysteresis to prevent rapid flipping.
        Tracks the candidate phase and only switches after 5 consecutive
        samples with the same candidate.
        """
        candidate = self._compute_phase_candidate()

        if candidate == TelemetrySample._current_phase:
            TelemetrySample._phase_lock_count = 0
        else:
            TelemetrySample._phase_lock_count += 1
            if TelemetrySample._phase_lock_count >= 5:
                TelemetrySample._current_phase = candidate
                TelemetrySample._phase_lock_count = 0

        self.flight_phase = TelemetrySample._current_phase

    def _compute_phase_candidate(self):
        """Determine the ideal phase from current sensor values."""
        alt = self.altitude
        vel = self.velocity
        gf = self.gforce
        cur = TelemetrySample._current_phase

        if alt < 50 and cur == "DESCENT":
            return "RECOVERY"
        if vel < -2 and alt > 50:
            return "DESCENT"
        if alt > 200 and vel < 0:
            return "APOGEE"
        if alt > 100:
            return "ASCENT"
        if vel > 5 and alt > 5:
            return "LIFTOFF"
        if gf > 2.5 and alt < 20:
            return "IGNITION"
        return "PRE-FLIGHT"

    @classmethod
    def reset(cls):
        """Reset all class-level state for a new session."""
        cls._prev_alt = 0.0
        cls._prev_time = 0.0
        cls._prev_velocity = 0.0
        cls._initialized = False
        cls._phase_lock_count = 0
        cls._current_phase = "PRE-FLIGHT"
        cls._max_altitude = 0.0
        cls._max_reached = False

    def as_dict(self):
        """Raw passthrough of MCU fields plus computed derived fields."""
        d = {field_name: getattr(self, field_name) for field_name in FIELDS}
        d["altitude"] = round(self.altitude, 2)
        d["velocity"] = round(self.velocity, 2)
        d["gforce"] = round(self.gforce, 3)
        d["flight_phase"] = self.flight_phase
        d["max_altitude"] = round(TelemetrySample._max_altitude, 2)
        return d
