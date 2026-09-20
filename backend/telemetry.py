from dataclasses import dataclass

FIELDS = [
    "time", "accelX", "accelY", "accelZ",
    "gyroX", "gyroY", "gyroZ", "imuTemp", "bmpTemp", "bmpPressure",
]


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

    @classmethod
    def parse(cls, line: str):
        parts = [p.strip() for p in line.split(",")]
        if len(parts) != len(FIELDS):
            return None
        try:
            values = [float(p) for p in parts]
        except ValueError:
            return None
        return cls(*values)

    def as_dict(self):
        return {field: getattr(self, field) for field in FIELDS}
