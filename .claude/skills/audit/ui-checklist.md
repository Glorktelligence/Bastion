# UI/UX Audit Checklist

## Human Client (PC) — packages/client-human

### Session & Connection
- [ ] Connection lifecycle: connect → authenticate → pair → key exchange → ready
- [ ] Disconnect: all stores cleared (17 domain + 6 session writables)
- [ ] Reconnect: state re-hydrated via sendHydrationQueries()
- [ ] E2E status indicator: shows green/yellow correctly
- [ ] Connection status: reflected in UI immediately

### Conversation View
- [ ] Messages render correctly (user + assistant + system)
- [ ] Message area stays within container bounds (no overflow breakout)
- [ ] Auto-scroll on new messages works
- [ ] Clicking a conversation navigates to messages view
- [ ] Extension messages with renderers: rendered via ExtensionMessageRenderer
- [ ] Extension messages without renderers: hidden (not shown as {})
- [ ] Markdown rendering in assistant messages (headers, bold, italic, code)

### Store Consistency
- [ ] All stores initialised on connect
- [ ] All stores cleared on disconnect
- [ ] No stores that can get out of sync
- [ ] localStorage items cleared on disconnect (dreamCycles etc.)

### Extension System
- [ ] Extension page loads components from manifest
- [ ] Sandboxed iframes created with CSP
- [ ] Bridge script injected (send/on/off/switchConversation)
- [ ] Message forwarding: extension messages route to bridge
- [ ] Bridge message queue: messages buffered before registration, flushed after
- [ ] Conversation renderers: registry populated, MessageBubble dispatches

### Routes & Navigation
- [ ] All routes functional (messages, settings, extensions, dreams)
- [ ] No dead routes or unreachable components
- [ ] Settings page: all configuration options present and functional
- [ ] Challenge UI: displays and blocks until response
- [ ] Memory proposal UI: displays approve/edit/reject options
- [ ] Dream cycle UI: shows proposals correctly

### Missing Features (document, don't fail)
- [ ] Adapter selector on conversation create
- [ ] Adapter selector during conversation
- [ ] File transfer UI completeness

---

## Relay Admin UI — packages/relay-admin-ui

### Authentication
- [ ] Login page: password + TOTP enforced
- [ ] 12+ chars, mixed case, digit required
- [ ] JWT token stored and sent as Bearer header
- [ ] Token expiry: handled (30-min JWT)
- [ ] Failed login: rate limited (5 attempts / 15 min)

### Pages (check all exist and are functional)
- [ ] Dashboard: connection status, provider list
- [ ] Providers: register, revoke, status
- [ ] Blocklist: MaliClaw display (non-removable), custom entries
- [ ] Config: challenge hours, budget, disclosure
- [ ] Audit: hash chain viewer, search, integrity check
- [ ] Sessions: active connections, paired status
- [ ] Setup: first-time wizard

### Missing Pages (document, don't fail)
- [ ] Tools page (relay has GET /api/tools)
- [ ] Skills page (no endpoint yet)
- [ ] Extensions page (relay has GET /api/extensions)

### Security
- [ ] Disclosure link: validated URL protocol (no javascript:)
- [ ] Destructive actions: require confirmation
- [ ] API errors: don't leak implementation details
- [ ] MaliClaw entries: cannot be removed via UI
