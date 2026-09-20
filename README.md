# Telemetry GUI

Desktop Python ground-station style GUI for the CSV telemetry stream produced by the MCU.

## Telemetry format

Each line must contain exactly 10 comma-separated values:

`time,accelX,accelY,accelZ,gyroX,gyroY,gyroZ,imuTemp,bmpTemp,bmpPressure`

Example:

`12.345678,0.012345,-0.023456,9.801234,0.120000,-0.330000,0.040000,31.25,30.90,1012.45`

## Features

- Serial-port discovery and connection
- Configurable baud rate
- Live numerical telemetry cards
- Live scrolling plots
- CSV recording to `logs/`
- Designed for long-running desktop telemetry monitoring

## Run

Python 3.10+ is recommended.

```bash
python -m venv .venv
source .venv/bin/activate       # Linux/macOS
# .venv\\Scripts\\activate    # Windows

pip install -r requirements.txt
python telemetry_gui.py
```

On Linux, your user may need permission to access the serial device, for example by being in the `dialout` group.

## MCU output

Your existing firmware output is already compatible:

```cpp
return String(micros() / 1000000.0, 6) + ","
     + String(accelX, 6) + ","
     + String(accelY, 6) + ","
     + String(accelZ, 6) + ","
     + String(gyroX, 6) + ","
     + String(gyroY, 6) + ","
     + String(gyroZ, 6) + ","
     + String(imuTemp, 2) + ","
     + String(bmpTemp, 2) + ","
     + String(bmpPressure, 2);
```
