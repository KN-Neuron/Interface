# Run KNeuron with Docker

Install Docker Engine with Compose or Docker Desktop using Linux containers. From this repository, run:

```sh
docker compose up --build -d
```

Open **http://localhost:8080**. The first run downloads images and builds the app; later runs reuse cached layers. Node, Rust, Python, and vendor SDKs do not need to be installed on the host. Windows, macOS, and Linux hosts with Docker can run this browser edition. Images build for the host architecture; x86-64 and ARM64 builds require the corresponding base images and scientific Python wheels.

In **Device**, connect **Simulation EEG** for Cortex 3D or TaaLON Miner, or **Simulation Brain Metrics** for Neuorrun. Only one device can be connected at a time. Miner uses the real Python FBCCA classifier with simulated input; its decisions do not represent your gaze. Neuorrun's bundled Unity WebGL assets are included. A browser and GPU with WebGL support are required; mobile browser compatibility depends on Unity and available memory.

## What is included

The container serves the production React build and an HTTP wrapper around the existing Python classifier. It runs as an unprivileged user, has a health check, and uses a read-only filesystem with temporary storage. The desktop/Tauri build keeps its native sidecars and hardware adapters.

The browser edition uses simulated devices. It cannot connect directly to BrainAccess or BrainLink, open a native desktop window, or access Bluetooth/serial devices on the viewing device. Native hardware use still requires the desktop setup documented in README.md. Docker containers also cannot be installed directly on most phones or tablets: run Docker on a supported computer/server and access it through a browser.

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
