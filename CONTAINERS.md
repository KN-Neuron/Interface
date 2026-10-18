# Run KNeuron with Docker

Install Docker Engine with Compose or Docker Desktop using Linux containers. From this repository, run:

```sh
docker compose up --build -d
```

Open **http://localhost:8080**. The first run downloads images and builds the app; later runs reuse cached layers. Node, Rust, Python, and vendor SDKs do not need to be installed on the host. Windows, macOS, and Linux hosts with Docker can run this browser edition. Images build for the host architecture; x86-64 and ARM64 builds require the corresponding base images and scientific Python wheels.

In **Device**, connect **Simulation EEG** for Cortex 3D or TaaLON Miner, or **Simulation Brain Metrics** for Neuorrun. Only one device can be connected at a time. Miner uses the real Python FBCCA classifier with simulated input; its decisions do not represent your gaze. Neuorrun and TALON's bundled Unity WebGL assets are included. TALON supports free flight, device-free rooftop click testing, and rooftop trials using Simulation EEG through the container classifier. A browser and GPU with WebGL support are required; mobile browser compatibility depends on Unity and available memory.

## What is included

The container serves the production React build and an HTTP wrapper around the existing Python classifier. It runs as an unprivileged user, has a health check, and uses a read-only filesystem with temporary storage. The desktop/Tauri build keeps its native sidecars and hardware adapters.

The browser edition includes simulations and supports BrainAccess/BrainLink through the Windows loopback hardware bridge described below. It uses native helpers on the viewing computer for Bluetooth/serial access. It does not open a native desktop window. Docker containers also cannot be installed directly on most phones or tablets: run Docker on a supported computer/server and access it through a browser.

## Commands

```sh
# Logs and health/status
docker compose logs -f
docker compose ps

# Stop and remove the container
docker compose down
```

Use `docker compose up --build -d` again after source changes. App preferences and electrode layouts remain in each browser's local storage, not inside the container. Clearing browser storage removes them.

To change the port, set `KNEURON_PORT` before starting Compose (or put `KNEURON_PORT=8090` in a root `.env` file).

By default the app listens only on the Docker host's loopback interface. To access it from another device on a trusted LAN, put this in a root `.env` file:

```dotenv
KNEURON_BIND_ADDRESS=0.0.0.0
KNEURON_PORT=8080
```

Restart with `docker compose up --build -d`, then open `http://<docker-host-lan-ip>:8080`. The host firewall must allow that port. This demo has no authentication; do not expose it directly to the public internet. For remote hosting, use an authenticated HTTPS reverse proxy.

If Docker reports a socket permission error, use your platform's documented Docker setup to grant your account access or run Compose through an authorized administrator. The app does not need privileged containers or device passthrough.

## Verification

```sh
docker compose config --quiet
docker compose up --build -d --wait
curl --fail http://localhost:8080/api/health
```

The health endpoint should return `{"status":"ok"}`. In a browser, connect Simulation EEG and open Cortex, then run a Miner trial. Switch to Simulation Brain Metrics before opening Neuorrun.

Container API tests can run without Docker using Python 3.12 and the dependencies in `container/requirements.txt`:

```sh
PYTHONPATH=ssvep-sidecar:container python -m unittest discover -s container -v
```

## Managed app on Windows and Linux

Use the same Docker image with an OS-native launcher for Bluetooth. The launcher starts Compose, opens a dedicated Chrome/Chromium/Edge app window, pairs the host bridge automatically, and stops that bridge/headset helpers when the window exits. A heartbeat timeout covers lost browser sessions. It stops the app container only when it started that container itself; an already-running container is preserved.

Download the Windows or Linux x86-64 launcher package from Device, extract it, and run `kneuron-launcher.exe` or `./kneuron-launcher`. Docker must already be running and the shared `kneuron-app:latest` image must be built/loaded. Windows also supports Docker Engine in the default WSL distribution when the Windows Docker CLI is absent. No always-running service or manual pairing code is needed in managed mode. OS Bluetooth pairing and browser permissions may still be required.

From a source checkout, build the host package with `hardware-bridge/build.ps1` (Windows) or `bash hardware-bridge/build-linux.sh` (Linux), then run `Start-KNeuron.cmd` or `bash start-container.sh`. The source launcher also builds the Docker image. Packaged launchers use the prebuilt image. Use default ports 8080/18765. See [hardware-bridge/README.md](hardware-bridge/README.md) for dependencies, image distribution, cleanup behavior, and manual browser mode.

Linux packages target Ubuntu x86-64. Physical headset streaming remains a separate validation step on each OS; package/protocol tests do not establish Bluetooth hardware compatibility.
