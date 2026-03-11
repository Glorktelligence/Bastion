# Security Patterns - Encryption, Auth, File Airlock

**Read this before implementing any security-sensitive code.**

---

## Core Principles

1. Trust no one — not the human, not the AI, not the relay
2. Every file crosses the boundary through quarantine — no exceptions
3. E2E encryption means the relay is zero-knowledge
4. Allowlist, not blocklist — default deny
5. The MaliClaw Clause is hardcoded and non-negotiable

---

## E2E Encryption

### Architecture
- Human client encrypts → relay transports encrypted blob → AI client decrypts
- Relay NEVER sees plaintext. Relay transports opaque blobs.
- Key exchange during session establishment (Double Ratchet adapted)
- Library: libsodium via `sodium-native`
- Keys stored encrypted at rest on each client

### Implementation
```typescript
// Encrypt before sending to relay
const encrypted = await encrypt(plaintext, sessionKey);
const envelope = { ...message, payload: encrypted };

// Relay routes without reading
relay.route(envelope); // Cannot decrypt payload

// Recipient decrypts
const plaintext = await decrypt(envelope.payload, sessionKey);
```

**Never** log plaintext message content at the relay level. Only metadata.

---

## Authentication

### JWT Flow
1. Client connects via WSS
2. Client sends credentials in session initiation
3. Relay validates, issues JWT (15-min expiry)
4. Client includes JWT in all subsequent messages
5. Client refreshes via `token_refresh` before expiry
6. Expired JWT → session terminated

### Provider Approval (AI clients)
- Explicit allowlist — no self-registration
- Each provider registered with identity, capabilities, credentials
- Unapproved connections rejected at TLS handshake level
- Logged as `BASTION-2004`

### Admin Auth
- Primary: Client certificates (self-signed CA on relay)
- Fallback: Username + TOTP (Argon2id hashed password)
- Rate limited: 5 attempts / 15 min, then 1-hour lockout
- Admin panel ONLY on local network / WireGuard — never public

---

## The MaliClaw Clause

**Non-negotiable. Non-bypassable. Hardcoded.**

```typescript
// packages/relay/src/auth/maliclaw-clause.ts
const BLOCKED_IDENTIFIERS = [
  'openclaw',
  'clawdbot', 
  'moltbot',
  'clawrouter',
] as const;

// This function is called at TLS handshake level
// It cannot be disabled via configuration
// It operates independently of the allowlist
export function checkMaliClawClause(clientId: string): boolean {
  const normalised = clientId.toLowerCase();
  return !BLOCKED_IDENTIFIERS.some(blocked => 
    normalised.includes(blocked)
  );
}
```

**Rules:**
- This check is HARDCODED — no config file, no environment variable, no flag
- Adding to the list: allowed (via code change + PR)
- Removing from the list: NOT allowed
- Making it configurable: NOT allowed
- Tests must verify it cannot be bypassed

---

## File Transfer Airlock

### Human → AI
1. Human encrypts file client-side
2. Encrypted blob → relay quarantine
3. Relay hashes blob, sends `file-manifest` (metadata only) to AI
4. AI reviews manifest, sends `file-request` if wanted
5. Relay delivers to read-only intake directory on AI VM
6. Hash verified at delivery (must match receipt)
7. File purged on completion or timeout

### AI → Human
1. AI encrypts file, submits to relay outbound quarantine
2. Relay hashes, sends `file-offer` to human
3. Human reviews offer, explicitly accepts or rejects
4. On accept: relay delivers encrypted blob to human
5. Human decrypts locally, hash verified

### Hash Verification
```typescript
// Every stage gets a hash
const hashAtSubmission = sha256(blob);
const hashAtQuarantine = sha256(storedBlob);
const hashAtDelivery = sha256(deliveredBlob);

// Any mismatch = BASTION-5001, transfer rejected, alert fired
if (hashAtDelivery !== hashAtSubmission) {
  throw new BastionError('BASTION-5001', 'File hash mismatch');
}
```

### Chain of Custody
Every file transfer generates audit entries:
- Who sent it, when
- Hash at each stage
- Who accepted/rejected
- When purged
- Any hash mismatches

---

## Session Security

### Single Device
- Only one human client at a time
- New device triggers `session_conflict`
- Takeover requires explicit confirmation
- No implicit session stealing

### Reconnection
- 5-minute grace period on disconnect
- Relay holds up to 100 messages during suspension
- Reconnection requires last-received message ID
- Grace timer minimum floor: 2 minutes

---

## Checklist: Security Code

```
□ E2E encryption used for all message/file content
□ Relay never sees plaintext
□ JWT validated on every message
□ Allowlist checked before routing
□ MaliClaw Clause fires at TLS level
□ File transfers go through quarantine
□ Hashes verified at every stage
□ Audit events logged for all security actions
□ No hardcoded secrets (except MaliClaw blocklist)
□ Admin panel not exposed publicly
```
