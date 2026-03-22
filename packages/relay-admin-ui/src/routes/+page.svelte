<script>
// Overview Dashboard — Task 3.6
// Connected clients, active sessions, throughput, quarantine, recent audit events

import StatCard from '$lib/components/StatCard.svelte';
import AuditEventRow from '$lib/components/AuditEventRow.svelte';
import { createOverviewStore } from '$lib/stores/overview.js';
import { createSharedService } from '$lib/api/service-instance.js';

const overview = createOverviewStore();
const service = createSharedService();

/** @type {import('$lib/stores/overview.js').OverviewState} */
let state = $state(overview.store.get());

/** @type {'healthy' | 'degraded' | 'critical'} */
let health = $state(overview.healthStatus.get());

/** @type {number} */
let quarantineUtil = $state(overview.quarantineUtilisation.get());

$effect(() => {
	const unsub1 = overview.store.subscribe((s) => { state = s; });
	const unsub2 = overview.healthStatus.subscribe((h) => { health = h; });
	const unsub3 = overview.quarantineUtilisation.subscribe((u) => { quarantineUtil = u; });

	// Start polling live data from the admin API
	service.startStatusPolling(overview);

	return () => {
		unsub1(); unsub2(); unsub3();
		service.stopStatusPolling();
	};
});

/** @type {'success' | 'warning' | 'error' | 'info'} */
let healthStatusColor = $derived(
	health === 'healthy' ? 'success' : health === 'degraded' ? 'warning' : 'error'
);

/** @type {'success' | 'warning' | 'error' | 'info'} */
let quarantineStatusColor = $derived(
	quarantineUtil >= 0.9 ? 'error' : quarantineUtil >= 0.7 ? 'warning' : 'info'
);
</script>

<div class="dashboard">
	<h2>Overview</h2>

	{#if state.loading}
		<p class="loading">Loading...</p>
	{/if}

	{#if state.error}
		<p class="error">{state.error}</p>
	{/if}

	<div class="stat-grid">
		<StatCard label="Connected Clients" value={state.connectedClients} status={healthStatusColor} />
		<StatCard label="Active Sessions" value={state.activeSessions} status="info" />
		<StatCard label="Messages / min" value={state.throughput.perMinute} status="info" />
		<StatCard label="Quarantine" value="{state.quarantine.count} / {state.quarantine.maxEntries}" status={quarantineStatusColor} />
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
				{#each state.recentAuditEvents as event}
					<AuditEventRow {event} />
				{:else}
					<tr>
						<td colspan="4" class="empty">No events recorded</td>
					</tr>
				{/each}
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

	.loading {
		color: var(--text-muted);
		font-style: italic;
		margin-bottom: 1rem;
	}

	.error {
		color: var(--status-error);
		margin-bottom: 1rem;
	}
</style>
