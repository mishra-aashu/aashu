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
    echo "🔨 Compiling & starting Rust Axum Backend Server..."
    cargo run --release &
    SERVER_PID=$!
    
    # Wait for server to boot
    echo -n "⏳ Waiting for server to initialize..."
    until curl -s "${APP_URL}/api/status" > /dev/null; do
        sleep 1
        echo -n "."
    done
    echo " Ready!"
fi

echo "🖥️ Launching Standalone Desktop Application Window..."

# Try launching in Chromium/Chrome/Brave standalone App Mode first for native window experience
if command -v google-chrome &> /dev/null; then
    google-chrome --app="${APP_URL}" --user-data-dir="${SCRIPT_DIR}/.chrome-app-profile" &
elif command -v chromium-browser &> /dev/null; then
    chromium-browser --app="${APP_URL}" --user-data-dir="${SCRIPT_DIR}/.chrome-app-profile" &
elif command -v chromium &> /dev/null; then
    chromium --app="${APP_URL}" --user-data-dir="${SCRIPT_DIR}/.chrome-app-profile" &
elif command -v brave-browser &> /dev/null; then
    brave-browser --app="${APP_URL}" --user-data-dir="${SCRIPT_DIR}/.chrome-app-profile" &
elif command -v xdg-open &> /dev/null; then
    xdg-open "${APP_URL}"
else
    echo "Please open your browser at: ${APP_URL}"
fi

echo "✅ App running at ${APP_URL}"
