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
    $env:Path = "$env:Path;$machinePath;$userPath;$env:USERPROFILE\.cargo\bin"
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

function Test-Node {
    if (-not (Has "node.exe") -or -not (Has "npm.cmd")) { return $false }
    $version = & node.exe -p "process.versions.node"
    return $LASTEXITCODE -eq 0 -and [version]$version -ge [version]"22.12.0"
}

function Ensure-Node {
    if (-not (Test-Node)) {
        WingetInstall -Id "OpenJS.NodeJS.LTS" -ExtraArguments @("--silent")
    }
    Refresh-Path
    if (-not (Test-Node)) {
        throw "Node >= 22.12 and npm are required. Update Node LTS, open a new PowerShell window, and rerun."
    }
    Ok "Node $(node.exe --version), npm $(npm.cmd --version)"
}

function Find-Python {
    $candidates = @(
        @{ Command = "py.exe"; Prefix = @("-3.12") },
        @{ Command = "python.exe"; Prefix = @() }
    )
    foreach ($candidate in $candidates) {
        if (-not (Has $candidate.Command)) { continue }
        $prefix = $candidate.Prefix
        try {
            $path = & $candidate.Command @prefix -c "import sys,struct; assert sys.version_info[:2] == (3,12) and struct.calcsize('P') == 8; print(sys.executable)" 2>$null
            if ($LASTEXITCODE -eq 0 -and $path) { return ($path | Select-Object -Last 1).Trim() }
        } catch { continue }
    }
    return $null
}

function Ensure-Python {
    $script:PythonExe = Find-Python
    if (-not $script:PythonExe) {
        WingetInstall -Id "Python.Python.3.12" -ExtraArguments @("--silent", "--architecture", "x64")
        Refresh-Path
        $script:PythonExe = Find-Python
    }
    if (-not $script:PythonExe) {
        throw "64-bit Python 3.12 is required. Open a new PowerShell window after installation and rerun."
    }
    Ok "Python 3.12 x64: $script:PythonExe"
}

function Have-WebView2 {
    $client = "Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    foreach ($key in @("HKLM:\SOFTWARE\WOW6432Node\$client", "HKLM:\SOFTWARE\$client", "HKCU:\Software\$client")) {
        $version = Get-ItemPropertyValue -Path $key -Name "pv" -ErrorAction SilentlyContinue
        if ($version -and [version]$version -gt [version]"0.0.0.0") { return $true }
    }
    return $false
}

function Ensure-WebView2 {
    if (-not (Have-WebView2)) {
        WingetInstall -Id "Microsoft.EdgeWebView2Runtime" -ExtraArguments @("--silent")
    }
    if (-not (Have-WebView2)) {
        throw "WebView2 Runtime was not detected. Install it from https://developer.microsoft.com/microsoft-edge/webview2/ and rerun."
    }
    Ok "Microsoft Edge WebView2 Runtime"
}

