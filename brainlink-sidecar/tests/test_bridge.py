from __future__ import annotations

import importlib.util
import io
import json
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


SIDECAR_DIR = Path(__file__).resolve().parents[1]
BRIDGE_PATH = SIDECAR_DIR / "bridge.py"
if str(SIDECAR_DIR) not in sys.path:
    sys.path.insert(0, str(SIDECAR_DIR))


class FakeSerialException(Exception):
    pass


class FakeSerialPort:
    def __init__(self, port: str = "COM7", reads=None) -> None:
        self.port = port
        self.is_open = True
        self.closed = False
        self._reads = list(reads or [])

    def read(self, _size: int) -> bytes:
        if not self._reads:
            return b""
        item = self._reads.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item

    def close(self) -> None:
        self.closed = True
        self.is_open = False


class FakeThread:
    def __init__(self, *, target, args, name, daemon) -> None:
        self.target = target
        self.args = args
        self.name = name
        self.daemon = daemon
        self.started = False
        self.joined = False

    def start(self) -> None:
        self.started = True

    def is_alive(self) -> bool:
        return self.started

    def join(self, timeout=None) -> None:
        self.joined = True


class BrainLinkBridgeTests(unittest.TestCase):
    MODULE_NAMES = ("serial", "serial.tools", "serial.tools.list_ports")

    @classmethod
    def setUpClass(cls) -> None:
        cls._old_modules = {name: sys.modules.get(name) for name in cls.MODULE_NAMES}

        serial_mod = types.ModuleType("serial")
        serial_tools_mod = types.ModuleType("serial.tools")
        list_ports_mod = types.ModuleType("serial.tools.list_ports")
        serial_mod.SerialException = FakeSerialException
        serial_mod.Serial = lambda **kwargs: FakeSerialPort(kwargs.get("port", "COM?"))
        list_ports_mod.comports = lambda: []
        serial_tools_mod.list_ports = list_ports_mod
        serial_mod.tools = serial_tools_mod

        sys.modules["serial"] = serial_mod
        sys.modules["serial.tools"] = serial_tools_mod
        sys.modules["serial.tools.list_ports"] = list_ports_mod

        spec = importlib.util.spec_from_file_location(
            "k_neuron_brainlink_bridge_test", BRIDGE_PATH
        )
        if spec is None or spec.loader is None:
            raise RuntimeError("Could not load brainlink-sidecar/bridge.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        cls.bridge = module
        cls.list_ports_mod = list_ports_mod

    @classmethod
    def tearDownClass(cls) -> None:
        sys.modules.pop("k_neuron_brainlink_bridge_test", None)
        for name, previous in cls._old_modules.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous

    def tearDown(self) -> None:
        os.environ.pop("KNEURON_BRAINLINK_PORT", None)

    def test_scan_ports_normalizes_pyserial_metadata(self) -> None:
        self.list_ports_mod.comports = lambda: [
            types.SimpleNamespace(
                device="COM7",
                description="BrainLink Bluetooth",
                hwid="BTHENUM\\123",
                manufacturer="Macrotellect",
            )
        ]
        session = self.bridge.BrainLinkSession()
        result = session.scan_ports()
        self.assertEqual(len(result), 1)
        self.assertEqual(
            result[0].to_json(),
            {
                "port": "COM7",
                "description": "BrainLink Bluetooth",
                "hwid": "BTHENUM\\123",
                "manufacturer": "Macrotellect",
            },
        )

    def test_autodetect_prioritizes_brainlink_named_port(self) -> None:
        session = self.bridge.BrainLinkSession()
        ports = [
            self.bridge.PortInfo("COM9", "USB Serial", "USB", None),
            self.bridge.PortInfo("COM4", "Bluetooth Serial", "BTH", None),
            self.bridge.PortInfo("COM7", "BrainLink Lite", "BTH", "Macrotellect"),
        ]
        session.scan_ports = Mock(return_value=ports)
        expected = (FakeSerialPort("COM7"), self.bridge.ThinkGearParser())
        session._open_and_verify_port = Mock(return_value=expected)

        result = session._autodetect_port()

        self.assertIs(result, expected)
        session._open_and_verify_port.assert_called_once_with("COM7")

    def test_autodetect_reports_probe_failures(self) -> None:
        session = self.bridge.BrainLinkSession()
        session.scan_ports = Mock(
            return_value=[self.bridge.PortInfo("COM1", "Serial", "", None)]
        )
        session._open_and_verify_port = Mock(side_effect=RuntimeError("no packet"))

        with self.assertRaisesRegex(RuntimeError, "Probe results: COM1: no packet"):
            session._autodetect_port()

    def test_open_and_verify_port_accepts_valid_thinkgear_packet(self) -> None:
        from thinkgear import build_packet

        fake = FakeSerialPort("COM7", [build_packet([0x04, 66])])
        with patch.object(self.bridge.serial, "Serial", return_value=fake):
            serial_port, parser = self.bridge.BrainLinkSession()._open_and_verify_port("COM7")

        self.assertIs(serial_port, fake)
        self.assertIsInstance(parser, self.bridge.ThinkGearParser)
        self.assertFalse(fake.closed)

    def test_open_and_verify_port_closes_port_on_probe_failure(self) -> None:
        fake = FakeSerialPort("COM7")
        with (
            patch.object(self.bridge.serial, "Serial", return_value=fake),
            patch.object(self.bridge, "PROBE_SECONDS", -1.0),
        ):
            with self.assertRaisesRegex(RuntimeError, "no valid ThinkGear packets"):
                self.bridge.BrainLinkSession()._open_and_verify_port("COM7")

        self.assertTrue(fake.closed)

    def test_connect_uses_requested_port_and_starts_reader(self) -> None:
        session = self.bridge.BrainLinkSession()
        fake_serial = FakeSerialPort("COM7")
        parser = self.bridge.ThinkGearParser()
        session._open_and_verify_port = Mock(return_value=(fake_serial, parser))

        with patch.object(self.bridge.threading, "Thread", FakeThread):
            info = session.connect("COM7")

        self.assertEqual(info["port"], "COM7")
        self.assertEqual(info["baudRate"], 57600)
        self.assertTrue(session._reader_thread.started)
        session._open_and_verify_port.assert_called_once_with("COM7")

        session.disconnect()
        self.assertTrue(fake_serial.closed)

    def test_connect_honors_environment_override(self) -> None:
        os.environ["KNEURON_BRAINLINK_PORT"] = "COM12"
        session = self.bridge.BrainLinkSession()
        fake_serial = FakeSerialPort("COM12")
        session._open_and_verify_port = Mock(
            return_value=(fake_serial, self.bridge.ThinkGearParser())
        )

        with patch.object(self.bridge.threading, "Thread", FakeThread):
            info = session.connect()

        self.assertEqual(info["port"], "COM12")
        session._open_and_verify_port.assert_called_once_with("COM12")
        session.disconnect()

    def test_handle_packet_emits_metrics_and_signal_quality(self) -> None:
        session = self.bridge.BrainLinkSession()
        session._port = "COM7"
        emitted: list[dict] = []

        with (
            patch.object(self.bridge, "emit", side_effect=emitted.append),
            patch.object(self.bridge.time, "time", return_value=1234.5),
        ):
            session._handle_packet(
                {
                    "poorSignalLevel": 100,
                    "attention": 73,
                    "meditation": 44,
                    "blinkStrength": 10,
                }
            )

        metrics = emitted[0]["metrics"]
        self.assertEqual(metrics["signalQualityPercent"], 50)
        self.assertEqual(metrics["attention"], 73)
        self.assertEqual(metrics["meditation"], 44)
        self.assertEqual(metrics["timestampMs"], 1234500)
        self.assertEqual(metrics["port"], "COM7")
        self.assertEqual(session.latest_metrics()["attention"], 73)

    def test_raw_only_packet_does_not_flood_frontend(self) -> None:
        session = self.bridge.BrainLinkSession()
        with patch.object(self.bridge, "emit") as emit_mock:
            session._handle_packet({"rawEeg": -42})
        emit_mock.assert_not_called()
        self.assertIsNone(session.latest_metrics())

    def test_reader_serial_failure_emits_disconnect_once_and_closes_port(self) -> None:
        session = self.bridge.BrainLinkSession()
        fake = FakeSerialPort("COM7", [FakeSerialException("link lost")])
        session._serial = fake
        session._port = "COM7"
        emitted: list[dict] = []

        with patch.object(self.bridge, "emit", side_effect=emitted.append):
            session._reader_loop(self.bridge.ThinkGearParser())
            session._emit_disconnected("duplicate")

        disconnects = [m for m in emitted if m.get("type") == "device-disconnected"]
        self.assertEqual(len(disconnects), 1)
        self.assertIn("link lost", disconnects[0]["reason"])
        self.assertTrue(fake.closed)
        self.assertIsNone(session._serial)

    def test_unknown_request_returns_error_response(self) -> None:
        emitted: list[dict] = []
        with patch.object(self.bridge, "emit", side_effect=emitted.append):
            keep_running = self.bridge.handle_request({"id": "1", "command": "wat"})

        self.assertTrue(keep_running)
        self.assertFalse(emitted[0]["ok"])
        self.assertIn("Unknown bridge command", emitted[0]["error"])

    def test_request_without_id_is_ignored(self) -> None:
        with patch.object(self.bridge, "emit") as emit_mock:
            keep_running = self.bridge.handle_request({"command": "ping"})
        self.assertTrue(keep_running)
        emit_mock.assert_not_called()

    def test_main_protocol_handles_bad_json_multiple_requests_and_shutdown(self) -> None:
        class StubSession:
            def __init__(self) -> None:
                self.disconnect_calls = 0

            def scan_ports(self):
                return []

            def connect(self, requested_port=None):
                return {"port": requested_port or "COM7"}

            def latest_metrics(self):
                return {"attention": 50}

            def disconnect(self):
                self.disconnect_calls += 1

        stub = StubSession()
        stdin = io.StringIO(
            "bad-json\n"
            '{"id":"1","command":"ping"}\n'
            '{"id":"2","command":"get_metrics"}\n'
            '{"id":"3","command":"unknown"}\n'
            '{"id":"4","command":"shutdown"}\n'
        )
        stdout = io.StringIO()

        with (
            patch.object(self.bridge, "session", stub),
            patch.object(sys, "stdin", stdin),
            patch.object(sys, "stdout", stdout),
        ):
            code = self.bridge.main()

        self.assertEqual(code, 0)
        messages = [json.loads(line) for line in stdout.getvalue().splitlines() if line]
        self.assertEqual(messages[0], {"type": "ready", "protocolVersion": 1})
        self.assertEqual(messages[1]["type"], "bridge-error")
        self.assertTrue(messages[2]["ok"])
        self.assertEqual(messages[3]["result"], {"attention": 50})
        self.assertFalse(messages[4]["ok"])
        self.assertTrue(messages[5]["ok"])
        self.assertEqual(stub.disconnect_calls, 1)

        # stdout remains strict JSONL even for malformed input/errors.
        for line in stdout.getvalue().splitlines():
            json.loads(line)


if __name__ == "__main__":
    unittest.main()
