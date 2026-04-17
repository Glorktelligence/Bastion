# Deployment Guide — Self-Hosting Bastion

> **Recommended:** Use the `bastion-cli.sh` CLI tool for installation and updates.
> Run `sudo bash scripts/bastion-cli.sh install --vm relay` or `--vm ai` for automated setup.
> See the [CLI Management Tool](#cli-management-tool) section below.

This guide covers deploying Bastion on your own infrastructure. It assumes a Proxmox-based virtualisation environment with OPNSense firewall (matching the Glorktelligence Naval Fleet architecture), but the principles apply to any server topology with network segmentation.

## Architecture Overview

A production Bastion deployment has three network zones:

```
VLAN 10 (User)              VLAN 30 (DMZ)              VLAN 50 (Isolated)
┌─────────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
│  Human Client    │    │  Bastion Relay        │    │  AI Client VM       │
│  Desktop/Mobile  │    │  naval-bastion-01     │    │  naval-bastion-ai-01│
│  10.0.10.x       │    │  10.0.30.10           │    │  10.0.50.10         │
└────────┬─────────┘    └───────┬──────┬────────┘    └──────────┬──────────┘
         │                      │      │                        │
         │    ┌─────────────────┴──────┴────────────────────────┤
         │    │          OPNSense Firewall (Mystic)             │
         └────┤          Inter-VLAN routing & rules             ├──── WAN
              │          No lateral movement for AI VM          │
              └─────────────────────────────────────────────────┘
```

**Key principles:**

- The relay sits in a DMZ (VLAN 30) — accessible from both user and AI VLANs, but isolated from internal services.
- The AI client runs in a fully isolated VM (VLAN 50) — no lateral movement, no fleet access by default.
- Human clients connect from the user VLAN (10) or over WireGuard VPN from external networks.
- The firewall enforces all inter-VLAN rules. The relay's application-level security is defence in depth, not the only barrier.

## Prerequisites

| Component | Requirement |
|-----------|-------------|
| Proxmox VE | 8.x or later |
| OPNSense | 24.x or later |
| Node.js | >= 20.0.0 (recommended: 24.x LTS) |
| PNPM | >= 9.0.0 |
| OpenSSL | For certificate management |
| Domain name | For TLS certificates (e.g. `bastion.yourdomain.com`) |

## Step 1: TLS Certificate Setup

### Option A: Let's Encrypt (Recommended)

Use certbot or acme.sh to obtain a trusted certificate:

```bash
# Install certbot
sudo apt install certbot

# Obtain certificate (standalone mode — stop any web server first)
sudo certbot certonly --standalone \
  -d bastion.yourdomain.com \
  --email admin@yourdomain.com \
  --agree-tos

# Certificates are stored at:
# /etc/letsencrypt/live/bastion.yourdomain.com/fullchain.pem
# /etc/letsencrypt/live/bastion.yourdomain.com/privkey.pem
```

Set up automatic renewal:

```bash
# Test renewal
sudo certbot renew --dry-run

# Certbot installs a systemd timer automatically.
# After renewal, reload the relay:
sudo cat > /etc/letsencrypt/renewal-hooks/post/bastion-relay.sh << 'EOF'
#!/bin/bash
systemctl restart bastion-relay
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/post/bastion-relay.sh
```

### Option B: Internal CA

For fully internal deployments, use your own CA:

```bash
# Generate CA key and certificate
openssl genrsa -out ca-key.pem 4096
openssl req -x509 -new -nodes -key ca-key.pem -sha256 -days 3650 \
  -out ca-cert.pem -subj "/CN=Bastion Internal CA"

# Generate relay server certificate
openssl genrsa -out relay-key.pem 2048
openssl req -new -key relay-key.pem \
  -out relay.csr -subj "/CN=bastion.yourdomain.com"

# Create SAN config
cat > relay-san.cnf << EOF
[req]
distinguished_name = req_distinguished_name
[req_distinguished_name]
[v3_ext]
subjectAltName = DNS:bastion.yourdomain.com,IP:10.0.30.10
EOF

openssl x509 -req -in relay.csr -CA ca-cert.pem -CAkey ca-key.pem \
  -CAcreateserial -out relay-cert.pem -days 365 -sha256 \
  -extfile relay-san.cnf -extensions v3_ext
```

Distribute `ca-cert.pem` to all clients so they trust the relay's certificate.

### Admin Panel mTLS (Optional but Recommended)

For the admin panel, generate a client certificate:

```bash
# Generate admin client key and certificate
openssl genrsa -out admin-client-key.pem 2048
openssl req -new -key admin-client-key.pem \
  -out admin-client.csr -subj "/CN=bastion-admin"
openssl x509 -req -in admin-client.csr -CA ca-cert.pem -CAkey ca-key.pem \
  -CAcreateserial -out admin-client-cert.pem -days 365 -sha256

# Note the SHA-256 fingerprint — you'll need it for admin auth config
openssl x509 -in admin-client-cert.pem -noout -fingerprint -sha256
```

## Step 2: Relay Server Configuration

### System Setup (Debian/Ubuntu)

```bash
# On naval-bastion-01 (10.0.30.10)

# Install Node.js 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# Install PNPM
corepack enable
corepack prepare pnpm@10 --activate

# Create bastion user
sudo useradd -r -m -s /bin/bash bastion
sudo mkdir -p /opt/bastion
sudo chown bastion:bastion /opt/bastion
```

### Deploy the Relay

```bash
# As bastion user
sudo -u bastion bash

cd /opt/bastion
git clone https://git.glorktelligence.co.uk/glorktelligence/bastion.git .
pnpm install --frozen-lockfile
pnpm build
```

### Environment Configuration

Create `/opt/bastion/.env`:

```bash
# Relay configuration
BASTION_RELAY_PORT=9443
BASTION_RELAY_HOST=0.0.0.0

# TLS
BASTION_TLS_CERT=/etc/letsencrypt/live/bastion.yourdomain.com/fullchain.pem
BASTION_TLS_KEY=/etc/letsencrypt/live/bastion.yourdomain.com/privkey.pem

# JWT (generate a strong secret)
BASTION_JWT_SECRET=$(openssl rand -hex 64)
BASTION_JWT_ISSUER=bastion-relay
BASTION_JWT_AUDIENCE=bastion-client

# Admin panel
BASTION_ADMIN_PORT=9444
BASTION_ADMIN_HOST=127.0.0.1
BASTION_ADMIN_TLS_CERT=/opt/bastion/certs/relay-cert.pem
BASTION_ADMIN_TLS_KEY=/opt/bastion/certs/relay-key.pem
BASTION_ADMIN_CA=/opt/bastion/certs/ca-cert.pem

# Audit
BASTION_AUDIT_DB=/var/lib/bastion/audit.db
BASTION_AUDIT_RETENTION_DAYS=365

# AI Disclosure Banner (regulatory transparency — default: OFF)
# Set BASTION_DISCLOSURE_ENABLED=true to show a persistent banner to human clients.
# Template variables: {provider} and {model} are substituted at send time.
BASTION_DISCLOSURE_ENABLED=false
BASTION_DISCLOSURE_TEXT=You are interacting with an AI system powered by {provider} ({model}).
BASTION_DISCLOSURE_STYLE=info          # info | legal | warning
BASTION_DISCLOSURE_POSITION=banner     # banner (top) | footer (bottom)
BASTION_DISCLOSURE_DISMISSIBLE=true    # Can the user hide the banner?
# BASTION_DISCLOSURE_LINK=https://example.com/ai-policy
# BASTION_DISCLOSURE_LINK_TEXT=Learn more about our AI system
# BASTION_DISCLOSURE_JURISDICTION=EU AI Act Article 50
```

**Security note:** The `.env` file contains secrets. Set permissions:

```bash
chmod 600 /opt/bastion/.env
chown bastion:bastion /opt/bastion/.env
```

### Systemd Service

Create `/etc/systemd/system/bastion-relay.service`:

```ini
[Unit]
Description=Bastion Relay Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=bastion
Group=bastion
WorkingDirectory=/opt/bastion
EnvironmentFile=/opt/bastion/.env
ExecStart=/usr/bin/node /opt/bastion/start-relay.mjs
Restart=on-failure
RestartSec=5

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/bastion
PrivateTmp=true

# Resource limits
LimitNOFILE=65536
MemoryMax=512M

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bastion-relay
sudo systemctl status bastion-relay
```

## Step 3: AI Client VM Setup

### VM Isolation Requirements

The AI client VM must be fully isolated:

- **Separate VLAN** (50) with no access to internal services
- **No SSH from the AI VM to other hosts** (firewall-enforced)
- **API keys never leave VLAN 50** — the AI provider API is called from within the VM
- **Only outbound connections**: to the relay (VLAN 30, port 9443) and to AI provider APIs (WAN)

### System Setup

```bash
# On naval-bastion-ai-01 (10.0.50.10)

# Same Node.js setup as relay
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
corepack enable
corepack prepare pnpm@10 --activate

# Create bastion-ai user
sudo useradd -r -m -s /bin/bash bastion-ai
sudo mkdir -p /opt/bastion-ai
sudo chown bastion-ai:bastion-ai /opt/bastion-ai
```

### Deploy the AI Client

```bash
sudo -u bastion-ai bash
cd /opt/bastion-ai
git clone https://git.glorktelligence.co.uk/glorktelligence/bastion.git .
pnpm install --frozen-lockfile
pnpm build
```

### Environment Configuration

Create `/opt/bastion-ai/.env`:

```bash
# AI Client configuration
BASTION_RELAY_URL=wss://bastion.yourdomain.com:9443
BASTION_AI_CLIENT_ID=ai-client-prod-001
BASTION_AI_DISPLAY_NAME=Claude (Production)
BASTION_PROVIDER_ID=anthropic-prod

# AI Provider API key (NEVER expose outside this VM)
ANTHROPIC_API_KEY=sk-ant-...

# File handling
BASTION_INTAKE_DIR=/var/lib/bastion-ai/intake
BASTION_OUTBOUND_DIR=/var/lib/bastion-ai/outbound

# TLS (trust the relay's certificate)
BASTION_TLS_CA=/opt/bastion-ai/certs/ca-cert.pem
# Or for Let's Encrypt: NODE_EXTRA_CA_CERTS is not needed (trusted by default)

# Layer 2: Persistent memory
BASTION_MEMORIES_DB=/var/lib/bastion-ai/memories.db

# Layer 3: Project context
BASTION_PROJECT_DIR=/var/lib/bastion-ai/project

# Layer 4: MCP tool endpoints (one per provider — env vars are on AI VM only)
# BASTION_MCP_OBSIDIAN_URL=ws://192.168.1.108:3002
# BASTION_MCP_OBSIDIAN_API_KEY=<api-key-here>
# BASTION_MCP_PROXMOX_URL=wss://mcp.yourdomain.com/ws
# BASTION_MCP_PROXMOX_API_KEY=<api-key-here>

# Challenge Me More configuration
BASTION_CHALLENGE_CONFIG=/var/lib/bastion-ai/challenge-config.json

# Budget Guard (web search cost enforcement)
BASTION_BUDGET_DB=/var/lib/bastion-ai/budget.db
BASTION_BUDGET_CONFIG=/var/lib/bastion-ai/budget-config.json
# Default limits: $10/month, 500 searches/month, 50/day, 20/session

# Conversation manager
BASTION_TOKEN_BUDGET=100000
BASTION_USER_CONTEXT_PATH=/var/lib/bastion-ai/user-context.md

# Multi-conversation persistence (SQLite)
BASTION_CONVERSATIONS_DB=/var/lib/bastion-ai/conversations.db

# Streaming responses (set to 'false' to disable)
BASTION_STREAMING=true

# Common adapter configuration
BASTION_TEMPERATURE=1.0
BASTION_API_ENDPOINT=https://api.anthropic.com
BASTION_API_VERSION=2023-06-01
BASTION_TIMEOUT=120000

# Three Official Adapters (all share ANTHROPIC_API_KEY)
# Sonnet — default, conversation, task ($3/$15 per MTok)
BASTION_SONNET_MODEL=claude-sonnet-4-20250514
# BASTION_SONNET_PRICING_INPUT=3
# BASTION_SONNET_PRICING_OUTPUT=15

# Haiku — compaction, game ($0.80/$4 per MTok — 4x cheaper)
BASTION_HAIKU_MODEL=claude-haiku-4-5-20251001
# BASTION_HAIKU_PRICING_INPUT=0.8
# BASTION_HAIKU_PRICING_OUTPUT=4

# Opus — research, dream ($15/$75 per MTok, 8192 max tokens)
BASTION_OPUS_MODEL=claude-opus-4-6
# BASTION_OPUS_PRICING_INPUT=15
# BASTION_OPUS_PRICING_OUTPUT=75
# BASTION_OPUS_MAX_TOKENS=8192
```

```bash
chmod 600 /opt/bastion-ai/.env

# Create file handling directories
sudo mkdir -p /var/lib/bastion-ai/{intake,outbound}
sudo chown bastion-ai:bastion-ai /var/lib/bastion-ai/{intake,outbound}
```

### Systemd Service

Create `/etc/systemd/system/bastion-ai-client.service`:

```ini
[Unit]
Description=Bastion AI Client
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=bastion-ai
Group=bastion-ai
WorkingDirectory=/opt/bastion-ai
EnvironmentFile=/opt/bastion-ai/.env
ExecStart=/usr/bin/node /opt/bastion-ai/start-ai-client.mjs
Restart=on-failure
RestartSec=10

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/bastion-ai
PrivateTmp=true

# Resource limits
MemoryMax=1G

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bastion-ai-client
```

## Step 4: Firewall Rules (OPNSense)

These rules enforce the network isolation model on the OPNSense firewall (named "Mystic" in the Naval Fleet topology).

### VLAN Configuration

| VLAN ID | Name | Subnet | Interface | Purpose |
|---------|------|--------|-----------|---------|
| 10 | User | 10.0.10.0/24 | VLAN10 | Human clients (desktop, mobile) |
| 30 | DMZ | 10.0.30.0/24 | VLAN30 | Bastion relay server |
| 50 | Isolated | 10.0.50.0/24 | VLAN50 | AI client VM |

### Firewall Rules

Navigate to **Firewall > Rules** in OPNSense for each interface.

#### VLAN 10 (User) Rules

```
# Allow human clients to connect to the relay
Pass  IPv4  TCP  VLAN10 net  →  10.0.30.10  port 9443  # WSS relay
Pass  IPv4  TCP  VLAN10 net  →  10.0.30.10  port 9444  # Admin panel (optional)

# Block direct access to AI VM
Block IPv4  *    VLAN10 net  →  VLAN50 net              # No user→AI direct
```

#### VLAN 30 (DMZ) Rules

```
# Relay can respond to established connections (stateful — implicit)
# No outbound initiation to user or AI VLANs
Block IPv4  *    VLAN30 net  →  VLAN10 net              # No relay→user initiation
Block IPv4  *    VLAN30 net  →  VLAN50 net              # No relay→AI initiation
# Note: WebSocket is bidirectional over a single TCP connection.
# The relay responds over established connections, not new outbound connections.
```

#### VLAN 50 (Isolated) Rules

```
# AI VM connects to relay only
Pass  IPv4  TCP  10.0.50.10  →  10.0.30.10  port 9443  # WSS relay

# AI VM calls external AI provider APIs
Pass  IPv4  TCP  10.0.50.10  →  *           port 443    # HTTPS to AI APIs

# AI VM can resolve DNS
Pass  IPv4  UDP  10.0.50.10  →  *           port 53     # DNS

# Block everything else — no lateral movement
Block IPv4  *    VLAN50 net  →  VLAN10 net              # No AI→user
Block IPv4  *    VLAN50 net  →  10.0.0.0/8              # No AI→internal
# (except the relay rule above)
```

#### Anti-Lockout

```
# Always allow management access to OPNSense itself
Pass  IPv4  TCP  VLAN10 net  →  OPNSense    port 443   # Admin UI
Pass  IPv4  TCP  VLAN10 net  →  OPNSense    port 22    # SSH management
```

### OPNSense Configuration Steps

1. **Create VLANs**: Navigate to **Interfaces > Other Types > VLAN**. Create VLANs 10, 30, 50 on your trunk interface.

2. **Assign Interfaces**: Navigate to **Interfaces > Assignments**. Assign each VLAN to an interface (VLAN10, VLAN30, VLAN50).

3. **Configure Subnets**: On each interface, set the static IPv4 address:
   - VLAN10: 10.0.10.1/24
   - VLAN30: 10.0.30.1/24
   - VLAN50: 10.0.50.1/24

4. **DHCP** (optional): Enable DHCP on VLAN 10 for user devices. VLANs 30 and 50 use static IPs.

5. **Apply Firewall Rules**: Navigate to **Firewall > Rules** for each interface and add the rules above.

6. **NAT**: If the AI VM needs to reach external APIs, configure outbound NAT on the WAN interface for VLAN 50 traffic to port 443.

## Step 5: Human Client Distribution

### Desktop (Tauri)

Build the Tauri app for distribution:

```bash
cd packages/client-human

# Build for the current platform
pnpm tauri build
```

This produces platform-specific installers in `src-tauri/target/release/bundle/`:

- **Linux**: `.deb`, `.AppImage`
- **macOS**: `.dmg`, `.app`
- **Windows**: `.msi`, `.exe`

Configure the relay URL in the app settings or via environment variable:

```bash
BASTION_RELAY_URL=wss://bastion.yourdomain.com:9443
```

### Mobile (React Native)

```bash
cd packages/client-human-mobile

# iOS
npx react-native run-ios --configuration Release

# Android
npx react-native run-android --variant=release
```

## Step 6: Admin Dashboard

The admin dashboard provides live monitoring: connected clients, active sessions, message throughput, quarantine status, audit trail, and provider management.

The admin API and the admin SPA are served by the **relay's own AdminServer on port 9444** — there is no separate admin UI process. The relay resolves `packages/relay-admin-ui/build/` at startup and serves the static SPA alongside the `/api/*` routes over the same HTTPS listener.

### Build the Admin SPA

The admin UI is a SvelteKit app built with `@sveltejs/adapter-static`. Build it once after install and after every update:

```bash
cd /opt/bastion
pnpm --filter @bastion/relay-admin-ui run build:app
```

`bastion update --component relay` performs this step automatically.

### Environment Variables

Add admin credentials to `/opt/bastion/.env`:

```bash
# Admin authentication (required for mutations — POST/PUT/DELETE)
BASTION_ADMIN_USERNAME=admin
BASTION_ADMIN_PASSWORD=<strong-password>
# Or pre-hash: BASTION_ADMIN_PASSWORD_HASH=<scrypt-hash>
BASTION_ADMIN_TOTP_SECRET=<base32-totp-secret>

# Admin listener (defaults shown — 127.0.0.1 binding is enforced)
BASTION_ADMIN_PORT=9444
BASTION_ADMIN_HOST=127.0.0.1
```

If you omit the credentials, `start-relay.mjs` launches into the first-run setup wizard on port 9444 — open the tunnel (below), visit `https://127.0.0.1:9444`, and the wizard walks you through creating the admin account with TOTP enrolment.

### Systemd Service

The admin UI has no systemd unit of its own. `bastion-relay.service` is the only unit involved — see Step 4 for the relay service file. Ensure the SPA has been built (previous subsection) before starting the relay.

### Remote Access via SSH Tunnel

The relay binds the admin listener to `127.0.0.1` only, so you always reach it via an SSH tunnel — one tunnel is enough:

```bash
# From your workstation — single tunnel to 9444
ssh -L 9444:127.0.0.1:9444 bastion@10.0.30.10

# Then open https://127.0.0.1:9444
```

The admin listener uses HTTPS with the relay's TLS certificate. If you are using a self-signed cert, expect the browser warning and proceed — the tunnel plus localhost binding is the access control.

### Access Model

- **All admin endpoints require a session JWT** — obtain one by authenticating at `/api/admin/login` (HS256, 30-minute expiry, lockout after 5 failed attempts / 15 min).
- **Mutations require a valid session** — provider approval, revocation, capability updates, challenge-config changes, disclosure updates.
- **Temporal guards apply** — safety settings and provider mutations are blocked during active Challenge Me More hours (Challenge 4 / 7-day cooldown on loosening).

**Never expose the admin panel to a public interface.** The relay enforces this at two points: the constructor-time private-host guard (logs `security_violation` + throws) and a post-listen address re-verification (logs `security_violation` + shuts down). Attempting `BASTION_ADMIN_HOST=0.0.0.0` will refuse to start.

## Step 7: Monitoring and Maintenance

### Health Checks

```bash
# Check relay is accepting connections
curl -k https://bastion.yourdomain.com:9443 || echo "Relay is up (WSS upgrade expected)"

# Check systemd service status
systemctl status bastion-relay
systemctl status bastion-ai-client

# View relay logs
journalctl -u bastion-relay -f

# View AI client logs
journalctl -u bastion-ai-client -f
```

### Audit Log Inspection

The audit database is a SQLite file at the configured path (default: `/var/lib/bastion/audit.db`).

```bash
# Query recent audit events
sqlite3 /var/lib/bastion/audit.db "SELECT * FROM audit_entries ORDER BY timestamp DESC LIMIT 20"

# Check hash chain integrity
sqlite3 /var/lib/bastion/audit.db "SELECT COUNT(*) FROM audit_entries WHERE chain_hash IS NULL"
# Should return 0 (only the genesis entry has no previous hash)
```

### Backup

Back up regularly:

```bash
# Audit database
cp /var/lib/bastion/audit.db /backup/audit-$(date +%Y%m%d).db

# TLS certificates (if using internal CA)
cp -r /opt/bastion/certs /backup/certs-$(date +%Y%m%d)

# Configuration
cp /opt/bastion/.env /backup/env-$(date +%Y%m%d)
```

### Updates

```bash
# On both relay and AI client VMs
cd /opt/bastion  # or /opt/bastion-ai
git pull
pnpm install --frozen-lockfile
pnpm build

# Restart services
sudo systemctl restart bastion-relay
sudo systemctl restart bastion-ai-client
```

## Cryptography Notes

**AI client (Node.js):** Uses libsodium-wrappers-sumo (loaded automatically via `ensureSodium()`). No additional crypto configuration needed. The X25519 key exchange and XSalsa20-Poly1305 encryption are handled by the startup script.

**Human client (browser/Tauri):** Uses tweetnacl (pure JavaScript, zero native dependencies). No WASM loading, no native compilation — works in every browser and Tauri WebView. Crypto initialisation is synchronous.

**Interoperability:** Both implementations produce byte-identical NaCl ciphertext. The KDF ratchet uses SHA-512 truncated to 32 bytes on both sides.

**Budget Guard:** Web search usage is tracked in SQLite at `BASTION_BUDGET_DB` (default: `/var/lib/bastion/budget.db`). Budget configuration persisted at `BASTION_BUDGET_CONFIG` (default: `/var/lib/bastion/budget-config.json`). Default limits: $10/month, 500 searches/month, 50/day, 20/session. Monthly cap increases take effect next month only (tighten-only mid-month). All config changes have a 7-day cooldown and are blocked during challenge hours.

## CLI Management Tool

All components are managed via the `bastion` CLI tool (`scripts/bastion-cli.sh`). All components run as a single `bastion` user — VM-level isolation provides security separation.

**Install:**

```bash
sudo cp scripts/bastion-cli.sh /usr/local/bin/bastion
sudo chmod +x /usr/local/bin/bastion
```

**Usage:**

```bash
bastion status                          # Show service status
bastion update --component relay|ai     # Pull, install, build
bastion restart --component relay|ai|admin|all
bastion audit relay --live              # Live log stream
bastion migrate --vm relay|ai           # One-time migration (run as root)
```

**Systemd service templates** are in `deploy/systemd/` — copy to `/etc/systemd/system/` or use `bastion migrate` to install them automatically.

**Migration:** If upgrading from the old multi-user architecture (bastion-ai, bastion-updater users), run `sudo bastion migrate --vm relay` and `sudo bastion migrate --vm ai` once. This consolidates users, fixes ownership, updates paths, and installs systemd services.

## Security Checklist

Before going live, verify:

- [ ] TLS certificates are from a trusted CA (not self-signed)
- [ ] JWT secret is generated with `openssl rand -hex 64` (not a default value)
- [ ] `.env` files are `chmod 600` and owned by the service user
- [ ] Admin panel binds to `127.0.0.1` only
- [ ] OPNSense firewall rules are active and tested
- [ ] AI VM (VLAN 50) cannot reach internal services (test with `ping`, `curl`)
- [ ] AI VM cannot SSH to other hosts (test with `ssh`)
- [ ] AI provider API key is only on the AI VM (not on relay or clients)
- [ ] Audit database has write access only for the bastion user
- [ ] Systemd services use `NoNewPrivileges=true` and `ProtectSystem=strict`
- [ ] Automatic certificate renewal is configured and tested

## Troubleshooting

### Relay won't start: "EACCES: permission denied, bind"

Port 9443 is below 1024 on some systems. Either:

```bash
# Grant capability to bind to low ports
sudo setcap 'cap_net_bind_service=+ep' /usr/bin/node
```

Or use a higher port (9443 is above 1024, so this usually isn't an issue).

### AI client: "UNABLE_TO_VERIFY_LEAF_SIGNATURE"

The AI client doesn't trust the relay's TLS certificate. Options:

1. Use Let's Encrypt (trusted by default)
2. Set `NODE_EXTRA_CA_CERTS=/path/to/ca-cert.pem` in the AI client environment
3. Add the CA cert to the system trust store: `sudo cp ca-cert.pem /usr/local/share/ca-certificates/ && sudo update-ca-certificates`

### Firewall blocking connections

Test connectivity between VLANs:

```bash
# From AI VM, test relay connectivity
nc -zv 10.0.30.10 9443

# From human client network, test relay connectivity
nc -zv 10.0.30.10 9443
```

If blocked, check OPNSense firewall logs: **Firewall > Log Files > Live View**.

### Audit database locked

If the audit database reports "database is locked", ensure only one relay process is running:

```bash
# Check for duplicate processes
ps aux | grep bastion
systemctl status bastion-relay
```

SQLite in WAL mode supports one writer. The relay uses synchronous writes, so concurrent access from admin tools should use read-only mode.
