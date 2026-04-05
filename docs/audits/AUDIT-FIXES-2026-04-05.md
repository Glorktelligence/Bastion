# Bastion Audit Fix Spec — 2026-04-05

**Auditors**: Harry Smith, Claude (Opus 4.6)
**Target Version**: 0.8.2
**Scope**: All S-* and P-* findings from the 2026-04-05 security + pixel audit

---

## DEFERRED TO OWN SESSION (do NOT implement in this sprint)

### D-1: Per-message DH Ratchet
**Reason**: Fundamental crypto layer change. Incorrect implementation breaks ALL message encryption. Needs its own design doc, test plan, and focused session.

### D-2: File E2E Encryption (S-1 implementation fix)  
**Reason**: Encrypting files before relay submission changes the quarantine hash verification pipeline. Relay currently verifies hashes on plaintext content — switching to encrypted blob hashes requires rethinking the entire quarantine flow. Needs its own session with D-1.

---

## FIX 1: SECURITY.md Disclosure for S-1 (file encryption gap)

**Finding**: SECURITY.md claims "File content (E2E encrypted, separately from message encryption)" under "What the Relay Cannot See", but file_manifest messages send fileData as plaintext base64 via `client.send()` (not `sendSecure()`). The relay CAN see file content during quarantine.

**Fix**: Update SECURITY.md to move "File content" from "Cannot See" to "Can See" section, with a note that this is a known limitation being addressed. Add to Known Limitations.

### Files to modify:
- `SECURITY.md`

### Changes:
1. Under "What the Relay Cannot See", REMOVE the line:
   ```
   - File content (E2E encrypted, separately from message encryption)
   ```

2. Under "What the Relay Can See (Even If Compromised)", ADD:
   ```
   - File content during quarantine (plaintext for hash verification — E2E file encryption planned)
   ```

3. Under "Known Limitations", ADD:
   ```
   - **File content visible to relay**: File transfers currently pass through the relay in plaintext for quarantine hash verification. The relay can see file content during the quarantine window. E2E file encryption (encrypting before submission, with the relay verifying encrypted blob hashes) is planned but requires changes to the quarantine verification pipeline.
   ```

---

## FIX 2: AI Disclosure Per-Launch Reset (S-2)

**Finding**: `ai-disclosure.ts` saves dismiss state to localStorage which persists across Tauri app restarts. Comment says "per-session" but behaviour is permanent. Compliance risk for Article 50.

**Fix**: Keep localStorage for reliability, but clear the dismiss key on app launch (in `+layout.svelte` onMount or session init). This gives per-launch behaviour: dismiss persists within a session but resets when the app restarts.

### Files to modify:
- `packages/client-human/src/lib/stores/ai-disclosure.ts`
- `packages/client-human/src/routes/+layout.svelte`

### Changes to `ai-disclosure.ts`:
1. Add a `resetDismissal()` method to `AiDisclosureStore` interface and implementation:
   ```typescript
   /** Reset dismissal state — call on app launch for per-launch behaviour. */
   resetDismissal(): void;
   ```
   Implementation:
   ```typescript
   resetDismissal(): void {
     try {
       globalThis.localStorage?.removeItem(DISMISS_KEY);
     } catch {
       // localStorage unavailable
     }
     store.update((s) => ({ ...s, dismissed: false }));
   },
   ```

2. Update the comment at the top to say:
   ```
   * Dismissal state uses localStorage for reliability but is reset on each
   * app launch via resetDismissal() — per-launch, not permanent.
   ```

3. Remove the initial dismissed check from the factory (the `const dismissed = ...` line). Initialize `dismissed: false` always. The reset happens on mount.

### Changes to `+layout.svelte`:
1. In the `onMount` callback, after store subscriptions are set up, call:
   ```javascript
   session.aiDisclosure.resetDismissal();
   ```

---

## FIX 3: AI Challenge Override Timer (S-3)

**Finding**: The AI challenge dialog's Override button has no wait timer. Accept is correctly disabled during countdown, but Override allows impulsive bypass of the waiting period.

**Fix**: Apply the same timer disable to the Override button.

### Files to modify:
- `packages/client-human/src/routes/+layout.svelte`

### Changes:
In the challenge dialog actions section, change the Override button from:
```svelte
<button class="ai-mem-btn ai-mem-dismiss" onclick={() => handleChallengeResponse('override')}>Override</button>
```
To:
```svelte
<button class="ai-mem-btn ai-mem-dismiss" onclick={() => handleChallengeResponse('override')} disabled={challengeTimerRemaining > 0}>
  Override{#if challengeTimerRemaining > 0} ({challengeTimerRemaining}s){/if}
</button>
```

The Cancel button should remain always-enabled — cancelling is the safe action.

---

## FIX 4: Memory Proposal Editing UI (S-4 + P-4)

