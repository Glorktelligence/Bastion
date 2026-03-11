<script>
/** @type {{ entries: readonly import('../types.js').QuarantineViewEntry[] }} */
const { entries } = $props();
</script>

<table>
	<thead>
		<tr>
			<th>File</th>
			<th>Direction</th>
			<th>Size</th>
			<th>MIME</th>
			<th>State</th>
			<th>Hash</th>
			<th>Quarantined</th>
			<th>Purge At</th>
		</tr>
	</thead>
	<tbody>
		{#each entries as entry}
			<tr>
				<td class="filename">{entry.filename}</td>
				<td>{entry.direction}</td>
				<td class="mono">{(entry.sizeBytes / 1024).toFixed(1)} KB</td>
				<td class="mono">{entry.mimeType}</td>
				<td><span class="state-badge state-{entry.state}">{entry.state}</span></td>
				<td class="hash">{entry.hashAtReceipt.slice(0, 12)}...</td>
				<td class="timestamp">{new Date(entry.quarantinedAt).toLocaleString()}</td>
				<td class="timestamp">{new Date(entry.purgeAt).toLocaleString()}</td>
			</tr>
		{:else}
			<tr>
				<td colspan="8" class="empty">No files in quarantine</td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	.filename {
		font-weight: 500;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mono {
		font-family: monospace;
		font-size: 0.8rem;
	}

	.hash {
		font-family: monospace;
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.timestamp {
		font-size: 0.8rem;
		color: var(--text-secondary);
		white-space: nowrap;
	}

	.state-badge {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 600;
	}

	.state-quarantined {
		background: color-mix(in srgb, var(--status-warning) 20%, transparent);
		color: var(--status-warning);
	}

	.state-offered {
		background: color-mix(in srgb, var(--status-info) 20%, transparent);
		color: var(--status-info);
	}

	.state-accepted, .state-delivered {
		background: color-mix(in srgb, var(--status-success) 20%, transparent);
		color: var(--status-success);
	}

	.state-rejected, .state-hash_mismatch {
		background: color-mix(in srgb, var(--status-error) 20%, transparent);
		color: var(--status-error);
	}

	.empty {
		text-align: center;
		color: var(--text-muted);
		padding: 2rem;
	}
</style>
