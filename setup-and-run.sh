#!/usr/bin/env bash
set -Eeuo pipefail

NO_LAUNCH=0
SKIP_SYSTEM=0

for arg in "$@"; do
  case "$arg" in
    --no-launch) NO_LAUNCH=1 ;;
    --skip-system) SKIP_SYSTEM=1 ;;
    -h|--help)
      cat <<'EOF'
KNeuron Linux bootstrap

Usage:
  ./setup-and-run.sh
  ./setup-and-run.sh --no-launch
  ./setup-and-run.sh --skip-system

Options:
  --no-launch    Prepare everything but do not start KNeuron.
  --skip-system  Do not install OS-level packages; only verify/use what exists.
EOF
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
ok()   { printf '\033[1;32m[OK]\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31m[ERROR]\033[0m %s\n' "$1" >&2; exit 1; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

if [[ ! -f "$ROOT/package.json" ]]; then
  die "package.json not found. Put setup-and-run.sh in the KNeuron repository root."
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  die "This script is for Linux."
fi

# ---------------------------------------------------------------------------
# Distribution / Tauri system dependencies
# ---------------------------------------------------------------------------

install_system_dependencies() {
  if [[ "$SKIP_SYSTEM" -eq 1 ]]; then
    warn "Skipping system package installation."
    return
  fi

  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    source /etc/os-release
  else
    die "Cannot detect Linux distribution (/etc/os-release is missing)."
  fi

  case "${ID:-}" in
    ubuntu|debian|linuxmint|pop)
      step "Installing Linux/Tauri/BCI system dependencies"
      sudo apt-get update
      sudo apt-get install -y \
        build-essential \
        curl \
        wget \
        file \
        git \
        pkg-config \
        libssl-dev \
        libwebkit2gtk-4.1-dev \
        libxdo-dev \
        libayatana-appindicator3-dev \
        librsvg2-dev \
        python3 \
        python3-pip \
        python3-venv \
        bluez \
        rfkill
      ;;
    *)
      die "Automatic system setup currently supports Ubuntu/Debian-family distributions. Detected: ${ID:-unknown}. Install Tauri v2 prerequisites manually, then rerun with --skip-system."
      ;;
  esac

  ok "Linux system dependencies installed"
}

# ---------------------------------------------------------------------------
# Node.js / npm
# ---------------------------------------------------------------------------

ensure_node() {
  local need_node=1

  if command_exists node && command_exists npm; then
    if node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit((major === 22 && minor >= 12) || major === 24 || major >= 26 ? 0 : 1)'; then
      need_node=0
      ok "Node $(node --version), npm $(npm --version)"
    else
      warn "Node $(node --version) is unsupported (requires 22.12+, 24, or 26+); installing current LTS via nvm."
    fi
  fi

  if [[ "$need_node" -eq 1 ]]; then
    if [[ "$SKIP_SYSTEM" -eq 1 ]]; then
      die "A supported Node.js version (22.12+, 24, or 26+) and npm are required."
    fi

    step "Installing Node.js LTS with nvm"

    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

    if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
      curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    fi

    # shellcheck disable=SC1090
    source "$NVM_DIR/nvm.sh"
    nvm install --lts
    nvm use --lts

    command_exists node || die "Node installation failed."
    command_exists npm || die "npm installation failed."

    ok "Node $(node --version), npm $(npm --version)"
  fi
}

# ---------------------------------------------------------------------------
# Rust / Cargo
# ---------------------------------------------------------------------------

ensure_rust() {
  if command_exists cargo && command_exists rustc; then
    ok "$(cargo --version)"
    return
  fi

  if [[ "$SKIP_SYSTEM" -eq 1 ]]; then
    die "Rust/cargo is required."
  fi

  step "Installing Rust stable toolchain"

  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain stable

  # shellcheck disable=SC1090
  source "$HOME/.cargo/env"

  command_exists cargo || die "Rust installation failed."
  ok "$(cargo --version)"
}

# ---------------------------------------------------------------------------
# Python / PyInstaller sidecars
# ---------------------------------------------------------------------------

ensure_python() {
  command_exists python3 || die "python3 is required."

  python3 - <<'PY'
import sys
if sys.version_info < (3, 10):
    raise SystemExit(
        f"Python >= 3.10 is required; found {sys.version.split()[0]}"
    )
print(f"[OK] Python {sys.version.split()[0]}")
PY
}

