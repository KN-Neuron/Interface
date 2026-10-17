"""Run with PYTHONPATH=ssvep-sidecar:container python -m unittest discover -s container."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        self.payload = {"eeg": [[0.5] * 1000], "sampleRateHz": 250,
                        "frequencies": [10.25, 13.75, 14.25, 14.75]}

    def test_health(self):
        self.assertEqual(self.client.get("/api/health").json, {"status": "ok"})

    def test_classification_uses_existing_pipeline(self):
        with patch.object(server, "classify", return_value={"winnerHz": 10.25}) as classify:
            response = self.client.post("/api/classify", json=self.payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["winnerHz"], 10.25)
        classify.assert_called_once_with(self.payload)

    def test_real_classifier_over_http(self):
        import numpy as np
        times = np.arange(1000) / 250
        signal = np.sin(2 * np.pi * 10.25 * times)
        response = self.client.post("/api/classify", json={**self.payload, "eeg": [signal.tolist()]})
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["winnerHz"], 10.25)
        self.assertEqual(response.json["sampleCount"], 1000)

    def test_invalid_requests(self):
        invalid = [None, [], {}, {**self.payload, "eeg": [[float("nan")] * 1000]},
                   {**self.payload, "eeg": [[1] * 1000, [1]]},
                   {**self.payload, "sampleRateHz": 0},
                   {**self.payload, "frequencies": [10, 10, 12, 13]}]
        for payload in invalid:
            with self.subTest(payload_type=type(payload)):
                response = self.client.post("/api/classify", data=json.dumps(payload), content_type="application/json")
                self.assertEqual(response.status_code, 400)
                self.assertIn("error", response.json)

    def test_busy_classifier(self):
        with server.classification_lock:
            response = self.client.post("/api/classify", json=self.payload)
        self.assertEqual(response.status_code, 503)

    def test_lock_released_after_classifier_error(self):
        with patch.object(server, "classify", side_effect=ValueError("Bad capture")):
            response = self.client.post("/api/classify", json=self.payload)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(server.classification_lock.locked())

    def test_static_files_wasm_and_missing_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_text("app")
            (root / "test.wasm").write_bytes(b"wasm")
            with patch.object(server, "DIST", root):
                with self.client.get("/") as response:
                    self.assertEqual(response.data, b"app")
                with self.client.get("/test.wasm") as response:
                    self.assertEqual(response.mimetype, "application/wasm")
                self.assertEqual(self.client.get("/missing.wasm").status_code, 404)
                self.assertEqual(self.client.get("/../server.py").status_code, 404)

    def test_malformed_json_and_oversized_request(self):
        self.assertEqual(self.client.post("/api/classify", data="{", content_type="application/json").status_code, 400)
        response = self.client.post("/api/classify", data=" " * (2 * 1024 * 1024 + 1), content_type="application/json")
        self.assertEqual(response.status_code, 413)
        self.assertIn("error", response.json)
