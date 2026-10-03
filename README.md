# KNeuron

KNeuron is a modular desktop platform for EEG/BCI experiments developed for a scientific student project.

The application combines multiple brain-computer interface workflows in one desktop interface and separates:

- hardware communication,
- EEG/brain-metric acquisition,
- signal processing and classification,
- interactive modules,
- visualization,
- device-specific integrations.

The current application contains three production modules:

- **Cortex 3D** — live EEG visualization on an interactive 3D brain,
- **TaaLON Miner** — SSVEP control using FBCCA,
- **Neuorrun** — attention-based interaction using BrainLink Lite / ThinkGear metrics.

---

## Current stack

### Desktop shell

- Tauri 2
- React
- TypeScript
- Vite

### Visualization

- Three.js / WebGL
- Unity WebGL for Neuorrun

### Signal processing

- Python sidecars
- NumPy
- SciPy
- scikit-learn

### Supported devices

- **BrainAccess MAXI 009**
- **BrainLink Lite BL002 V2.0**

---

# Architecture

KNeuron is designed so that application modules do not communicate directly with hardware.

```text
                         KNeuron
                            │
                      DeviceManager
                  ┌─────────┴─────────┐
                  │                   │
        BrainAccess MAXI 009   BrainLink Lite
                  │                   │
             raw EEG              ThinkGear
                  │                   │
          EEGStreamService      BrainMetricsService
                  │                   │
          ┌───────┴────────┐          │
          │                │          │
     Cortex 3D        TaaLON Miner    │
                           │          │
                         FBCCA      Neuorrun
```

The key architectural rule is:

> Modules consume normalized application-level data and do not depend on hardware-native channel indexes, Bluetooth implementation details, COM ports, or vendor SDK internals.

---

# Devices

## BrainAccess MAXI 009

BrainAccess is used as the raw EEG device for Cortex 3D and TaaLON Miner.

Current normalized 32-channel layout:

```text
0  AF3
1  AFz
2  AF4
3  F7
4  F3
5  Fz
6  F4
7  F8
8  FC5
9  FC1
10 FC2
11 FC6
12 T7
13 C3
14 Cz
15 C4
16 T8
17 CP5
18 CP1
19 CP2
20 CP6
21 P7
22 P3
23 Pz
24 P4
25 P8
26 PO3
27 POz
28 PO4
29 O1
30 Oz
31 O2
```

The physical cap uses:

```text
Fp1 = REF
Fp2 = BIAS
```

Therefore these two positions are not exposed as EEG measurement channels.

BrainAccess communication is handled by a Python sidecar:

```text
BrainAccess MAXI 009
        ↓
BrainAccess Python SDK
        ↓
brainaccess-bridge
        ↓
BrainAccessEEGAdapter
        ↓
DeviceManager
        ↓
EEGStreamService
```

---

## BrainLink Lite

Neuorrun uses BrainLink Lite and native ThinkGear/eSense metrics.

The relevant values are:

```text
attention
meditation
poorSignalLevel
signalQualityPercent
```

The application does not use FBCCA for Neuorrun.

```text
BrainLink Lite
      ↓
Bluetooth serial / COM or RFCOMM
      ↓
brainlink-bridge
      ↓
BrainLinkAdapter
      ↓
BrainMetricsService
      ↓
Neuorrun
```

The UI presents signal quality as a percentage derived from `poorSignalLevel`.

---

# Modules

## Cortex 3D

Cortex 3D visualizes live EEG activity on an interactive 3D brain.

Main features:

- live BrainAccess EEG,
- interactive cortex,
- electrode visualization,
- band filtering,
- FAST activity,
- delta / theta / alpha / beta / gamma band power,
- calibration,
- filter warm-up,
- frozen baseline,
- robust median/MAD normalization,
- artifact telemetry,
- editable electrode positions,
- LOW / MEDIUM / HIGH mesh quality,
- persistent electrode layout.

### Processing concept

```text
raw EEG
   ↓
filtering
   ↓
feature extraction
   ↓
baseline normalization
   ↓
relative activity
   ↓
3D cortex visualization
```

The baseline is intentionally frozen after calibration so the visualization continues to represent deviation from the initial session state rather than adapting the reference continuously.

---

## TaaLON Miner

TaaLON Miner is an SSVEP-controlled game.

The module requests only posterior channels:

```text
POz
PO3
PO4
Oz
O1
O2
```

The BrainAccess device itself still streams the full 32-channel EEG.

### Default SSVEP frequencies

```text
UP     10.25 Hz
LEFT   13.75 Hz
RIGHT  14.25 Hz
DOWN   14.75 Hz
```

### FBCCA pipeline

```text
EEG trial
   ↓
DC removal
   ↓
5 filter-bank subbands
   ↓
CCA against target references
   ↓
5 harmonics
   ↓
weighted squared canonical correlations
   ↓
argmax
   ↓
UP / LEFT / RIGHT / DOWN
```

The classifier is implemented in Python and uses NumPy, SciPy and scikit-learn CCA.

---

## Neuorrun

Neuorrun is the original Unity game integrated into KNeuron as a WebGL module.

The game is controlled by BrainLink `attention`.

```text
BrainLink
   ↓
attention
   ↓
threshold
   ↓
interaction
```

The Unity project is built locally to WebGL and copied into:

```text
public/neuorrun/
```

KNeuron injects BrainLink metrics into Unity through:

```text
KNeuron React module
      ↓
Unity SendMessage
      ↓
KNeuronBridge.cs
      ↓
TGCConnectionController
      ↓
original game Controller
```

No FBCCA is used in Neuorrun.

---

# Repository structure

```text
KNeuron---Interface/
│
├── brainaccess-sidecar/
├── brainlink-sidecar/
├── ssvep-sidecar/
│
├── unity-patch/
│   └── prepare_webgl_build.py
│
├── public/
│   ├── modules/
│   │   └── cortex/
│   └── neuorrun/
│       └── Build/
│
├── src/
│   ├── core/
│   │   ├── devices/
│   │   ├── eeg/
│   │   ├── brainMetrics/
│   │   └── ssvep/
│   ├── features/
│   ├── modules/
│   │   ├── cortex/
│   │   ├── miner/
│   │   └── neuorrun/
│   └── styles/
│
├── src-tauri/
│   ├── binaries/
│   ├── capabilities/
│   ├── src/
│   └── tauri.conf.json
│
├── setup-and-run.ps1
├── setup-and-run.sh
├── package.json
├── package-lock.json
├── vite.config.ts
├── .gitignore
└── README.md
```

