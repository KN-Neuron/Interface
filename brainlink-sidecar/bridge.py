from __future__ import annotations

import json
import os
import re
import socket
import sys
import threading
import time
from dataclasses import dataclass
from typing import Any

import serial
from serial import SerialException
from serial.tools import list_ports

from thinkgear import ThinkGearParser

PROTOCOL_VERSION = 1
BAUD_RATE = 57600
PROBE_SECONDS = 2.5
READ_TIMEOUT_SECONDS = 0.20
RFCOMM_CONNECT_TIMEOUT_SECONDS = 15.0
DEFAULT_RFCOMM_CHANNEL = 1

_BLUETOOTH_ADDRESS = re.compile(r"[0-9A-F]{2}(?::[0-9A-F]{2}){5}")

_stdout_lock = threading.Lock()


def emit(message: dict[str, Any]) -> None:
    with _stdout_lock:
        sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def error_text(error: BaseException) -> str:
    return f"{type(error).__name__}: {error}"


@dataclass
class PortInfo:
    port: str
    description: str
    hwid: str
    manufacturer: str | None

    def to_json(self) -> dict[str, Any]:
        return {
            "port": self.port,
            "description": self.description,
            "hwid": self.hwid,
            "manufacturer": self.manufacturer,
        }


def normalize_bluetooth_address(address: str) -> str:
    normalized = address.strip().replace("-", ":").upper()
    if not _BLUETOOTH_ADDRESS.fullmatch(normalized):
        raise ValueError(f"Invalid Bluetooth MAC address: {address!r}")
    return normalized


class RfcommTransport:
    """Bluetooth RFCOMM socket exposing the subset of serial.Serial the session uses."""

    def __init__(self, address: str, channel: int) -> None:
        if not hasattr(socket, "AF_BLUETOOTH") or not hasattr(socket, "BTPROTO_RFCOMM"):
            raise RuntimeError("This Python build has no Bluetooth RFCOMM socket support.")

        self.port = address
        self.is_open = False
        self._socket = socket.socket(
            socket.AF_BLUETOOTH, socket.SOCK_STREAM, socket.BTPROTO_RFCOMM
        )

        try:
            self._socket.settimeout(RFCOMM_CONNECT_TIMEOUT_SECONDS)
            self._socket.connect((address, channel))
            self._socket.settimeout(READ_TIMEOUT_SECONDS)
        except Exception:
            self._socket.close()
            raise

        self.is_open = True

    def read(self, size: int) -> bytes:
        try:
            chunk = self._socket.recv(size)
        except TimeoutError:
            return b""

        # Unlike a serial read timeout, an empty recv means the headset hung up.
        if not chunk:
            raise ConnectionError("Bluetooth RFCOMM link closed by the device.")
        return chunk

    def close(self) -> None:
        self.is_open = False
        self._socket.close()


