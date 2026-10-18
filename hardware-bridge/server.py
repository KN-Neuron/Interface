"""Loopback-only, authenticated browser transport for the existing EEG sidecars."""
import argparse
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import signal
from pathlib import Path
import secrets
import subprocess
import sys
import threading
import time

COMMANDS = {
    "brainaccess": {"ping", "scan", "connect", "disconnect", "start_stream", "stop_stream"},
    "brainlink": {"ping", "scan", "connect", "disconnect", "get_metrics"},
}


class Session:
    def __init__(self, executable):
        self.id = secrets.token_urlsafe(24)
        self.condition = threading.Condition()
        self.responses = {}
        self.events = deque(maxlen=2048)
        self.sequence = 0
        self.pending = set()
        self.closed = False
        self.last_seen = time.monotonic()
        self.process = subprocess.Popen([str(executable)], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=sys.stderr if sys.stderr is not None else subprocess.DEVNULL,
                                        text=True, encoding="utf-8", bufsize=1,
                                        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
                                        start_new_session=sys.platform != "win32")
        threading.Thread(target=self.read, daemon=True).start()

    def read(self):
        try:
            for line in self.process.stdout:
                try:
                    message = json.loads(line)
                except (ValueError, TypeError):
                    continue
                with self.condition:
                    if message.get("type") == "response":
                        if message.get("id") in self.pending:
                            self.responses[message["id"]] = message
                    elif message.get("type") in {"samples", "metrics", "device-disconnected", "bridge-error"}:
                        self.sequence += 1
                        self.events.append((self.sequence, message))
                    self.condition.notify_all()
        finally:
            with self.condition:
                self.closed = True
                self.condition.notify_all()

    def request(self, command, payload):
        request_id = secrets.token_hex(12)
        with self.condition:
            if self.closed:
                raise RuntimeError("Hardware helper exited. Reconnect the device.")
            self.pending.add(request_id)
            try:
                self.process.stdin.write(json.dumps({"id": request_id, "command": command, "payload": payload}) + "\n")
                self.process.stdin.flush()
                if not self.condition.wait_for(lambda: request_id in self.responses or self.closed, 90):
                    raise TimeoutError("Hardware command timed out.")
                response = self.responses.pop(request_id, None)
                if response is None:
                    raise RuntimeError("Hardware helper exited.")
                if not response.get("ok"):
                    raise RuntimeError(response.get("error", "Hardware command failed."))
                return response.get("result")
            finally:
                self.pending.discard(request_id)

    def poll(self, cursor):
        with self.condition:
            self.condition.wait_for(lambda: self.sequence > cursor or self.closed, 10)
            self.last_seen = time.monotonic()
            if self.closed:
                raise RuntimeError("Hardware helper exited. Reconnect the device.")
            if cursor > self.sequence or (self.events and cursor < self.events[0][0] - 1):
                raise RuntimeError("EEG stream fell behind. Reconnect to avoid using incomplete data.")
            return {"cursor": self.sequence, "events": [event for seq, event in self.events if seq > cursor]}

    def close(self):
        with self.condition:
            if self.process.poll() is None:
                try:
                    self.process.stdin.write(json.dumps({"id": "closing", "command": "shutdown", "payload": {}}) + "\n")
                    self.process.stdin.flush()
                except OSError:
                    pass
            self.closed = True
            self.condition.notify_all()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            if sys.platform == "win32":
                subprocess.run(["taskkill", "/PID", str(self.process.pid), "/T", "/F"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            else:
                os.killpg(self.process.pid, signal.SIGKILL)
            self.process.wait(timeout=5)
        self.process.stdin.close()
        self.process.stdout.close()


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, token, origin, binaries, *, managed=False):
        super().__init__(address, Handler)
        self.token, self.origin, self.binaries = token, origin, Path(binaries)
        self.managed = managed
        self.claim_ticket = secrets.token_urlsafe(32) if managed else None
        self.claim_deadline = 0.0
        self.lease_deadline = None
        self.heartbeat_seen = threading.Event()
        self.lease_expired = threading.Event()
        self.sessions = {}
        self.lock = threading.Lock()
        self.stopping = threading.Event()
        threading.Thread(target=self.reap, daemon=True).start()

    def arm_lease(self):
        # Give the first browser launch time to load; subsequent heartbeats use 30s.
        self.claim_deadline = time.monotonic() + 90
        self.lease_deadline = time.monotonic() + 90

    def renew_lease(self):
        self.lease_deadline = time.monotonic() + 30
        self.heartbeat_seen.set()

    def reap(self):
        while not self.stopping.wait(5):
            with self.lock:
                if self.managed and self.lease_deadline is not None and time.monotonic() > self.lease_deadline:
                    self.lease_expired.set()
                    for session in self.sessions.values():
                        session.close()
                    self.sessions.clear()
                    return
                for name, session in list(self.sessions.items()):
                    if time.monotonic() - session.last_seen > 30:
                        session.close()
                        del self.sessions[name]

    def server_close(self):
        self.stopping.set()
        with self.lock:
            for session in self.sessions.values():
                session.close()
            self.sessions.clear()
        super().server_close()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Never log pairing credentials or EEG data.

    def allowed(self):
        return (self.headers.get("Origin") == self.server.origin and
                self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}")

    def reply(self, status, data):
        encoded = json.dumps(data, allow_nan=False).encode()
        self.send_response(status)
        if self.allowed():
            self.send_header("Access-Control-Allow-Origin", self.server.origin)
            self.send_header("Vary", "Origin")
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_OPTIONS(self):
        if not self.allowed():
            self.reply(403, {"error": "Origin not allowed."})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.server.origin)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Vary", "Origin")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        if not self.allowed():
            self.reply(403, {"error": "Origin not allowed."})
            return
        supplied = self.headers.get("Authorization", "").encode()
        if self.path == "/claim":
            with self.server.lock:
                ticket = self.server.claim_ticket
                if not ticket or time.monotonic() > self.server.claim_deadline or not secrets.compare_digest(supplied, ("Bearer " + ticket).encode()):
                    self.reply(401, {"error": "Launch link expired. Close this window and relaunch KNeuron."})
                    return
                self.server.claim_ticket = None
                self.server.renew_lease()
                self.reply(200, {"token": self.server.token})
                return
        if not secrets.compare_digest(supplied, ("Bearer " + self.server.token).encode()):
            self.reply(401, {"error": "Enter the pairing code shown in the hardware bridge window."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 8192:
                raise ValueError("Invalid request size.")
            self.connection.settimeout(10)
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("Invalid request.")
            if self.path == "/heartbeat":
                if not self.server.managed or self.server.lease_expired.is_set():
                    raise RuntimeError("Managed app session is closed.")
                self.server.renew_lease()
                self.reply(200, {"managed": True})
                return
            if self.path == "/health":
                self.reply(200, {"ready": True, "managed": self.server.managed})
                return
            parts = self.path.strip("/").split("/")
            if len(parts) != 2 or parts[0] not in COMMANDS:
                self.reply(404, {"error": "Unknown device endpoint."})
                return
            device, action = parts
            if action not in {"start", "stop", "events", "command"}:
                raise ValueError("Unknown action.")
            with self.server.lock:
                session = self.server.sessions.get(device)
                if action == "start":
                    if session:
                        raise RuntimeError("Device is already in use by another browser session. Disconnect it first or wait 30 seconds after closing that tab.")
                    exe = self.server.binaries / (f"{device}-bridge.exe" if sys.platform == "win32" else f"{device}-bridge")
                    if not exe.is_file():
                        raise RuntimeError(f"Missing helper: {exe.name}. Use the complete hardware bridge package.")
                    session = Session(exe)
                    self.server.sessions[device] = session
                    self.reply(200, {"session": session.id})
                    return
                if not session or not secrets.compare_digest(str(body.get("session", "")), session.id):
                    raise RuntimeError("Hardware session expired. Reconnect the device.")
                session.last_seen = time.monotonic()
                if action == "stop":
                    session.close()
                    del self.server.sessions[device]
                    self.reply(200, {})
                    return
            if action == "events":
                result = session.poll(int(body.get("cursor", 0)))
            else:
                command = body.get("command")
                payload = body.get("payload", {})
                if command not in COMMANDS[device] or not isinstance(payload, dict):
                    raise ValueError("Invalid hardware command.")
                result = session.request(command, payload)
            self.reply(200, result)
        except (ValueError, TypeError) as error:
            self.reply(400, {"error": str(error)})
        except (RuntimeError, OSError, TimeoutError) as error:
            self.reply(409, {"error": str(error)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", default="http://localhost:8080")
    parser.add_argument("--port", type=int, default=18765)
    parser.add_argument("--binaries", type=Path, default=Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).parent)
    args = parser.parse_args()
    if args.origin not in {"http://localhost:8080", "http://127.0.0.1:8080"}:
        parser.error("Only the local Docker interface origins are supported.")
    token = secrets.token_urlsafe(32)
    with BridgeServer(("127.0.0.1", args.port), token, args.origin, args.binaries) as server:
        print(f"KNeuron hardware bridge · {args.origin}\nPairing code: {token}\nKeep this window open. Press Ctrl+C to stop.\n", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