---

# Quick start on a new machine

KNeuron is primarily supported and validated on Windows. An experimental Linux bootstrap is also included for development and platform testing.

The goal is that after cloning the repository, the development environment and Python sidecars can be recreated locally instead of storing generated dependencies and build artifacts in Git.

## Windows

### 1. Clone the repository

```powershell
git clone <REPOSITORY_URL>
cd KNeuron---Interface
```

### 2. Run the bootstrap

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-and-run.ps1
```

The script checks or installs the required development environment and then builds the local sidecars.

It handles:

```text
Node.js / npm
Python
Rust / Cargo
Visual Studio C++ Build Tools
npm dependencies
BrainAccess sidecar
SSVEP classifier sidecar
BrainLink sidecar
```

After setup it verifies that Tauri sidecar binaries exist and starts:

```powershell
npm run tauri:dev
```

### Prepare without launching

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-and-run.ps1 -NoLaunch
```

Then start manually:

```powershell
npm run tauri:dev
```

### Windows requirements

The bootstrap expects:

- Windows 10/11,
- internet access during first setup,
- `winget` / Microsoft App Installer,
- permission to install development tools.

The first build can take significantly longer because Node packages, Rust dependencies and Python environments are created from scratch.

---

# Linux experimental setup

Linux support is currently experimental and has not been validated end-to-end with the full KNeuron hardware stack.

The included Linux bootstrap targets **Ubuntu/Debian-family distributions** and is intended primarily for development and platform testing.

### 1. Clone the repository

```bash
git clone <REPOSITORY_URL>
cd KNeuron---Interface
```

### 2. Make the bootstrap executable

```bash
chmod +x setup-and-run.sh
```

### 3. Run it

```bash
./setup-and-run.sh
```

The script installs/checks:

```text
Tauri Linux system dependencies
Node.js / npm
Python 3
Rust / Cargo
Bluetooth utilities
Python virtual environments
all three Python sidecars
```

The script attempts to prepare all three Python sidecars and checks device permissions used by serial/Bluetooth devices.

Successful setup does not guarantee that every hardware integration is supported by the underlying vendor SDK on Linux.

### Prepare without launching

```bash
./setup-and-run.sh --no-launch
```

### Skip OS package installation

If system dependencies are already installed:

```bash
./setup-and-run.sh --skip-system
```

### Important Linux note

If the script adds the current user to:

```text
dialout
```

BrainAccess support on Linux is not currently considered production-validated. The bootstrap can build the BrainAccess sidecar only if the BrainAccess SDK/dependency used by `brainaccess-sidecar/requirements.txt` is available and compatible with the target Linux environment. Real-device connectivity must be verified separately.

log out and log back in before using serial/RFCOMM devices.

The BrainAccess Python SDK is the component most likely to require platform-specific verification. The bootstrap can rebuild the sidecar only if the BrainAccess SDK/dependency used by `brainaccess-sidecar/requirements.txt` is available for the target Linux environment.

---

# What the bootstrap creates locally

The repository intentionally does not need to store every generated dependency.

After bootstrap, the local machine may contain:

```text
node_modules/
src-tauri/target/

brainaccess-sidecar/.venv/
brainaccess-sidecar/build/
brainaccess-sidecar/dist/

ssvep-sidecar/.venv/
ssvep-sidecar/build/
ssvep-sidecar/dist/

brainlink-sidecar/.venv/
brainlink-sidecar/build/
brainlink-sidecar/dist/

src-tauri/binaries/*
```

These directories/files can be regenerated and should generally not be treated as source code.

---

# Recommended `.gitignore`

Use:

```gitignore
# =========================================================
# KNeuron — .gitignore
# =========================================================


# ---------------------------------------------------------
# Node / React
# ---------------------------------------------------------

node_modules/
dist/


# ---------------------------------------------------------
# Rust / Tauri
# ---------------------------------------------------------

src-tauri/target/


# ---------------------------------------------------------
# Python
# ---------------------------------------------------------

**/.venv/
**/venv/
**/__pycache__/

*.pyc
*.pyo
*.pyd

.pytest_cache/
.mypy_cache/
.ruff_cache/


# ---------------------------------------------------------
# PyInstaller build artifacts
# ---------------------------------------------------------

brainaccess-sidecar/build/
brainaccess-sidecar/dist/

brainlink-sidecar/build/
brainlink-sidecar/dist/

ssvep-sidecar/build/
ssvep-sidecar/dist/


# ---------------------------------------------------------
# Generated Tauri sidecar binaries
# ---------------------------------------------------------

src-tauri/binaries/*
!src-tauri/binaries/.gitkeep


# ---------------------------------------------------------
# IDE / editor files
# ---------------------------------------------------------

.vscode/
.idea/


# ---------------------------------------------------------
# Operating system files
# ---------------------------------------------------------

.DS_Store
Thumbs.db
desktop.ini


# ---------------------------------------------------------
# Logs / temporary files
# ---------------------------------------------------------

*.log
*.tmp
*.temp


# ---------------------------------------------------------
# Miscellaneous caches
# ---------------------------------------------------------

.cache/
```

## Why these files are ignored

### `node_modules/`

Contains installed npm packages.

It can always be recreated from:

```text
package.json
package-lock.json
```

with:

```bash
npm ci
```

It should not be committed because it is large, platform-dependent and generated.

### `src-tauri/target/`

Contains Rust/Tauri compilation output:

```text
debug builds
release builds
incremental compilation cache
compiled dependencies
temporary linker artifacts
```

This directory can grow to several gigabytes.

It is regenerated by Cargo/Tauri and is not source code.

### `**/.venv/`

Python virtual environments contain copies of the Python interpreter and installed packages.

They are platform-specific and can be rebuilt from each sidecar's:

```text
requirements.txt
```

### `*/build/` and `*/dist/`

These are PyInstaller output directories.

They can contain:

```text
.pkg
.pyz
.toc
temporary compiled Python files
generated executables
```

They are build artifacts, not application source.

### `src-tauri/binaries/*

!src-tauri/binaries/.gitkeep`

The platform-specific sidecar executables can be rebuilt locally by the bootstrap/build scripts:

```text
brainaccess-bridge
ssvep-classifier
brainlink-bridge
```

Keeping generated sidecar binaries out of the repository substantially reduces repository size and avoids mixing Windows and Linux artifacts in Git.

`src-tauri/binaries/.gitkeep` may be committed only to preserve the otherwise-empty directory.

### IDE and OS files

Files such as:

```text
.vscode/
.idea/
.DS_Store
Thumbs.db
desktop.ini
```

describe a local editor or operating system and are not required to build KNeuron.

### Logs and caches

Logs, temporary files and caches contain no source-of-truth project state and should not be versioned.

---

# Files that should stay in Git

Do **not** ignore the following:

```text
package.json
package-lock.json

