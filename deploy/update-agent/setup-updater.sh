#!/bin/bash
# Bastion Update Agent — Setup Script
# Run as root on each VM that needs an update agent
#
# Usage:
#   sudo ./setup-updater.sh
#
# Prerequisites:
#   - Node.js >= 20.0.0
#   - systemd
#   - sudo

set -euo pipefail

INSTALL_DIR="/opt/bastion-updater"
CONFIG_FILE="$INSTALL_DIR/config.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Bastion Update Agent Setup ==="
echo ""

# Check running as root
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run as root"
    exit 1
fi

# Check prerequisites
echo "[0/5] Checking prerequisites..."
if ! command -v node &>/dev/null; then
    echo "  ERROR: Node.js not found. Install Node.js >= 20.0.0"
    exit 1
fi
NODE_VERSION=$(node --version | sed 's/v//')
echo "  Node.js $NODE_VERSION found"

if ! command -v systemctl &>/dev/null; then
    echo "  ERROR: systemd not found"
    exit 1
fi
echo "  systemd found"
echo ""

# Create system user
echo "[1/5] Creating bastion-updater user..."
if ! id bastion-updater &>/dev/null; then
    useradd -r -s /usr/sbin/nologin -d /opt/bastion-updater bastion-updater
    echo "  Created bastion-updater user"
else
    echo "  User already exists"
fi
echo ""

# Install sudoers
echo "[2/5] Installing sudoers config..."
cp "$SCRIPT_DIR/bastion-updater-sudoers" /etc/sudoers.d/bastion-updater
chmod 0440 /etc/sudoers.d/bastion-updater
visudo -c -q
echo "  Sudoers installed and validated"
echo ""

# Copy agent files
echo "[3/6] Installing agent to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
if [ -d "$SCRIPT_DIR/../../packages/update-agent/dist" ]; then
    cp -r "$SCRIPT_DIR/../../packages/update-agent/dist/" "$INSTALL_DIR/"
    # Copy package.json but strip devDependencies (contain workspace:* refs
    # that pnpm cannot resolve outside the monorepo)
    node -e "
      const pkg = JSON.parse(require('fs').readFileSync('$SCRIPT_DIR/../../packages/update-agent/package.json','utf8'));
      delete pkg.devDependencies;
      require('fs').writeFileSync('$INSTALL_DIR/package.json', JSON.stringify(pkg, null, 2) + '\n');
    "
    echo "  Agent files copied (devDependencies stripped from package.json)"
else
    echo "  WARNING: No built agent found at packages/update-agent/dist"
    echo "  Build first: pnpm --filter @bastion/update-agent build"
    echo "  Then re-run this script"
fi
chown -R bastion-updater:bastion-updater "$INSTALL_DIR"
echo ""

# Install runtime dependencies
echo "[4/6] Installing runtime dependencies..."
if [ -f "$INSTALL_DIR/package.json" ]; then
    cd "$INSTALL_DIR"
    if command -v pnpm &>/dev/null; then
        sudo -u bastion-updater pnpm install --prod 2>&1 | tail -3
    elif command -v npm &>/dev/null; then
        sudo -u bastion-updater npm install --omit=dev 2>&1 | tail -3
    else
        echo "  ERROR: Neither pnpm nor npm found — cannot install dependencies"
        exit 1
    fi
    cd "$SCRIPT_DIR"
    echo "  Dependencies installed (ws, zod)"
else
    echo "  WARNING: No package.json — skipping dependency install"
fi
echo ""

# Install systemd service
echo "[5/6] Installing systemd service..."
cp "$SCRIPT_DIR/bastion-updater.service" /etc/systemd/system/
systemctl daemon-reload
echo "  Service installed"
echo ""

# Config check
echo "[6/6] Checking configuration..."
if [ ! -f "$CONFIG_FILE" ]; then
    echo "  No config.json found at $CONFIG_FILE"
    echo ""
    echo "  Copy and edit an example config:"
    echo "    cp $SCRIPT_DIR/config.relay.example.json $CONFIG_FILE"
    echo "    # or"
    echo "    cp $SCRIPT_DIR/config.ai-vm.example.json $CONFIG_FILE"
    echo "    chown bastion-updater:bastion-updater $CONFIG_FILE"
    echo ""
    echo "  Then enable and start:"
    echo "    systemctl enable --now bastion-updater"
else
    echo "  Config found at $CONFIG_FILE"
    systemctl enable --now bastion-updater
    echo "  Service enabled and started"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Check status:  systemctl status bastion-updater"
echo "View logs:     journalctl -u bastion-updater -f"
echo "Admin panel:   /update page shows connected agents"
