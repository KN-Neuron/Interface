import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from server import BridgeServer, Session


class AccessTests(unittest.TestCase):
    def setUp(self):
        self.server = BridgeServer(("127.0.0.1", 0), "secret", "http://localhost:8080", ".")
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, path="/health", origin="http://localhost:8080", token="secret", host=None, method="POST", body=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        conn.request(method, path, json.dumps(body or {}), {"Origin": origin, "Authorization": "Bearer " + token, "Host": host or f"127.0.0.1:{self.server.server_port}"})
        response = conn.getresponse()
        result = response.status, response.getheader("Access-Control-Allow-Origin"), response.read()
        conn.close()
        return result

    def test_authentication_and_origin(self):
        self.assertEqual(self.request()[0], 200)
        self.assertEqual(self.request(token="wrong")[0], 401)
        status, cors, _ = self.request(origin="https://malicious.example")
        self.assertEqual(status, 403)
        self.assertIsNone(cors)
        self.assertEqual(self.request(host="malicious.example")[0], 403)
        self.assertEqual(self.request(method="OPTIONS")[0], 204)
        self.assertEqual(self.request(method="OPTIONS", origin="null")[0], 403)

    def test_invalid_routes_and_sessions(self):
        self.assertEqual(self.request(path="/other/start")[0], 404)
        self.assertEqual(self.request(path="/brainaccess/command", body={"session": "stale"})[0], 409)
        self.assertEqual(self.request(path="/brainaccess/start")[0], 409)


class ProtocolTests(unittest.TestCase):
    def test_stream_and_command_and_overflow(self):
        with tempfile.TemporaryDirectory() as directory:
            helper = Path(directory) / "helper"
            helper.write_text('''#!/usr/bin/env python3
import json,sys
for line in sys.stdin:
 r=json.loads(line)
 if r["command"] == "shutdown": break
 print(json.dumps({"type":"response","id":r["id"],"ok":True,"result":{"pong":True}}),flush=True)
 print(json.dumps({"type":"samples","batch":{"sampleCount":1}}),flush=True)
''')
            helper.chmod(0o700)
            session = Session(helper)
            try:
                self.assertEqual(session.request("ping", {}), {"pong": True})
                result = session.poll(0)
                self.assertEqual(result["events"][0]["type"], "samples")
                with session.condition:
                    session.sequence = 3000
                    session.events.clear()
                    session.events.append((3000, {"type": "samples"}))
                with self.assertRaisesRegex(RuntimeError, "fell behind"):
                    session.poll(0)
            finally:
                session.close()
            self.assertIsNotNone(session.process.poll())


class ManagedAccessTests(AccessTests):
    def setUp(self):
        self.server = BridgeServer(("127.0.0.1", 0), "secret", "http://localhost:8080", ".", managed=True)
        self.server.arm_lease()
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()

    def test_claim_is_origin_bound_and_single_use(self):
        ticket = self.server.claim_ticket
        self.assertEqual(self.request(path="/claim", token=ticket, origin="https://malicious.example")[0], 403)
        self.assertEqual(self.request(path="/claim", token="wrong")[0], 401)
        status, _, body = self.request(path="/claim", token=ticket)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["token"], "secret")
        self.assertEqual(self.request(path="/claim", token=ticket)[0], 401)
        self.assertEqual(self.request(path="/heartbeat")[0], 200)
        self.assertTrue(self.server.heartbeat_seen.is_set())

    def test_expired_ticket_does_not_pair(self):
        self.server.claim_deadline = 0
        self.assertEqual(self.request(path="/claim", token=self.server.claim_ticket)[0], 401)

    def test_lost_browser_expires_bridge(self):
        self.server.lease_deadline = 0
        self.assertTrue(self.server.lease_expired.wait(7))
        self.assertEqual(self.request(path="/heartbeat")[0], 409)


if __name__ == "__main__":
    unittest.main()
