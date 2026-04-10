# Security Audit Checklist

## Authentication & Authorization
- [ ] JWT tokens validated on every message (not just connection)
- [ ] JWT jti tracked — replay rejected (seenJtis Map)
- [ ] Token refresh doesn't expose JWT in plaintext
- [ ] Admin API endpoints ALL require Bearer token authentication
- [ ] MaliClaw Clause checked BEFORE allowlist (hardcoded, non-bypassable)
- [ ] Session conflict handled — second client sends session_superseded to first

## E2E Encryption
- [ ] All sensitive message types encrypted (not in PLAINTEXT_TYPES)
- [ ] Relay never sees plaintext content
- [ ] Key exchange uses X25519
- [ ] KDF ratchet steps on every message
- [ ] Encryption failure: user notified, not silently sent as plaintext

## Input Validation
- [ ] All Zod schemas validate required fields and types
- [ ] Path traversal blocked (../ and symlinks via realpathSync)
- [ ] Content scanning: 13 patterns blocked in project_sync
- [ ] Extension type names validated: /^[a-z][a-z0-9_-]*$/
- [ ] Shell redirect operators validated in BastionBash (>, >>, 2>, &>)
- [ ] No raw user input in SQL queries (parameterized)

## File Security
- [ ] 3-stage custody chain: submission → quarantine → delivery
- [ ] SHA-256 hash verified at each stage
- [ ] File content never forwarded without quarantine
- [ ] IntakeDirectory: read-only, 50 file max
- [ ] OutboundStaging: write-only, 50 file max

## Audit Trail
- [ ] AuditLogger is sole audit authority (relay + AI client)
- [ ] Hash chain integrity verified on startup + every 5 minutes
- [ ] Unregistered event types → AUDIT_CHAIN_LOGGING_VIOLATION
- [ ] Audit storage failure: caught, isDegraded flag set, no crash
- [ ] All security events wired (check for console.log-only events)

## XSS/Injection
- [ ] Admin UI disclosure link: URL protocol whitelist (https/http only)
- [ ] Extension UI: CSP meta tag injected in sandboxed iframes
- [ ] Extension bridge: BLOCKED_UI_PATTERNS enforced
- [ ] postMessage: origin validation on receiving side

## Sole Authority Enforcement
For each authority, grep for bypasses:
- [ ] DateTimeManager: no business-logic `new Date()` outside DTM
- [ ] PurgeManager: no direct fs.unlinkSync/rmSync outside purge.ts (except test fallbacks)
- [ ] ToolManager: no tool registration outside ToolRegistryManager
- [ ] SkillsManager: no skill loading outside SkillsManager
- [ ] BastionBash: no direct child_process.exec outside BastionBash
- [ ] AuditLogger: no direct SQLite audit writes outside AuditLogger
