#!/bin/bash
# Copyright 2026 Glorktelligence — Harry Smith
# Licensed under the Apache License, Version 2.0
# See LICENSE file for full terms
#
# Bastion Update Agent — Setup Script (idempotent — safe to rerun)
#
# Usage:
#   sudo ./setup-updater.sh          # Install or update the agent
#   sudo ./setup-updater.sh --help   # Show help
#
# This script is idempotent: it can be run multiple times safely.
# On subsequent runs it will:
#   - Skip user creation if the user already exists
#   - Preserve config.json (deployer customisations survive)
#   - Overwrite dist/, package.json, sudoers, service file (the update)
#   - Clean and reinstall node_modules
#   - Restart the service

set -euo pipefail

INSTALL_DIR="/opt/bastion-updater"
CONFIG_FILE="$INSTALL_DIR/config.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_SRC="$SCRIPT_DIR/../../packages/update-agent"

# ---------------------------------------------------------------------------
# --help
# ---------------------------------------------------------------------------

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    cat <<'HELP'
Bastion Update Agent — Setup Script

Usage: sudo ./setup-updater.sh [--help]

This script installs or updates the Bastion update agent on the current
machine. It is idempotent — safe to run multiple times.

What it does:
  1. Creates the bastion-updater system user (skips if exists)
  2. Installs sudoers whitelist for git/pnpm commands
  3. Copies agent dist/ and package.json to /opt/bastion-updater
     (preserves existing config.json)
  4. Cleans and reinstalls runtime dependencies (ws, zod)
  5. Installs systemd service file and reloads daemon
  6. Sets ownership and restarts the service

Prerequisites:
  - Must be run as root (sudo)
  - Node.js >= 20.0.0
  - systemd
  - Agent must be built first: pnpm --filter @bastion/update-agent build

On first run:
  - Copy and edit a config file after setup:
    cp config.relay.example.json /opt/bastion-updater/config.json
    chown bastion-updater:bastion-updater /opt/bastion-updater/config.json

On subsequent runs:
  - config.json is preserved automatically
  - The service is restarted with the updated agent code
HELP
    exit 0
fi

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run as root (sudo)"
    exit 1
fi

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

FIRST_RUN=true
if [ -d "$INSTALL_DIR/dist" ]; then
    FIRST_RUN=false
fi

echo "=== Bastion Update Agent Setup ==="
echo ""
if [ "$FIRST_RUN" = true ]; then
    echo "Mode: FRESH INSTALL"
else
    echo "Mode: UPDATE (config.json will be preserved)"
fi
echo "Install dir: $INSTALL_DIR"
echo ""

# ---------------------------------------------------------------------------
# [0/6] Prerequisites
# ---------------------------------------------------------------------------

echo "[0/6] Checking prerequisites..."
if ! command -v node &>/dev/null; then
    echo "  ERROR: Node.js not found. Install Node.js >= 20.0.0"
    exit 1
fi
NODE_VERSION=$(node --version | sed 's/v//')
echo "  Node.js $NODE_VERSION"

if ! command -v systemctl &>/dev/null; then
    echo "  ERROR: systemd not found"
    exit 1
fi
echo "  systemd found"

if [ ! -d "$AGENT_SRC/dist" ]; then
    echo "  ERROR: No built agent at $AGENT_SRC/dist"
    echo "  Build first: pnpm --filter @bastion/update-agent build"
    exit 1
fi
echo "  Agent build found"
echo ""

# ---------------------------------------------------------------------------
# [1/6] System user — skip if exists
# ---------------------------------------------------------------------------

echo "[1/6] System user..."
if ! id bastion-updater &>/dev/null; then
    useradd -r -s /usr/sbin/nologin -d "$INSTALL_DIR" bastion-updater
    echo "  Created bastion-updater user"
else
    echo "  User already exists — skipping"
fi
echo ""

# ---------------------------------------------------------------------------
# [2/6] Sudoers — always overwrite (might have new entries)
# ---------------------------------------------------------------------------

