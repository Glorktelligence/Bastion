# Bastion Update Agent — Deployment Guide

The update agent runs on each VM in your Bastion deployment, connecting to the relay as an `updater` client. It receives whitelisted build commands and reports status back to the admin panel.

## Prerequisites

- Node.js >= 20.0.0
- systemd (Linux)
- sudo
- The Bastion relay must be running and accessible

## Quick Setup

```bash
# On each VM (relay VM and AI VM):
cd /path/to/bastion/deploy/update-agent
chmod +x setup-updater.sh
sudo ./setup-updater.sh
```

The script creates the `bastion-updater` system user, installs the sudoers whitelist, copies agent files, installs runtime dependencies (`ws`, `zod`), and installs the systemd service.

## Manual Setup

### 1. Create system user

```bash
sudo useradd -r -s /usr/sbin/nologin -d /opt/bastion-updater bastion-updater
```

### 2. Install sudoers whitelist

```bash
sudo cp bastion-updater-sudoers /etc/sudoers.d/bastion-updater
sudo chmod 0440 /etc/sudoers.d/bastion-updater
sudo visudo -c  # Validate syntax
```

### 3. Install agent

```bash
sudo mkdir -p /opt/bastion-updater
# Copy built agent files
sudo cp -r ../../packages/update-agent/dist/ /opt/bastion-updater/

# Copy package.json WITHOUT devDependencies (they contain workspace:*
# refs that pnpm cannot resolve outside the monorepo)
node -e "
  const pkg = JSON.parse(require('fs').readFileSync('../../packages/update-agent/package.json','utf8'));
  delete pkg.devDependencies;
  require('fs').writeFileSync('/opt/bastion-updater/package.json', JSON.stringify(pkg, null, 2) + '\n');
"

sudo chown -R bastion-updater:bastion-updater /opt/bastion-updater

# Install runtime dependencies (ws, zod only)
cd /opt/bastion-updater
sudo -u bastion-updater pnpm install --prod  # or: npm install --omit=dev
```

### 4. Configure

```bash
# For relay VM:
sudo cp config.relay.example.json /opt/bastion-updater/config.json
# For AI VM:
sudo cp config.ai-vm.example.json /opt/bastion-updater/config.json

# Edit as needed:
sudo nano /opt/bastion-updater/config.json
sudo chown bastion-updater:bastion-updater /opt/bastion-updater/config.json
```

### 5. Install and start service

```bash
sudo cp bastion-updater.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bastion-updater
```

## Configuration Options

| Field | Required | Description |
|-------|----------|-------------|
| `relayUrl` | Yes | WSS URL of the relay (e.g., `wss://127.0.0.1:9443`) |
| `agentId` | Yes | Unique identifier for this agent |
| `agentName` | Yes | Human-readable name (shown in admin panel) |
| `component` | Yes | Component name: `relay`, `ai-client`, etc. |
| `buildPath` | Yes | Absolute path to the Bastion project root |
| `services` | Yes | Systemd service names to restart after build |
| `buildSteps` | No | Default build steps (override via update_execute) |
| `rejectUnauthorized` | No | Set `false` for self-signed TLS certs (dev only) |
| `commandTimeoutMs` | No | Command timeout in ms (default: 300000 = 5 min) |

## Verifying Connection

1. Start the agent: `sudo systemctl start bastion-updater`
2. Check status: `sudo systemctl status bastion-updater`
3. Open the admin panel at `/update` — the agent should appear under "Connected Update Agents"

## Troubleshooting

### Agent won't connect
```bash
journalctl -u bastion-updater -f
```
- Check `relayUrl` is correct and reachable
- Check TLS: set `rejectUnauthorized: false` for self-signed certs
- Check firewall allows WSS traffic on port 9443

### Permission denied on build
```bash
# Verify sudoers is installed correctly:
sudo visudo -c
# Test a command manually:
sudo -u bastion git -C /opt/bastion pull
```

### Service won't restart
```bash
# Check the sudoers whitelist includes the service name:
grep bastion-relay /etc/sudoers.d/bastion-updater
# The service name in config.json must match exactly
```

## Security Notes

- The agent can **only** execute 3 command types: `git_pull`, `pnpm_install`, `pnpm_build`
- No `eval()`, no `exec(arbitrary)`, no shell injection possible
- The sudoers file restricts sudo to specific commands as specific users
- All commands run with `PATH=/usr/bin:/bin` (no user PATH)
- The relay cannot read update_execute payloads (E2E encrypted)
- All update operations are logged in the tamper-evident audit chain

## Files

| File | Purpose |
|------|---------|
| `bastion-updater.service` | systemd unit file |
| `bastion-updater-sudoers` | sudo whitelist (install to `/etc/sudoers.d/`) |
| `setup-updater.sh` | Automated setup script |
| `config.relay.example.json` | Example config for relay VM |
| `config.ai-vm.example.json` | Example config for AI VM |
