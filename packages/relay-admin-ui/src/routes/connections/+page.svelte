<script>
// Connection Log — Task 3.10
// Real-time connected clients, auth status, message counts

import StatCard from '$lib/components/StatCard.svelte';
import ConnectionTable from '$lib/components/ConnectionTable.svelte';
import { createConnectionsStore } from '$lib/stores/connections.js';

const connections = createConnectionsStore();

/** @type {import('$lib/stores/connections.js').ConnectionsState} */
let state = $state(connections.store.get());

/** @type {readonly import('$lib/types.js').ConnectionEntry[]} */
let filteredConnections = $state(connections.filteredConnections.get());

/** @type {number} */
let humanCount = $state(connections.humanCount.get());

/** @type {number} */
let aiCount = $state(connections.aiCount.get());

/** @type {number} */
let authenticatedCount = $state(connections.authenticatedCount.get());

/** @type {number} */
let totalCount = $state(connections.totalCount.get());

$effect(() => {
	const unsub1 = connections.store.subscribe((s) => { state = s; });
	const unsub2 = connections.filteredConnections.subscribe((c) => { filteredConnections = c; });
	const unsub3 = connections.humanCount.subscribe((c) => { humanCount = c; });
	const unsub4 = connections.aiCount.subscribe((c) => { aiCount = c; });
	const unsub5 = connections.authenticatedCount.subscribe((c) => { authenticatedCount = c; });
	const unsub6 = connections.totalCount.subscribe((c) => { totalCount = c; });
	return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6(); };
});

const filterTypes = /** @type {const} */ (['all', 'human', 'ai', 'unknown']);

function setFilter(/** @type {'all' | 'human' | 'ai' | 'unknown'} */ type) {
	connections.setFilter(type);
}
</script>

<div class="connections-page">
	<h2>Connection Log</h2>

	{#if state.loading}
		<p class="loading">Loading...</p>
	{/if}

	{#if state.error}
		<p class="error">{state.error}</p>
	{/if}

	<div class="stat-row">
		<StatCard label="Total" value={totalCount} status="info" />
		<StatCard label="Human" value={humanCount} status="info" />
		<StatCard label="AI" value={aiCount} status="success" />
		<StatCard label="Authenticated" value={authenticatedCount} status="success" />
	</div>

	<div class="filter-bar">
		{#each filterTypes as type}
			<button
				class="filter-btn"
				class:active={state.filterType === type}
				onclick={() => setFilter(type)}
			>
				{type.charAt(0).toUpperCase() + type.slice(1)}
			</button>
		{/each}
	</div>

	<ConnectionTable connections={filteredConnections} />
</div>

<style>
	.connections-page h2 {
		margin-bottom: 1.5rem;
		font-size: 1.5rem;
	}

	.stat-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 1rem;
		margin-bottom: 1.5rem;
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
		cursor: pointer;
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
