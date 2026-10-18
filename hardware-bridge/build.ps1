param([string]$PythonPath = "", [string]$HelpersDirectory = "")
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
if (-not $PythonPath) { $PythonPath = Join-Path $Root "brainaccess-sidecar\.venv\Scripts\python.exe" }
if (-not $HelpersDirectory) { $HelpersDirectory = Join-Path $Root "src-tauri\binaries" }
& $PythonPath (Join-Path $PSScriptRoot "build.py") --helpers $HelpersDirectory --python $PythonPath
if ($LASTEXITCODE -ne 0) { throw "Managed host launcher packaging failed." }
