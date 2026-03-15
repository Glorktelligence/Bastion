<script>
// Blocklist Manager — Task 3.8
// MaliClaw entries (immutable) + custom blocked identifiers

import BlocklistTable from '$lib/components/BlocklistTable.svelte';
import { createBlocklistStore } from '$lib/stores/blocklist.js';

const blocklist = createBlocklistStore();

/** @type {import('$lib/stores/blocklist.js').BlocklistState} */
let state = $state(blocklist.store.get());

/** @type {number} */
let totalCount = $state(blocklist.totalCount.get());

/** @type {number} */
let maliClawCount = $state(blocklist.maliClawCount.get());

$effect(() => {
	const unsub1 = blocklist.store.subscribe((s) => { state = s; });
	const unsub2 = blocklist.totalCount.subscribe((c) => { totalCount = c; });
	const unsub3 = blocklist.maliClawCount.subscribe((c) => { maliClawCount = c; });
	return () => { unsub1(); unsub2(); unsub3(); };
});
</script>

<div class="blocklist-page">
	<div class="page-header">
		<h2>Blocklist Manager</h2>
		<span class="count">{totalCount} entries ({maliClawCount} MaliClaw)</span>
	</div>

	{#if state.loading}
		<p class="loading">Loading...</p>
	{/if}

	{#if state.error}
		<p class="error">{state.error}</p>
	{/if}

	<BlocklistTable
		maliClawEntries={state.maliClawEntries}
		customEntries={state.customEntries}
	/>
</div>

<style>
	.blocklist-page h2 {
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
