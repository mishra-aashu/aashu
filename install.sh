#!/usr/bin/env bash
# ==========================================================
# Aashu AI - Desktop Application Installer for Linux
# ==========================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "Installing Aashu AI Desktop Application..."

# 1. Build Rust Release Binary
echo "Compiling Rust release binary..."
cargo build --release

# 2. Make scripts executable
chmod +x "$SCRIPT_DIR/start-app.sh"

# 3. Create System Applications Directory if not exists
APPS_DIR="$HOME/.local/share/applications"
mkdir -p "$APPS_DIR"

# 4. Generate & Copy Desktop Entry to System Applications Menu
DESKTOP_FILE="$APPS_DIR/aashu-ai.desktop"

cat << EOF > "$DESKTOP_FILE"
[Desktop Entry]
Version=1.0
Type=Application
Name=Aashu AI
Comment=Aashu AI Voice Assistant & Local Memory System
Exec=$SCRIPT_DIR/start-app.sh
Icon=$SCRIPT_DIR/public/icon.svg
Terminal=false
Categories=Utility;AudioVideo;Development;
StartupWMClass=Aashu
EOF

chmod +x "$DESKTOP_FILE"

# Update desktop database if available
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database "$APPS_DIR" &> /dev/null || true
fi

echo ""
echo "=========================================================="
echo "Aashu AI Desktop App Successfully Installed!"
echo "=========================================================="
echo ""
echo "Aap app ko 2 tarike se chala sakte hain:"
echo "1. System App Menu: Apne Linux Start / App Menu me 'Aashu AI' search karke click karein."
echo "2. Terminal: Project folder me './start-app.sh' run karein."
echo ""
