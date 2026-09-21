"""Standalone fallback serial logger.

Opens COM14 at 115200 baud and appends valid telemetry samples to a
sequentially numbered CSV file in logs/. Used when the main GUI/backend
is unavailable. Run with:  python tools/fallback_serial_logger.py
"""

import csv
import re
import time
from pathlib import Path

import serial

PORT = "COM14"
BAUD = 115200

# Header row matches backend/telemetry.py FIELDS order exactly.
FIELDS = [
    "time", "accelX", "accelY", "accelZ",
    "gyroX", "gyroY", "gyroZ", "imuTemp", "bmpTemp", "bmpPressure",
    "latitude", "longitude", "altitude", "groundSpeed",
]

_SEQ_RE = re.compile(r"^telemetry_fallback_(\d+)\.csv$")


def next_log_path(logs_dir: Path) -> Path:
    """Return the next sequential log path (telemetry_fallback_NNN.csv)."""
    highest = 0
    if logs_dir.is_dir():
        for child in logs_dir.iterdir():
            match = _SEQ_RE.match(child.name)
            if match:
                highest = max(highest, int(match.group(1)))
    return logs_dir / f"telemetry_fallback_{highest + 1:03d}.csv"


def parse_line(line: str):
    """Strict validation: exactly 14 CSV fields, all numeric.

    Returns the list of 14 floats, or None if the line is malformed.
    """
    parts = [p.strip() for p in line.split(",")]
    if len(parts) != 14:
        return None
    try:
        return [float(p) for p in parts]
    except ValueError:
        return None


def run_logger(ser, csvfile, start=None, max_reads=None):
    """Read lines from ser, validate, write valid rows to csvfile.

    Returns (samples, invalid). The first line after connect gets a silent
    one-time amnesty (likely a mid-packet fragment); every malformed line
    after that increments invalid. max_reads is a test hook: stop after
    that many readline() calls and return the counts.
    """
    writer = csv.writer(csvfile)
    writer.writerow(FIELDS)
    csvfile.flush()

    if start is None:
        start = time.monotonic()
    samples = 0
    invalid = 0
    first = True
    reads = 0
    while True:
        raw = ser.readline()
        reads += 1
        if raw:
            line = raw.decode("utf-8", errors="replace").strip()
            if line:
                values = parse_line(line)
                if values is None:
                    if first:
                        # First line only: silently discard the likely fragment.
                        first = False
                    else:
                        invalid += 1
                else:
                    first = False
                    writer.writerow(values)
                    csvfile.flush()
                    samples += 1
                    if samples % 100 == 0:
                        elapsed = time.monotonic() - start
                        rate = samples / elapsed if elapsed > 0 else 0.0
                        print(f"samples={samples} invalid={invalid} rate={rate:.1f}/s", flush=True)
        if max_reads is not None and reads >= max_reads:
            break
    return samples, invalid


def main():
    logs_dir = Path(__file__).resolve().parent.parent / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    path = next_log_path(logs_dir)
    print(f"Opening {PORT} at {BAUD} baud...", flush=True)
    ser = serial.Serial(PORT, BAUD, timeout=1)
    # The device may already be transmitting when the logger connects,
    # so stale buffered bytes would otherwise corrupt the first line.
    ser.reset_input_buffer()
    print(f"Logging to {path}", flush=True)
    try:
        with open(path, "w", newline="", encoding="utf-8") as csvfile:
            run_logger(ser, csvfile)
    except KeyboardInterrupt:
        print("\nStopped by user.", flush=True)
    except (serial.SerialException, OSError) as exc:
        print(f"Serial error: {exc}", flush=True)
    finally:
        ser.close()


if __name__ == "__main__":
    main()