class BrainLinkSession:
    def __init__(self) -> None:
        self._serial: serial.Serial | RfcommTransport | None = None
        self._reader_thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        self._port: str | None = None
        self._latest_metrics: dict[str, Any] | None = None
        self._disconnect_emitted = False

    def scan_ports(self) -> list[PortInfo]:
        ports: list[PortInfo] = []
        for port in list_ports.comports():
            ports.append(
                PortInfo(
                    port=port.device,
                    description=port.description or "",
                    hwid=port.hwid or "",
                    manufacturer=getattr(port, "manufacturer", None),
                )
            )
        return ports

    def connect(
        self,
        requested_port: str | None = None,
        bluetooth_address: str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            if self._serial and self._serial.is_open:
                return self._connection_info()

        override_port = requested_port or os.environ.get("KNEURON_BRAINLINK_PORT")

        if bluetooth_address:
            serial_port, parser = self._open_and_verify_rfcomm(bluetooth_address)
        elif override_port:
            serial_port, parser = self._open_and_verify_port(override_port)
        else:
            serial_port, parser = self._autodetect_port()

        with self._lock:
            self._serial = serial_port
            self._port = serial_port.port
            self._latest_metrics = None
            self._disconnect_emitted = False
            self._stop_event.clear()

        self._reader_thread = threading.Thread(
            target=self._reader_loop,
            args=(parser,),
            name="BrainLinkReader",
            daemon=True,
        )
        self._reader_thread.start()

        return self._connection_info()

    def disconnect(self) -> None:
        self._stop_event.set()

        with self._lock:
            serial_port = self._serial
            self._serial = None
            self._port = None

        if serial_port:
            try:
                serial_port.close()
            except Exception:
                pass

        thread = self._reader_thread
        self._reader_thread = None
        if thread and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=1.5)

        self._latest_metrics = None
        self._disconnect_emitted = False

    def latest_metrics(self) -> dict[str, Any] | None:
        with self._lock:
            if self._latest_metrics is None:
                return None
            return dict(self._latest_metrics)

    def _connection_info(self) -> dict[str, Any]:
        with self._lock:
            port = self._port

        return {
            "deviceName": "BrainLink Lite",
            "model": "BL002 V2.0",
            "port": port,
            "baudRate": BAUD_RATE,
        }

    def _autodetect_port(self) -> tuple[serial.Serial | RfcommTransport, ThinkGearParser]:
        ports = self.scan_ports()
        if not ports:
            raise RuntimeError(
                "No serial ports are available. Pair BrainLink Lite in your system's Bluetooth "
                "settings first. On Linux, also enter its Bluetooth MAC address."
            )

        def priority(port: PortInfo) -> tuple[int, str]:
            searchable = " ".join(
                [
                    port.port,
                    port.description,
                    port.hwid,
                    port.manufacturer or "",
                ]
            ).lower()

            if "brainlink" in searchable or "macrotellect" in searchable:
                return (0, port.port)
            if "bluetooth" in searchable or "bth" in searchable:
                return (1, port.port)
            return (2, port.port)

        failures: list[str] = []
        for port in sorted(ports, key=priority):
            try:
                return self._open_and_verify_port(port.port)
            except Exception as error:
                failures.append(f"{port.port}: {error}")

        details = "; ".join(failures[:8])
        raise RuntimeError(
            "BrainLink Lite was not detected on any serial port at 57600 baud. "
            "Make sure it is powered on, paired with this computer, "
            "and not connected to another device. "
            f"Probe results: {details}"
        )

    def _open_and_verify_port(
        self, port_name: str
    ) -> tuple[serial.Serial | RfcommTransport, ThinkGearParser]:
        serial_port = serial.Serial(
            port=port_name,
            baudrate=BAUD_RATE,
            timeout=READ_TIMEOUT_SECONDS,
            write_timeout=1.0,
        )
        return self._verify_stream(serial_port)

    def _open_and_verify_rfcomm(
        self, address: str
    ) -> tuple[serial.Serial | RfcommTransport, ThinkGearParser]:
        normalized = normalize_bluetooth_address(address)
        channel = int(os.environ.get("KNEURON_BRAINLINK_RFCOMM_CHANNEL", DEFAULT_RFCOMM_CHANNEL))

        try:
            transport = RfcommTransport(normalized, channel)
        except OSError as error:
            raise RuntimeError(
                f"Could not open a Bluetooth RFCOMM link to {normalized} on channel {channel}. "
                "Make sure it is powered on, paired with this computer, and not connected "
                f"to another device. ({error_text(error)})"
            ) from error

        return self._verify_stream(transport)

    def _verify_stream(
        self, serial_port: serial.Serial | RfcommTransport
    ) -> tuple[serial.Serial | RfcommTransport, ThinkGearParser]:
        parser = ThinkGearParser()

        deadline = time.monotonic() + PROBE_SECONDS
        saw_valid_packet = False

        try:
            while time.monotonic() < deadline:
                chunk = serial_port.read(512)
                if not chunk:
                    continue

                packets = parser.feed(chunk)
                if packets:
                    saw_valid_packet = True
                    # Preserve parser state and continue with the already-open
                    # port. Any metrics in this probe data will be superseded
                    # by the live reader almost immediately.
                    break

            if not saw_valid_packet:
                raise RuntimeError("no valid ThinkGear packets received")

            return serial_port, parser
        except Exception:
            serial_port.close()
            raise

    def _reader_loop(self, parser: ThinkGearParser) -> None:
        try:
            while not self._stop_event.is_set():
                with self._lock:
                    serial_port = self._serial

                if serial_port is None or not serial_port.is_open:
                    return

                chunk = serial_port.read(512)
                if not chunk:
                    continue

                for packet in parser.feed(chunk):
                    self._handle_packet(packet.values)
        except (SerialException, OSError) as error:
            if not self._stop_event.is_set():
                self._emit_disconnected(error_text(error))
        except Exception as error:
            if not self._stop_event.is_set():
                emit(
                    {
                        "type": "bridge-error",
                        "message": error_text(error),
                    }
                )
                self._emit_disconnected(error_text(error))
        finally:
            with self._lock:
                serial_port = self._serial
                self._serial = None
                self._port = None

            if serial_port:
                try:
                    serial_port.close()
                except Exception:
                    pass

    def _handle_packet(self, values: dict[str, object]) -> None:
        # Raw EEG rows arrive much more frequently than eSense. Neuorrun uses
        # the native eSense metrics, so the bridge intentionally does not flood
        # the frontend with raw samples in v1.0.
        has_metrics = any(
            key in values
            for key in (
                "poorSignalLevel",
                "attention",
                "meditation",
                "eegPower",
                "blinkStrength",
            )
        )

        if not has_metrics:
            return

        now_ms = int(time.time() * 1000)

        with self._lock:
            current = dict(self._latest_metrics or {})
            port = self._port

            if "poorSignalLevel" in values:
                current["poorSignalLevel"] = int(values["poorSignalLevel"])
            if "attention" in values:
                current["attention"] = int(values["attention"])
            if "meditation" in values:
                current["meditation"] = int(values["meditation"])
            if "eegPower" in values:
                current["eegPower"] = values["eegPower"]
            if "blinkStrength" in values:
                current["blinkStrength"] = int(values["blinkStrength"])

            poor = int(current.get("poorSignalLevel", 200))
            bounded_poor = max(0, min(200, poor))
            current["signalQualityPercent"] = round((1.0 - bounded_poor / 200.0) * 100)
            current["timestampMs"] = now_ms
            current["port"] = port

            self._latest_metrics = current
            snapshot = dict(current)

        emit({"type": "metrics", "metrics": snapshot})

    def _emit_disconnected(self, reason: str) -> None:
        with self._lock:
            if self._disconnect_emitted:
                return
            self._disconnect_emitted = True

        emit({"type": "device-disconnected", "reason": reason})


