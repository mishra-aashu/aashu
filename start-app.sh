#!/usr/bin/env bash
# ==========================================================
# Aashu AI Voice Memory - Desktop App Launcher
# ==========================================================

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

PORT=3000
APP_URL="http://localhost:${PORT}"

echo "🚀 Starting Aashu AI Voice Memory System..."

# Check if port 3000 is already in use
if lsof -Pi :${PORT} -sTCP:LISTEN -t >/dev/null ; then
    echo "⚡ Backend server is already running on port ${PORT}."
else
    if [ -f "$SCRIPT_DIR/bin/groq-memory-system" ]; then
        echo "⚡ Executing pre-compiled release binary (bin/)..."
        "$SCRIPT_DIR/bin/groq-memory-system" &
    elif [ -f "$SCRIPT_DIR/target/release/groq-memory-system" ]; then
        echo "⚡ Executing pre-compiled Rust binary..."
        "$SCRIPT_DIR/target/release/groq-memory-system" &
    else
        echo "🔨 Building & starting Rust Backend Server..."
        cargo run --release &
    fi
    
    # Wait for server to boot
    echo -n "⏳ Waiting for server to initialize..."
    count=0
    until curl -s "${APP_URL}/api/status" > /dev/null; do
        sleep 1
        echo -n "."
        count=$((count+1))
        if [ $count -gt 30 ]; then
            echo " Server initialization timeout!"
            break
        fi
    done
    echo " Ready!"
fi

# Kill any stale instance running on the app profile so new flags take effect
pkill -f "user-data-dir=.*\.app-profile" 2>/dev/null || true
sleep 0.5

# Ensure Chrome profile uses dark custom window frame
if [ -f "${SCRIPT_DIR}/.app-profile/Default/Preferences" ]; then
    python3 -c '
import json, os
p = "'"${SCRIPT_DIR}"'/.app-profile/Default/Preferences"
if os.path.exists(p):
    try:
        with open(p, "r") as f: d = json.load(f)
        d.setdefault("browser", {})["use_custom_chrome_frame"] = True
        d.setdefault("theme", {})["system_theme"] = 0
        with open(p, "w") as f: json.dump(d, f)
    except Exception: pass
' 2>/dev/null
fi

echo "🖥️ Launching Standalone Desktop Application Window..."

export GTK_THEME=Adwaita:dark

# Try launching in Tauri Native App first (100% Rust Native Desktop experience)
if [ -d "${SCRIPT_DIR}/src-tauri" ] && command -v npx &> /dev/null; then
    echo "✨ Launching Pure Rust Tauri Native Application Window..."
    npx @tauri-apps/cli dev &
elif [ -f "${SCRIPT_DIR}/app_gui.py" ] && python3 -c 'import gi; gi.require_version("Gtk","3.0"); gi.require_version("WebKit2","4.1")' 2>/dev/null; then
    echo "✨ Launching Native GTK WebKit2 Application..."
    python3 "${SCRIPT_DIR}/app_gui.py" "${APP_URL}" &
elif command -v google-chrome &> /dev/null; then
    FLAGS="--app=${APP_URL} --force-dark-mode --enable-features=WebUIDarkMode,WindowControlsOverlay --user-data-dir=${SCRIPT_DIR}/.app-profile"
    google-chrome ${FLAGS} &
elif command -v chromium-browser &> /dev/null; then
    FLAGS="--app=${APP_URL} --force-dark-mode --enable-features=WebUIDarkMode,WindowControlsOverlay --user-data-dir=${SCRIPT_DIR}/.app-profile"
    chromium-browser ${FLAGS} &
elif command -v chromium &> /dev/null; then
    FLAGS="--app=${APP_URL} --force-dark-mode --enable-features=WebUIDarkMode,WindowControlsOverlay --user-data-dir=${SCRIPT_DIR}/.app-profile"
    chromium ${FLAGS} &
elif command -v brave-browser &> /dev/null; then
    FLAGS="--app=${APP_URL} --force-dark-mode --enable-features=WebUIDarkMode,WindowControlsOverlay --user-data-dir=${SCRIPT_DIR}/.app-profile"
    brave-browser ${FLAGS} &
elif command -v xdg-open &> /dev/null; then
    xdg-open "${APP_URL}"
else
    echo "Please open your browser at: ${APP_URL}"
fi

echo "✅ Aashu AI is running at ${APP_URL}"
