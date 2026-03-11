<script>
/**
 * @type {{
 *   title: string,
 *   fields: { label: string, value: string | number | boolean }[]
 * }}
 */
const { title, fields } = $props();
</script>

<div class="config-panel">
	<h3>{title}</h3>
	<dl>
		{#each fields as field}
			<dt>{field.label}</dt>
			<dd>
				{#if typeof field.value === 'boolean'}
					<span class="badge" class:badge-success={field.value} class:badge-error={!field.value}>
						{field.value ? 'Yes' : 'No'}
					</span>
				{:else}
					{field.value}
				{/if}
			</dd>
		{/each}
	</dl>
</div>

<style>
	.config-panel {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 0.5rem;
		padding: 1.25rem;
	}

	h3 {
		margin-bottom: 1rem;
		font-size: 1rem;
		color: var(--text-secondary);
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.375rem 1rem;
	}

	dt {
		color: var(--text-muted);
		font-size: 0.8rem;
	}

	dd {
		color: var(--text-primary);
		font-size: 0.875rem;
		font-weight: 500;
	}

	.badge {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 600;
	}

	.badge-success {
		background: color-mix(in srgb, var(--status-success) 20%, transparent);
		color: var(--status-success);
	}

	.badge-error {
		background: color-mix(in srgb, var(--status-error) 20%, transparent);
		color: var(--status-error);
	}
</style>