session = BrainLinkSession()


def respond(request_id: str, result: Any = None) -> None:
    emit(
        {
            "type": "response",
            "id": request_id,
            "ok": True,
            "result": result,
        }
    )


def fail(request_id: str, error: BaseException) -> None:
    emit(
        {
            "type": "response",
            "id": request_id,
            "ok": False,
            "error": error_text(error),
        }
    )


def handle_request(request: dict[str, Any]) -> bool:
    request_id = str(request.get("id", ""))
    command = str(request.get("command", ""))
    payload = request.get("payload") or {}

    if not request_id:
        return True

    try:
        if command == "ping":
            respond(
                request_id,
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "device": "BrainLink Lite BL002 V2.0",
                },
            )
            return True

        if command == "scan":
            respond(request_id, [port.to_json() for port in session.scan_ports()])
            return True

        if command == "connect":
            requested_port = payload.get("port")
            if requested_port is not None:
                requested_port = str(requested_port)
            bluetooth_address = payload.get("bluetoothAddress")
            if bluetooth_address is not None:
                bluetooth_address = str(bluetooth_address)
            respond(request_id, session.connect(requested_port, bluetooth_address))
            return True

        if command == "get_metrics":
            respond(request_id, session.latest_metrics())
            return True

        if command == "disconnect":
            session.disconnect()
            respond(request_id, None)
            return True

        if command == "shutdown":
            session.disconnect()
            respond(request_id, None)
            return False

        raise ValueError(f"Unknown bridge command: {command}")
    except Exception as error:
        fail(request_id, error)
        return True


def main() -> int:
    emit({"type": "ready", "protocolVersion": PROTOCOL_VERSION})

    for line in sys.stdin:
        stripped = line.strip()
        if not stripped:
            continue

        try:
            request = json.loads(stripped)
            if not isinstance(request, dict):
                raise ValueError("Bridge request must be a JSON object.")
        except Exception as error:
            emit({"type": "bridge-error", "message": error_text(error)})
            continue

        if not handle_request(request):
            return 0

    session.disconnect()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
