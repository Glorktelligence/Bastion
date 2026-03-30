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
echo "[3/5] Installing agent to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
if [ -d "$SCRIPT_DIR/../../packages/update-agent/dist" ]; then
    cp -r "$SCRIPT_DIR/../../packages/update-agent/dist/" "$INSTALL_DIR/"
    cp "$SCRIPT_DIR/../../packages/update-agent/package.json" "$INSTALL_DIR/"
    echo "  Agent files copied from monorepo build"
else
    echo "  WARNING: No built agent found at packages/update-agent/dist"
    echo "  Build first: pnpm --filter @bastion/update-agent build"
    echo "  Then re-run this script"
fi
chown -R bastion-updater:bastion-updater "$INSTALL_DIR"
echo ""

# Install systemd service
echo "[4/5] Installing systemd service..."
cp "$SCRIPT_DIR/bastion-updater.service" /etc/systemd/system/
systemctl daemon-reload
echo "  Service installed"
echo ""

# Config check
echo "[5/5] Checking configuration..."
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
