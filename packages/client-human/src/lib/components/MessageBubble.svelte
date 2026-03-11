<script lang="ts">
import type { DisplayMessage } from '../stores/messages.js';

const { message }: { message: DisplayMessage } = $props();

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return ts;
  }
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
</style>
