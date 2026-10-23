# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_all
from PyInstaller.config import CONF
import sys
sys.path.insert(0, SPECPATH)
from build_support import patch_scipy_cleanup

sklearn_datas, sklearn_bins, sklearn_hidden = collect_all("sklearn")
scipy_datas, scipy_bins, scipy_hidden = collect_all("scipy")

a = Analysis(
    ["bridge.py"],
    pathex=[],
    binaries=sklearn_bins + scipy_bins,
    datas=sklearn_datas + scipy_datas,
    hiddenimports=sklearn_hidden + scipy_hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    # Load this module from our private source copy, not the frozen importer.
    module_collection_mode={"scipy.stats._distn_infrastructure": "py"},
)

a.datas = patch_scipy_cleanup(a.datas, CONF["workpath"])

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="ssvep-classifier",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
