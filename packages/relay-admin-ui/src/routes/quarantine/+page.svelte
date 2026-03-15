<script>
// Quarantine Viewer — Task 3.9
// Quarantined files, state, custody chain, hash verification

import QuarantineTable from '$lib/components/QuarantineTable.svelte';
import { createQuarantineStore } from '$lib/stores/quarantine.js';

const quarantine = createQuarantineStore();

/** @type {import('$lib/stores/quarantine.js').QuarantineStoreState} */
let state = $state(quarantine.store.get());

/** @type {readonly import('$lib/types.js').QuarantineViewEntry[]} */
let filteredEntries = $state(quarantine.filteredEntries.get());

/** @type {number} */
let totalCount = $state(quarantine.totalCount.get());

/** @type {Record<string, number>} */
let stateBreakdown = $state(quarantine.stateBreakdown.get());

$effect(() => {
	const unsub1 = quarantine.store.subscribe((s) => { state = s; });
	const unsub2 = quarantine.filteredEntries.subscribe((e) => { filteredEntries = e; });
	const unsub3 = quarantine.totalCount.subscribe((c) => { totalCount = c; });
	const unsub4 = quarantine.stateBreakdown.subscribe((b) => { stateBreakdown = b; });
	return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
});

const filterStates = ['all', 'quarantined', 'offered', 'accepted', 'delivered'];

function setFilter(/** @type {string} */ filterState) {
	quarantine.setFilter(filterState === 'all' ? null : filterState);
}
</script>

<div class="quarantine-page">
	<div class="page-header">
		<h2>File Quarantine</h2>
		<span class="count">{totalCount} files</span>
	</div>

	{#if state.loading}
		<p class="loading">Loading...</p>
	{/if}

	{#if state.error}
		<p class="error">{state.error}</p>
	{/if}

	<div class="filter-bar">
		{#each filterStates as filterState}
			<button
				class="filter-btn"
				class:active={state.filterState === (filterState === 'all' ? null : filterState) && (filterState !== 'all' || state.filterState === null)}
				onclick={() => setFilter(filterState)}
			>
				{filterState.charAt(0).toUpperCase() + filterState.slice(1)}
				{#if filterState !== 'all' && stateBreakdown[filterState]}
					({stateBreakdown[filterState]})
				{/if}
			</button>
		{/each}
	</div>

	<QuarantineTable entries={filteredEntries} />
</div>

<style>
	.quarantine-page h2 {
		margin-bottom: 0;
		font-size: 1.5rem;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	.count {
		font-size: 0.8rem;
		color: var(--text-muted);
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
