# ==========================================================
# Aashu AI Voice Memory - Windows Desktop Launcher & Dev Script
# ==========================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "Starting Aashu AI Desktop Application..." -ForegroundColor Cyan

# 1. If pre-compiled release binary exists
$ReleaseBin = Join-Path $ScriptDir "src-tauri\target\release\aashu-ai.exe"
$BinSubdir  = Join-Path $ScriptDir "bin\aashu-ai.exe"

if (Test-Path $ReleaseBin) {
    Write-Host "Launching compiled Tauri Native App binary..." -ForegroundColor Green
    Start-Process $ReleaseBin
    exit 0
} elseif (Test-Path $BinSubdir) {
    Write-Host "Launching compiled binary from bin directory..." -ForegroundColor Green
    Start-Process $BinSubdir
    exit 0
}

# 2. Development mode via npx, cargo tauri, or cargo run
Set-Location (Join-Path $ScriptDir "src-tauri")

if (Get-Command npx -ErrorAction SilentlyContinue) {
    Write-Host "Launching Tauri v2 Native App (npx @tauri-apps/cli dev)..." -ForegroundColor Green
    npx @tauri-apps/cli dev
} elseif (Get-Command cargo -ErrorAction SilentlyContinue) {
    Write-Host "Launching Tauri v2 Native App (cargo tauri dev)..." -ForegroundColor Green
    cargo tauri dev
} else {
    Write-Host "Neither Node.js (npx) nor Rust (cargo) were detected in PATH." -ForegroundColor Red
    Write-Host "Please install Node.js or Rust to run in development mode." -ForegroundColor Yellow
}
