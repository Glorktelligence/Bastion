<script lang="ts">
import type { HumanClientState } from '../services/connection.js';

const {
  status,
  peerStatus,
  reconnectAttempt,
  reconnectDelay = 0,
  e2eActive = false,
  e2eAvailable = false,
  providerName = '',
  providerActive = false,
  providerModel = '',
  relayUrl = '',
  adapterName = '',
  onRetry,
}: {
  status: HumanClientState;
  peerStatus: string;
  reconnectAttempt: number;
  reconnectDelay?: number;
  e2eActive?: boolean;
  e2eAvailable?: boolean;
  providerName?: string;
  providerActive?: boolean;
  providerModel?: string;
  relayUrl?: string;
  adapterName?: string;
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

<div class="status-bar" title={relayUrl ? `Relay: ${relayUrl}` : ''}>
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
	<div class="peer-status">
		{peerLabel(peerStatus)}
		{#if status === 'authenticated' || status === 'connected'}
			<span class="provider-label">{providerName ? `${providerName}${providerModel ? ` (${providerModel})` : ''} ${providerActive ? '✓' : '✗'}` : 'No AI provider'}</span>
			{#if adapterName}
				<span class="adapter-label">{adapterName}</span>
			{/if}
		{/if}
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

	.provider-label {
		margin-left: 0.5rem;
		padding-left: 0.5rem;
		border-left: 1px solid var(--color-border);
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.e2e-badge {
		font-size: 0.65rem;
		font-weight: 600;
		padding: 0.0625rem 0.375rem;
		border-radius: 999px;
		white-space: nowrap;
	}

	.e2e-active {
		background: color-mix(in srgb, #22c55e 15%, transparent);
		color: #22c55e;
	}

	.e2e-warn {
		background: color-mix(in srgb, #f59e0b 15%, transparent);
		color: #f59e0b;
	}

	.e2e-reconnecting {
		background: color-mix(in srgb, #f59e0b 15%, transparent);
		color: #f59e0b;
		animation: pulse 1.5s infinite;
	}

	.e2e-unavailable {
		background: color-mix(in srgb, #ef4444 15%, transparent);
		color: #ef4444;
	}

	.adapter-label {
		margin-left: 0.375rem;
		padding: 0.0625rem 0.375rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent);
		font-size: 0.65rem;
		font-weight: 600;
		white-space: nowrap;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}
</style>
