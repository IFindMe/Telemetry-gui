import csv
import sys
import time
from collections import deque
from datetime import datetime
from pathlib import Path

import pyqtgraph as pg
import serial
import serial.tools.list_ports
from PySide6 import QtCore, QtWidgets


FIELDS = [
    "time", "accelX", "accelY", "accelZ",
    "gyroX", "gyroY", "gyroZ", "imuTemp", "bmpTemp", "bmpPressure"
]

PLOT_FIELDS = FIELDS[1:]
UNITS = {
    "accelX": "m/s²", "accelY": "m/s²", "accelZ": "m/s²",
    "gyroX": "°/s", "gyroY": "°/s", "gyroZ": "°/s",
    "imuTemp": "°C", "bmpTemp": "°C", "bmpPressure": "hPa",
}


class TelemetryGUI(QtWidgets.QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Telemetry GUI")
        self.resize(1400, 900)

        self.serial = None
        self.timer = QtCore.QTimer(self)
        self.timer.timeout.connect(self.read_serial)

        self.max_points = 1500
        self.data = {name: deque(maxlen=self.max_points) for name in FIELDS}
        self.plot_curves = {}
        self.recording = False
        self.csv_file = None
        self.csv_writer = None

        self.build_ui()
        self.refresh_ports()

    def build_ui(self):
        central = QtWidgets.QWidget()
        root = QtWidgets.QVBoxLayout(central)
        self.setCentralWidget(central)

        controls = QtWidgets.QHBoxLayout()
        self.port_combo = QtWidgets.QComboBox()
        self.baud_combo = QtWidgets.QComboBox()
        self.baud_combo.addItems(["115200", "230400", "460800", "921600"])
        self.baud_combo.setCurrentText("115200")

        refresh = QtWidgets.QPushButton("↻ Refresh")
        refresh.clicked.connect(self.refresh_ports)
        self.connect_btn = QtWidgets.QPushButton("Connect")
        self.connect_btn.clicked.connect(self.toggle_connection)
        self.record_btn = QtWidgets.QPushButton("Start CSV")
        self.record_btn.clicked.connect(self.toggle_recording)

        controls.addWidget(QtWidgets.QLabel("Port"))
        controls.addWidget(self.port_combo, 2)
        controls.addWidget(QtWidgets.QLabel("Baud"))
        controls.addWidget(self.baud_combo)
        controls.addWidget(refresh)
        controls.addWidget(self.connect_btn)
        controls.addWidget(self.record_btn)
        controls.addStretch()
        self.status = QtWidgets.QLabel("Disconnected")
        controls.addWidget(self.status)
        root.addLayout(controls)

        self.cards = {}
        cards = QtWidgets.QGridLayout()
        for i, field in enumerate(PLOT_FIELDS):
            box = QtWidgets.QFrame()
            box.setObjectName("card")
            layout = QtWidgets.QVBoxLayout(box)
            title = QtWidgets.QLabel(field)
            title.setObjectName("cardTitle")
            value = QtWidgets.QLabel("--")
            value.setObjectName("cardValue")
            unit = QtWidgets.QLabel(UNITS[field])
            unit.setObjectName("cardUnit")
            layout.addWidget(title)
            layout.addWidget(value)
            layout.addWidget(unit)
            self.cards[field] = value
            cards.addWidget(box, i // 5, i % 5)
        root.addLayout(cards)

        self.plot = pg.PlotWidget()
        self.plot.setBackground("#080808")
        self.plot.showGrid(x=True, y=True, alpha=0.2)
        self.plot.setLabel("bottom", "Telemetry time", units="s")
        self.plot.addLegend()
        for field in PLOT_FIELDS:
            curve = self.plot.plot(name=field, pen=pg.mkPen(width=2))
            self.plot_curves[field] = curve
        root.addWidget(self.plot, 1)

        self.log = QtWidgets.QPlainTextEdit()
        self.log.setReadOnly(True)
        self.log.setMaximumBlockCount(300)
        root.addWidget(self.log)

        self.setStyleSheet("""
            QMainWindow, QWidget { background: #101214; color: #e8eaed; }
            QComboBox, QPushButton, QPlainTextEdit {
                background: #1b1e22; color: #e8eaed; border: 1px solid #34383e;
                padding: 6px; border-radius: 5px;
            }
            QPushButton:hover { background: #252a30; }
            QFrame#card {
                background: #17191c; border: 1px solid #292d32; border-radius: 8px;
            }
            QLabel#cardTitle { color: #9aa0a6; font-size: 13px; }
            QLabel#cardValue { font-size: 24px; font-weight: 600; }
            QLabel#cardUnit { color: #777d85; font-size: 12px; }
        """)

    def refresh_ports(self):
        current = self.port_combo.currentText()
        self.port_combo.clear()
        for port in serial.tools.list_ports.comports():
            self.port_combo.addItem(port.device)
        if current:
            index = self.port_combo.findText(current)
            if index >= 0:
                self.port_combo.setCurrentIndex(index)

    def toggle_connection(self):
        if self.serial and self.serial.is_open:
            self.disconnect_serial()
        else:
            self.connect_serial()

    def connect_serial(self):
        port = self.port_combo.currentText()
        if not port:
            self.status.setText("No serial port")
            return
        try:
            self.serial = serial.Serial(
                port, int(self.baud_combo.currentText()), timeout=0
            )
            self.timer.start(20)
            self.connect_btn.setText("Disconnect")
            self.status.setText(f"Connected: {port}")
            self.log.appendPlainText(f"Connected to {port}")
        except serial.SerialException as exc:
            self.status.setText("Connection failed")
            self.log.appendPlainText(f"ERROR: {exc}")

    def disconnect_serial(self):
        self.timer.stop()
        if self.serial:
            self.serial.close()
        self.connect_btn.setText("Connect")
        self.status.setText("Disconnected")
        self.log.appendPlainText("Disconnected")

    def read_serial(self):
        if not self.serial or not self.serial.is_open:
            return
        try:
            while self.serial.in_waiting:
                line = self.serial.readline().decode("utf-8", errors="replace").strip()
                if line:
                    self.process_line(line)
        except (serial.SerialException, OSError) as exc:
            self.log.appendPlainText(f"Serial error: {exc}")
            self.disconnect_serial()

    def process_line(self, line):
        parts = line.split(",")
        if len(parts) != len(FIELDS):
            return
        try:
            values = [float(x.strip()) for x in parts]
        except ValueError:
            return

        for field, value in zip(FIELDS, values):
            self.data[field].append(value)

        for field in PLOT_FIELDS:
            self.cards[field].setText(f"{values[FIELDS.index(field)]:.3f}")
            self.plot_curves[field].setData(
                list(self.data["time"]), list(self.data[field])
            )

        if self.csv_writer:
            self.csv_writer.writerow(values)
            self.csv_file.flush()

    def toggle_recording(self):
        if self.recording:
            self.stop_recording()
        else:
            self.start_recording()

    def start_recording(self):
        Path("logs").mkdir(exist_ok=True)
        filename = Path("logs") / f"telemetry_{datetime.now():%Y%m%d_%H%M%S}.csv"
        self.csv_file = filename.open("w", newline="", encoding="utf-8")
        self.csv_writer = csv.writer(self.csv_file)
        self.csv_writer.writerow(FIELDS)
        self.recording = True
        self.record_btn.setText("Stop CSV")
        self.log.appendPlainText(f"Recording: {filename}")

    def stop_recording(self):
        if self.csv_file:
            self.csv_file.close()
        self.csv_file = None
        self.csv_writer = None
        self.recording = False
        self.record_btn.setText("Start CSV")
        self.log.appendPlainText("CSV recording stopped")

    def closeEvent(self, event):
        self.stop_recording()
        self.disconnect_serial()
        event.accept()


def main():
    app = QtWidgets.QApplication(sys.argv)
    pg.setConfigOptions(antialias=True)
    window = TelemetryGUI()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
