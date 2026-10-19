# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = [("profiles/*.yaml", "profiles")], [], []

# neurostate loads its montages as package data; pylsl loads liblsl from its lib/ folder.
for package in ("neurostate", "pylsl"):
    for collected, target in zip(collect_all(package), (datas, binaries, hiddenimports)):
        target += collected

a = Analysis(
    ["bridge.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["pyqtgraph", "PySide6", "matplotlib", "tkinter"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="neurostate-bridge",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