**Finding**: `memoryEditText` state variable is set but never rendered in an editable field. `handleMemoryProposalSave(null)` always sends original content. Users can't modify proposals before saving.

**Fix**: Add an editable textarea to the AI memory proposal toast, and pass edited content to save handler.

### Files to modify:
- `packages/client-human/src/routes/+layout.svelte`

### Changes:
Replace the AI memory proposal toast section with:
```svelte
{#if aiMemoryProposal}
<div class="ai-memory-toast">
  <div class="ai-memory-header">Claude suggests remembering:</div>
  <textarea
    class="ai-memory-edit"
    bind:value={memoryEditText}
    rows="3"
  ></textarea>
  <div class="ai-memory-meta">Category: {aiMemoryProposal.category} &middot; {aiMemoryProposal.reason}</div>
  <div class="ai-memory-actions">
    <button class="ai-mem-btn ai-mem-save" onclick={() => handleMemoryProposalSave(memoryEditText)}>Save</button>
    <button class="ai-mem-btn ai-mem-dismiss" onclick={handleMemoryProposalDismiss}>Dismiss</button>
  </div>
</div>
{/if}
```

Add CSS for the textarea:
```css
.ai-memory-edit {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--color-border, #2a2a4a);
  border-radius: 0.375rem;
  background: var(--color-bg, #0a0a1a);
  color: var(--color-text, #eee);
  font-size: 0.85rem;
  font-family: inherit;
  resize: vertical;
  margin-bottom: 0.25rem;
}
```

---

## FIX 5: Reconnection + E2E Badge Logic (P-1 + P-2)

**Finding**: (P-1) `reconnectDelay` prop exists on StatusIndicator but is never passed — dead code. (P-2) When E2E is completely unavailable, no badge renders at all — user has no indication encryption is absent.

**Fix**: 
1. Pass `reconnectDelay` from the page (requires tracking it in the connection store or session).
2. Add a "No E2E" red badge when connected but E2E is not available.
3. During reconnection, show reconnection state instead of E2E badge.

### Files to modify:
- `packages/client-human/src/lib/components/StatusIndicator.svelte`

### Changes to StatusIndicator.svelte:
Replace the E2E badge section:
```svelte
{#if status === 'authenticated' || status === 'connected'}
  {#if e2eActive}
    <span class="e2e-badge e2e-active">🔒 Encrypted</span>
  {:else if e2eAvailable}
    <span class="e2e-badge e2e-warn">⚠️ Unencrypted</span>
  {/if}
{/if}
```

With:
```svelte
{#if status === 'reconnecting'}
  <span class="e2e-badge e2e-reconnecting">🔄 Reconnecting</span>
{:else if status === 'authenticated' || status === 'connected'}
  {#if e2eActive}
    <span class="e2e-badge e2e-active">🔒 Encrypted</span>
  {:else if e2eAvailable}
    <span class="e2e-badge e2e-warn">⚠️ Unencrypted</span>
  {:else}
    <span class="e2e-badge e2e-unavailable">🔓 No E2E</span>
  {/if}
{/if}
```

Add CSS:
```css
.e2e-reconnecting {
  background: color-mix(in srgb, #f59e0b 15%, transparent);
  color: #f59e0b;
  animation: pulse 1.5s infinite;
}

.e2e-unavailable {
  background: color-mix(in srgb, #ef4444 15%, transparent);
  color: #ef4444;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

---

## FIX 6: FileOfferBanner Dark Mode (P-3)

**Finding**: FileOfferBanner uses hardcoded light-theme hex colours instead of CSS variables. Renders as a jarring light box on dark theme.

**Fix**: Replace all hardcoded colours with CSS variables matching the rest of the UI.

### Files to modify:
- `packages/client-human/src/lib/components/FileOfferBanner.svelte`

### Changes:
Replace the entire `<style>` block. Key replacements:
| Old (light) | New (dark theme vars) |
|---|---|
| `background: #fffbe6` | `background: color-mix(in srgb, #d4a843 10%, var(--color-surface, #111128))` |
| `color: #666` | `color: var(--color-text-muted)` |
| `color: #444` | `color: var(--color-text-muted)` |
| `background: #fff` | `background: var(--color-bg, #0a0a1a)` |
| `border: 1px solid #eee` | `border: 1px solid var(--color-border)` |
| `color: #555` | `color: var(--color-text-muted)` |
| `background: #2d7d46` / hover `#236b38` | `background: var(--color-success, #22c55e)` |
| `border: 1px solid #999` | `border: 1px solid var(--color-border)` |
| `color: #666` (reject btn) | `color: var(--color-text-muted)` |
| `background: #f5f5f5` (reject hover) | `background: var(--color-border)` |
| `border: 1px solid #ccc` (toggle) | `border: 1px solid var(--color-border)` |
| `font-family: system-ui` | Remove (inherit from app) |

