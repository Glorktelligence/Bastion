<script>
// Quarantine Viewer — Task 3.9
// Quarantined files, state, custody chain, hash verification
</script>

<div class="quarantine-page">
	<h2>File Quarantine</h2>

	<div class="filter-bar">
		<button class="filter-btn active">All</button>
		<button class="filter-btn">Quarantined</button>
		<button class="filter-btn">Offered</button>
		<button class="filter-btn">Accepted</button>
		<button class="filter-btn">Delivered</button>
	</div>

	<table>
		<thead>
			<tr>
				<th>File</th>
				<th>Direction</th>
				<th>Size</th>
				<th>Type</th>
				<th>State</th>
				<th>Quarantined</th>
				<th>Purge At</th>
			</tr>
		</thead>
		<tbody>
			<tr>
				<td colspan="7" class="empty">No files in quarantine</td>
			</tr>
		</tbody>
	</table>
</div>

<style>
	.quarantine-page h2 {
		margin-bottom: 1.5rem;
		font-size: 1.5rem;
	}

	.filter-bar {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}

	.filter-btn {
		background: var(--bg-surface);
		color: var(--text-secondary);
		border: 1px solid var(--border-default);
		padding: 0.375rem 0.75rem;
		border-radius: 0.375rem;
		font-size: 0.8rem;
	}

	.filter-btn:hover {
		color: var(--text-primary);
		border-color: var(--accent-primary);
	}

	.filter-btn.active {
		background: var(--accent-muted);
		color: var(--accent-secondary);
		border-color: var(--accent-primary);
	}

	.empty {
		text-align: center;
		color: var(--text-muted);
		padding: 2rem;
	}
</style>
