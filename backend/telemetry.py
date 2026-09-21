import math
import time
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

# Smoothing constants (module-level)
SMOOTH_ALPHA = {"OFF": 1.0, "LOW": 0.5, "MED": 0.3, "HIGH": 0.1}
_smooth_state = {"x": 0.0, "y": 0.0, "z": 0.0}
_smooth_initialized = False


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
    smooth_velocity: float = 0.0
    gforce: float = 1.0
    flight_phase: str = "PRE-FLIGHT"
    _altitude_locked: bool = False  # True when altitude set externally (e.g. IMU)

    # Class-level state (persists across samples)
    _base_pressure: float = 0.0
    _prev_alt: float = 0.0
    _prev_time: float = 0.0
    _initialized: bool = False
    _phase_lock_count: int = 0
    _current_phase: str = "PRE-FLIGHT"
    _sample_count: int = 0
    smooth_velocity: float = 0.0  # class-level EMA state (persists across samples; synced to instance in compute_derived)
    max_altitude: float = 0.0
    _max_reached: bool = False
    _smooth_level: str = "HIGH"

    @classmethod
    def parse(cls, line: str):
        # Strict ingress validation: exactly 14 numeric CSV fields.
        # Anything else is rejected (None) — never zero-padded or fabricated.
        parts = [p.strip() for p in line.split(",")]
        if len(parts) != 14:
            return None
        try:
            values = [float(p) for p in parts]
        except (ValueError, TypeError):
            return None
        return cls(*values)

    def compute_derived(self):
        """Compute altitude, velocity, g-force, and flight phase."""
        # Apply smoothing to raw accel values first
        self._apply_smoothing()

        now = self.time  # use the sample's own timestamp

        # Initialize on first sample
        if not TelemetrySample._initialized:
            TelemetrySample._base_pressure = self.bmpPressure
            TelemetrySample._prev_time = now
            TelemetrySample._initialized = True
            TelemetrySample._current_phase = "PRE-FLIGHT"
            TelemetrySample._phase_lock_count = 0

        # Actual dt from sample timestamps
        dt = now - TelemetrySample._prev_time
        if dt <= 0 or dt > 1.0:
            dt = 0.01  # fallback ~100Hz
        TelemetrySample._prev_time = now

        # ── Barometric altitude ──
        if self._altitude_locked:
            # Altitude set externally (e.g. by IMU integration) — skip barometric
            pass
        elif self.altitude > 0:
            # MCU sent altitude directly — use it, skip barometric calc
            pass
        elif self.bmpPressure > 0 and TelemetrySample._base_pressure > 0:
            ratio = self.bmpPressure / TelemetrySample._base_pressure
            self.altitude = 44330.0 * (1.0 - math.pow(max(ratio, 0.001), 1.0 / 5.255))
        else:
            self.altitude = 0.0

        # Clamp negative altitude to 0
        self.altitude = max(0.0, self.altitude)

        # Track max altitude (class-level, persists across samples)
        if self.altitude > TelemetrySample.max_altitude:
            TelemetrySample.max_altitude = self.altitude

        # ── Velocity: low-pass filtered altitude derivative ──
        if not self._altitude_locked:
            dt_actual = max(dt, 0.001)  # prevent division by zero
            raw_vel = (self.altitude - TelemetrySample._prev_alt) / dt_actual
            TelemetrySample._prev_alt = self.altitude

            # EMA low-pass filter (alpha=0.3 → responsive but smooth)
            TelemetrySample.smooth_velocity = 0.3 * raw_vel + 0.7 * TelemetrySample.smooth_velocity
            self.velocity = TelemetrySample.smooth_velocity
            self.smooth_velocity = TelemetrySample.smooth_velocity

        # ── G-force from accelerometer ──
        accel_mag = math.sqrt(self.accelX**2 + self.accelY**2 + self.accelZ**2)
        self.gforce = accel_mag / 9.81

        # ── Flight phase detection with hysteresis ──
        self._detect_phase_with_hysteresis()

    def _detect_phase_with_hysteresis(self):
        """
        Phase detection with hysteresis to prevent rapid flipping.
        Tracks the candidate phase and only switches after 5 consecutive
        samples with the same candidate.
        """
        candidate = self._compute_phase_candidate()

        if candidate == TelemetrySample._current_phase:
            # Same phase — reset lock count
            TelemetrySample._phase_lock_count = 0
        else:
            # Different candidate — increment lock counter
            TelemetrySample._phase_lock_count += 1
            # Require 5 consecutive different samples before switching
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

        # Check phases in order of specificity (most specific first)

        # RECOVERY: near ground after descent
        if alt < 50 and cur == "DESCENT":
            return "RECOVERY"

        # DESCENT: falling from altitude
        if vel < -2 and alt > 50:
            return "DESCENT"

        # APOGEE: at altitude, velocity just crossed zero
        if alt > 200 and vel < 0:
            return "APOGEE"

        # ASCENT: climbing at altitude
        if alt > 100:
            return "ASCENT"

        # LIFTOFF: leaving the pad with velocity
        if vel > 5 and alt > 5:
            return "LIFTOFF"

        # IGNITION: high G-force but barely off the ground
        if gf > 2.5 and alt < 20:
            return "IGNITION"

        # PRE-FLIGHT: default
        return "PRE-FLIGHT"

    @classmethod
    def reset_base_pressure(cls):
        """Reset for a new session."""
        global _smooth_initialized
        cls._base_pressure = 0.0
        cls._prev_alt = 0.0
        cls._prev_time = 0.0
        cls._initialized = False
        cls._phase_lock_count = 0
        cls._current_phase = "PRE-FLIGHT"
        cls._sample_count = 0
        cls.smooth_velocity = 0.0
        cls.max_altitude = 0.0
        cls._max_reached = False
        _smooth_initialized = False

    @classmethod
    def set_smooth_level(cls, level: str):
        """Set smoothing level: OFF, LOW, MED, HIGH (default)."""
        global _smooth_initialized
        level = level.upper()
        if level in SMOOTH_ALPHA:
            cls._smooth_level = level
            _smooth_initialized = False
            print(f"[Telemetry] Smooth level: {level}")

    @classmethod
    def get_smooth_level(cls) -> str:
        return cls._smooth_level

    def _apply_smoothing(self):
        """Apply EMA smoothing to accel values in-place."""
        global _smooth_state, _smooth_initialized
        alpha = SMOOTH_ALPHA[TelemetrySample._smooth_level]
        if alpha >= 1.0:
            return  # OFF — no smoothing
        if not _smooth_initialized:
            _smooth_state = {"x": self.accelX, "y": self.accelY, "z": self.accelZ}
            _smooth_initialized = True
            return
        _smooth_state["x"] = alpha * self.accelX + (1 - alpha) * _smooth_state["x"]
        _smooth_state["y"] = alpha * self.accelY + (1 - alpha) * _smooth_state["y"]
        _smooth_state["z"] = alpha * self.accelZ + (1 - alpha) * _smooth_state["z"]
        self.accelX = _smooth_state["x"]
        self.accelY = _smooth_state["y"]
        self.accelZ = _smooth_state["z"]

    def as_dict(self):
        d = {field_name: getattr(self, field_name) for field_name in FIELDS}
        d["altitude"] = round(self.altitude, 2)
        d["velocity"] = round(self.velocity, 2)
        d["smooth_velocity"] = round(self.smooth_velocity, 2)
        d["gforce"] = round(self.gforce, 3)
        d["flight_phase"] = self.flight_phase
        d["max_altitude"] = round(TelemetrySample.max_altitude, 2)
        return d
