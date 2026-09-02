#!/usr/bin/env bash
# ==========================================================
# Aashu AI Voice Memory - Tauri Native Desktop Launcher
# ==========================================================

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

export GTK_THEME=Adwaita:dark

echo "Starting Aashu AI Native Desktop Application..."

# 1. If pre-compiled binary exists
if [ -f "$SCRIPT_DIR/src-tauri/target/release/aashu-ai" ]; then
    echo "Launching compiled Tauri Native App binary (Release)..."
    "$SCRIPT_DIR/src-tauri/target/release/aashu-ai" &
elif [ -f "$SCRIPT_DIR/src-tauri/target/debug/aashu-ai" ]; then
    echo "Launching compiled Tauri Native App binary (Debug)..."
    "$SCRIPT_DIR/src-tauri/target/debug/aashu-ai" &
elif [ -f "$SCRIPT_DIR/bin/aashu-ai" ]; then
    echo "Launching compiled Tauri Native App binary from bin/..."
    "$SCRIPT_DIR/bin/aashu-ai" &
# 2. Development mode via npx, cargo tauri, or cargo run
elif command -v npx &> /dev/null; then
    echo "Launching Tauri v2 Native App (npx @tauri-apps/cli dev)..."
    cd "$SCRIPT_DIR/src-tauri"
    npx @tauri-apps/cli dev
elif cargo tauri --version &> /dev/null; then
    echo "Launching Tauri v2 Native App (cargo tauri dev)..."
    cd "$SCRIPT_DIR/src-tauri"
    cargo tauri dev
else
    echo "Launching Tauri v2 Native App (cargo run)..."
    cd "$SCRIPT_DIR/src-tauri"
    cargo run
fi

echo "Aashu AI Desktop session initiated."
