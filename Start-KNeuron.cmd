@echo off
setlocal
set "KNEURON_LAUNCHER=%~dp0hardware-bridge\dist\KNeuron-windows-x64\kneuron-launcher.exe"
if not exist "%KNEURON_LAUNCHER%" (
  echo Build the Windows host package first: powershell -ExecutionPolicy Bypass -File hardware-bridge/build.ps1
  pause
  exit /b 1
)
start "KNeuron" "%KNEURON_LAUNCHER%" --project "%~dp0." %*
