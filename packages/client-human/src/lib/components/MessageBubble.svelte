<script lang="ts">
import type { DisplayMessage } from '../stores/messages.js';
import * as session from '../session.js';

const { message }: { message: DisplayMessage } = $props();

let showRememberForm = $state(false);
let rememberContent = $state('');
let rememberCategory = $state<'preference' | 'fact' | 'workflow' | 'project'>('fact');

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return ts;
  }
}

function openRememberForm(): void {
  rememberContent = message.content;
  showRememberForm = true;
}

function sendMemoryProposal(): void {
  const client = session.getClient();
  if (!client || !rememberContent.trim()) return;
  client.send(JSON.stringify({
    type: 'memory_proposal',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: session.IDENTITY,
    payload: {
      proposalId: crypto.randomUUID(),
      content: rememberContent.trim(),
      category: rememberCategory,
      sourceMessageId: message.id,
    },
  }));
  showRememberForm = false;
  rememberContent = '';
}

function isResult(msg: DisplayMessage): boolean {
  return msg.type === 'result' && !!msg.payload;
}

function getTransparency(msg: DisplayMessage): { confidence: string; permissions: string[]; cost: string } | null {
  if (msg.type !== 'result' || !msg.payload || typeof msg.payload !== 'object') return null;
  const p = msg.payload as Record<string, unknown>;
  const t = p.transparency as Record<string, unknown> | undefined;
  if (!t) return null;
  const c = p.cost as Record<string, unknown> | undefined;
  return {
    confidence: String(t.confidenceLevel ?? 'unknown'),
    permissions: Array.isArray(t.permissionsUsed) ? (t.permissionsUsed as string[]) : [],
    cost: c ? `$${Number(c.estimatedCostUsd ?? 0).toFixed(4)}` : 'N/A',
  };
}
</script>

<div
	class="bubble"
	class:outgoing={message.direction === 'outgoing'}
	class:incoming={message.direction === 'incoming'}
	class:denial={message.type === 'denial'}
	class:error={message.type === 'error'}
>
	<div class="bubble-header">
		<span class="sender">{message.senderName}</span>
		<span class="time">{formatTime(message.timestamp)}</span>
	</div>

	<div class="bubble-content">
		{message.content}
	</div>

	{#if isResult(message)}
		{@const t = getTransparency(message)}
		{#if t}
			<div class="transparency">
				<span class="tag">Confidence: {t.confidence}</span>
				{#if t.permissions.length > 0}
					<span class="tag">Permissions: {t.permissions.join(', ')}</span>
				{/if}
				<span class="tag">Cost: {t.cost}</span>
			</div>
		{/if}
	{/if}

	<button class="remember-btn" onclick={openRememberForm} title="Remember this">R</button>

	{#if showRememberForm}
		<div class="remember-form">
			<textarea bind:value={rememberContent} rows="2" class="remember-input"></textarea>
			<div class="remember-controls">
				<select bind:value={rememberCategory} class="remember-select">
					<option value="fact">Fact</option>
					<option value="preference">Preference</option>
					<option value="workflow">Workflow</option>
					<option value="project">Project</option>
				</select>
				<button class="remember-save" onclick={sendMemoryProposal} disabled={!rememberContent.trim()}>Save</button>
				<button class="remember-cancel" onclick={() => { showRememberForm = false; }}>Cancel</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.bubble {
		max-width: 75%;
		padding: 0.625rem 0.875rem;
		border-radius: 12px;
		margin-bottom: 0.5rem;
		word-wrap: break-word;
	}

	.incoming {
		align-self: flex-start;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
	}

	.outgoing {
		align-self: flex-end;
		background: var(--color-accent);
		color: #fff;
	}

	.denial {
		border-left: 3px solid var(--color-warning);
	}

	.error {
		border-left: 3px solid var(--color-error);
	}

	.bubble-header {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.75rem;
		margin-bottom: 0.25rem;
	}

	.sender {
		font-weight: 600;
		opacity: 0.9;
	}

	.time {
		opacity: 0.6;
	}

	.bubble-content {
		font-size: 0.875rem;
		line-height: 1.4;
		white-space: pre-wrap;
	}

	.transparency {
		margin-top: 0.5rem;
		padding-top: 0.375rem;
		border-top: 1px solid rgba(255, 255, 255, 0.15);
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.tag {
		font-size: 0.6875rem;
		padding: 0.125rem 0.375rem;
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.2);
		opacity: 0.8;
	}

	.bubble { position: relative; }

	.remember-btn {
		position: absolute;
		top: 0.375rem;
		right: 0.375rem;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 50%;
		border: 1px solid var(--color-border, #333);
		background: var(--color-bg, #111);
		color: var(--color-text-muted, #888);
		font-size: 0.6rem;
		font-weight: 700;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.15s;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.bubble:hover .remember-btn { opacity: 0.7; }
	.remember-btn:hover { opacity: 1 !important; color: var(--color-accent, #4a9eff); border-color: var(--color-accent, #4a9eff); }

	.remember-form {
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border, #333);
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.remember-input {
		width: 100%;
		resize: vertical;
		padding: 0.375rem;
		border: 1px solid var(--color-border, #333);
		border-radius: 0.25rem;
		background: var(--color-bg, #111);
		color: var(--color-text, #eee);
		font-size: 0.8rem;
		font-family: inherit;
	}

	.remember-controls {
		display: flex;
		gap: 0.375rem;
		align-items: center;
	}

	.remember-select {
		padding: 0.2rem 0.375rem;
		border: 1px solid var(--color-border, #333);
		border-radius: 0.25rem;
		background: var(--color-bg, #111);
		color: var(--color-text, #eee);
		font-size: 0.75rem;
	}

	.remember-save {
		padding: 0.2rem 0.5rem;
		background: var(--color-accent, #4a9eff);
		color: white;
		border: none;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.remember-save:disabled { opacity: 0.5; }

	.remember-cancel {
		padding: 0.2rem 0.5rem;
		background: transparent;
		color: var(--color-text-muted, #888);
		border: 1px solid var(--color-border, #333);
		border-radius: 0.25rem;
		font-size: 0.75rem;
		cursor: pointer;
	}
</style>
