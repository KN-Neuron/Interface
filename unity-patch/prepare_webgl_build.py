from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def one(files: list[Path], label: str) -> Path:
    if len(files) != 1:
        names = ", ".join(path.name for path in files) or "none"
        raise RuntimeError(f"Expected exactly one {label}; found: {names}")
    return files[0]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Copy an uncompressed Unity WebGL build into a KNeuron module directory."
    )
    parser.add_argument("unity_build", type=Path)
    parser.add_argument("kneuron_public_neuorrun", type=Path)
    parser.add_argument("--product-name", default="Neuorrun")
    args = parser.parse_args()

    source_root = args.unity_build.resolve()
    target_root = args.kneuron_public_neuorrun.resolve()

    build_dir = source_root / "Build" if (source_root / "Build").is_dir() else source_root

    if not build_dir.is_dir():
        raise RuntimeError(f"Unity Build directory does not exist: {build_dir}")

    loader = one(list(build_dir.glob("*.loader.js")), "Unity loader")
    data = one(list(build_dir.glob("*.data")), "Unity data file")
    framework = one(list(build_dir.glob("*.framework.js")), "Unity framework file")
    code = one(list(build_dir.glob("*.wasm")), "Unity wasm file")

    symbols_candidates = list(build_dir.glob("*.symbols.json"))
    symbols = symbols_candidates[0] if symbols_candidates else None

    target_build = target_root / "Build"
    if target_build.exists():
        shutil.rmtree(target_build)
    target_build.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(build_dir, target_build)

    streaming_source = source_root / "StreamingAssets"
    streaming_target = target_root / "StreamingAssets"
    if streaming_target.exists():
        shutil.rmtree(streaming_target)
    if streaming_source.is_dir():
        shutil.copytree(streaming_source, streaming_target)

    manifest = {
        "ready": True,
        "loader": f"Build/{loader.name}",
        "data": f"Build/{data.name}",
        "framework": f"Build/{framework.name}",
        "code": f"Build/{code.name}",
        "symbols": f"Build/{symbols.name}" if symbols else None,
        "streamingAssets": "StreamingAssets" if streaming_source.is_dir() else None,
        "companyName": "KNeuron",
        "productName": args.product_name,
        "productVersion": "1.0",
    }

    (target_root / "manifest.json").write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )

    print(f"{args.product_name} build installed into: {target_root}")
    print(f"Loader: {loader.name}")
    print(f"Data: {data.name}")
    print(f"Framework: {framework.name}")
    print(f"WASM: {code.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
