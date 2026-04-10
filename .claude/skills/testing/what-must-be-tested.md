# What Must Be Tested — Reference

## Protocol Package (Critical)
- Every Zod schema validates correct input
- Every Zod schema rejects invalid input
- Serialisation round-trips preserve data
- Integrity hashes detect tampering
- All error codes have valid BASTION-CXXX format
- All message types have schemas
- Extension manifest schemas validate correctly
- conversationRenderers schema validates

## Safety Engine (Critical)
- Layer 1 denies every blocked category
- Layer 2 challenges every trigger factor
- Layer 3 catches every ambiguity type
- Safety floors CANNOT be lowered (test explicitly)
- Budget thresholds trigger correct actions and cooldowns
- Tool registry blocks self-modification
- Challenge Me More blocks budget changes during active periods

## Sole Authorities (Critical — test sovereignty)
- DateTimeManager: managers use DTM not raw Date for business logic
- PurgeManager: deletion only through PurgeManager (fallback for tests OK)
- ToolManager: lock prevents post-lock additions, violations escalate
- SkillsManager: forensic scanner catches all 10 threat patterns
- BastionBash: tier classification, scope enforcement, rate limiting
- AuditLogger: event type registry locks, unregistered types → violation

## Relay (Critical)
- Message routing delivers to correct recipient
- Schema validation rejects malformed messages
- JWT validation rejects expired/invalid tokens
- JWT jti replay rejected (seenJtis)
- MaliClaw Clause rejects all identifiers + /claw/i
- Audit log append-only with hash chain integrity
- ChainIntegrityMonitor detects tampered entries
- File quarantine hashes match at every stage
- Session conflict sends session_superseded
- Extension rate limiting enforced (60/min/namespace)
- Extension direction enforcement (human_to_ai/ai_to_human/bidirectional)
- Admin API requires authentication on all endpoints
- Reconnection grace period + queue flush

## Clients
- WebSocket handles reconnection
- Challenge UI blocks until response
- All stores cleared on disconnect
- E2E key exchange produces interoperable ciphers
- Extension bridge queues messages before registration
- Conversation renderers dispatch correctly
- Encryption failure notifies user

## Before Marking "Tested"
```
□ All test files pass (3,651+ tests, 0 failures)
□ Console output suppressed for expected-failure tests
□ Safety floor tests included
□ MaliClaw tests included
□ Sole authority sovereignty verified
□ Edge cases covered
□ No skipped tests
□ pnpm lint clean
□ Platform-specific tests guarded (process.platform)
```
