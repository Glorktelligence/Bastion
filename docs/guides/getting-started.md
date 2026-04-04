# Getting Started with Bastion

This guide walks you through running a complete local Bastion instance — relay server, AI client, and human client all communicating over encrypted WebSocket connections.

By the end, you will have:

1. A relay server routing messages on `wss://localhost:9443`
2. An AI client connected with a mock provider
3. A human client (Tauri desktop app) connected and ready to chat
4. Sent your first message and triggered your first safety challenge

## Prerequisites

| Requirement | Version | Check |
|-------------|---------|-------|
| Node.js | >= 20.0.0 (recommended: 24.x) | `node --version` |
| PNPM | >= 9.0.0 (recommended: 10.x) | `pnpm --version` |
| OpenSSL | Any recent version | `openssl version` |
| Git | Any recent version | `git --version` |
| Rust toolchain | Latest stable (for Tauri) | `rustc --version` |

**Platform-specific:**

- **Linux**: Install system dependencies for Tauri: `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`
- **macOS**: Xcode Command Line Tools: `xcode-select --install`
- **Windows**: Visual Studio Build Tools with C++ workload, WebView2 (pre-installed on Windows 11)

> **Note:** If you only want to work with the relay and AI client (no desktop UI), you can skip the Rust toolchain and Tauri dependencies entirely. The logic layer of every package compiles with `tsc` alone.

## Clone and Install

```bash
git clone https://git.glorktelligence.co.uk/glorktelligence/bastion.git
cd bastion

# Install all workspace dependencies
pnpm install

# Build all packages (protocol first, then consumers)
pnpm build
```

The build compiles TypeScript across all 7 packages. Protocol and crypto build first because other packages depend on them.

Verify the build is clean:

```bash
# Type checking across all packages
pnpm typecheck

# Lint check (Biome)
pnpm lint
```

## Running the Test Suite

Before running anything live, confirm all tests pass:

```bash
# Run all tests across the monorepo
pnpm test
```

This executes trace-test.mjs files in each package. You should see output like:

```
@bastion/protocol: 190 checks passed
@bastion/crypto: 134 checks passed
@bastion/relay: 288 checks passed
@bastion/relay (admin): 185 checks passed
@bastion/client-ai: 239 checks passed
@bastion/client-ai (files): 155 checks passed
@bastion/client-human: 272 checks passed
@bastion/client-human-mobile: 123 checks passed
@bastion/relay-admin-ui: 192 checks passed
Integration: 82 checks passed
File Transfer Integration: 105 checks passed
```

All 2,964 tests should pass.

## Step 1: Generate TLS Certificates

The relay requires TLS — it will not accept unencrypted connections. For local development, generate a self-signed certificate:

```bash
mkdir -p certs

openssl req -x509 -newkey rsa:2048 \
  -keyout certs/key.pem \
  -out certs/cert.pem \
  -days 365 -nodes \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

This creates `certs/cert.pem` and `certs/key.pem` valid for one year.

## Step 2: Start the Relay Server

The relay is the central hub. Create a startup script:

```javascript
// start-relay.mjs
import { BastionRelay, generateSelfSigned, JwtService, MessageRouter, AuditLogger } from '@bastion/relay';

// For development: generate self-signed TLS (or use certs/ from Step 1)
const tls = generateSelfSigned('localhost');

// Create the JWT service (shared secret for development)
const jwtService = new JwtService({
  secret: 'bastion-dev-secret-change-in-production',
  issuer: 'bastion-relay',
  audience: 'bastion-client',
  expiresInSeconds: 900, // 15 minutes
});

// Create the audit logger
const auditLogger = new AuditLogger({ sessionId: 'relay-main' });

// Create and start the relay
const relay = new BastionRelay({
  port: 9443,
  host: '0.0.0.0',
  tls,
  auditLogger,
});

relay.on('listening', (port, host) => {
  console.log(`Bastion relay listening on wss://${host}:${port}`);
});

relay.on('connection', (ws, info) => {
  console.log(`Client connected: ${info.id} from ${info.remoteAddress}`);
});

relay.on('disconnection', (info, code, reason) => {
  console.log(`Client disconnected: ${info.id} (${code}: ${reason})`);
});

relay.on('message', (data, info) => {
  console.log(`Message from ${info.id}: ${data.substring(0, 100)}...`);
});

