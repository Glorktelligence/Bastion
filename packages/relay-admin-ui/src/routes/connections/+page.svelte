<script>
// Connection Log — Task 3.10
// Real-time connected clients, auth status, message counts
</script>

<div class="connections-page">
	<h2>Connection Log</h2>

	<div class="stat-row">
		<div class="mini-stat">
			<span class="stat-label">Total</span>
			<span class="stat-value">0</span>
		</div>
		<div class="mini-stat">
			<span class="stat-label">Human</span>
			<span class="stat-value">0</span>
		</div>
		<div class="mini-stat">
			<span class="stat-label">AI</span>
			<span class="stat-value">0</span>
		</div>
		<div class="mini-stat">
			<span class="stat-label">Authenticated</span>
			<span class="stat-value">0</span>
		</div>
	</div>

	<table>
		<thead>
			<tr>
				<th>Connection ID</th>
				<th>Address</th>
				<th>Type</th>
				<th>Auth</th>
				<th>Provider</th>
				<th>Messages</th>
				<th>Connected</th>
			</tr>
		</thead>
		<tbody>
			<tr>
				<td colspan="7" class="empty">No active connections</td>
			</tr>
		</tbody>
	</table>
</div>

<style>
	.connections-page h2 {
		margin-bottom: 1.5rem;
		font-size: 1.5rem;
	}

	.stat-row {
		display: flex;
		gap: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.mini-stat {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 0.375rem;
		padding: 0.75rem 1.25rem;
		display: flex;
		gap: 0.75rem;
		align-items: baseline;
	}

	.stat-label {
		font-size: 0.75rem;
		color: var(--text-muted);
		text-transform: uppercase;
	}

	.stat-value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--accent-secondary);
	}

	.empty {
		text-align: center;
		color: var(--text-muted);
		padding: 2rem;
	}
</style>
