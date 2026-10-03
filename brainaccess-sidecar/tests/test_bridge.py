from __future__ import annotations

import importlib.util
import io
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np


SIDECAR_DIR = Path(__file__).resolve().parents[1]
BRIDGE_PATH = SIDECAR_DIR / "bridge.py"


class FakeFeatures:
    def __init__(self, count: int) -> None:
        self._count = count

    def electrode_count(self) -> int:
        return self._count


class FakeBattery:
    def __init__(self, level: int) -> None:
        self.level = level


class FakeEEGManager:
    instances: list["FakeEEGManager"] = []
    connect_status = 0
    electrode_count = 4
    sample_frequency = 250.0
    battery_level = 87

    def __init__(self) -> None:
        type(self).instances.append(self)
        self.device_name: str | None = None
        self.enabled: list[tuple[int, bool]] = []
        self.gains: list[tuple[int, object]] = []
        self.biases: list[tuple[int, bool]] = []
        self.disconnect_callback = None
        self.chunk_callback = None
        self.load_config_calls = 0
        self.start_stream_calls = 0
        self.stop_stream_calls = 0
        self.destroy_calls = 0

    def connect(self, device_name: str) -> int:
        self.device_name = device_name
        return type(self).connect_status

    def get_device_features(self) -> FakeFeatures:
        return FakeFeatures(type(self).electrode_count)

    def set_channel_enabled(self, channel: int, enabled: bool) -> None:
        self.enabled.append((channel, enabled))

    def set_channel_gain(self, channel: int, gain: object) -> None:
        self.gains.append((channel, gain))

    def set_channel_bias(self, channel: int, enabled: bool) -> None:
        self.biases.append((channel, enabled))

    def get_sample_frequency(self) -> float:
        return type(self).sample_frequency

    def set_callback_disconnect(self, callback) -> None:
        self.disconnect_callback = callback

    def get_battery_info(self) -> FakeBattery:
        return FakeBattery(type(self).battery_level)

    def set_callback_chunk(self, callback) -> None:
        self.chunk_callback = callback

    def load_config(self) -> None:
        self.load_config_calls += 1

    def start_stream(self) -> None:
        self.start_stream_calls += 1

    def stop_stream(self) -> None:
        self.stop_stream_calls += 1

    def destroy(self) -> None:
        self.destroy_calls += 1


