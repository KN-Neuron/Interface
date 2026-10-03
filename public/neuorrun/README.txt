KNeuron — Neuorrun WebGL Runtime

This directory contains the generated Unity WebGL runtime used by the Neuorrun module.

It is NOT the full Neuorrun Unity source project.

Expected runtime layout:

public/neuorrun/
  Build/
    *.loader.js
    *.framework.js
    *.data
    *.wasm
  manifest.json
  README.txt

KNeuron loads this runtime from the React/Tauri application and injects BrainLink
metrics into Unity through the KNeuron WebGL bridge.

Runtime data flow:

BrainLink Lite
  -> brainlink-bridge
  -> BrainLinkAdapter
  -> BrainMetricsService
  -> Neuorrun React module
  -> Unity SendMessage
  -> KNeuronBridge
  -> TGCConnectionController
  -> original game logic

The main KNeuron repository keeps the generated WebGL runtime so developers can
run Neuorrun without installing Unity.

To rebuild or modify Neuorrun itself, use the original Unity source project.
The supported Unity version for the current integration is Unity 2022.3.7f1.

KNeuron-specific Unity integration patches are stored under:

unity-patch/

After rebuilding the Unity project, install the WebGL output with:

python ./unity-patch/prepare_webgl_build.py <path-to-NeuorrunWebGL> ./public/neuorrun

After installation, verify that:

public/neuorrun/manifest.json

contains:

{
  "ready": true
}

Generated files under Build/ should not be edited manually.
