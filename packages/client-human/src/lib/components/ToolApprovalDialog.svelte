<script lang="ts">
import * as session from '../session.js';
import type { PendingToolRequest } from '../stores/tools.js';

const { request }: { request: PendingToolRequest } = $props();

let trustLevel = $state(0);
let reason = $state('');
let scope = $state<'this_call' | 'session'>('this_call');
let showValidation = $state(false);

// Dangerous tools locked to this_call only
const scopeLocked = request.dangerous;
// Write/destructive tools note
const isWrite = request.category === 'write' || request.category === 'destructive';

function handleApprove(): void {
  if (trustLevel < 1 || trustLevel > 10 || !reason.trim()) {
    showValidation = true;
    return;
  }
  const client = session.getClient();
  if (!client) return;
  client.send(JSON.stringify({
    type: 'tool_approved',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: session.getIdentity(),
    payload: {
      requestId: request.requestId,
      toolId: request.toolId,
      trustLevel,
      reason: reason.trim(),
      scope: scopeLocked ? 'this_call' : scope,
    },
  }));
  session.tools.addApproved({
    toolId: request.toolId,
    trustLevel,
    scope: scopeLocked ? 'this_call' : scope,
    approvedAt: new Date().toISOString(),
    conversationId: session.conversations.store.get().activeConversationId ?? undefined,
  });
  session.tools.setPendingRequest(null);
}

function handleDeny(): void {
  const client = session.getClient();
  if (!client) return;
  client.send(JSON.stringify({
    type: 'tool_denied',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: session.getIdentity(),
    payload: {
      requestId: request.requestId,
      toolId: request.toolId,
      reason: reason.trim() || 'Denied by operator',
    },
  }));
  session.tools.setPendingRequest(null);
}

const [provider, toolName] = request.toolId.split(':');
</script>

<div class="overlay">
  <div class="dialog">
    <h2>Tool Approval Required</h2>

    {#if request.dangerous}
      <div class="danger-banner">DANGEROUS TOOL — requires approval for every call</div>
    {/if}

    <div class="info-grid">
      <span class="label">Tool</span>
      <code class="value">{toolName}</code>
      <span class="label">Provider</span>
      <span class="value">{provider}</span>
      <span class="label">Action</span>
      <span class="value">{request.action}</span>
      <span class="label">Mode</span>
      <span class="value badge" class:badge-task={request.mode === 'task'}>{request.mode}</span>
      <span class="label">Category</span>
      <span class="value badge" class:badge-write={isWrite} class:badge-danger={request.dangerous}>{request.category}</span>
    </div>

    {#if Object.keys(request.parameters).length > 0}
      <details class="params-details">
        <summary>Parameters ({Object.keys(request.parameters).length})</summary>
        <pre class="params-pre">{JSON.stringify(request.parameters, null, 2)}</pre>
      </details>
    {/if}

    <div class="form-fields">
      <label>
        Trust Level (1-10)
        <input type="number" min="1" max="10" bind:value={trustLevel} class="trust-input" />
      </label>
      <label>
        Reason
        <input type="text" bind:value={reason} placeholder="Why are you approving this tool call?" class="reason-input" />
      </label>

      {#if showValidation && (trustLevel < 1 || trustLevel > 10 || !reason.trim())}
        <p class="validation-msg">Trust level (1-10) and reason are REQUIRED</p>
      {/if}

      <div class="scope-row">
        <span class="label">Scope</span>
        <label class="radio-label">
          <input type="radio" value="this_call" bind:group={scope} disabled={scopeLocked} /> This call only
        </label>
        <label class="radio-label">
          <input type="radio" value="session" bind:group={scope} disabled={scopeLocked} /> For this session
        </label>
        {#if scopeLocked}
          <span class="scope-note">Dangerous tools: this call only</span>
        {:else if isWrite}
          <span class="scope-note">Write tools always show approval dialog</span>
        {/if}
      </div>
    </div>

    <div class="actions">
      <button class="btn-approve" onclick={handleApprove}>Approve</button>
      <button class="btn-deny" onclick={handleDeny}>Deny</button>
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .dialog { background: var(--color-surface, #111128); border: 1px solid var(--color-border, #2a2a4a); border-radius: 0.75rem; padding: 1.5rem; width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; }
  h2 { font-size: 1.1rem; color: var(--color-text, #eee); margin: 0 0 1rem; }

  .danger-banner { background: #ef444420; color: #ef4444; padding: 0.5rem 0.75rem; border-radius: 0.25rem; font-size: 0.85rem; font-weight: 600; margin-bottom: 1rem; text-align: center; }

  .info-grid { display: grid; grid-template-columns: auto 1fr; gap: 0.375rem 1rem; font-size: 0.85rem; margin-bottom: 1rem; }
  .label { color: var(--color-text-muted, #888); }
  .value { color: var(--color-text, #eee); }
  code.value { font-family: monospace; font-size: 0.8rem; }
  .badge { font-size: 0.75rem; padding: 0.1rem 0.375rem; border-radius: 999px; background: #4a9eff20; color: #4a9eff; display: inline-block; }
  .badge-task { background: #a855f720; color: #a855f7; }
  .badge-write { background: #f59e0b20; color: #f59e0b; }
  .badge-danger { background: #ef444420; color: #ef4444; }

  .params-details { margin-bottom: 1rem; }
  .params-details summary { font-size: 0.8rem; color: var(--color-text-muted, #888); cursor: pointer; }
  .params-pre { font-size: 0.75rem; background: var(--color-bg, #0a0a1a); padding: 0.5rem; border-radius: 0.25rem; overflow-x: auto; max-height: 150px; margin-top: 0.375rem; }

  .form-fields { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1rem; }
  .form-fields label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.8rem; color: var(--color-text-muted, #888); }
  .trust-input, .reason-input { padding: 0.375rem 0.5rem; border: 1px solid var(--color-border, #333); border-radius: 0.25rem; background: var(--color-bg, #0a0a1a); color: var(--color-text, #eee); font-size: 0.85rem; }
  .trust-input { width: 80px; }
  .validation-msg { color: #ef4444; font-size: 0.75rem; font-weight: 600; margin: 0; }

  .scope-row { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
  .scope-row .label { font-size: 0.8rem; }
  .radio-label { font-size: 0.8rem; color: var(--color-text, #eee); display: flex; align-items: center; gap: 0.25rem; cursor: pointer; }
  .scope-note { font-size: 0.7rem; color: var(--color-text-muted, #666); font-style: italic; }

  .actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
  .btn-approve { padding: 0.5rem 1rem; background: #22c55e; color: white; border: none; border-radius: 0.375rem; font-size: 0.875rem; font-weight: 500; cursor: pointer; }
  .btn-deny { padding: 0.5rem 1rem; background: transparent; color: #ef4444; border: 1px solid #ef4444; border-radius: 0.375rem; font-size: 0.875rem; cursor: pointer; }
  .btn-approve:hover { background: #16a34a; }
  .btn-deny:hover { background: #ef444415; }
</style>