build_sidecar() {
  local dir="$1"
  local name="$2"
  local spec="$3"
  local venv="$ROOT/$dir/.venv"

  [[ -d "$ROOT/$dir" ]] || die "Missing directory: $dir"
  [[ -f "$ROOT/$dir/$spec" ]] || die "Missing PyInstaller spec: $dir/$spec"
  [[ -f "$ROOT/$dir/requirements.txt" ]] || die "Missing requirements.txt: $dir/requirements.txt"

  step "Building $name"

  if [[ ! -x "$venv/bin/python" ]]; then
    python3 -m venv "$venv"
  fi

  "$venv/bin/python" -m pip install --upgrade pip setuptools wheel
  "$venv/bin/python" -m pip install -r "$ROOT/$dir/requirements.txt"
  "$venv/bin/python" -m pip install --upgrade pyinstaller

  (
    cd "$ROOT/$dir"
    "$venv/bin/python" -m PyInstaller \
      --clean \
      --noconfirm \
      "$spec"
  )

  local built=""

  if [[ -f "$ROOT/$dir/dist/$name" ]]; then
    built="$ROOT/$dir/dist/$name"
  elif [[ -f "$ROOT/$dir/dist/$name/$name" ]]; then
    built="$ROOT/$dir/dist/$name/$name"
  else
    built="$(
      find "$ROOT/$dir/dist" -maxdepth 3 -type f -name "$name" -print -quit 2>/dev/null || true
    )"
  fi

  [[ -n "$built" && -f "$built" ]] || die "PyInstaller completed, but $name was not found under $dir/dist."

  mkdir -p "$ROOT/src-tauri/binaries"

  local target
  target="$(rustc -vV | awk '/^host:/ { print $2 }')"
  [[ -n "$target" ]] || die "Could not determine Rust host target."

  local destination="$ROOT/src-tauri/binaries/${name}-${target}"
  cp -f "$built" "$destination"
  chmod +x "$destination"

  ok "$name -> src-tauri/binaries/$(basename "$destination")"
}

# ---------------------------------------------------------------------------
# Bluetooth / serial permissions
# ---------------------------------------------------------------------------

prepare_device_permissions() {
  step "Checking Linux device permissions"

  if command_exists systemctl; then
    if systemctl list-unit-files bluetooth.service >/dev/null 2>&1; then
      sudo systemctl enable --now bluetooth.service >/dev/null 2>&1 || true
    fi
  fi

  if getent group dialout >/dev/null 2>&1; then
    if id -nG "$USER" | tr ' ' '\n' | grep -qx dialout; then
      ok "User is already in dialout group"
    else
      sudo usermod -aG dialout "$USER"
      warn "Added $USER to dialout. Log out and back in before using serial/RFCOMM devices."
    fi
  fi

  if command_exists rfkill; then
    sudo rfkill unblock bluetooth || true
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

printf '\n\033[1;36m============================================\033[0m\n'
printf '\033[1;36m KNeuron - Linux first-run bootstrap\033[0m\n'
printf '\033[1;36m============================================\033[0m\n'

install_system_dependencies
ensure_node
ensure_python
ensure_rust
prepare_device_permissions

step "Installing JavaScript dependencies"
if [[ -f "$ROOT/package-lock.json" ]]; then
  npm ci
else
  npm install
fi
ok "Node dependencies installed"

build_sidecar \
  "brainaccess-sidecar" \
  "brainaccess-bridge" \
  "brainaccess-bridge.spec"

build_sidecar \
  "ssvep-sidecar" \
  "ssvep-classifier" \
  "ssvep-classifier.spec"

build_sidecar \
  "brainlink-sidecar" \
  "brainlink-bridge" \
  "brainlink-bridge.spec"

step "Verifying runtime assets"

[[ -d "$ROOT/public/modules/cortex" ]] \
  && ok "Cortex assets found" \
  || warn "public/modules/cortex is missing"

if [[ -d "$ROOT/public/neuorrun/Build" && -f "$ROOT/public/neuorrun/manifest.json" ]]; then
  ok "Neuorrun WebGL runtime found"
else
  warn "Neuorrun WebGL runtime is missing. Keep public/neuorrun/Build in the repository or build/copy Neuorrun separately."
fi

step "Verifying generated Linux sidecars"

HOST_TARGET="$(rustc -vV | awk '/^host:/ { print $2 }')"

for name in \
  brainaccess-bridge \
  ssvep-classifier \
  brainlink-bridge
do
  file="$ROOT/src-tauri/binaries/${name}-${HOST_TARGET}"
  [[ -x "$file" ]] || die "Missing executable sidecar: $file"
  size="$(du -h "$file" | awk '{print $1}')"
  ok "$(basename "$file") ($size)"
done

printf '\n\033[1;32mKNeuron Linux setup completed successfully.\033[0m\n'

if [[ "$NO_LAUNCH" -eq 0 ]]; then
  step "Starting KNeuron"
  npm run tauri:dev
else
  echo
  echo "Launch later with:"
  echo "  npm run tauri:dev"
fi
