<script>
/**
 * @type {{
 *   maliClawEntries: readonly string[],
 *   customEntries: readonly import('../types.js').BlocklistEntry[]
 * }}
 */
const { maliClawEntries, customEntries } = $props();
</script>

<div class="blocklist-table">
	<table>
		<thead>
			<tr>
				<th>Identifier</th>
				<th>Source</th>
				<th>Status</th>
				<th>Actions</th>
			</tr>
		</thead>
		<tbody>
			{#each maliClawEntries as id}
				<tr class="maliclaw-row">
					<td class="mono">{id}</td>
					<td><span class="badge badge-maliclaw">MaliClaw</span></td>
					<td><span class="badge badge-error">Permanently Blocked</span></td>
					<td class="muted">Immutable</td>
				</tr>
			{/each}
			{#each customEntries as entry}
				<tr>
					<td class="mono">{entry.id}</td>
					<td><span class="badge badge-custom">Custom</span></td>
					<td><span class="badge badge-warning">Blocked</span></td>
					<td><button class="btn-remove">Remove</button></td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.maliclaw-row {
		background: color-mix(in srgb, var(--status-error) 5%, transparent);
	}

	.mono {
		font-family: monospace;
		font-size: 0.85rem;
	}

	.badge {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 600;
	}

	.badge-maliclaw {
		background: color-mix(in srgb, var(--status-error) 20%, transparent);
		color: var(--status-error);
	}

	.badge-custom {
		background: color-mix(in srgb, var(--accent-primary) 20%, transparent);
		color: var(--accent-secondary);
	}

	.badge-error {
		background: color-mix(in srgb, var(--status-error) 15%, transparent);
		color: var(--status-error);
	}

	.badge-warning {
		background: color-mix(in srgb, var(--status-warning) 15%, transparent);
		color: var(--status-warning);
	}

	.muted {
		color: var(--text-muted);
		font-size: 0.8rem;
		font-style: italic;
	}

	.btn-remove {
		background: transparent;
		color: var(--status-error);
		border: 1px solid var(--status-error);
		padding: 0.125rem 0.5rem;
		border-radius: 0.25rem;
		font-size: 0.75rem;
	}

	.btn-remove:hover {
		background: color-mix(in srgb, var(--status-error) 15%, transparent);
	}
</style>
