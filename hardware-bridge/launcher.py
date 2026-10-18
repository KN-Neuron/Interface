"""Own one Docker/browser/Bluetooth session. No persistent host service is installed."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.parse
from server import BridgeServer


def hidden_process():
    return {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}


def browser_path(explicit=None):
    if explicit:
        candidate = Path(explicit)
        if candidate.is_file():
            return str(candidate.resolve())
        raise RuntimeError("The selected browser executable does not exist.")
    if sys.platform == "win32":
        for base in (os.environ.get("PROGRAMFILES", ""), os.environ.get("PROGRAMFILES(X86)", ""), os.environ.get("LOCALAPPDATA", "")):
            for suffix in ("Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe"):
                candidate = Path(base) / suffix
                if candidate.is_file():
                    return str(candidate)
    else:
        for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"):
            if executable := shutil.which(name):
                return executable
    raise RuntimeError("Install Google Chrome, Chromium, or Microsoft Edge, or pass --browser PATH.")


def compose_command(root):
    compose = root / "compose.yaml"
    if not compose.is_file():
        raise RuntimeError("Keep compose.yaml beside the launcher, or pass --project PATH_TO_INTERFACE.")
    if shutil.which("docker"):
        return ["docker", "compose", "--project-directory", str(root), "-f", str(compose)]
    if sys.platform == "win32" and shutil.which("wsl.exe"):
        # Reuse Docker Engine in the default WSL distribution if Desktop's CLI is absent.
        linux_root = run_command(["wsl.exe", "--exec", "wslpath", "-u", str(root)], timeout=30)
        return ["wsl.exe", "--exec", "docker", "compose", "--project-directory", linux_root, "-f", linux_root.rstrip("/") + "/compose.yaml"]
    raise RuntimeError("Docker is missing. Install/start Docker Desktop on Windows or Docker Engine + Compose on Linux.")


def run_command(command, *, timeout=900):
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, **hidden_process())
    if result.returncode:
        raise RuntimeError(f"Command failed: {' '.join(command[:3])}\n{result.stderr[-2000:]}\nCheck Docker is running and your account can access it.")
    return result.stdout.strip()


def stop_browser(process):
    if process and process.poll() is None:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, **hidden_process())
        else:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            if sys.platform != "win32":
                os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)


def run(args):
    root = args.project.resolve()
    browser = browser_path(args.browser)
    command = compose_command(root)
    binaries = args.binaries.resolve()
    for device in ("brainaccess", "brainlink"):
        helper = binaries / (f"{device}-bridge.exe" if sys.platform == "win32" else f"{device}-bridge")
        if not helper.is_file():
            raise RuntimeError(f"Missing {helper.name}. Use the complete launcher package or build hardware-bridge first.")
    # Bind first: a second launcher must fail before it can touch another session's container.
    with BridgeServer(("127.0.0.1", 18765), secrets.token_urlsafe(32), "http://localhost:8080", binaries, managed=True) as bridge:
        server_thread = threading.Thread(target=bridge.serve_forever, daemon=True)
        server_thread.start()
        browser_process = None
        started_container = False
        profile = None
        try:
            config = json.loads(run_command(command + ["config", "--format", "json"], timeout=30))
            ports = config.get("services", {}).get("app", {}).get("ports", [])
            if not any(str(port.get("published")) == "8080" and port.get("target") == 8080 and port.get("host_ip") == "127.0.0.1" for port in ports):
                raise RuntimeError("Managed mode requires app port 127.0.0.1:8080. Remove custom KNEURON_PORT/KNEURON_BIND_ADDRESS overrides or use the packaged compose.yaml.")
            was_running = bool(run_command(command + ["ps", "--status", "running", "-q", "app"], timeout=30))
            started_container = not was_running
            # Source checkout builds; distributed compose.yaml uses the same prebuilt image.
            up = ["up", "-d", "--wait", "--wait-timeout", "120"]
            if (root / "Dockerfile").is_file():
                up.append("--build")
            run_command(command + up)
            bridge.arm_lease()
            if getattr(args, "profile", None):
                profile = args.profile.resolve()
            elif sys.platform == "win32":
                profile = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "KNeuron" / "container-browser"
            else:
                profile = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))) / "kneuron" / "container-browser"
            profile.mkdir(parents=True, exist_ok=True)
            url = "http://localhost:8080/#kneuron-launch=" + urllib.parse.quote(bridge.claim_ticket)
            browser_process = subprocess.Popen([browser, "--app=" + url, "--user-data-dir=" + str(profile), "--no-first-run", "--no-default-browser-check", "--disable-background-mode", *getattr(args, "browser_arg", [])],
                                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                               start_new_session=sys.platform != "win32", **hidden_process())
            monitor_process = False
            while not bridge.lease_expired.wait(0.5):
                # Some Linux browser wrappers detach. In that case the lease owns cleanup.
                if bridge.heartbeat_seen.is_set() and browser_process.poll() is None:
                    monitor_process = True
                if monitor_process and browser_process.poll() is not None:
                    break
        finally:
            bridge.shutdown()
            server_thread.join(timeout=5)
            bridge.server_close()  # Stop headset helpers before waiting for Docker.
            stop_browser(browser_process)
            if started_container and not args.keep_container:
                run_command(command + ["stop", "app"], timeout=60)


def main():
    location = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
    default_root = location if (location / "compose.yaml").is_file() else location.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, default=default_root)
    parser.add_argument("--binaries", type=Path, default=location)
    parser.add_argument("--profile", type=Path, help="Override the dedicated persistent browser profile directory.")
    parser.add_argument("--browser")
    parser.add_argument("--browser-arg", action="append", default=[], help="Optional explicit browser argument, repeatable.")
    parser.add_argument("--keep-container", action="store_true", help="Keep Docker running after this app session closes.")
    args = parser.parse_args()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        run(args)
        return 0
    except KeyboardInterrupt:
        return 0
    except Exception as error:
        message = str(error)
        if sys.platform == "win32":
            ctypes.windll.user32.MessageBoxW(None, message, "KNeuron could not start", 0x10)
        else:
            print(f"KNeuron could not start: {message}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
