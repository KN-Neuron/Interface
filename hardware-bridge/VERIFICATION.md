# Managed container architecture verification

Verified 2026-10-18 in the local Windows/WSL workspace.

- Frontend: 124 tests passed; TypeScript checks and ESLint on changed frontend files passed.
- Host: 12 Python bridge/launcher tests passed, including origin/authentication checks, single-use launch tickets, expired tickets, lost-browser lease expiration, stream overflow rejection, graceful helper shutdown, and container ownership on normal/failing startup.
- Windows: packaged console-free launcher started the shared Docker image through the default WSL Docker Engine, opened actual Google Chrome in test-only headless mode, automatically paired, removed its launch fragment, and preserved the managed session on page reload. Both real packaged headset helpers answered protocol pings and shut down gracefully. Closing the Chrome window caused the launcher and bridge/helpers to exit. The pre-existing Docker container was preserved; no bridge/debugging listener remained.
- Linux: packaged native launcher used the same Docker image and a browser-process stand-in. Automatic pairing, real Linux BrainAccess/BrainLink helper pings, graceful helper shutdown, and launcher exit after the browser process ended passed. A native Linux GUI browser was not exercised in WSL.
- Linux binary artifacts were built on Ubuntu 24.04 x86-64 (glibc 2.39). Rebuild on an older supported distribution if distributing to older glibc versions.
- Physical headset scanning, connection, and live EEG/attention streaming still need testing on Windows and native Linux hardware. No physical headset connection was attempted during these checks.

Host packages: `public/hardware-bridge/KNeuron-windows-x64.zip` and `public/hardware-bridge/KNeuron-linux-x64.tar.gz`; hashes in `public/hardware-bridge/SHA256SUMS`. Docker must be running and the shared image built/loaded before using a distributed package. Source-checkout launchers also build the image automatically.
