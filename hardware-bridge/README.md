# Managed Docker app for Windows and Linux

The interface, TALON, Neuorrun, and classifier run in **one shared Linux Docker image**. The small OS-native launcher owns Bluetooth on the host. No permanent background service or login task is installed.

## Use the app

Prerequisites: Docker running (Docker Desktop with Linux containers on Windows, or Docker Engine + Compose in the default WSL distribution; Docker Engine + Compose recommended on Linux), Chrome/Chromium or Edge, and the `kneuron-app:latest` image. On a development machine, create/update that image with `docker compose build` from the Interface repository. To move it to another computer, use `docker save -o kneuron-app.tar kneuron-app:latest` and `docker load -i kneuron-app.tar`. Both packages use this same x86-64 Linux image. Other CPU architectures need matching images and headset SDK support.

1. Download and extract the package for your OS from Device: `KNeuron-windows-x64.zip` or `KNeuron-linux-x64.tar.gz`.
2. Start `kneuron-launcher.exe` on Windows or `./kneuron-launcher` on Linux. Keep the complete package together; it contains the headset helpers and `compose.yaml`.
3. The launcher starts Docker's app and opens a dedicated browser app window. Pairing happens automatically. Select **Device → Connect**, then choose a module.
4. Close the app window. Its bridge and headset helpers stop. If this launcher started the Docker container, it also stops that container. A container already running before launch stays running.

The Windows launcher and headset helpers run without a separate console window. On Linux, launch the executable from your file manager or a terminal. Your Docker daemon must already be running; the launcher does not install/start system services or elevate privileges. Initial OS Bluetooth pairing and any browser local-network permission are still required. Use the default local address `http://localhost:8080`; managed mode requires ports 8080 and 18765 free or an existing compatible KNeuron container on 8080.

For source development, build a host package, then invoke its launcher with `--project PATH_TO_INTERFACE`. The launcher builds the Docker image when that directory contains a Dockerfile. Packaged launchers reuse the prebuilt image, with no Node, Rust, Python, or SDK installation required for end users. `--browser PATH` chooses a browser executable. `--keep-container` keeps a newly started container running after exit. `KNEURON_IMAGE` selects an already-loaded image when using the packaged Compose file.

## Shutdown and safety

The bridge binds only `127.0.0.1:18765`, checks Host and the exact `http://localhost:8080` Origin, and authenticates every request. A random, **single-use launch ticket** is handed to the browser in its URL fragment, which is removed before rendering. Fragments are not sent to Docker or in HTTP referrers. The ticket expires after 90 seconds and exchanges once for a separate bearer token stored only in the app window's sessionStorage. Credentials and EEG are not logged.

The dedicated browser uses an isolated persistent profile so the launcher can monitor its process without closing your ordinary browser. App preferences and electrode layouts persist across launches in this dedicated profile; use `--profile PATH` to override its location. The window sends authenticated heartbeats every five seconds even while no headset is connected. If the browser disappears, the bridge expires after 30 seconds without a heartbeat (plus up to five seconds for checking). Normal browser-process exit triggers cleanup sooner. If a Linux browser wrapper detaches, the heartbeat timeout owns shutdown. A browser startup failure gets a 90-second allowance. Reloading the window preserves the session and resumes heartbeats.

Helpers receive graceful `shutdown` before forced process-tree cleanup. If the launcher crashes, closing its stdin pipes makes the existing helper loops exit and disconnect. This is a best-effort local lifecycle mechanism, not a hard real-time shutdown guarantee. Do not expose the bridge through a reverse proxy. A second launcher fails to bind before touching Docker. There is no service left intentionally running after the managed session closes.

## Linux Bluetooth prerequisites

Source-build target: **Ubuntu 22.04+ x86-64**, with the BrainAccess Linux SDK packaged in its helper. Install/enable your distribution's BlueZ Bluetooth service and turn on Bluetooth. BrainAccess scans through its native Linux SDK. BrainLink Lite uses Bluetooth Classic serial/RFCOMM and the existing ThinkGear parser; pair the device and expose its serial endpoint (for example `/dev/rfcomm0`) through your distribution's Bluetooth tooling. Your user needs access to that device, commonly through the `dialout` group; log out/in after group changes. Do not run the launcher as root or grant Docker privileged hardware access.

The package produced in this workspace was built on Ubuntu 24.04 (glibc 2.39); use Ubuntu 24.04+ for that artifact, or rebuild on Ubuntu 22.04 for an older runtime.

Linux headset streaming must still be verified with physical devices. WSL is useful for package/protocol tests, but is not validation of native Linux Bluetooth access. Ubuntu SDK support does not imply every Linux distribution or CPU architecture works.

## Build packages

Windows: build the existing BrainAccess and BrainLink sidecars, then run `powershell -ExecutionPolicy Bypass -File hardware-bridge/build.ps1`. It reuses their Python/PyInstaller environment and binaries. The source checkout can then be launched with `Start-KNeuron.cmd`. Explicit paths: `-PythonPath PATH -HelpersDirectory PATH`.

Linux: run `bash hardware-bridge/build-linux.sh` on Ubuntu x86-64 with Python 3 and python3-venv installed. It creates an isolated build environment using the existing sidecar requirements and builds the helpers, launcher, and optional manual bridge. To reuse helpers/environment, run `PYTHON hardware-bridge/build.py --helpers PATH --python PYTHON`. The source checkout can then be launched with `bash start-container.sh`. Each package must be built on its own OS; build Linux on the oldest supported glibc environment for wider distribution compatibility.

Downloads are written to `public/hardware-bridge/`; rebuild Docker to serve updated packages. Build host packages before building the final Docker image. Build outputs are ignored by Git and must be distributed with releases. The shared image and host packages should be released together.

Run `python3 -m unittest discover -s hardware-bridge -p 'test_*.py'` for authentication, single-use tickets, leases, protocol, and launcher ownership/cleanup tests. Physical headset validation is separate.

## Manual browser mode

The packaged `kneuron-hardware-bridge[.exe]` remains available for manual use. Start it in a terminal, keep it running, and paste its pairing code into Device in an ordinary browser tab. Unlike managed mode, this bridge stays running until stopped, although inactive headset helpers expire after 30 seconds. This mode also permits `--origin http://127.0.0.1:8080`. The managed launcher always uses `http://localhost:8080`.
