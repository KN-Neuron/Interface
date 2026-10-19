$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$VenvPath = Join-Path $PSScriptRoot ".venv"
$PythonPath = Join-Path $VenvPath "Scripts\python.exe"

if (-not (Test-Path $PythonPath)) {
    Write-Host "Creating neurostate bridge virtual environment (needs Python 3.12 or newer)..."
    py -3 -m venv $VenvPath
}

Write-Host "Installing neurostate bridge dependencies..."
& $PythonPath -m pip install --upgrade pip
& $PythonPath -m pip install -r (Join-Path $PSScriptRoot "requirements.txt")

# NEUROSTATE_SRC points at a local NeuroState checkout to build from instead of
# the pinned GitHub commit.
if ($env:NEUROSTATE_SRC) {
    Write-Host "Installing neurostate from $env:NEUROSTATE_SRC..."
    & $PythonPath -m pip install --upgrade $env:NEUROSTATE_SRC
}
else {
    Write-Host "Installing neurostate from GitHub..."
    & $PythonPath -m pip install -r (Join-Path $PSScriptRoot "neurostate.txt")
}

if ($LASTEXITCODE -ne 0) {
    throw "Installing neurostate failed."
}

Write-Host "Building neurostate sidecar..."
Push-Location $PSScriptRoot
try {
    & $PythonPath -m PyInstaller --clean --noconfirm "neurostate-bridge.spec"
}
finally {
    Pop-Location
}

$TargetTriple = ""
try {
    $TargetTriple = (& rustc --print host-tuple).Trim()
}
catch {
    $HostLine = (& rustc -Vv | Select-String "host:").Line
    $TargetTriple = ($HostLine -split "\s+")[1].Trim()
}

if ([string]::IsNullOrWhiteSpace($TargetTriple)) {
    throw "Could not determine the Rust target triple."
}

$SourceExe = Join-Path $PSScriptRoot "dist\neurostate-bridge.exe"
if (-not (Test-Path $SourceExe)) {
    throw "PyInstaller did not create $SourceExe"
}

$BinariesDir = Join-Path $ProjectRoot "src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $BinariesDir | Out-Null

$DestinationExe = Join-Path $BinariesDir "neurostate-bridge-$TargetTriple.exe"
Copy-Item -Force $SourceExe $DestinationExe

Write-Host ""
Write-Host "neurostate sidecar built successfully:"
Write-Host $DestinationExe
Write-Host ""
Write-Host "Tauri externalBin entry remains: binaries/neurostate-bridge"