await relay.start();
console.log('Relay is ready. Waiting for connections...');
```

Run it:

```bash
node start-relay.mjs
```

You should see:

```
Bastion relay listening on wss://0.0.0.0:9443
Relay is ready. Waiting for connections...
```

## Step 3: Connect the AI Client

The AI client is a headless Node.js process that connects to the relay via WSS. Create a startup script:

```javascript
// start-ai-client.mjs
import { BastionAiClient } from '@bastion/client-ai';

const client = new BastionAiClient({
  relayUrl: 'wss://localhost:9443',
  identity: {
    id: 'ai-client-dev-001',
    type: 'ai',
    displayName: 'Claude (Development)',
  },
  providerId: 'anthropic-dev',
  rejectUnauthorized: false, // Accept self-signed certs in development
});

client.on('connected', () => {
  console.log('AI client connected to relay');
});

client.on('message', (data) => {
  console.log('Received message:', data.substring(0, 200));
  // In production, this would feed into the safety engine and provider adapter
});

client.on('authenticated', (jwt, expiresAt) => {
  console.log(`Authenticated. Token expires at ${expiresAt}`);
});

client.on('error', (err) => {
  console.error('AI client error:', err.message);
});

client.on('disconnected', (code, reason) => {
  console.log(`Disconnected: ${code} ${reason}`);
});

await client.connect();
console.log('AI client is ready.');
```

Run it in a second terminal:

```bash
node start-ai-client.mjs
```

You should see:

```
AI client connected to relay
AI client is ready.
```

And in the relay terminal:

```
Client connected: <uuid> from ::1
```

## Step 4: Start the Human Client

The human client is a Tauri desktop application with a SvelteKit frontend.

```bash
cd packages/client-human

# Start the SvelteKit dev server (frontend only, no Tauri shell)
pnpm dev
```

This starts a Vite dev server at `http://localhost:5173`. The UI will show:

- A connection status indicator (initially disconnected)
- A message area (empty)
- An input bar with Chat/Task mode toggle

To run the full Tauri desktop app (requires Rust toolchain):

```bash
# From packages/client-human
pnpm tauri dev
```

This opens the Bastion desktop window with full native functionality.

## Step 5: Send Your First Message

With all three components running:

1. **In the human client UI**, ensure the connection status shows "Connected" (green indicator).

2. **Type a message** in the chat input:

   ```
   Hello! Can you check the status of the nginx service?
   ```

3. **Click Send** (or press Enter).

The message flows through the protocol:

```
Human Client                    Relay                       AI Client
     |                            |                            |
     |-- conversation message --> |                            |
     |   (encrypted payload)      |-- forward encrypted -----> |
     |                            |                            |
     |                            |   <-- status message ----- |
     |   <-- forward status ----- |   (10% — checking...)      |
     |                            |                            |
     |                            |   <-- result message ----- |
     |   <-- forward result ----- |   (nginx is running)       |
     |                            |                            |
```

The relay sees the message envelope (type, sender, correlation ID) but **never** the payload content — that's encrypted end-to-end.

## Step 6: Trigger Your First Challenge

The safety engine evaluates every task before execution. To trigger a Layer 2 challenge:

1. **Switch to Task mode** using the pill toggle in the input bar.

2. **Fill in the task form:**
   - **Action**: `delete`
   - **Target**: `production-database`
   - **Priority**: `critical`
   - **Constraints**: (leave empty)

3. **Submit the task.**

The AI client's three-layer safety engine evaluates this:

- **Layer 1 (Absolute Boundaries)**: Passes — `delete` is not in the hardcoded deny list (that would be e.g. `self_modify`, `disable_safety`).
- **Layer 2 (Contextual Evaluation)**: **Triggers a challenge.** The combination of `delete` + `production` + `critical` priority scores high on:
  - `irreversible_action` factor (weight: 0.9)
  - `production_target` factor (weight: 0.8)
  - `high_risk_hours` factor (if outside safe hours, weight: 0.7)
- **Layer 3**: Not reached (Layer 2 already challenged).

You'll see a **Challenge Banner** appear in the UI:

```
Safety Challenge — Layer 2
Reason: Irreversible action targeting production environment
Risk Assessment: This action would delete data from the production
database. This cannot be undone without backup restoration...

Factors:
  irreversible_action  ███████████░  0.9
  production_target    ████████░░░░  0.8
  high_risk_hours      ███████░░░░░  0.7

Suggested Alternatives:
  - Create a backup before deletion
  - Delete from staging first to verify
  - Use a soft-delete with recovery window

[Proceed Anyway]  [Modify Task]  [Cancel]
```

