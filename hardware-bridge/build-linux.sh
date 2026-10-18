#!/usr/bin/env bash
set -euo pipefail
bridge_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
python3 -m venv "$bridge_root/.venv"
"$bridge_root/.venv/bin/python" -m pip install -r "$bridge_root/../brainaccess-sidecar/requirements.txt" -r "$bridge_root/../brainlink-sidecar/requirements.txt"
exec "$bridge_root/.venv/bin/python" "$bridge_root/build.py" "$@"
