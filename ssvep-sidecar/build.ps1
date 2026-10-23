$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$VenvPath = Join-Path $PSScriptRoot ".venv"
$PythonPath = Join-Path $VenvPath "Scripts\python.exe"

if (-not (Test-Path $PythonPath)) {
    Write-Host "Creating SSVEP classifier virtual environment..."
    py -3.12 -m venv $VenvPath
}

Write-Host "Installing classifier dependencies..."
& $PythonPath -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed." }
& $PythonPath -m pip install -r (Join-Path $PSScriptRoot "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }

Write-Host "Building SSVEP classifier sidecar..."

Push-Location $PSScriptRoot
try {
    & $PythonPath -m PyInstaller --clean --noconfirm "ssvep-classifier.spec"
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed." }
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

$SourceExe = Join-Path $PSScriptRoot "dist\ssvep-classifier.exe"

if (-not (Test-Path $SourceExe)) {
    throw "PyInstaller did not create $SourceExe"
}

& $PythonPath (Join-Path $PSScriptRoot "smoke_test.py") $SourceExe
if ($LASTEXITCODE -ne 0) { throw "Packaged SSVEP classifier smoke test failed; existing binary was not replaced." }

$BinariesDir = Join-Path $ProjectRoot "src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $BinariesDir | Out-Null

$DestinationExe = Join-Path $BinariesDir "ssvep-classifier-$TargetTriple.exe"

Copy-Item -Force $SourceExe $DestinationExe

Write-Host ""
Write-Host "SSVEP classifier sidecar built successfully:"
Write-Host $DestinationExe
Write-Host ""
Write-Host "Tauri externalBin entry: binaries/ssvep-classifier"