src/
src-tauri/src/
src-tauri/Cargo.toml
src-tauri/Cargo.lock
src-tauri/tauri.conf.json
src-tauri/capabilities/

brainaccess-sidecar/*.py
brainaccess-sidecar/*.spec
brainaccess-sidecar/requirements.txt
brainaccess-sidecar/build.ps1

ssvep-sidecar/*.py
ssvep-sidecar/*.spec
ssvep-sidecar/requirements.txt
ssvep-sidecar/build.ps1

brainlink-sidecar/*.py
brainlink-sidecar/*.spec
brainlink-sidecar/requirements.txt
brainlink-sidecar/build.ps1

public/modules/cortex/*.glb

public/neuorrun/Build/
public/neuorrun/manifest.json

unity-patch/

setup-and-run.ps1
setup-and-run.sh

README.md
.gitignore
```

### Why keep `package-lock.json` and `Cargo.lock`

Lock files make dependency resolution reproducible across machines.

### Why keep `*.spec`

PyInstaller spec files describe how sidecar executables are packaged.

They are part of the reproducible build definition.

### Why keep Cortex `.glb` files

The LOW / MEDIUM / HIGH brain meshes are runtime application assets, not generated caches.

### Why keep `public/neuorrun/Build/`

The current KNeuron repository contains the built Unity WebGL runtime so a developer cloning KNeuron does **not** also need the complete Unity project and Unity Editor just to run Neuorrun.

The relevant runtime files include:

```text
*.data
*.wasm
*.framework.js
*.loader.js
```

If Neuorrun source is later maintained in a separate repository and built automatically in CI, this policy can be changed.

---

# Verify what Git will include

To list all tracked or untracked files that are **not ignored**:

```powershell
git ls-files -co --exclude-standard
```

## Calculate their total size on Windows

```powershell
$files = git ls-files -co --exclude-standard

$total = 0

foreach ($file in $files) {
    if (Test-Path $file -PathType Leaf) {
        $total += (Get-Item $file).Length
    }
}

[PSCustomObject]@{
    MB = [math]::Round($total / 1MB, 2)
    GB = [math]::Round($total / 1GB, 3)
}
```

## Show the largest non-ignored files on Windows

```powershell
$files = git ls-files -co --exclude-standard

$files |
Where-Object { Test-Path $_ -PathType Leaf } |
ForEach-Object {
    $item = Get-Item $_

    [PSCustomObject]@{
        File = $_
        MB = [math]::Round($item.Length / 1MB, 2)
    }
} |
Sort-Object MB -Descending |
Select-Object -First 30 |
Format-Table -AutoSize
```

## Check Git history/object storage

```bash
git count-objects -vH
```

This is useful because deleting a large file from the current working tree does not automatically remove it from old Git history.

---

# Manual development setup

The bootstrap scripts are the preferred setup method.

If dependencies are already installed, frontend packages can be installed manually:

```bash
npm ci
```

Run the application:

```bash
npm run tauri:dev
```

---

# Quality checks

Before committing or preparing a release:

```bash
npm run format
npm run typecheck
npm test
npm run lint
```

If defined:

```bash
npm run quality
```

---

# Sidecars

KNeuron uses three production sidecars:

```text
brainaccess-bridge
ssvep-classifier
brainlink-bridge
```

Tauri's `externalBin` configuration references names without a platform target suffix:

```json
"externalBin": [
  "binaries/brainaccess-bridge",
  "binaries/ssvep-classifier",
  "binaries/brainlink-bridge"
]
```

On Windows, generated files use names similar to:

```text
brainaccess-bridge-x86_64-pc-windows-msvc.exe
ssvep-classifier-x86_64-pc-windows-msvc.exe
brainlink-bridge-x86_64-pc-windows-msvc.exe
```

On a typical x86_64 Linux machine:

```text
brainaccess-bridge-x86_64-unknown-linux-gnu
ssvep-classifier-x86_64-unknown-linux-gnu
brainlink-bridge-x86_64-unknown-linux-gnu
```

The bootstrap scripts create/copy these locally into:

```text
src-tauri/binaries/
```

---

# BrainLink diagnostics

On Windows:

```powershell
cd .\brainlink-sidecar
.\.venv\Scripts\python.exe .\diagnose.py
```

A valid connection should produce changing values such as:

```text
attention
meditation
poorSignalLevel
signalQualityPercent
```

If BrainLink is connected to a phone/tablet, disconnect it there before attempting to connect from KNeuron.

---

# Building Neuorrun manually

The repository normally keeps the generated WebGL runtime in:

```text
public/neuorrun/Build/
```

so Unity is not required on every development machine.

If rebuilding Neuorrun is required, use the original Unity project.

## Unity version

```text
Unity 2022.3.7f1
```

with WebGL Build Support.

## Recommended WebGL settings

```text
Compression Format: Disabled
Data Caching: Disabled
Threads: Disabled
```

## Expected build output

```text
Build/*.loader.js
Build/*.framework.js
Build/*.data
Build/*.wasm
```

## Copy the new build into KNeuron

Windows example:

```powershell
python .\unity-patch\prepare_webgl_build.py `
  "C:\Users\<user>\Desktop\NeuorrunWebGL" `
  ".\public\neuorrun"
```

After copying, verify:

```text
public/neuorrun/manifest.json
```

contains:

```json
{
  "ready": true
}
```

---

# Tauri WebGL CSP

Neuorrun is loaded into a canvas rather than an iframe.

Relevant directives:

```text
script-src 'self' 'wasm-unsafe-eval'
worker-src 'self' blob:
frame-src 'none'
```

---

# Recommended end-to-end test

After setup on a new machine:

```text
1. Start KNeuron.
2. Connect BrainAccess.
3. Open Cortex 3D.
4. Verify live EEG.
5. Exit Cortex.
6. Open TaaLON Miner.
7. Run an SSVEP trial.
8. Exit Miner.
9. Disconnect BrainAccess.
10. Connect BrainLink Lite.
11. Open Neuorrun.
12. Verify ATTENTION / MEDITATION / SIGNAL QUALITY.
13. Verify attention-driven interaction.
14. Exit Neuorrun.
15. Enter Neuorrun again.
16. Close KNeuron.
```

The application should not require a restart while switching between modules.

---

# Production configuration

The production Dashboard should contain:

```text
Cortex 3D
TaaLON Miner
Neuorrun
```

The production Device screen should contain:

```text
BrainAccess MAXI 009
BrainLink Lite
```

Development/test modules and Simulation EEG should not be registered in the production application.

---

# Release build

## Windows / general Tauri build

```bash
npm run tauri:build
```

or:

```bash
npx tauri build
```

Windows NSIS output is typically created under:

```text
src-tauri/target/release/bundle/nsis/
```

Linux packaging is currently experimental and should not be treated as a production-supported release path until it has been validated on the target distribution.

---

# Troubleshooting

## `localhost:1420` returns HTTP 404

Verify:

```text
package.json
index.html
```

exist in the repository root.

Test Vite separately:

```bash
npm run dev
```

---

## Tauri sidecar is missing

Rerun the bootstrap:

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-and-run.ps1 -NoLaunch
```

### Linux

```bash
./setup-and-run.sh --no-launch
```

Then inspect:

```text
src-tauri/binaries/
```

---

## BrainLink connects but no metrics are received on Windows

Check COM ports:

```powershell
[System.IO.Ports.SerialPort]::GetPortNames()
```

and:

```powershell
Get-CimInstance Win32_SerialPort |
Select-Object DeviceID, Name, Description
```

A port can be forced before starting KNeuron:

```powershell
$env:KNEURON_BRAINLINK_PORT="COM7"
npm run tauri:dev
```

Replace `COM7` with the actual outgoing Bluetooth COM port.

---

## BrainLink serial access fails on Linux

Verify membership:

```bash
groups
```

If `dialout` is missing:

```bash
sudo usermod -aG dialout "$USER"
```

then log out and log back in.

Also verify Bluetooth:

```bash
rfkill list bluetooth
systemctl status bluetooth
```

---

## Neuorrun reports `UNITY BUILD REQUIRED`

Verify:

```text
public/neuorrun/Build/
public/neuorrun/manifest.json
```

If missing, rebuild/copy the Unity WebGL output.

---

## Neuorrun loads but attention does not affect gameplay

First verify that `ATTENTION` changes in the KNeuron telemetry.

Then verify the Unity integration contains:

```text
KNeuronBridge.cs
patched TGCConnectionController.cs
```

The bridge GameObject must be named:

```text
KNeuronBridge
```

and the Unity receiver method must be:

```text
SetMetricsJson
```

---

# Developer extension guide

This section is the canonical guide for extending KNeuron with new modules, devices and sidecars.

The central rule is:

```text
hardware / vendor SDK
        ↓
device adapter / bridge
        ↓
DeviceManager
        ↓
application service
        ↓
module
        ↓
UI
```

A module consumes normalized KNeuron APIs. It must not know how a specific manufacturer transports or indexes the data.

---

## Extension architecture rules

Production modules must not:

```text
open COM/RFCOMM ports directly
call BrainAccess or another vendor SDK directly
spawn hardware sidecars directly
use physical/vendor EEG channel indexes
start a second independent hardware EEG stream
own the global active-device state
leave subscriptions/timers/render loops alive after unmount
```

Device adapters must not contain:

```text
game logic
module-specific rendering
Dashboard/UI state
manufacturer-specific behavior exposed above the adapter boundary
```

Use this dependency direction:

```text
module → service → adapter → bridge / SDK → hardware
```

Never make a core service depend on a concrete module.

---

# Contracts and interfaces

## Generic device contract

The generic device contract is represented by `DeviceAdapter`.

The core responsibilities are:

```text
info
getStatus()
connect()
disconnect()
subscribeStatus()
```

The exact TypeScript contract is the source of truth in the repository.

To locate it:

```bash
git grep -n "interface DeviceAdapter" src/core/devices
```

`DeviceManager` owns the application-level connection lifecycle and the currently active device.

Current architectural limitation:

> KNeuron uses one active physical device at a time through `DeviceManager`.

This does not prevent multiple modules from consuming one active EEG stream.

## Raw EEG contract

Raw EEG devices implement:

```text
EEGDeviceAdapter
```

The canonical file is:

```text
src/core/devices/contracts/EEGDeviceAdapter.ts
```

The EEG-specific operations used by the shared stream service are:

```text
getStreamInfo()
startStream()
stopStream()
isStreaming()
subscribeSamples()
```

The existing `EEGStreamService` also uses:

```text
adapter.info
adapter.getStatus()
```

The service lives at:

```text
src/core/eeg/EEGStreamService.ts
```

Device guards live at:

```text
src/core/devices/contracts/deviceGuards.ts
```

EEG models live at:

```text
src/core/devices/models/eeg.ts
```

Channel-selection helpers live under:

```text
src/core/devices/eeg/
```

## Brain-metrics contract

Devices such as BrainLink expose already-derived metrics instead of a raw multichannel EEG stream.

The current production reference path is:

```text
BrainLinkAdapter
      ↓
DeviceManager
      ↓
BrainMetricsService
      ↓
Neuorrun
```

Typical normalized metrics are:

```text
attention
meditation
poorSignalLevel
signalQualityPercent
```

When implementing a similar device, reuse the existing BrainMetrics contract/service rather than exposing vendor packet details to a module.

Locate the exact current files with:

```bash
git grep -n "BrainLinkAdapter" src
git grep -n "BrainMetricsService" src
```

## Choosing the correct contract

Use:

```text
raw time-series EEG
    → EEGDeviceAdapter + EEGStreamService

derived attention/meditation-style values
    → BrainMetrics contract + BrainMetricsService

vendor SDK / Python scientific code / serial parser
    → sidecar below the adapter
```

Choose based on the data exposed to KNeuron, not the marketing category of the device.

---

# Adding a new module

Production modules should follow the existing module architecture.

Recommended structure:

```text
src/modules/<module-id>/
├── <ModuleName>Module.tsx
├── <moduleName>Manifest.ts
├── <moduleName>ModuleDefinition.ts
├── components/
├── hooks/
├── services/
├── styles/
└── tests/
```

Not every module needs every subdirectory.

For example:

```text
src/modules/neurofeedback/
├── NeurofeedbackModule.tsx
├── neurofeedbackManifest.ts
├── neurofeedbackModuleDefinition.ts
├── hooks/
│   └── useNeurofeedbackEEG.ts
└── styles/
    └── neurofeedback.css
```

## Step 1 — create the manifest

KNeuron module metadata is represented by `KNeuronModuleManifest`.

The existing contract contains the project-level module identity and capabilities.

A typical manifest follows this pattern:

```ts
import type { KNeuronModuleManifest } from "../../types/module";

export const neurofeedbackManifest: KNeuronModuleManifest = {
  schemaVersion: 1,

  id: "neurofeedback",

  name: "Neurofeedback",

  version: "1.0.0",

  description: "Example EEG neurofeedback module.",

  category: "VISUALIZATION",

  appearance: {},

  entryPoint: "/modules/neurofeedback",

  capabilities: {
    eeg: {
      required: true,
    },
  },
};
```

Use slug-style IDs:

```text
neurofeedback
cortex-3d
ssvep-control
```

Avoid IDs containing spaces, underscores or display-name casing.

## Step 2 — create the React component

The current module component contract uses `KNeuronModuleProps`.

Example:

```tsx
import type { KNeuronModuleProps } from "../../features/modules/moduleDefinition";

export function NeurofeedbackModule({ onRequestClose }: KNeuronModuleProps) {
  return (
    <section>
      <h1>Neurofeedback</h1>

      <button type="button" onClick={onRequestClose}>
        Close
      </button>
    </section>
  );
}
```

A module component should contain module UI/orchestration, not device transport code.

## Step 3 — create the module definition

The production module registry operates on complete definitions.

Example:

```ts
import { NeurofeedbackModule } from "./NeurofeedbackModule";

import { neurofeedbackManifest } from "./neurofeedbackManifest";

import type { KNeuronModuleDefinition } from "../../features/modules/moduleDefinition";

export const neurofeedbackModuleDefinition: KNeuronModuleDefinition = {
  manifest: neurofeedbackManifest,
  component: NeurofeedbackModule,
};
```

The definition is the unit that binds:

```text
manifest + React component
```

## Step 4 — register the module

The built-in production registration entry point is:

```text
src/features/modules/registerBuiltInModules.ts
```

Import the definition there:

```ts
import { neurofeedbackModuleDefinition } from "../../modules/neurofeedback/neurofeedbackModuleDefinition";
```

and include it in the returned/registered definitions using the same pattern as the existing Cortex, Miner and Neuorrun definitions.

To verify the current production registry:

```bash
git grep -n "CortexModule" src/features/modules src/modules
git grep -n "NeuorrunModule" src/features/modules src/modules
git grep -n "registerBuiltInModules" src
```

Do **not** add a hard-coded module card to:

```text
App.tsx
Dashboard.tsx
ModuleHost.tsx
ModuleManager.ts
```

just because a new module was added.

The Dashboard should discover production modules through the canonical registry.

## Step 5 — declare device/capability requirements

A generic EEG module:

```ts
capabilities: {
  eeg: {
    required: true,
  },
}
```

An SSVEP-style module that requires specific channels:

```ts
capabilities: {
  eeg: {
    required: true,

    requiredChannels: [
      "O1",
      "O2",
      "Oz",
      "PO3",
      "PO4",
      "POz",
    ],
  },
}
```

Declare normalized EEG labels, not physical device indexes.

## Step 6 — consume EEG through `EEGStreamService`

Allowed:

```ts
import { eegStreamService } from "../../core/eeg";
```

Not allowed:

```ts
import { BrainAccessEEGAdapter } from "...";
import { BrainAccessBridge } from "...";
```

Acquire all channels:

```ts
const handle = await eegStreamService.acquire({
  channels: "all",
});
```

Acquire selected normalized channels:

```ts
const handle = await eegStreamService.acquire({
  channels: ["O1", "Oz", "O2"],
});
```

Use live batches:

```ts
const handle = await eegStreamService.acquire({
  channels: ["O1", "Oz", "O2"],

  onBatch: (batch) => {
    // Consume normalized EEG data.
  },
});
```

Read a buffered historical window:

```ts
const window = eegStreamService.getLatestWindow(2.0, ["O1", "Oz", "O2"]);
```

Do not create another global hardware ring buffer inside the module.

## Step 7 — use safe React lifecycle cleanup

Every successful EEG acquisition must eventually be released.

A safe pattern for an asynchronous acquire is:

```ts
useEffect(() => {
  let disposed = false;
  let handle: EEGStreamHandle | null = null;

  void (async () => {
    try {
      const acquired = await eegStreamService.acquire({
        channels: ["O1", "Oz", "O2"],

        onBatch: (batch) => {
          if (disposed) {
            return;
          }

          // Update module-specific processing/state.
        },
      });

      if (disposed) {
        await acquired.release();
        return;
      }

      handle = acquired;
    } catch (error) {
      if (!disposed) {
        // Surface module-level error state.
      }
    }
  })();

  return () => {
    disposed = true;

    if (handle) {
      void handle.release();
    }
  };
}, []);
```

The important invariant is:

```text
every successful acquire() → one effective release()
```

The module must also handle the race where it unmounts before `acquire()` finishes.

## Step 8 — use BrainMetrics through the service

For attention/meditation-style modules, copy the subscription lifecycle used by Neuorrun.

Locate it with:

```bash
git grep -n "BrainMetricsService" src/modules src/core
git grep -n "NeuorrunModule" src/modules
```

Do not connect to BrainLink or parse ThinkGear packets in the module.

## Step 9 — cleanup all owned resources

On unmount, release:

```text
EEGStreamHandle
brain-metrics subscription
classifier/event subscriptions
setInterval
setTimeout
requestAnimationFrame
DOM listeners
WebSocket/event listeners
module-owned Three.js resources
module-owned Unity/event hooks
```

For module-owned Three.js resources, dispose GPU resources that are no longer needed:

```text
geometry.dispose()
material.dispose()
texture.dispose()
renderer.dispose() when the renderer itself is module-owned
```

## Step 10 — test the module

At minimum test:

```text
manifest validation
definition registration
unique module ID behavior
component mounting
component unmounting
module error boundary behavior
missing/incompatible device state
required EEG channels
EEG acquisition
EEG release on unmount
async acquire/unmount race
module re-entry
```

Manual flow:

```text
Dashboard
→ module card visible
→ Open
→ module mounted
→ use core feature
→ Close/Back
→ resources released
→ open module again
→ works without application restart
```

---

# Adding a new device

Assume a new raw EEG device.

Recommended adapter structure:

```text
src/core/devices/adapters/<device-slug>/
├── <DeviceName>Adapter.ts
├── <DeviceName>Bridge.ts        # if a sidecar/native bridge is required
├── models.ts                    # optional device-private protocol types
└── <DeviceName>Adapter.test.ts
```

Example:

```text
src/core/devices/adapters/openbci/
├── OpenBCIAdapter.ts
├── OpenBCIBridge.ts
└── OpenBCIAdapter.test.ts
```

## Step 1 — implement the correct contract

For raw EEG:

```ts
export class OpenBCIAdapter implements EEGDeviceAdapter {
  // ...
}
```

For non-EEG devices, implement the appropriate generic/specialized contract instead.

The TypeScript interface is always the compiler-enforced source of truth.

Find existing implementations:

```bash
git grep -n "implements EEGDeviceAdapter" src/core/devices
```

## Step 2 — define stable metadata

Example:

```ts
readonly info = {
  id: "openbci-cyton",
  name: "OpenBCI Cyton",
  kind: "eeg",
  transport: "serial",
  manufacturer: "OpenBCI",
  model: "Cyton",
} as const;
```

The ID should be:

```text
stable
lowercase
unique
independent of COM port
independent of temporary Bluetooth address
```

## Step 3 — implement lifecycle

The generic device lifecycle is:

```text
disconnected
     ↓ connect
connecting
     ↓
connected
     ↓ disconnect
disconnecting
     ↓
disconnected
```

A failure should leave a clear recoverable error/disconnected state.

Status changes must propagate through the common status subscription mechanism.

Repeated disconnect/cleanup calls should be safe wherever practical.

## Step 4 — expose stream metadata

For an EEG device, `getStreamInfo()` returns device-specific metadata such as:

```ts
{
  sampleRateHz: 250,
  channels: [
    // normalized EEG channel descriptors
  ],
}
```

Never assume globally that every EEG device has:

```text
250 Hz
32 channels
the same electrodes
the same order
```

Each adapter reports its own stream characteristics.

## Step 5 — normalize channels at the adapter boundary

A normalized channel can conceptually contain:

```ts
{
  index: 0,
  label: "O1",
  type: "eeg",
  unit: "uV",
  sourceIndex: 11,
}
```

Meaning:

```text
index
= normalized KNeuron stream index

sourceIndex
= native/vendor source index
```

Modules use:

```text
label / normalized index
```

Modules must never use:

```text
sourceIndex
vendor array position
BrainAccess physical index
```

## Step 6 — emit normalized batches

The current normalized EEG layout is:

```text
values[channelIndex][sampleIndex]
```

A batch contains fields such as:

```text
sequenceStart
timestampStartMs
sampleRateHz
sampleCount
channelCount
values
optional source/native sample-number information
```

If the hardware exposes a native monotonically increasing sample number, preserve it. It is useful for diagnosing dropped samples.

Once streaming starts, do not silently change:

```text
sample rate
channel count
channel ordering
matrix orientation
```

`EEGStreamService` treats these as stream invariants.

## Step 7 — implement stream operations

The adapter must correctly implement the EEG methods required by the current interface:

```text
getStreamInfo()
subscribeSamples()
startStream()
stopStream()
isStreaming()
```

`subscribeSamples()` must return an unsubscribe function.

`startStream()` should start the physical acquisition only once.

`stopStream()` must release streaming resources.

A module must never call these directly. `EEGStreamService` owns the shared physical stream lifecycle.

## Step 8 — register the adapter

The built-in device registration entry point is:

```text
src/core/devices/registerBuiltInDevices.ts
```

Add the new adapter using the same pattern as the production BrainAccess and BrainLink registrations.

Confirm the current composition with:

```bash
git grep -n "BrainAccessEEGAdapter" src/core/devices
git grep -n "BrainLinkAdapter" src/core/devices
git grep -n "registerBuiltInDevices" src
```

Do not modify these just because another manufacturer was added:

```text
DeviceManager.ts
DevicePage.tsx
DevicePanel.tsx
EEGStreamService.ts
App.tsx
```

If one of those requires manufacturer-specific branching, the adapter abstraction is probably leaking.

## Step 9 — add adapter tests

Minimum tests:

```text
initial status
metadata
connect
disconnect
status notifications
failed connect cleanup
reconnect
stream info
sample rate
channel map
stream cannot start in invalid state
stream start
stream stop
batch dimensions
sequence numbering
source sample numbering when available
subscribe/unsubscribe
disconnect while streaming
malformed bridge/vendor message
bridge process failure
```

## Step 10 — validate with real hardware

Verify:

```text
connect
disconnect
reconnect
start stream
stop stream
open Cortex / another consumer
leave module
open another consumer
close application while connected
lose Bluetooth/unplug hardware
recover and reconnect
```

A mocked unit test does not replace hardware validation.

---

# Adding a new sidecar

Use a sidecar when a dependency should remain outside the Tauri/React process, for example:

```text
Python scientific stack
vendor Python SDK
serial/RFCOMM parser
CPU-heavy classifier
native SDK wrapper
```

Do not use a sidecar for ordinary React/UI logic.

## Recommended layout

```text
<name>-sidecar/
├── bridge.py
├── requirements.txt
├── <binary-name>.spec
├── build.ps1
├── diagnose.py          # optional but recommended for hardware
└── tests/               # optional
```

The current production examples are:

```text
brainaccess-sidecar/
ssvep-sidecar/
brainlink-sidecar/
```

## IPC protocol

Sidecars should use the same JSONL principle as the current bridges:

```text
one JSON message per line
```

Example request:

```json
{ "id": 17, "command": "status" }
```

Example response:

```json
{ "id": 17, "ok": true, "result": { "state": "connected" } }
```

Example asynchronous event:

```json
{ "event": "samples", "payload": { "sampleRateHz": 250, "sampleCount": 8 } }
```

The exact commands belong to the sidecar/TypeScript bridge protocol.

### stdout rule

When stdout carries JSONL IPC:

```text
stdout = protocol JSON only
stderr = diagnostic logs
```

Bad:

```python
print("Connected!")
print(json.dumps(message))
```

Good:

```python
print("Connected!", file=sys.stderr)
print(json.dumps(message), flush=True)
```

A single non-JSON diagnostic line on stdout can corrupt the protocol.

## TypeScript bridge ownership

The TypeScript bridge should own:

```text
sidecar spawn
stdin writes
stdout parsing
request correlation
async event routing
process errors
pending-request rejection
kill/shutdown
```

A React module should never spawn a hardware/classifier sidecar directly.

## PyInstaller build files

Commit:

```text
requirements.txt
*.spec
build.ps1
source .py files
optional diagnose.py
```

Do not commit:

```text
.venv/
build/
dist/
generated binary
```

## Add the sidecar to Tauri

Edit:

```text
src-tauri/tauri.conf.json
```

and add the base binary name to `externalBin`.

Example:

```json
"externalBin": [
  "binaries/brainaccess-bridge",
  "binaries/ssvep-classifier",
  "binaries/brainlink-bridge",
  "binaries/example-bridge"
]
```

Do not add:

```text
.exe
target triple
absolute path
```

to the `externalBin` base name.

Typical generated files are:

```text
Windows:
example-bridge-x86_64-pc-windows-msvc.exe

Linux:
example-bridge-x86_64-unknown-linux-gnu
```

## Update Tauri capabilities

Review:

```text
src-tauri/capabilities/
```

The sidecar must be included in the allowed spawn scope using the same pattern as the existing production sidecars.

Keep permissions narrow.

The current bridges require the equivalents of:

```text
spawn
stdin write
kill
```

Do not authorize arbitrary shell commands simply to avoid defining the sidecar scope correctly.

## Update both bootstrap scripts

A production sidecar is not fully integrated until a clean machine can recreate it.

Update:

```text
setup-and-run.ps1
setup-and-run.sh
```

They must:

```text
create/install the Python environment
install requirements
run the sidecar build
place/copy the target-specific binary into src-tauri/binaries/
verify that the expected binary exists
fail clearly when packaging fails
```

## Sidecar tests

At minimum test:

```text
valid request
unknown request
malformed JSON
SDK/serial exception
process EOF
process crash
shutdown
reconnect
multiple sequential requests
async event output
stderr logging
stdout protocol purity
```

For deterministic classifiers, keep test fixtures with expected results where possible.

---

# Registry and composition — step by step

The registry/composition layer is where code becomes part of the production application.

Do not create a second parallel registry.

## Register a module

Canonical entry point:

```text
src/features/modules/registerBuiltInModules.ts
```

Procedure:

```text
1. create manifest
2. create React component
3. create ModuleDefinition
4. import ModuleDefinition into registerBuiltInModules.ts
5. add it using the same production-registration pattern
6. verify unique ID
7. verify Dashboard card appears automatically
8. verify open/close lifecycle
```

Do not add duplicate conditions to `ModuleHost`.

Useful search:

```bash
git grep -n "registerBuiltInModules" src
git grep -n "CortexModule" src
git grep -n "MinerModule" src
git grep -n "NeuorrunModule" src
```

## Register a device

Canonical entry point:

```text
src/core/devices/registerBuiltInDevices.ts
```

Procedure:

```text
1. implement the adapter
2. import it into registerBuiltInDevices.ts
3. instantiate/register exactly once
4. verify DeviceManager sees it
5. verify Device page lists it
6. connect/disconnect
7. verify active-device state
```

Useful search:

```bash
git grep -n "registerBuiltInDevices" src
git grep -n "BrainAccessEEGAdapter" src
git grep -n "BrainLinkAdapter" src
```

Do not instantiate another copy inside a module.

## Register a sidecar

Procedure:

```text
1. implement Python/native sidecar
2. implement TypeScript bridge
3. connect bridge to adapter/service
4. add externalBin entry
5. add Tauri capability scope
6. update Windows bootstrap
7. update Linux bootstrap
8. update .gitignore if necessary
9. test from a clean checkout
```

Useful search:

```bash
git grep -n "externalBin" src-tauri
git grep -n "brainaccess-bridge" src-tauri
```

---

# Lifecycle and cleanup rules

Resource ownership must always be explicit.

| Resource                   | Owner                           | Required cleanup                              |
| -------------------------- | ------------------------------- | --------------------------------------------- |
| Physical device connection | Adapter / DeviceManager         | disconnect                                    |
| Physical raw EEG stream    | EEGStreamService + adapter      | stop on device disconnect or service disposal |
| EEG consumer               | Module/hook calling `acquire()` | `handle.release()`                            |
| Brain-metrics subscription | Module/hook                     | unsubscribe                                   |
| Python sidecar process     | TypeScript bridge/adapter       | terminate                                     |
| Classifier request         | classifier client/service       | resolve/reject/cancel                         |
| DOM listener               | component/hook                  | remove listener                               |
| Timer                      | creator                         | clear timer                                   |
| `requestAnimationFrame`    | renderer/module                 | cancel frame                                  |
| Three.js resource          | renderer/module/cache           | dispose when not shared                       |
| Unity bridge listener      | Neuorrun integration            | remove hook                                   |

## Shared EEG lifecycle

The shared service allows multiple modules to consume one physical EEG stream.

```text
Cortex acquire
consumer count = 1
physical stream starts
        ↓
Miner acquire
consumer count = 2
same physical stream is reused
        ↓
Cortex release
consumer count = 1
physical stream remains active
        ↓
Miner release
consumer count = 0
physical stream remains active
        ↓
device disconnect / service dispose
physical stream stops
```

A module releasing its handle removes only that consumer. It does not stop the physical EEG acquisition.

Therefore a module must never call:

```text
adapter.stopStream()
```

directly.

`EEGStreamService` owns the physical stream lifecycle and serializes adapter start/stop operations.

## Device switching

Do not switch to another raw EEG adapter while consumers of the current stream are still active.

Correct order:

```text
close/release consuming modules
disconnect old device
connect new device
```

The physical EEG stream is stopped as part of device teardown/disconnect, not by a module's `release()`.

## Async races

A component may unmount while an async connection/acquire request is still resolving.

Always account for late completion.

If a resource finishes acquisition after the component was disposed, release it immediately.

## Sidecar crash

On unexpected process exit:

```text
mark adapter/service unhealthy
reject pending requests
remove listeners
clear request maps
allow future reconnect
do not leave promises waiting forever
```

---

# Implementation checklists

## New raw EEG device

- [ ] Stable unique `info.id`.
- [ ] Implements common device lifecycle.
- [ ] Implements `EEGDeviceAdapter`.
- [ ] Reports its own sample rate.
- [ ] Reports normalized channel metadata.
- [ ] Vendor indexes remain inside adapter/bridge.
- [ ] Channel order is stable during a stream.
- [ ] `subscribeSamples()` can unsubscribe.
- [ ] `startStream()` is not called by modules.
- [ ] `stopStream()` releases resources.
- [ ] Reconnect works.
- [ ] Failed connect leaves recoverable state.
- [ ] Registered once in `registerBuiltInDevices.ts`.
- [ ] Device page discovers it through normal architecture.
- [ ] `EEGStreamService` can consume it.
- [ ] Multiple consumers share one physical stream.
- [ ] Unit tests cover malformed input and lifecycle.
- [ ] Real Bluetooth/unplug-loss behavior tested.

## New brain-metrics device

- [ ] Reuses or deliberately extends BrainMetrics contract.
- [ ] Vendor packets stay below service boundary.
- [ ] Metrics use normalized names/units.
- [ ] Subscription cleanup works.
- [ ] Signal-quality semantics documented.
- [ ] Registered once through production device composition.
- [ ] Modules require no manufacturer-specific conditions.

## New module

- [ ] Lives under `src/modules/<module-id>/`.
- [ ] Has a manifest.
- [ ] Has a `KNeuronModuleDefinition`.
- [ ] Stable unique module ID.
- [ ] Registered in `registerBuiltInModules.ts`.
- [ ] Dashboard entry is registry-driven.
- [ ] Uses service, not concrete hardware.
- [ ] EEG requested by normalized labels.
- [ ] Every EEG handle is released.
- [ ] Every subscription is removed.
- [ ] Timers/animation frames are cleaned up.
- [ ] Handles no-device/incompatible-device state.
- [ ] Handles service/sidecar errors.
- [ ] Re-entry works without restarting app.
- [ ] Unit tests cover mounting/unmounting and cleanup.

## New sidecar

- [ ] One clear responsibility.
- [ ] JSONL protocol documented.
- [ ] stdout contains only protocol JSON.
- [ ] logs go to stderr.
- [ ] `.spec` committed.
- [ ] `requirements.txt` committed.
- [ ] generated `.venv/build/dist` ignored.
- [ ] generated binary ignored.
- [ ] `externalBin` updated.
- [ ] Tauri capability updated narrowly.
- [ ] TypeScript bridge owns process lifecycle.
- [ ] Windows bootstrap builds/verifies it.
- [ ] Linux bootstrap builds/verifies it.
- [ ] clean-machine setup tested.
- [ ] crash/EOF/reconnect tested.

## Pre-merge checklist

Run:

```bash
npm run format
npm run typecheck
npm test
npm run lint
```

If available:

```bash
npm run quality
```

Then perform:

```text
fresh application start
connect device
open new module
exercise core feature
close module
open it again
disconnect
reconnect
close application
```

Hardware/sidecar changes must also regression-test:

```text
Cortex 3D
TaaLON Miner
Neuorrun
```

---

# Example extension: simple EEG module

Suppose a module needs:

```text
O1
Oz
O2
```

Correct architecture:

```text
active EEG hardware
       ↓
EEGDeviceAdapter
       ↓
EEGStreamService
       ↓
ExampleModule
```

Incorrect architecture:

```text
ExampleModule
       ↓
BrainAccessBridge
       ↓
BrainAccess SDK
```

The module should acquire only application-level channels:

```ts
const handle = await eegStreamService.acquire({
  channels: ["O1", "Oz", "O2"],

  onBatch: (batch) => {
    // Module-specific processing.
  },
});
```

and release:

```ts
await handle.release();
```

when the module no longer owns the consumer.

---

# Example extension: sidecar-backed EEG device

Recommended dependency graph:

```text
Example EEG hardware
        ↓
example-sidecar/bridge.py
        ↓ JSONL
ExampleBridge.ts
        ↓
ExampleEEGAdapter.ts
        ↓
DeviceManager
        ↓
EEGStreamService
        ↓
modules
```

Suggested new files:

```text
example-sidecar/
├── bridge.py
├── requirements.txt
├── example-bridge.spec
├── build.ps1
└── diagnose.py

src/core/devices/adapters/example/
├── ExampleBridge.ts
├── ExampleEEGAdapter.ts
└── ExampleEEGAdapter.test.ts
```

Then update:

```text
src/core/devices/registerBuiltInDevices.ts
src-tauri/tauri.conf.json
src-tauri/capabilities/
setup-and-run.ps1
setup-and-run.sh
README.md
```

That is the complete production integration surface for a new sidecar-backed device.

---

# Extension anti-patterns

Bad:

```ts
const oz = batch.values[6];
```

because the module assumes a physical/native channel index.

Prefer:

```text
request "Oz" through EEGStreamService
```

Bad:

```ts
await brainAccessAdapter.startStream();
```

inside a module.

Prefer:

```ts
const handle = await eegStreamService.acquire({
  channels: "all",
});
```

Bad:

```ts
Command.sidecar("brainaccess-bridge").spawn();
```

inside React module code.

Prefer:

```text
module
  ↓
core service / adapter
  ↓
bridge
  ↓
sidecar
```

Bad:

```text
Dashboard hard-coded device list
+ DeviceManager registry
+ module-local device list
```

There should be one canonical production registration path for each type of extension.

---

---

# Project status

- [x] modular Tauri/React shell
- [x] production device registry
- [x] BrainAccess integration
- [x] BrainLink Lite integration
- [x] shared EEG stream service
- [x] Cortex 3D
- [x] live EEG visualization
- [x] calibration and baseline normalization
- [x] TaaLON Miner
- [x] FBCCA classifier sidecar
- [x] Neuorrun Unity WebGL integration
- [x] BrainLink attention/meditation bridge
- [x] Windows sidecar packaging
- [x] Windows bootstrap script
- [x] Linux bootstrap script
- [x] developer extension guide
- [x] device/module/sidecar implementation guide
- [x] lifecycle/cleanup rules and extension checklists

---

# Research / educational use

KNeuron is developed as a scientific student project for experimentation with EEG and brain-computer interfaces.

It is not a medical device and is not intended for diagnosis, treatment, or clinical decision-making.

---

## KNeuron

**Modular Brain-Computer Interface Platform**

## Neuorrun source

The complete Neuorrun Unity project is maintained in a separate repository:

https://github.com/KN-Neuron/Neurorun

The main KNeuron repository contains only:

- the generated Neuorrun WebGL runtime in `public/neuorrun/`,
- KNeuron-specific integration code and patches in `unity-patch/`.

Rebuilding Neuorrun requires the source project from the repository above.

# License

Unless otherwise noted, original KNeuron source code is licensed
under the Apache License 2.0.

See:

- `LICENSE`
- `NOTICE`
- `THIRD_PARTY.md`

Third-party software, assets, vendor SDKs and runtime components
may be subject to separate license terms.
