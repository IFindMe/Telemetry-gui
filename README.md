# Telemetry Ground Station

Modern browser-based telemetry dashboard for the MCU serial stream.

## Architecture

```
MCU / Arduino
    │ USB Serial
    ▼
Python FastAPI backend
    │
    ├── Serial reader
    ├── Telemetry parser
    ├── CSV recorder
    └── WebSocket
          │
          ▼
    http://localhost:8080
          │
          ▼
     Browser dashboard
```

## Dashboard

- Dark modern mission-control UI
- Responsive desktop / tablet / phone layout
- Live artificial-horizon style attitude display
- Separate accelerometer and gyroscope charts
- Temperature and pressure telemetry
- Packet rate and invalid-packet counters
- Serial port / baud-rate controls
- WebSocket live stream
- CSV recording
- Event console
- No frontend build system required

## Telemetry format

Each line must contain exactly 10 comma-separated values:

`time,accelX,accelY,accelZ,gyroX,gyroY,gyroZ,imuTemp,bmpTemp,bmpPressure`

Example:

`12.345678,0.012345,-0.023456,9.801234,0.120000,-0.330000,0.040000,31.25,30.90,1012.45`

Your existing firmware output is compatible:

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

## Run

Python 3.10+ is recommended.

```bash
git clone https://github.com/IFindMe/Telemetry-gui.git
cd Telemetry-gui

python -m venv .venv
source .venv/bin/activate       # Linux/macOS
# .venv\\Scripts\\activate    # Windows

pip install -r requirements.txt
python run.py
```

Open:

```
http://localhost:8080
```

On Linux, your user may need permission to access the serial device, for example by being in the `dialout` group.

## Project structure

```
Telemetry-gui/
├── backend/
│   ├── __init__.py
│   ├── serial_reader.py
│   ├── server.py
│   └── telemetry.py
├── frontend/
│   ├── app.js
│   ├── index.html
│   └── style.css
├── logs/
├── requirements.txt
└── run.py
```

## Remote access later

The server currently binds to `127.0.0.1:8080`. For LAN/VPN access, change the uvicorn host in `run.py` to `0.0.0.0`, then place the dashboard behind the network/VPN layer you trust.
