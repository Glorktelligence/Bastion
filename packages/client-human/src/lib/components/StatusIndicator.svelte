<script lang="ts">
import type { HumanClientState } from '../services/connection.js';

const {
  status,
  peerStatus,
  reconnectAttempt,
  reconnectDelay = 0,
  onRetry,
}: {
  status: HumanClientState;
  peerStatus: string;
  reconnectAttempt: number;
  reconnectDelay?: number;
  onRetry?: () => void;
} = $props();

function dotColor(s: HumanClientState): string {
  if (s === 'authenticated') return 'var(--color-success)';
  if (s === 'connecting' || s === 'reconnecting' || s === 'connected') return 'var(--color-warning)';
  return 'var(--color-error)';
}

function statusLabel(s: HumanClientState): string {
  switch (s) {
    case 'authenticated':
      return 'Connected';
    case 'connected':
      return 'Connected (authenticating)';
    case 'connecting':
      return 'Connecting\u2026';
    case 'reconnecting':
      return 'Reconnecting\u2026';
    case 'closing':
      return 'Closing\u2026';
    default:
      return 'Disconnected';
  }
}

function peerLabel(ps: string): string {
  switch (ps) {
    case 'active':
      return 'AI connected';
    case 'suspended':
      return 'AI suspended';
    case 'disconnected':
      return 'AI disconnected';
    default:
      return 'AI status unknown';
  }
}

function formatDelay(ms: number): string {
  const secs = Math.ceil(ms / 1000);
  return `${secs}s`;
}
</script>

<div class="status-bar">
	<div class="status-group">
		<span class="dot" style="background:{dotColor(status)}"></span>
		<span class="label">{statusLabel(status)}</span>
		{#if status === 'reconnecting' && reconnectAttempt > 0}
			<span class="attempt">
				(attempt {reconnectAttempt}{#if reconnectDelay > 0}, retrying in {formatDelay(reconnectDelay)}{/if})
			</span>
			{#if onRetry}
				<button class="retry-btn" onclick={onRetry}>Retry Now</button>
			{/if}
		{/if}
		{#if status === 'disconnected' && onRetry}
			<button class="retry-btn" onclick={onRetry}>Connect</button>
		{/if}
	</div>
	<div class="peer-status">
		{peerLabel(peerStatus)}
	</div>
</div>

<style>
	.status-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.375rem 1rem;
		background: var(--color-surface);
		border-bottom: 1px solid var(--color-border);
		font-size: 0.75rem;
	}

	.status-group {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		display: inline-block;
	}

	.label {
		color: var(--color-text);
	}

	.attempt {
		color: var(--color-text-muted);
	}

	.peer-status {
		color: var(--color-text-muted);
	}

	.retry-btn {
		padding: 0.125rem 0.5rem;
		border-radius: 4px;
		border: 1px solid var(--color-accent);
		background: transparent;
		color: var(--color-accent);
		font-size: 0.7rem;
		cursor: pointer;
		margin-left: 0.25rem;
	}

	.retry-btn:hover {
		background: var(--color-accent);
		color: #fff;
	}
</style>
