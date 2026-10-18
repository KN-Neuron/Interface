#!/usr/bin/env bash
set -euo pipefail
interface_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
launcher="$interface_root/hardware-bridge/dist/KNeuron-linux-x64/kneuron-launcher"
if [[ ! -x "$launcher" ]]; then
  echo 'Build the Linux host package first: bash hardware-bridge/build-linux.sh' >&2
  exit 1
fi
exec "$launcher" --project "$interface_root" "$@"
