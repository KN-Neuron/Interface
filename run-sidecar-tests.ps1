$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

$Sidecars = @(
    "brainaccess-sidecar",
    "brainlink-sidecar",
    "ssvep-sidecar"
)

foreach ($Sidecar in $Sidecars) {
    $Dir = Join-Path $Root $Sidecar
    $Python = Join-Path $Dir ".venv\Scripts\python.exe"

    if (-not (Test-Path $Python)) {
        throw "Missing virtual environment for $Sidecar. Run its build.ps1 first. Expected: $Python"
    }

    Write-Host ""
    Write-Host "=== $Sidecar ===" -ForegroundColor Cyan

    Push-Location $Dir
    try {
        & $Python -m unittest discover -s tests -p "test_*.py" -v
        if ($LASTEXITCODE -ne 0) {
            throw "$Sidecar tests failed."
        }
    }
    finally {
        Pop-Location
    }
}

Write-Host ""
Write-Host "All sidecar tests passed." -ForegroundColor Green
