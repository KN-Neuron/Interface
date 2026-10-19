from __future__ import annotations

import importlib.util
import io
import json
import socket
import sys
import threading
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from neurostate.acquisition.mock_source import run_mock
from neurostate.config import Config, MockConfig
from neurostate.schema import BrainState, State

SIDECAR_DIR = Path(__file__).resolve().parents[1]
BRIDGE_PATH = SIDECAR_DIR / "bridge.py"


def load_bridge():
    spec = importlib.util.spec_from_file_location("k_neuron_neurostate_bridge_test", BRIDGE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load neurostate-sidecar/bridge.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def brain_state(state: State, quality: float = 90.0) -> BrainState:
    return BrainState(
        t=12.5,
        attention=61.26,
        relaxation=40.04,
        quality=quality,
        state=state,
        calibrated=False,
    )


class Events:
    """Collects emitted protocol messages from any thread."""

    def __init__(self) -> None:
        self.messages: list[dict] = []
        self._changed = threading.Condition()

    def append(self, message: dict) -> None:
        with self._changed:
            self.messages.append(message)
            self._changed.notify_all()

    def wait_for(self, predicate, timeout_s: float) -> dict:
        deadline = time.monotonic() + timeout_s
        with self._changed:
            while True:
                for message in self.messages:
                    if predicate(message):
                        return message
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise AssertionError(f"No matching event; got {self.messages[-5:]}")
                self._changed.wait(remaining)


class NeuroStateBridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.bridge = load_bridge()

    @classmethod
    def tearDownClass(cls) -> None:
        sys.modules.pop("k_neuron_neurostate_bridge_test", None)

    def test_emit_writes_one_compact_json_line(self) -> None:
        stdout = io.StringIO()
        with patch.object(sys, "stdout", stdout):
            self.bridge.emit({"type": "ready", "protocolVersion": 1})

        self.assertEqual(stdout.getvalue(), '{"type":"ready","protocolVersion":1}\n')

    def test_standard_profile_uses_neurostate_defaults(self) -> None:
        config = self.bridge.load_profile("standard")

        self.assertEqual(config.input.montage, "standard-1020")
        self.assertEqual(config.outputs.json_tcp.port, 13855)

    def test_midi_profile_tunes_for_dry_electrodes(self) -> None:
        config = self.bridge.load_profile("brainaccess-midi")

        self.assertEqual(config.input.montage, "brainaccess-midi")
        self.assertEqual(config.bad_channels.mains_ratio, 10)

    def test_profile_names_cannot_escape_the_profiles_folder(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "Invalid neurostate profile"):
            self.bridge.load_profile("../secrets")

        with self.assertRaisesRegex(RuntimeError, "Unknown neurostate profile"):
            self.bridge.load_profile("brainaccess-nope")

    def test_brain_state_event_carries_thinkgear_signal_level(self) -> None:
        usable = self.bridge.brain_state_event(brain_state(State.UNCALIBRATED))
        poor = self.bridge.brain_state_event(brain_state(State.POOR_SIGNAL, quality=25.0))
        none = self.bridge.brain_state_event(brain_state(State.NO_SIGNAL, quality=0.0))

        self.assertEqual(
            usable,
            {
                "type": "brain-state",
                "state": {
                    "t": 12.5,
                    "attention": 61.3,
                    "relaxation": 40.0,
                    "quality": 90.0,
                    "state": "uncalibrated",
                    "calibrated": False,
                    "poorSignalLevel": 0,
                },
            },
        )
        self.assertEqual(poor["state"]["poorSignalLevel"], 150)
        self.assertEqual(none["state"]["poorSignalLevel"], 200)

    def test_start_requires_a_stream_name(self) -> None:
        events = Events()
        with patch.object(self.bridge, "emit", side_effect=events.append):
            keep_running = self.bridge.handle_request({"id": "1", "command": "start"})

        self.assertTrue(keep_running)
        self.assertFalse(events.messages[0]["ok"])
        self.assertIn("payload.stream", events.messages[0]["error"])

    def test_unknown_command_is_a_response_error(self) -> None:
        events = Events()
        with patch.object(self.bridge, "emit", side_effect=events.append):
            self.bridge.handle_request({"id": "x", "command": "nope"})

        self.assertFalse(events.messages[0]["ok"])
        self.assertIn("Unknown neurostate bridge command", events.messages[0]["error"])

    def test_main_keeps_stdout_pure(self) -> None:
        stdin = io.StringIO(
            "not-json\n"
            '{"id":"1","command":"ping"}\n'
            '{"id":"2","command":"stop"}\n'
            '{"id":"3","command":"shutdown"}\n'
        )
        stdout = io.StringIO()
        stderr = io.StringIO()

        def noisy_ping(request):
            print("a library talking on stdout")
            return original(request)

        original = self.bridge.handle_request
        with (
            patch.object(sys, "stdin", stdin),
            patch.object(sys, "stdout", stdout),
            patch.object(sys, "stderr", stderr),
            patch.object(self.bridge, "handle_request", side_effect=noisy_ping),
        ):
            self.bridge.main()
            restored = sys.stdout

        messages = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertEqual(messages[0], {"type": "ready", "protocolVersion": 1})
        self.assertEqual(messages[1]["type"], "bridge-error")
        self.assertEqual(messages[2]["result"], {"protocolVersion": 1})
        self.assertEqual(messages[3]["result"], {"running": False})
        self.assertEqual(messages[4]["result"], {"shutdown": True})
        self.assertIn("a library talking on stdout", stderr.getvalue())
        self.assertIs(restored, stdout)

    def test_service_reads_an_lsl_stream_and_publishes_values(self) -> None:
        mock = MockConfig(stream_name=f"kneuron-test-{uuid.uuid4().hex[:8]}")
        stop_mock = threading.Event()
        mock_thread = threading.Thread(
            target=run_mock, args=(mock,), kwargs={"stop": stop_mock}, daemon=True
        )
        mock_thread.start()
        self.addCleanup(mock_thread.join, 5)
        self.addCleanup(stop_mock.set)

        # Any free port, and only the JSON output, so the test can't clash with a
        # neurostate already running on this machine.
        config = Config.model_validate(
            {
                "outputs": {
                    "json_tcp": {"port": 0},
                    "lsl": {"enabled": False},
                    "websocket": {"enabled": False},
                    "thinkgear": {"enabled": False},
                }
            }
        )

        session = self.bridge.NeuroStateSession()
        events = Events()
        with patch.object(self.bridge, "emit", side_effect=events.append):
            self.assertEqual(
                session.start(mock.stream_name, config),
                {"started": True, "stream": mock.stream_name},
            )
            self.assertEqual(session.start(mock.stream_name, config)["started"], False)

            running = events.wait_for(lambda m: m.get("status") == "running", 30)
            update = events.wait_for(lambda m: m["type"] == "brain-state", 10)

            # neurostate's own JSON output carries the same values for the games.
            address = running["outputs"][0].rsplit(" ", 1)[-1]
            host, port = address.rsplit(":", 1)
            with socket.create_connection((host, int(port)), timeout=5) as client:
                line = client.makefile().readline()
            self.assertEqual(json.loads(line)["v"], 1)

            self.assertEqual(session.stop(), {"running": False})
            events.wait_for(lambda m: m.get("status") == "stopped", 10)

        self.assertIn(update["state"]["state"], {"calibrating", "poor_signal", "no_signal"})
        self.assertFalse(session.running)

    def start_mock(self, **settings) -> MockConfig:
        mock = MockConfig(stream_name=f"kneuron-test-{uuid.uuid4().hex[:8]}", **settings)
        stop_mock = threading.Event()
        thread = threading.Thread(
            target=run_mock, args=(mock,), kwargs={"stop": stop_mock}, daemon=True
        )
        thread.start()
        self.addCleanup(thread.join, 5)
        self.addCleanup(stop_mock.set)
        return mock

    def run_check(self, mock: MockConfig, config: Config, until) -> Events:
        session = self.bridge.CheckSession()
        events = Events()
        with patch.object(self.bridge, "emit", side_effect=events.append):
            self.assertTrue(session.start(mock.stream_name, config)["started"])
            try:
                events.wait_for(until, 30)
            finally:
                self.assertEqual(session.stop(), {"running": False})
        return events

    def test_signal_check_reports_channels_signals_and_spectrum(self) -> None:
        midi = "P8,O2,P4,C4,F8,F4,Oz,Cz,Fz,Pz,F3,O1,P7,C3,P3,F7".split(",")
        mock = self.start_mock(channels=midi, alpha_uv=20.0)

        events = self.run_check(
            mock,
            self.bridge.load_profile("brainaccess-midi"),
            lambda m: m["type"] == "check-status" and m["spectrum"] is not None,
        )

        info = next(m for m in events.messages if m["type"] == "check-info")
        self.assertEqual(info["labels"], midi)
        # Regions list channels in the montage's order.
        self.assertEqual(info["spectrumChannels"], ["O1", "Oz", "O2"])
        self.assertEqual(info["regions"]["frontal"], ["Fz", "F3", "F4"])
        self.assertEqual(info["thresholds"]["mainsRatio"], 10)

        signals = next(m for m in events.messages if m["type"] == "check-signals")
        self.assertEqual(len(signals["values"]), 16)

        status = [m for m in events.messages if m["type"] == "check-status"][-1]
        self.assertEqual([channel["label"] for channel in status["channels"]], midi)
        self.assertTrue(all(channel["status"] == "ok" for channel in status["channels"]))
        self.assertEqual(status["regions"]["occipital"], {"good": 3, "total": 3})
        self.assertEqual(status["stream"]["nominalRateHz"], 250.0)

        # The mock's alpha rhythm shows as the spectrum's peak over the back of the head.
        spectrum = status["spectrum"]
        peak_hz = spectrum["hz"][spectrum["psd"].index(max(spectrum["psd"]))]
        self.assertTrue(8 <= peak_hz <= 13, peak_hz)
        self.assertEqual(events.messages[-1], {
            "type": "check-state", "state": "stopped", "message": "Signal check stopped."
        })

    def test_signal_check_flags_mains_hum(self) -> None:
        mock = self.start_mock(line_noise_uv=40.0)

        events = self.run_check(
            mock,
            Config(),
            lambda m: m["type"] == "check-status" and m["channels"],
        )

        status = next(m for m in events.messages if m["type"] == "check-status" and m["channels"])
        self.assertIn("mains", {channel["status"] for channel in status["channels"]})

    def test_numbers_json_cannot_carry_become_null(self) -> None:
        self.assertEqual(self.bridge.finite(1.234, 1), 1.2)
        self.assertIsNone(self.bridge.finite(float("inf"), 1))
        self.assertIsNone(self.bridge.finite(float("nan"), 1))

    def test_start_check_requires_a_stream_name(self) -> None:
        events = Events()
        with patch.object(self.bridge, "emit", side_effect=events.append):
            self.bridge.handle_request({"id": "1", "command": "start_check"})

        self.assertIn("start_check requires payload.stream", events.messages[0]["error"])

    def test_stop_check_while_waiting_for_a_stream(self) -> None:
        session = self.bridge.CheckSession()
        events = Events()
        with patch.object(self.bridge, "emit", side_effect=events.append):
            session.start(f"kneuron-missing-{uuid.uuid4().hex[:8]}", Config())
            events.wait_for(lambda m: m.get("state") == "waiting-for-stream", 10)
            self.assertEqual(session.stop(), {"running": False})

        self.assertEqual(events.messages[-1]["state"], "stopped")

    def test_stop_while_waiting_for_a_stream(self) -> None:
        session = self.bridge.NeuroStateSession()
        events = Events()
        with patch.object(self.bridge, "emit", side_effect=events.append):
            session.start(f"kneuron-missing-{uuid.uuid4().hex[:8]}", Config())
            events.wait_for(lambda m: m.get("status") == "waiting-for-stream", 10)

            self.assertEqual(session.stop(), {"running": False})
            # Stopping again, as shutdown does at exit, is harmless.
            self.assertEqual(session.stop(), {"running": False})

        self.assertEqual(events.messages[-1]["status"], "stopped")


if __name__ == "__main__":
    unittest.main()
