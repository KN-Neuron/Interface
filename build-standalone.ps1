param([switch]$SkipSetup)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location $PSScriptRoot

# Unity is a developer-only dependency. End users receive its built assets.
foreach ($game in @('neuorrun', 'talon')) {
    $root = Join-Path $PSScriptRoot "public\$game"
    $manifestPath = Join-Path $root 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Missing $game WebGL manifest." }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if (-not $manifest.ready) { throw "$game WebGL assets are not ready." }
    foreach ($field in @('loader', 'data', 'framework', 'code')) {
        $asset = $manifest.$field
        if ([string]::IsNullOrWhiteSpace($asset) -or -not (Test-Path -LiteralPath (Join-Path $root $asset))) {
            throw "Missing $game asset: $field. Rebuild/copy the Unity WebGL output."
        }
    }
}
if (-not $SkipSetup) {
    & (Join-Path $PSScriptRoot 'setup-and-run.ps1') -NoLaunch
}
foreach ($helper in @('brainaccess-bridge', 'ssvep-classifier', 'brainlink-bridge')) {
    if (-not (Test-Path (Join-Path $PSScriptRoot "src-tauri\binaries\$helper-x86_64-pc-windows-msvc.exe"))) {
        throw "Missing $helper. Run setup-and-run.ps1 -NoLaunch."
    }
}
& npm.cmd run tauri:build
if ($LASTEXITCODE -ne 0) { throw 'Standalone Windows build failed.' }
$target = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $PSScriptRoot 'src-tauri\target' }
Write-Host "Standalone Windows installer: $(Join-Path $target 'release\bundle\nsis')"
