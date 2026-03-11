<script>
// Blocklist Manager — Task 3.8
// MaliClaw entries (immutable) + custom blocked identifiers
</script>

<div class="blocklist-page">
	<h2>Blocklist Manager</h2>

	<div class="section">
		<h3>MaliClaw Clause (Immutable)</h3>
		<p class="description">These identifiers are permanently blocked and cannot be removed or modified.</p>
		<table>
			<thead>
				<tr>
					<th>Identifier</th>
					<th>Status</th>
				</tr>
			</thead>
			<tbody>
				<tr><td>maliclaw</td><td><span class="badge badge-error">Blocked</span></td></tr>
				<tr><td>MALICLAW</td><td><span class="badge badge-error">Blocked</span></td></tr>
				<tr><td>MaliClaw</td><td><span class="badge badge-error">Blocked</span></td></tr>
			</tbody>
		</table>
	</div>

	<div class="section">
		<div class="section-header">
			<h3>Custom Entries</h3>
			<button class="btn-secondary">Add Entry</button>
		</div>
		<table>
			<thead>
				<tr>
					<th>Identifier</th>
					<th>Label</th>
					<th>Added</th>
					<th>Actions</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td colspan="4" class="empty">No custom entries</td>
				</tr>
			</tbody>
		</table>
	</div>
</div>

<style>
	.blocklist-page h2 {
		margin-bottom: 1.5rem;
		font-size: 1.5rem;
	}

	.section {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 0.5rem;
		padding: 1.25rem;
		margin-bottom: 1.5rem;
	}

	.section h3 {
		margin-bottom: 0.5rem;
		font-size: 1rem;
		color: var(--text-secondary);
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}

	.description {
		font-size: 0.8rem;
		color: var(--text-muted);
		margin-bottom: 1rem;
	}

	.badge {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 600;
	}

	.badge-error {
		background: color-mix(in srgb, var(--status-error) 20%, transparent);
		color: var(--status-error);
	}

	.btn-secondary {
		background: var(--bg-elevated);
		color: var(--text-primary);
		border: 1px solid var(--border-default);
		padding: 0.375rem 0.75rem;
		border-radius: 0.375rem;
		font-size: 0.8rem;
	}

	.btn-secondary:hover {
		border-color: var(--accent-primary);
	}

	.empty {
		text-align: center;
		color: var(--text-muted);
		padding: 2rem;
	}
</style>
