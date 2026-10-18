"""Package OS-native host helpers; the application itself stays in the shared Docker image."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import zipfile


def build(python, source, output, work, name, *, spec=False, windowed=False):
    command = [str(python), "-m", "PyInstaller", "--clean", "--noconfirm", "--distpath", str(output), "--workpath", str(work)]
    if not spec:
        command += ["--onefile", "--name", name, "--specpath", str(work)]
        if windowed:
            command += ["--windowed"]
    subprocess.run(command + [str(source)], cwd=source.parent, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", type=Path, default=Path(sys.executable))
    parser.add_argument("--helpers", type=Path, help="Reuse existing helpers instead of rebuilding them.")
    args = parser.parse_args()
    if sys.platform not in {"win32", "linux"}:
        parser.error("Only Windows and Linux packages are supported.")
    here = Path(__file__).resolve().parent
    root = here.parent
    output, work = here / "dist", here / "build"
    output.mkdir(exist_ok=True)
    work.mkdir(exist_ok=True)
    suffix = ".exe" if sys.platform == "win32" else ""
    platform = "windows-x64" if sys.platform == "win32" else "linux-x64"
    if sys.platform == "linux" and os.uname().machine != "x86_64":
        parser.error("The current BrainAccess SDK bundle targets x86-64 Linux.")
    package = output / f"KNeuron-{platform}"
    package.mkdir(exist_ok=True)
    for name in ("brainaccess", "brainlink"):
        if args.helpers:
            source = args.helpers.resolve() / f"{name}-bridge{suffix}"
            if not source.is_file() and sys.platform == "win32":
                source = args.helpers.resolve() / f"{name}-bridge-x86_64-pc-windows-msvc.exe"
        else:
            directory = root / f"{name}-sidecar"
            build(args.python.absolute(), directory / f"{name}-bridge.spec", output, work / name, f"{name}-bridge", spec=True)
            source = output / f"{name}-bridge{suffix}"
        if not source.is_file():
            raise RuntimeError(f"Missing headset helper: {source}")
        shutil.copy2(source, package / f"{name}-bridge{suffix}")
    for script, name in (("launcher.py", "kneuron-launcher"), ("server.py", "kneuron-hardware-bridge")):
        build(args.python.absolute(), here / script, output, work / name, name, windowed=(script == "launcher.py" and sys.platform == "win32"))
        shutil.copy2(output / (name + suffix), package / (name + suffix))
    for name in ("compose.yaml", "README.md"):
        shutil.copy2(here / name, package / name)
    public = root / "public" / "hardware-bridge"
    public.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        archive = public / "KNeuron-windows-x64.zip"
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for path in package.iterdir():
                bundle.write(path, package.name + "/" + path.name)
        # Preserve the existing manual bridge download URL.
        shutil.copy2(archive, public / "KNeuron-Hardware-Bridge.zip")
    else:
        archive = public / "KNeuron-linux-x64.tar.gz"
        with tarfile.open(archive, "w:gz") as bundle:
            bundle.add(package, arcname=package.name)
    print(f"Host package ready: {archive}")


if __name__ == "__main__":
    main()
