param(
    [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Ok([string]$Message) {
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath;$env:USERPROFILE\.cargo\bin"
}

function Has([string]$Name) {
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Run {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable,

        [Parameter()]
        [string[]]$Arguments = @()
    )

    & $Executable @Arguments

    if ($LASTEXITCODE -ne 0) {
        throw "Command failed ($LASTEXITCODE): $Executable $($Arguments -join ' ')"
    }
}

function WingetInstall {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Id,

        [Parameter()]
        [string[]]$ExtraArguments = @()
    )

    if (-not (Has "winget")) {
        throw "winget is missing. Install/update 'App Installer' from Microsoft Store and rerun."
    }

    Step "Installing $Id"

    $wingetArguments = @(
        "install",
        "--id", $Id,
        "-e",
        "--accept-package-agreements",
        "--accept-source-agreements"
    ) + $ExtraArguments

    Run -Executable "winget" -Arguments $wingetArguments
    Refresh-Path
}

function Ensure-Node {
    if (-not (Has "node") -or -not (Has "npm")) {
        WingetInstall -Id "OpenJS.NodeJS.LTS" -ExtraArguments @("--silent")
    }

    Refresh-Path

    if (-not (Has "node") -or -not (Has "npm")) {
        throw "Node/npm was installed but is not visible yet. Open a new PowerShell window and rerun this script."
    }

    $nodeVersion = [version]((node --version).TrimStart("v"))
    if (-not (($nodeVersion.Major -eq 22 -and $nodeVersion.Minor -ge 12) -or
              $nodeVersion.Major -eq 24 -or $nodeVersion.Major -ge 26)) {
        throw "Install Node.js 22.12+, 24 LTS, or 26+ and rerun this script."
    }

    Ok "Node $(node --version), npm $(npm --version)"
}

function Ensure-Python {
    if (-not (Has "py") -and -not (Has "python")) {
        WingetInstall -Id "Python.Python.3.12" -ExtraArguments @("--silent")
    }

    Refresh-Path

    if (-not (Has "py") -and -not (Has "python")) {
        throw "Python was installed but is not visible yet. Open a new PowerShell window and rerun this script."
    }

    if (Has "py") {
        Ok "$(py --version)"
    } else {
        Ok "$(python --version)"
    }
}

function Ensure-Rust {
    Refresh-Path

    if (Has "cargo" -and Has "rustc") {
        Ok "$(cargo --version)"
        Ok "$(rustc --version)"
        return
    }

    if (-not (Has "rustup")) {
        WingetInstall -Id "Rustlang.Rustup" -ExtraArguments @("--silent")
        Refresh-Path
    }

    if (-not (Has "rustup")) {
        $rustupPath = Join-Path $env:USERPROFILE ".cargo\bin\rustup.exe"

        if (Test-Path $rustupPath) {
            $env:Path = "$(Split-Path $rustupPath);$env:Path"
        }
    }

    if (-not (Has "rustup")) {
        throw "rustup is not available after installation. Open a new PowerShell window and rerun this script."
    }

    Step "Installing Rust stable-msvc toolchain"

    Run -Executable "rustup" -Arguments @(
        "toolchain",
        "install",
        "stable-msvc"
    )

    Run -Executable "rustup" -Arguments @(
        "default",
        "stable-msvc"
    )

    Refresh-Path

    if (-not (Has "cargo") -or -not (Has "rustc")) {
        throw "Rust was installed but cargo/rustc is not visible yet. Open a new PowerShell window and rerun this script."
    }

    Ok "$(cargo --version)"
    Ok "$(rustc --version)"
}

function Have-VCTools {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"

    if (-not (Test-Path $vswhere)) {
        return $false
    }

    $result = & $vswhere `
        -latest `
        -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath 2>$null

    return -not [string]::IsNullOrWhiteSpace(($result | Out-String))
}

function Ensure-VCTools {
    if (Have-VCTools) {
        Ok "Visual Studio C++ Build Tools"
        return
    }

    WingetInstall -Id "Microsoft.VisualStudio.2022.BuildTools" -ExtraArguments @(
        "--override",
        "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    )

    if (-not (Have-VCTools)) {
        throw "C++ Build Tools were not detected after installation. Reboot Windows if requested and rerun."
    }

    Ok "Visual Studio C++ Build Tools"
}

function Build-Sidecar {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$Directory
    )

    $buildScript = Join-Path $Directory "build.ps1"

    if (-not (Test-Path $buildScript)) {
        throw "Missing build script: $buildScript"
    }

    Step "Building $Name"

    Push-Location $Directory

    try {
        & powershell.exe `
            -NoProfile `
            -ExecutionPolicy Bypass `
            -File ".\build.ps1"

        if ($LASTEXITCODE -ne 0) {
            throw "$Name build failed."
        }
    }
    finally {
        Pop-Location
    }

    Ok "$Name"
}

$root = $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($root)) {
    throw "Could not determine repository root."
}

Set-Location $root

Write-Host "========================================" -ForegroundColor DarkCyan
Write-Host " KNeuron - Windows first-run bootstrap" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor DarkCyan

if (-not (Test-Path ".\package.json")) {
    throw "Put this script in the KNeuron repository root."
}

Step "Checking/installing system dependencies"

Refresh-Path
Ensure-Node
Ensure-Python
Ensure-Rust
Ensure-VCTools

Step "Installing JavaScript dependencies"

if (Test-Path ".\package-lock.json") {
    Run -Executable "npm" -Arguments @("ci")
} else {
    Run -Executable "npm" -Arguments @("install")
}

Ok "Node dependencies"

Build-Sidecar `
    -Name "BrainAccess bridge" `
    -Directory (Join-Path $root "brainaccess-sidecar")

Build-Sidecar `
    -Name "SSVEP classifier" `
    -Directory (Join-Path $root "ssvep-sidecar")

Build-Sidecar `
    -Name "BrainLink bridge" `
    -Directory (Join-Path $root "brainlink-sidecar")

Step "Verifying sidecars"

$expectedBinaries = @(
    "brainaccess-bridge-x86_64-pc-windows-msvc.exe",
    "ssvep-classifier-x86_64-pc-windows-msvc.exe",
    "brainlink-bridge-x86_64-pc-windows-msvc.exe"
)

foreach ($binaryName in $expectedBinaries) {
    $binaryPath = Join-Path $root "src-tauri\binaries\$binaryName"

    if (-not (Test-Path $binaryPath)) {
        throw "Expected sidecar not found: $binaryPath"
    }

    $sizeMb = [math]::Round((Get-Item $binaryPath).Length / 1MB, 2)
    Ok "$binaryName ($sizeMb MB)"
}

if (-not (Test-Path ".\public\neuorrun\Build")) {
    Write-Warning "Neuorrun WebGL build is missing. Keep public/neuorrun/Build in the repository or build it separately."
} else {
    Ok "Neuorrun WebGL build"
}

Write-Host "`nKNeuron setup completed successfully." -ForegroundColor Green

if (-not $NoLaunch) {
    Step "Starting KNeuron"
    Run -Executable "npm" -Arguments @("run", "tauri:dev")
} else {
    Write-Host ""
    Write-Host "Run later with:"
    Write-Host "  npm run tauri:dev"
}
