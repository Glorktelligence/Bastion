<script>
/** @type {{ provider: import('../types.js').ProviderWithCapabilities }} */
const { provider } = $props();
</script>

<div class="provider-card" class:inactive={!provider.active}>
	<div class="header">
		<div class="name-row">
			<h4>{provider.name}</h4>
			<span class="badge" class:active={provider.active} class:revoked={!provider.active}>
				{provider.active ? 'Active' : 'Revoked'}
			</span>
		</div>
		<span class="provider-id">{provider.id}</span>
	</div>
	<div class="details">
		<div class="detail-row">
			<span class="label">Message Types</span>
			<span class="value">{provider.capabilityMatrix.allowedMessageTypes.length}</span>
		</div>
		<div class="detail-row">
			<span class="label">File Transfer</span>
			<span class="value">
				{provider.capabilityMatrix.fileTransfer.canSend ? 'Send' : ''}
				{provider.capabilityMatrix.fileTransfer.canSend && provider.capabilityMatrix.fileTransfer.canReceive ? ' / ' : ''}
				{provider.capabilityMatrix.fileTransfer.canReceive ? 'Receive' : ''}
			</span>
		</div>
		<div class="detail-row">
			<span class="label">Max Tasks</span>
			<span class="value">{provider.capabilityMatrix.maxConcurrentTasks}</span>
		</div>
	</div>
</div>

<style>
	.provider-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 0.5rem;
		padding: 1rem;
	}

	.provider-card.inactive {
		opacity: 0.6;
	}

	.header {
		margin-bottom: 0.75rem;
	}

	.name-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.name-row h4 {
		font-size: 1rem;
		color: var(--text-primary);
	}

	.provider-id {
		font-size: 0.75rem;
		color: var(--text-muted);
		font-family: monospace;
	}

	.badge {
		font-size: 0.7rem;
		padding: 0.125rem 0.5rem;
		border-radius: 999px;
		font-weight: 600;
	}

	.badge.active {
		background: color-mix(in srgb, var(--status-success) 20%, transparent);
		color: var(--status-success);
	}

	.badge.revoked {
		background: color-mix(in srgb, var(--status-error) 20%, transparent);
		color: var(--status-error);
	}

	.details {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.detail-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
	}

	.detail-row .label {
		color: var(--text-muted);
	}

	.detail-row .value {
		color: var(--text-secondary);
	}
</style>