echo "[2/6] Sudoers config..."
cp "$SCRIPT_DIR/bastion-updater-sudoers" /etc/sudoers.d/bastion-updater
chmod 0440 /etc/sudoers.d/bastion-updater
visudo -c -q
echo "  Sudoers installed and validated"
echo ""

# ---------------------------------------------------------------------------
# [3/6] Agent files — overwrite dist + package.json, preserve config.json
# ---------------------------------------------------------------------------

echo "[3/6] Installing agent to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"

# Preserve config.json if it exists
CONFIG_BACKED_UP=false
if [ -f "$CONFIG_FILE" ]; then
    cp "$CONFIG_FILE" /tmp/bastion-updater-config-backup.json
    CONFIG_BACKED_UP=true
    echo "  Backed up existing config.json"
fi

# Copy dist (overwrite)
cp -r "$AGENT_SRC/dist/" "$INSTALL_DIR/"

# Copy package.json — strip devDependencies and scripts
# (devDependencies contain workspace:* refs that break outside the monorepo,
#  scripts reference tsc which isn't installed in production)
node -e "
  const pkg = JSON.parse(require('fs').readFileSync('$AGENT_SRC/package.json','utf8'));
  delete pkg.devDependencies;
  delete pkg.scripts;
  require('fs').writeFileSync('$INSTALL_DIR/package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo "  Agent files copied (devDeps + scripts stripped)"

# Restore config.json if it was backed up
if [ "$CONFIG_BACKED_UP" = true ]; then
    cp /tmp/bastion-updater-config-backup.json "$CONFIG_FILE"
    rm -f /tmp/bastion-updater-config-backup.json
    echo "  Restored existing config.json"
fi
echo ""

# ---------------------------------------------------------------------------
# [4/6] Runtime dependencies — clean and reinstall
# ---------------------------------------------------------------------------

echo "[4/6] Installing runtime dependencies..."
# Clean node_modules for a fresh install
if [ -d "$INSTALL_DIR/node_modules" ]; then
    rm -rf "$INSTALL_DIR/node_modules"
    echo "  Cleaned old node_modules"
fi

cd "$INSTALL_DIR"
if command -v pnpm &>/dev/null; then
    sudo -u bastion-updater pnpm install --prod 2>&1 | tail -3
elif command -v npm &>/dev/null; then
    sudo -u bastion-updater npm install --omit=dev 2>&1 | tail -3
else
    echo "  ERROR: Neither pnpm nor npm found"
    exit 1
fi
cd "$SCRIPT_DIR"
echo "  Dependencies installed"
echo ""

# ---------------------------------------------------------------------------
# [5/6] Systemd service — always overwrite + reload
# ---------------------------------------------------------------------------

echo "[5/6] Systemd service..."
cp "$SCRIPT_DIR/bastion-updater.service" /etc/systemd/system/
systemctl daemon-reload
echo "  Service file installed, daemon reloaded"
echo ""

# ---------------------------------------------------------------------------
# [6/6] Ownership + start
# ---------------------------------------------------------------------------

echo "[6/6] Ownership and service..."
chown -R bastion-updater:bastion-updater "$INSTALL_DIR"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "  No config.json found — service will not start without it."
    echo ""
    echo "  Copy and edit an example config:"
    echo "    cp $SCRIPT_DIR/config.relay.example.json $CONFIG_FILE"
    echo "    # or"
    echo "    cp $SCRIPT_DIR/config.ai-vm.example.json $CONFIG_FILE"
    echo "    chown bastion-updater:bastion-updater $CONFIG_FILE"
    echo ""
    echo "  Then start:"
    echo "    systemctl enable --now bastion-updater"
else
    systemctl enable bastion-updater
    systemctl restart bastion-updater
    echo "  Service enabled and restarted"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Status:  systemctl status bastion-updater"
echo "Logs:    journalctl -u bastion-updater -f"
echo "Admin:   /update page shows connected agents"
