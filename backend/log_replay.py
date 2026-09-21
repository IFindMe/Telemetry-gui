"""
Log Replay — reads telemetry CSV logs and replays them through the same
on_sample callback used by the simulator and serial reader.

CSV format: columns match TelemetrySample.as_dict() keys.
If only base FIELDS are present, derived values are computed on the fly.
"""

import asyncio
import csv
from pathlib import Path
from typing import Callable, Optional

from .telemetry import TelemetrySample, FIELDS


class LogReplayer:
    """Replays saved telemetry CSV logs at configurable speed."""

    def __init__(self):
        self._running = False
        self._paused = False
        self._task: Optional[asyncio.Task] = None
        self._on_sample: Optional[Callable] = None
        self._speed = 1.0
        self._samples: list[dict] = []
        self._index = 0
        self._log_path: Optional[str] = None
        self._recompute = False

    # Derived columns written by LogWriter that verbatim replay restores
    # instead of recomputing (D2-2c/2d).
    _DERIVED_COLS = ("velocity", "gforce", "flight_phase")

    # ── Public API ──────────────────────────────────────────────────

    def list_logs(self, logs_dir: str = "logs") -> list[dict]:
        """Return metadata for every CSV file in the logs directory."""
        logs_path = Path(logs_dir)
        if not logs_path.is_dir():
            return []

        result = []
        for csv_file in sorted(logs_path.glob("*.csv")):
            info = self._file_info(csv_file)
            if info:
                result.append(info)
        return result

    async def start(
        self,
        log_path: str,
        on_sample: Callable,
        speed: float = 1.0,
        recompute: bool = False,
    ):
        """Begin replaying *log_path* at *speed*× through *on_sample*.

        recompute=False (default, D2-2c/2d verbatim): derived columns are
        restored from the row. recompute=True: rows pass through
        un-derived so the funnel sample_handler derives them once.
        """
        if self._running:
            await self.stop()

        self._on_sample = on_sample
        self._speed = max(0.1, min(10.0, speed))
        self._recompute = recompute
        self._log_path = log_path
        self._paused = False
        self._index = 0
        self._samples = self._load_csv(log_path)

        if not self._samples:
            return

        self._running = True
        self._task = asyncio.create_task(self._replay_loop())

    async def stop(self):
        """Stop the current replay."""
        self._running = False
        self._paused = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    def pause(self):
        """Pause the replay."""
        self._paused = True

    def resume(self):
        """Resume the replay."""
        self._paused = False

    def seek(self, timestamp: float):
        """Jump to the sample closest to *timestamp*."""
        if not self._samples:
            return
        for i, row in enumerate(self._samples):
            if float(row.get("time", 0)) >= timestamp:
                self._index = i
                self._reanchor()
                return
        self._index = len(self._samples)  # past end → stop
        self._reanchor()

    def seek_fraction(self, fraction: float):
        """Jump to a position by fraction (0.0 – 1.0) of total samples."""
        if not self._samples:
            return
        self._index = int(fraction * len(self._samples))
        self._index = max(0, min(self._index, len(self._samples)))
        self._reanchor()

    def _reanchor(self):
        """D2-2f: re-seed derivation anchors at the current index so the
        next computed velocity (recompute mode) doesn't spike, and set
        _max_altitude to the prefix max over rows [0..index]."""
        if not self._samples:
            return
        i = max(0, min(self._index, len(self._samples) - 1))
        try:
            TelemetrySample._prev_time = float(self._samples[i].get("time", 0))
        except (ValueError, TypeError):
            TelemetrySample._prev_time = 0.0
        try:
            TelemetrySample._prev_alt = float(self._samples[i].get("altitude", 0))
        except (ValueError, TypeError):
            TelemetrySample._prev_alt = 0.0
        TelemetrySample._initialized = True
        prefix_max = 0.0
        for row in self._samples[: i + 1]:
            try:
                prefix_max = max(prefix_max, float(row.get("altitude", 0)))
            except (ValueError, TypeError):
                continue
        TelemetrySample._max_altitude = prefix_max

    def set_speed(self, speed: float):
        """Change replay speed (0.1 – 10.0)."""
        self._speed = max(0.1, min(10.0, speed))

    # ── Properties ──────────────────────────────────────────────────

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def paused(self) -> bool:
        return self._paused

    @property
    def current_file(self) -> Optional[str]:
        return self._log_path

    @property
    def position(self) -> int:
        return self._index

    @property
    def total_samples(self) -> int:
        return len(self._samples)

    # ── Internals ───────────────────────────────────────────────────

    def _load_csv(self, log_path: str) -> list[dict]:
        """Load all rows from a CSV into a list of dicts."""
        rows: list[dict] = []
        with open(log_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows.append(row)
        return rows

    def _row_to_sample(self, row: dict) -> TelemetrySample:
        """Convert a CSV row dict to a TelemetrySample."""
        # Always populate the base fields
        base = {k: float(row.get(k, 0)) for k in FIELDS}
        sample = TelemetrySample(**base)

        # D2-2d (dead branch inverted): the old `if "altitude" not in row`
        # never fired because altitude is always in FIELDS. Test derived
        # columns instead — restore when present, compute only when absent.
        derived_present = all(
            k in row and row[k] not in (None, "") for k in self._DERIVED_COLS
        )
        if derived_present and not self._recompute:
            # D2-2c verbatim: reproduce the recorded flight bit-for-bit.
            sample.velocity = float(row["velocity"])
            sample.gforce = float(row["gforce"])
            sample.flight_phase = row["flight_phase"]
            if "max_altitude" in row and row["max_altitude"] not in (None, ""):
                TelemetrySample._max_altitude = float(row["max_altitude"])
        elif not self._recompute:
            # Derived columns absent (pre-derived-column log): derive once
            # here — replay_handler never calls compute_derived() (D2-2c).
            sample.compute_derived()
        # Recompute mode: restore nothing, compute nothing — the funnel
        # sample_handler performs the single compute_derived() (D2-2a).

        return sample

    async def _replay_loop(self):
        """Emit samples at timestamps scaled by the speed multiplier."""
        while self._running and self._index < len(self._samples):
            if self._paused:
                await asyncio.sleep(0.05)
                continue

            row = self._samples[self._index]
            sample = self._row_to_sample(row)
            self._index += 1

            if self._on_sample:
                await self._on_sample(sample)

            # Determine delay until the next sample
            if self._index < len(self._samples):
                t_now = float(row.get("time", 0))
                t_next = float(self._samples[self._index].get("time", 0))
                gap = (t_next - t_now) / self._speed
                # Clamp gap to sane bounds (prevent huge sleeps or zero-gap tight loops)
                gap = max(0.001, min(gap, 2.0))
                await asyncio.sleep(gap)

    @staticmethod
    def _file_info(path: Path) -> Optional[dict]:
        """Return metadata dict for a single CSV log file."""
        try:
            stat = path.stat()
            size = stat.st_size

            # Count rows and extract time range
            sample_count = 0
            t_min: Optional[float] = None
            t_max: Optional[float] = None

            with open(path, newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    sample_count += 1
                    try:
                        t = float(row.get("time", 0))
                    except (ValueError, TypeError):
                        continue
                    if t_min is None or t < t_min:
                        t_min = t
                    if t_max is None or t > t_max:
                        t_max = t

            return {
                "filename": path.name,
                "size": size,
                "samples": sample_count,
                "duration": round(t_max - t_min, 3) if (t_min is not None and t_max is not None) else 0,
                "time_range": [t_min, t_max],
            }
        except Exception:
            return None
