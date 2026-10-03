from __future__ import annotations

import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np


SIDECAR_DIR = Path(__file__).resolve().parents[1]
BRIDGE_PATH = SIDECAR_DIR / "bridge.py"
if str(SIDECAR_DIR) not in sys.path:
    sys.path.insert(0, str(SIDECAR_DIR))


def load_bridge():
    spec = importlib.util.spec_from_file_location("k_neuron_ssvep_bridge_test", BRIDGE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load ssvep-sidecar/bridge.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class SSVEPBridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.bridge = load_bridge()

    @classmethod
    def tearDownClass(cls) -> None:
        sys.modules.pop("k_neuron_ssvep_bridge_test", None)

    def valid_payload(self) -> dict:
        return {
            "eeg": np.ones((6, 250), dtype=float).tolist(),
            "sampleRateHz": 250,
            "frequencies": [10.25, 11.25, 13.75, 14.75],
        }

    def test_classify_maps_predictor_output_to_protocol_result(self) -> None:
        payload = self.valid_payload()
        with patch.object(
            self.bridge,
            "fbcca_predict",
            return_value=(13.75, np.array([0.1, 0.2, 0.9, 0.3])),
        ):
            result = self.bridge.classify(payload)

        self.assertEqual(result["winnerHz"], 13.75)
        self.assertEqual(result["scores"]["13.75"], 0.9)
        self.assertEqual(result["sampleRateHz"], 250.0)
        self.assertEqual(result["channelCount"], 6)
        self.assertEqual(result["sampleCount"], 250)

    def test_classify_requires_exactly_four_frequencies(self) -> None:
        payload = self.valid_payload()
        payload["frequencies"] = [10.0, 11.0, 12.0]
        with self.assertRaisesRegex(ValueError, "exactly four"):
            self.bridge.classify(payload)

    def test_predictor_exception_is_returned_as_response_error(self) -> None:
        emitted: list[dict] = []
        request = {"id": "c1", "command": "classify", "payload": self.valid_payload()}

        with (
            patch.object(self.bridge, "fbcca_predict", side_effect=ValueError("bad EEG")),
            patch.object(self.bridge, "emit", side_effect=emitted.append),
        ):
            keep_running = self.bridge.handle(request)

        self.assertTrue(keep_running)
        self.assertFalse(emitted[0]["ok"])
        self.assertEqual(emitted[0]["id"], "c1")
        self.assertIn("bad EEG", emitted[0]["error"])

    def test_unknown_command_returns_error(self) -> None:
        emitted: list[dict] = []
        with patch.object(self.bridge, "emit", side_effect=emitted.append):
            keep_running = self.bridge.handle({"id": "x", "command": "unknown"})
        self.assertTrue(keep_running)
        self.assertFalse(emitted[0]["ok"])
        self.assertIn("Unknown SSVEP command", emitted[0]["error"])

    def test_shutdown_returns_false_and_acknowledges(self) -> None:
        emitted: list[dict] = []
        with patch.object(self.bridge, "emit", side_effect=emitted.append):
            keep_running = self.bridge.handle({"id": "x", "command": "shutdown"})
        self.assertFalse(keep_running)
        self.assertTrue(emitted[0]["ok"])
        self.assertEqual(emitted[0]["result"], {"shutdown": True})

    def test_main_protocol_keeps_stdout_json_only(self) -> None:
        stdin = io.StringIO(
            "bad-json\n"
            '{"id":"1","command":"ping"}\n'
            '{"id":"2","command":"unknown"}\n'
            '{"id":"3","command":"shutdown"}\n'
        )
        stdout = io.StringIO()
        stderr = io.StringIO()

        with (
            patch.object(sys, "stdin", stdin),
            patch.object(sys, "stdout", stdout),
            patch.object(sys, "stderr", stderr),
        ):
            self.bridge.main()

        messages = [json.loads(line) for line in stdout.getvalue().splitlines() if line]
        self.assertEqual(messages[0], {"type": "ready", "protocolVersion": 1})
        self.assertTrue(messages[1]["ok"])
        self.assertFalse(messages[2]["ok"])
        self.assertTrue(messages[3]["ok"])
        self.assertIn("Invalid protocol input", stderr.getvalue())

        for line in stdout.getvalue().splitlines():
            json.loads(line)

    def test_multiple_sequential_classify_requests_keep_ids_correlated(self) -> None:
        payload = self.valid_payload()
        line1 = json.dumps({"id": "a", "command": "classify", "payload": payload})
        line2 = json.dumps({"id": "b", "command": "classify", "payload": payload})
        stdin = io.StringIO(line1 + "\n" + line2 + "\n" + '{"id":"z","command":"shutdown"}\n')
        stdout = io.StringIO()

        with (
            patch.object(
                self.bridge,
                "fbcca_predict",
                return_value=(10.25, np.array([1.0, 0.2, 0.1, 0.0])),
            ),
            patch.object(sys, "stdin", stdin),
            patch.object(sys, "stdout", stdout),
        ):
            self.bridge.main()

        responses = [
            json.loads(line)
            for line in stdout.getvalue().splitlines()
            if '"type":"response"' in line
        ]
        self.assertEqual([r["id"] for r in responses], ["a", "b", "z"])
        self.assertTrue(all(r["ok"] for r in responses))


if __name__ == "__main__":
    unittest.main()