You have three options:

- **Proceed Anyway**: The task executes as-is. Your decision is logged in the audit trail.
- **Modify Task**: Re-open the task form with pre-filled fields. You can change the target, add constraints, etc.
- **Cancel**: The task is abandoned. The AI client logs the cancellation.

> **Important:** Layer 1 denials cannot be overridden. If you try a task with `action: "self_modify"` or a target matching the MaliClaw Clause blocklist, you'll receive a **denial** — not a challenge. This is hardcoded and non-negotiable.

## Step 7: Explore the Admin Panel

The relay includes a separate admin HTTPS server:

```javascript
// In your start-relay.mjs, add:
import { AdminServer, AdminAuth, AdminRoutes } from '@bastion/relay';

const adminAuth = new AdminAuth({
  accounts: [{
    username: 'admin',
    // In production, use scrypt-hashed password. For dev:
    passwordHash: 'dev-hash',
    totpSecret: undefined,
  }],
});

const adminRoutes = new AdminRoutes({
  providerRegistry,
  auditLogger,
  adminAuth,
});

const adminServer = new AdminServer({
  port: 9444,
  host: '127.0.0.1', // localhost only — enforced
  tls,
  adminAuth,
  adminRoutes,
});

await adminServer.start();
console.log('Admin panel at https://localhost:9444');
```

The admin panel provides:

- **Dashboard**: Connection counts, message throughput, safety challenge rates
- **Provider Management**: Approve/revoke AI providers, set capability matrices
- **Blocklist**: View the MaliClaw Clause entries (read-only — cannot be modified)
- **Quarantine**: View files currently in quarantine, their hash verification status
- **Connection Log**: Active sessions, connection history, heartbeat status
- **System Config**: View (not lower) safety floor values, audit retention settings

## Project Structure

```
bastion/
├── packages/
│   ├── protocol/         # Shared types, schemas, constants (build first)
│   ├── crypto/           # E2E encryption, key management, audit hashing
│   ├── relay/            # WSS server, routing, auth, audit, quarantine
│   ├── client-ai/        # Headless AI client, safety engine, provider adapter
│   ├── client-human/     # Tauri + SvelteKit desktop app
│   ├── client-human-mobile/ # React Native mobile app
│   ├── relay-admin-ui/   # SvelteKit admin panel
│   └── tests/            # Protocol schema + integration tests
├── docs/
│   ├── spec/             # Core and supplementary specifications
│   ├── protocol/         # Standalone protocol specification
│   └── guides/           # This guide and deployment guide
└── packages/infrastructure/  # Docker, Proxmox templates
```

## Common Issues

### "Self-signed certificate" errors

When connecting clients to a relay using self-signed certificates:

- **AI client**: Set `rejectUnauthorized: false` in the config (development only).
- **Human client**: The Tauri WebView may reject self-signed certs. Use the `WEBKIT_DISABLE_COMPOSITING_MODE` environment variable or add the cert to your system trust store.

### "OpenSSL not found" on certificate generation

The relay's `generateSelfSigned()` function requires OpenSSL in your PATH:

- **macOS**: Pre-installed with Xcode CLT, or `brew install openssl`.
- **Linux**: `sudo apt install openssl` or equivalent.
- **Windows**: Install OpenSSL via `winget install ShiningLight.OpenSSL` or use the Git Bash bundled OpenSSL.

### Port already in use

The relay defaults to port 9443. If it's occupied:

```javascript
const relay = new BastionRelay({
  port: 9444, // Use a different port
  // ...
});
```

Update client configs to match.

### Build errors after pulling changes

```bash
pnpm install    # Reinstall dependencies
pnpm clean      # Remove all build artifacts
pnpm build      # Rebuild everything
```

## Next Steps

- **[Deployment Guide](./deployment.md)** — Self-hosting Bastion on a real server with TLS, VLANs, and AI VM isolation.
- **[Protocol Specification](../protocol/bastion-protocol-v0.5.0.md)** — Complete protocol reference with all 85 message types.
- **[Contributing](../../CONTRIBUTING.md)** — How to contribute to Bastion.
- **[Security Policy](../../SECURITY.md)** — Reporting vulnerabilities and understanding the threat model.