function Ensure-Rust {
    Refresh-Path

    if ((Has "cargo") -and (Has "rustc")) {
        $hostInfo = (& rustc -vV | Out-String)
        if ($LASTEXITCODE -eq 0 -and $hostInfo -match "host: x86_64-pc-windows-msvc") {
            Ok "$(cargo --version)"
            return
        }
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
        "stable-x86_64-pc-windows-msvc"
    )

    Run -Executable "rustup" -Arguments @(
        "default",
        "stable-x86_64-pc-windows-msvc"
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

    $kits = "${env:ProgramFiles(x86)}\Windows Kits\10\Lib"
    $sdk = @(Get-ChildItem -Path "$kits\*\um\x64\kernel32.lib" -ErrorAction SilentlyContinue)
    return (-not [string]::IsNullOrWhiteSpace(($result | Out-String))) -and $sdk.Count -gt 0
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

function Test-DesktopPython([string]$Python) {
    if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) { return $false }
    try {
        & $Python -c "import sys,struct; sys.exit(0 if sys.platform == 'win32' and sys.version_info[:2] == (3,12) and struct.calcsize('P') == 8 else 1)" *> $null
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}

function Build-Sidecar {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$Directory
    )

    $venv = Join-Path $Directory ".venv"
    $python = Join-Path $venv "Scripts\python.exe"
    if ((Test-Path $venv) -and -not (Test-DesktopPython $python)) {
        $backup = "$venv.backup-$([Guid]::NewGuid().ToString('N'))"
        Write-Warning "Existing helper environment is incompatible with Windows Python 3.12 x64. Preserving it at $backup"
        Move-Item -LiteralPath $venv -Destination $backup
    }
    if (-not (Test-Path $venv)) {
        Run -Executable $script:PythonExe -Arguments @("-m", "venv", $venv)
    }
    if (-not (Test-DesktopPython $python)) {
        throw "Could not prepare Windows Python 3.12 x64 environment: $python"
    }
    Step "Building $Name"
    Run -Executable $python -Arguments @("-m", "pip", "install", "--upgrade", "pip")
    Run -Executable $python -Arguments @("-m", "pip", "install", "-r", (Join-Path $Directory "requirements.txt"))
    Push-Location $Directory
    try {
        if ($Name -eq "brainlink-bridge") {
            Run -Executable $python -Arguments @("test_parser.py")
        }
        Run -Executable $python -Arguments @("-m", "PyInstaller", "--clean", "--noconfirm", "$Name.spec")
        $built = Join-Path $Directory "dist\$Name.exe"
        if (-not (Test-Path $built)) { throw "Expected helper was not built: $built" }
        if ($Name -eq "ssvep-classifier") {
            Step "Testing the packaged SSVEP classifier"
            Run -Executable $python -Arguments @((Join-Path $Directory "smoke_test.py"), $built)
        }
        $destination = Join-Path $root "src-tauri\binaries"
        New-Item -ItemType Directory -Force -Path $destination | Out-Null
        Copy-Item -Force $built (Join-Path $destination "$Name-x86_64-pc-windows-msvc.exe")
    } finally {
        Pop-Location
    }
    Ok $Name
}

function Test-GameAssets([string]$Game) {
    $directory = Join-Path $root "public\$Game"
    $manifestPath = Join-Path $directory "manifest.json"
    if (-not (Test-Path $manifestPath)) { throw "Missing $Game manifest: download the complete repository, including public/$Game." }
    $manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
    if (-not $manifest.ready) { throw "$Game game assets are not ready." }
    foreach ($property in @("loader", "data", "framework", "code")) {
        $relative = $manifest.$property
        if ([string]::IsNullOrWhiteSpace($relative) -or $relative -notmatch '^[a-zA-Z0-9_./-]+$' -or $relative.Contains("..") -or $relative.StartsWith("/")) {
            throw "Invalid $Game asset path: $relative"
        }
        $asset = Join-Path $directory $relative
        if (-not (Test-Path $asset -PathType Leaf) -or (Get-Item $asset).Length -eq 0) {
            throw "Missing or empty $Game asset: $asset. Download the complete repository."
        }
        $stream = [IO.File]::OpenRead($asset)
        try {
            $bytes = New-Object byte[] 128
            $count = $stream.Read($bytes, 0, $bytes.Length)
            if ([Text.Encoding]::ASCII.GetString($bytes, 0, $count).StartsWith("version https://git-lfs.github.com/spec/v1")) {
                throw "Git LFS pointer found at $asset. Run git lfs pull to download the actual game assets."
            }
        } finally { $stream.Dispose() }
    }
    Ok "$Game WebGL assets"
}

$root = $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($root)) {
    throw "Could not determine repository root."
}

if ($env:OS -ne "Windows_NT") { throw "Run this script in Windows PowerShell, not in WSL." }
if (-not [Environment]::Is64BitProcess -or $env:PROCESSOR_ARCHITECTURE -ne "AMD64") {
    throw "This setup supports Windows x64 with 64-bit PowerShell. ARM64 and 32-bit Windows are not validated."
}
if ($root.StartsWith("\\")) {
    throw "Extract or clone the project into a Windows folder such as C:\Projects\Interface, not a WSL/network path."
}
Set-Location $root

Write-Host "========================================" -ForegroundColor DarkCyan
Write-Host " KNeuron - Windows first-run bootstrap" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor DarkCyan

if (-not (Test-Path ".\package.json")) {
    throw "Put this script in the KNeuron repository root."
}

Step "Checking bundled assets"
Test-GameAssets "talon"
Test-GameAssets "neuorrun"
if (-not (Test-Path ".\public\modules\cortex\brain_low.glb")) { throw "Missing Cortex brain_low.glb model." }

Step "Checking/installing system dependencies"

Refresh-Path
Ensure-Node
Ensure-Python
Ensure-VCTools
Ensure-Rust
Ensure-WebView2

Step "Installing JavaScript dependencies"

if (Test-Path ".\package-lock.json") {
    Run -Executable "npm.cmd" -Arguments @("ci")
} else {
    Run -Executable "npm.cmd" -Arguments @("install")
}

Ok "Node dependencies"

Build-Sidecar `
    -Name "brainaccess-bridge" `
    -Directory (Join-Path $root "brainaccess-sidecar")

Build-Sidecar `
    -Name "ssvep-classifier" `
    -Directory (Join-Path $root "ssvep-sidecar")

Build-Sidecar `
    -Name "brainlink-bridge" `
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

Write-Host "`nKNeuron setup completed successfully." -ForegroundColor Green

if (-not $NoLaunch) {
    Step "Starting KNeuron"
    Run -Executable "npm.cmd" -Arguments @("run", "tauri:dev")
} else {
    Write-Host ""
    Write-Host "Run later with:"
    Write-Host "  npm.cmd run tauri:dev"
}
