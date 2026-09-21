"""
Log Writer — saves telemetry samples to CSV files in the logs/ directory.

CSV columns match TelemetrySample.as_dict() keys so that files are
readable by LogReplayer and compatible with the serial reader format.
"""

import csv
from datetime import datetime
from pathlib import Path
from typing import Optional

from .telemetry import TelemetrySample, FIELDS

# All columns written by as_dict(), in the same order
ALL_FIELDS = FIELDS + [
    "velocity",
    "gforce", "flight_phase", "max_altitude",
]


class LogWriter:
    """Writes telemetry samples to a timestamped CSV log file."""

    def __init__(self):
        self._file: Optional[object] = None
        self._writer: Optional[csv.writer] = None
        self._filename: Optional[str] = None

    # ── Public API ──────────────────────────────────────────────────

    def start(self, filename: Optional[str] = None) -> str:
        """Open a new CSV file for writing. Returns the filename created."""
        if self._file:
            self.stop()

        logs_dir = Path("logs")
        logs_dir.mkdir(exist_ok=True)

        if filename is None:
            filename = f"telemetry_{datetime.now():%Y%m%d_%H%M%S}.csv"

        path = logs_dir / filename
        self._file = path.open("w", newline="", encoding="utf-8")
        self._writer = csv.writer(self._file)
        self._writer.writerow(ALL_FIELDS)
        self._file.flush()
        self._filename = filename
        return filename

    def stop(self):
        """Close the current log file."""
        if self._file:
            try:
                self._file.close()
            except Exception:
                pass
        self._file = None
        self._writer = None
        self._filename = None

    def write(self, sample: TelemetrySample):
        """Write a single sample to the current log. No-op if not open."""
        if not self._writer or not self._file:
            return
        d = sample.as_dict()
        self._writer.writerow([d.get(field, "") for field in ALL_FIELDS])
        self._file.flush()

    # ── Properties ──────────────────────────────────────────────────

    @property
    def recording(self) -> bool:
        return self._file is not None

    @property
    def filename(self) -> Optional[str]:
        return self._filename