Full replacement style block:
```css
.file-offer-banner {
  border: 1px solid #d4a843;
  border-left: 4px solid #d4a843;
  background: color-mix(in srgb, #d4a843 10%, var(--color-surface, #111128));
  border-radius: 6px;
  padding: 12px 16px;
  margin: 8px 0;
  font-size: 14px;
  color: var(--color-text);
}
.banner-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.banner-icon { font-size: 20px; }
.banner-title { flex: 1; }
.banner-title strong { display: block; color: var(--color-text); }
.sender { font-size: 12px; color: var(--color-text-muted); }
.toggle-btn {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 12px;
  color: var(--color-text-muted);
}
.toggle-btn:hover { background: var(--color-border); color: var(--color-text); }
.file-summary {
  margin: 8px 0 4px;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.filename { font-weight: 600; color: var(--color-text); }
.meta { font-size: 12px; color: var(--color-text-muted); }
.purpose { font-size: 13px; color: var(--color-text-muted); margin-bottom: 8px; }
.details {
  background: var(--color-bg, #0a0a1a);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 8px;
  margin: 8px 0;
}
.details table { width: 100%; border-collapse: collapse; font-size: 13px; }
.details td { padding: 3px 8px; vertical-align: top; color: var(--color-text); }
.details td:first-child { font-weight: 500; width: 100px; color: var(--color-text-muted); }
.mono { font-family: monospace; font-size: 12px; }
.hash { word-break: break-all; }
.actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.btn-accept {
  background: var(--color-success, #22c55e);
  color: white;
  border: none;
  border-radius: 4px;
  padding: 6px 16px;
  cursor: pointer;
  font-weight: 500;
}
.btn-accept:hover { opacity: 0.9; }
.btn-reject {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 6px 16px;
  cursor: pointer;
  color: var(--color-text-muted);
}
.btn-reject:hover { background: var(--color-border); color: var(--color-text); }
```

---

## Verification Checklist

After all fixes are applied, verify:

- [ ] `pnpm build` — clean (no TypeScript errors)
- [ ] `pnpm lint` — 0 issues
- [ ] `pnpm test` — all tests pass
- [ ] SECURITY.md accurately reflects file transfer reality
- [ ] AI disclosure banner appears on every app launch (not permanently dismissed)
- [ ] AI challenge Override button is disabled during timer countdown
- [ ] Memory proposal shows editable textarea with pre-filled content
- [ ] StatusIndicator shows "🔓 No E2E" when encryption unavailable
- [ ] StatusIndicator shows "🔄 Reconnecting" during reconnection
- [ ] FileOfferBanner renders correctly on dark theme (no white/light areas)
- [ ] Cancel button on AI challenge remains always-enabled (safe exit)

---

## SECURITY-AUDIT.md Addendum Entry

After fixes are verified, append to SECURITY-AUDIT.md:

```markdown
## ADDENDUM: v0.8.1 Findings (2026-04-05)

### Finding S-1: File Content Visible to Relay (MEDIUM — documented)

**Issue**: `+page.svelte:handleFileUpload()` sends file_manifest with plaintext fileData via `client.send()`, bypassing E2E encryption (`sendSecure()`). SECURITY.md incorrectly claimed file content was E2E encrypted.

**Fix (this sprint)**: Updated SECURITY.md to accurately document that file content is visible to relay during quarantine. Added to Known Limitations.

**Deferred**: Full E2E file encryption (encrypt before submission, relay verifies encrypted blob hashes) requires quarantine pipeline rework. Scheduled for dedicated crypto session alongside per-message DH ratchet.

### Finding S-2: AI Disclosure Dismissal Persisted Permanently (LOW)

**Issue**: localStorage dismiss key survived Tauri app restarts. Comment claimed "per-session" behaviour.

**Fix**: Added `resetDismissal()` to AiDisclosureStore, called on app launch. Dismiss persists within session, resets on restart.

### Finding S-3: AI Challenge Override No Timer (LOW)

**Issue**: Override button in AI challenge dialog had no wait timer, allowing impulsive bypass during challenge hours.

**Fix**: Override button now disabled with countdown timer matching Accept button. Cancel remains always-enabled.

### Finding S-4 + P-4: Memory Proposal Edit UI Missing (INFO)

**Issue**: `memoryEditText` state scaffolded but no editable input rendered. Save always sent original content.

**Fix**: Added textarea to memory proposal toast. Users can now edit content before saving.

### Finding P-1 + P-2: E2E Badge Missing States (MEDIUM — UX)

**Issue**: No E2E badge when encryption unavailable. reconnectDelay dead code.

**Fix**: Added "🔓 No E2E" red badge when connected without encryption. Added "🔄 Reconnecting" state with pulse animation.

### Finding P-3: FileOfferBanner Light Theme (LOW)

**Issue**: Hardcoded light-theme hex colours. Jarring on dark theme.

**Fix**: Replaced all hardcoded colours with CSS variables matching dark theme.
```
