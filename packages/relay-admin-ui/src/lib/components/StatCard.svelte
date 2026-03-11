<script>
/** @type {{ label: string, value: string | number, status?: 'success' | 'warning' | 'error' | 'info' }} */
const { label, value, status = 'info' } = $props();

const _statusColors = {
  success: 'var(--status-success)',
  warning: 'var(--status-warning)',
  error: 'var(--status-error)',
  info: 'var(--accent-secondary)',
};
</script>

<div class="stat-card">
	<span class="label">{label}</span>
	<span class="value" style="color: {statusColors[status]}">{value}</span>
</div>

<style>
	.stat-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 0.5rem;
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.label {
		font-size: 0.8rem;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.value {
		font-size: 1.75rem;
		font-weight: 700;
	}
</style>
