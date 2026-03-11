<script>
// Overview Dashboard — Task 3.6
// Connected clients, active sessions, throughput, quarantine, recent audit events
</script>

<div class="dashboard">
	<h2>Overview</h2>

	<div class="stat-grid">
		<div class="stat-card">
			<span class="stat-label">Connected Clients</span>
			<span class="stat-value">0</span>
		</div>
		<div class="stat-card">
			<span class="stat-label">Active Sessions</span>
			<span class="stat-value">0</span>
		</div>
		<div class="stat-card">
			<span class="stat-label">Messages / min</span>
			<span class="stat-value">0</span>
		</div>
		<div class="stat-card">
			<span class="stat-label">Quarantine</span>
			<span class="stat-value">0 / 100</span>
		</div>
	</div>

	<div class="section">
		<h3>Recent Audit Events</h3>
		<table>
			<thead>
				<tr>
					<th>Time</th>
					<th>Type</th>
					<th>Session</th>
					<th>Detail</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td colspan="4" class="empty">No events recorded</td>
				</tr>
			</tbody>
		</table>
	</div>
</div>

<style>
	.dashboard h2 {
		margin-bottom: 1.5rem;
		font-size: 1.5rem;
	}

	.stat-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.stat-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 0.5rem;
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.stat-label {
		font-size: 0.8rem;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.stat-value {
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--accent-secondary);
	}

	.section {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 0.5rem;
		padding: 1.25rem;
	}

	.section h3 {
		margin-bottom: 1rem;
		font-size: 1rem;
		color: var(--text-secondary);
	}

	.empty {
		text-align: center;
		color: var(--text-muted);
		padding: 2rem;
	}
</style>
