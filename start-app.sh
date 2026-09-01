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
    if [ -f "$SCRIPT_DIR/target/release/groq-memory-system" ]; then
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

echo "🖥️ Launching Standalone Desktop Application Window..."

# Try launching in Chrome/Chromium/Brave App Mode first for native window experience
if command -v google-chrome &> /dev/null; then
    google-chrome --app="${APP_URL}" --user-data-dir="${SCRIPT_DIR}/.app-profile" &
elif command -v chromium-browser &> /dev/null; then
    chromium-browser --app="${APP_URL}" --user-data-dir="${SCRIPT_DIR}/.app-profile" &
elif command -v chromium &> /dev/null; then
    chromium --app="${APP_URL}" --user-data-dir="${SCRIPT_DIR}/.app-profile" &
elif command -v brave-browser &> /dev/null; then
    brave-browser --app="${APP_URL}" --user-data-dir="${SCRIPT_DIR}/.app-profile" &
elif command -v xdg-open &> /dev/null; then
    xdg-open "${APP_URL}"
else
    echo "Please open your browser at: ${APP_URL}"
fi

echo "✅ Aashu AI is running at ${APP_URL}"