class BrainAccessBridgeTests(unittest.TestCase):
    MODULE_NAMES = (
        "brainaccess",
        "brainaccess.core",
        "brainaccess.core.eeg_manager",
        "brainaccess.core.eeg_channel",
        "brainaccess.core.gain_mode",
    )

    @classmethod
    def setUpClass(cls) -> None:
        cls._old_modules = {name: sys.modules.get(name) for name in cls.MODULE_NAMES}

        brainaccess_mod = types.ModuleType("brainaccess")
        core_mod = types.ModuleType("brainaccess.core")
        manager_mod = types.ModuleType("brainaccess.core.eeg_manager")
        channel_mod = types.ModuleType("brainaccess.core.eeg_channel")
        gain_mod = types.ModuleType("brainaccess.core.gain_mode")

        core_mod.init = Mock()
        core_mod.close = Mock()
        core_mod.scan = Mock(return_value=[])
        manager_mod.EEGManager = FakeEEGManager
        channel_mod.ELECTRODE_MEASUREMENT = 100
        channel_mod.SAMPLE_NUMBER = 10
        channel_mod.STREAMING = 11

        class FakeGainMode:
            X8 = "X8"

        gain_mod.GainMode = FakeGainMode
        brainaccess_mod.core = core_mod

        sys.modules["brainaccess"] = brainaccess_mod
        sys.modules["brainaccess.core"] = core_mod
        sys.modules["brainaccess.core.eeg_manager"] = manager_mod
        sys.modules["brainaccess.core.eeg_channel"] = channel_mod
        sys.modules["brainaccess.core.gain_mode"] = gain_mod

        spec = importlib.util.spec_from_file_location(
            "k_neuron_brainaccess_bridge_test", BRIDGE_PATH
        )
        if spec is None or spec.loader is None:
            raise RuntimeError("Could not load brainaccess-sidecar/bridge.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        cls.bridge = module
        cls.core = core_mod

    @classmethod
    def tearDownClass(cls) -> None:
        sys.modules.pop("k_neuron_brainaccess_bridge_test", None)
        for name, previous in cls._old_modules.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous

    def setUp(self) -> None:
        FakeEEGManager.instances.clear()
        FakeEEGManager.connect_status = 0
        FakeEEGManager.electrode_count = 4
        FakeEEGManager.sample_frequency = 250.0
        FakeEEGManager.battery_level = 87
        self.core.init.reset_mock()
        self.core.close.reset_mock()
        self.core.scan.reset_mock(return_value=[])

    def test_emit_writes_one_compact_json_line(self) -> None:
        stdout = io.StringIO()
        with patch.object(sys, "stdout", stdout):
            self.bridge.emit({"type": "ready", "protocolVersion": 1})

        lines = stdout.getvalue().splitlines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(json.loads(lines[0]), {"type": "ready", "protocolVersion": 1})

    def test_scan_initializes_core_once_and_serializes_devices(self) -> None:
        device = types.SimpleNamespace(name="BA MAXI 009", mac_address="AA:BB:CC")
        self.core.scan.return_value = [device]
        session = self.bridge.BrainAccessSession()

        first = session.scan()
        second = session.scan()

        self.assertEqual(first, [{"name": "BA MAXI 009", "macAddress": "AA:BB:CC"}])
        self.assertEqual(second, first)
        self.core.init.assert_called_once_with()
        self.assertEqual(self.core.scan.call_count, 2)

    def test_connect_configures_channels_and_returns_connection_info(self) -> None:
        session = self.bridge.BrainAccessSession()

        info = session.connect("BA MAXI 009")
        manager = FakeEEGManager.instances[-1]

        self.assertEqual(
            info,
            {
                "deviceName": "BA MAXI 009",
                "sampleRateHz": 250.0,
                "channelCount": 4,
                "battery": 87,
            },
        )
        self.assertEqual(
            manager.enabled,
            [(100, True), (101, True), (102, True), (103, True), (10, True), (11, True)],
        )
        self.assertEqual(manager.gains, [(100, "X8"), (101, "X8"), (102, "X8"), (103, "X8")])
        self.assertEqual(manager.biases, [(103, True)])
        self.assertTrue(callable(manager.disconnect_callback))

        # Connecting the same already-active device is intentionally idempotent.
        second = session.connect("BA MAXI 009")
        self.assertEqual(second["deviceName"], "BA MAXI 009")
        self.assertEqual(len(FakeEEGManager.instances), 1)

    def test_connect_failure_destroys_temporary_manager(self) -> None:
        FakeEEGManager.connect_status = 5
        session = self.bridge.BrainAccessSession()

        with self.assertRaisesRegex(RuntimeError, "status 5"):
            session.connect("broken-device")

        self.assertEqual(FakeEEGManager.instances[-1].destroy_calls, 1)
        with self.assertRaisesRegex(RuntimeError, "No BrainAccess device"):
            session.connection_info()

    def test_connect_rejects_zero_electrodes_and_cleans_up(self) -> None:
        FakeEEGManager.electrode_count = 0
        session = self.bridge.BrainAccessSession()

        with self.assertRaisesRegex(RuntimeError, "zero EEG electrodes"):
            session.connect("BA MAXI 009")

        self.assertEqual(FakeEEGManager.instances[-1].destroy_calls, 1)

    def test_stream_start_stop_disconnect_lifecycle(self) -> None:
        session = self.bridge.BrainAccessSession()
        session.connect("BA MAXI 009")
        manager = FakeEEGManager.instances[-1]

        self.assertEqual(session.start_stream(), {"streaming": True})
        self.assertEqual(session.start_stream(), {"streaming": True})
        self.assertEqual(manager.start_stream_calls, 1)
        self.assertEqual(manager.load_config_calls, 1)
        self.assertTrue(callable(manager.chunk_callback))

        self.assertEqual(session.stop_stream(), {"streaming": False})
        self.assertEqual(manager.stop_stream_calls, 1)
        self.assertEqual(session.stop_stream(), {"streaming": False})
        self.assertEqual(manager.stop_stream_calls, 1)

        self.assertEqual(session.disconnect(), {"connected": False})
        self.assertEqual(manager.destroy_calls, 1)
        self.assertIsNone(manager.disconnect_callback)
        self.assertEqual(session.disconnect(), {"connected": False})

    def test_sample_callback_batches_and_sequences_samples(self) -> None:
        session = self.bridge.BrainAccessSession()
        session.connect("BA MAXI 009")
        session.start_stream()

        first = np.zeros((6, 12), dtype=float)
        first[0] = np.arange(100, 112)
        first[1:5] = np.arange(48, dtype=float).reshape(4, 12)
        first[5] = 1

        second = np.zeros((6, 8), dtype=float)
        second[0] = np.arange(112, 120)
        second[1:5] = np.arange(32, dtype=float).reshape(4, 8) + 1000
        second[5] = 1

        emitted: list[dict] = []
        with patch.object(self.bridge, "emit", side_effect=emitted.append):
            session._on_chunk(first, 12)
            session._on_chunk(second, 8)

        self.assertEqual(len(emitted), 2)
        first_batch = emitted[0]["batch"]
        second_batch = emitted[1]["batch"]
        self.assertEqual(first_batch["sequenceStart"], 0)
        self.assertEqual(second_batch["sequenceStart"], 10)
        self.assertEqual(first_batch["sampleCount"], 10)
        self.assertEqual(first_batch["channelCount"], 4)
        self.assertEqual(first_batch["sourceSampleNumberStart"], 100)
        self.assertEqual(second_batch["sourceSampleNumberStart"], 110)
        self.assertEqual(len(first_batch["values"]), 4)
        self.assertTrue(all(len(row) == 10 for row in first_batch["values"]))

    def test_sample_callback_accepts_transposed_sdk_chunk(self) -> None:
        session = self.bridge.BrainAccessSession()
        session.connect("BA MAXI 009")
        session.start_stream()

        chunk = np.zeros((10, 6), dtype=float)
        chunk[:, 0] = np.arange(200, 210)
        chunk[:, 1:5] = np.arange(40, dtype=float).reshape(10, 4)
        chunk[:, 5] = 1

        emitted: list[dict] = []
        with patch.object(self.bridge, "emit", side_effect=emitted.append):
            session._on_chunk(chunk, 10)

        self.assertEqual(emitted[0]["type"], "samples")
        self.assertEqual(emitted[0]["batch"]["sourceSampleNumberStart"], 200)

    def test_malformed_chunk_becomes_bridge_error_event(self) -> None:
        session = self.bridge.BrainAccessSession()
        session.connect("BA MAXI 009")
        session.start_stream()

        emitted: list[dict] = []
        with patch.object(self.bridge, "emit", side_effect=emitted.append):
            session._on_chunk(np.zeros((3, 5, 2)), 5)

        self.assertEqual(emitted[0]["type"], "bridge-error")
        self.assertIn("sample callback failed", emitted[0]["message"])

    def test_unexpected_device_disconnect_emits_event(self) -> None:
        session = self.bridge.BrainAccessSession()
        emitted: list[dict] = []

        with patch.object(self.bridge, "emit", side_effect=emitted.append):
            session._on_device_disconnect()

        self.assertEqual(
            emitted,
            [
                {
                    "type": "device-disconnected",
                    "reason": "BrainAccess Bluetooth connection was lost.",
                }
            ],
        )

    def test_handle_request_reports_unknown_command_as_response_error(self) -> None:
        emitted: list[dict] = []
        with patch.object(self.bridge, "emit", side_effect=emitted.append):
            keep_running = self.bridge.handle_request({"id": "x", "command": "nope"})

        self.assertTrue(keep_running)
        self.assertEqual(emitted[0]["type"], "response")
        self.assertFalse(emitted[0]["ok"])
        self.assertIn("Unknown BrainAccess bridge command", emitted[0]["error"])

    def test_main_handles_malformed_json_sequential_requests_and_shutdown(self) -> None:
        class StubSession:
            def __init__(self) -> None:
                self.shutdown_calls = 0

            def shutdown(self) -> None:
                self.shutdown_calls += 1

        stub = StubSession()
        stdin = io.StringIO(
            "not-json\n"
            '{"id":"1","command":"ping"}\n'
            '{"id":"2","command":"unknown"}\n'
            '{"id":"3","command":"shutdown"}\n'
        )
        stdout = io.StringIO()
        stderr = io.StringIO()

        with (
            patch.object(self.bridge, "SESSION", stub),
            patch.object(sys, "stdin", stdin),
            patch.object(sys, "stdout", stdout),
            patch.object(sys, "stderr", stderr),
        ):
            self.bridge.main()

        messages = [json.loads(line) for line in stdout.getvalue().splitlines() if line]
        self.assertEqual(messages[0], {"type": "ready", "protocolVersion": 1})
        self.assertEqual(messages[1]["type"], "bridge-error")
        self.assertTrue(messages[2]["ok"])
        self.assertEqual(messages[2]["result"]["protocolVersion"], 1)
        self.assertFalse(messages[3]["ok"])
        self.assertTrue(messages[4]["ok"])
        self.assertEqual(messages[4]["result"], {"shutdown": True})
        # shutdown command + finally cleanup
        self.assertEqual(stub.shutdown_calls, 2)

        # Protocol purity: every stdout line is valid JSON; diagnostics never leak there.
        for line in stdout.getvalue().splitlines():
            json.loads(line)


if __name__ == "__main__":
    unittest.main()
