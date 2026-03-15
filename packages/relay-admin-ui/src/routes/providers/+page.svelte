<script>
// Provider Management — Task 3.7
// List, approve, revoke, view/edit capability matrix

import ProviderCard from '$lib/components/ProviderCard.svelte';
import { createProvidersStore } from '$lib/stores/providers.js';

const providers = createProvidersStore();

/** @type {import('$lib/stores/providers.js').ProvidersState} */
let state = $state(providers.store.get());

/** @type {readonly import('$lib/types.js').ProviderWithCapabilities[]} */
let activeProviders = $state(providers.activeProviders.get());

/** @type {number} */
let activeCount = $state(providers.activeCount.get());

/** @type {number} */
let totalCount = $state(providers.totalCount.get());

$effect(() => {
	const unsub1 = providers.store.subscribe((s) => { state = s; });
	const unsub2 = providers.activeProviders.subscribe((p) => { activeProviders = p; });
	const unsub3 = providers.activeCount.subscribe((c) => { activeCount = c; });
	const unsub4 = providers.totalCount.subscribe((c) => { totalCount = c; });
	return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
});
</script>

<div class="providers-page">
	<div class="page-header">
		<h2>Provider Management</h2>
		<div class="header-stats">
			<span class="stat">{activeCount} active / {totalCount} total</span>
			<button class="btn-primary">Approve Provider</button>
		</div>
	</div>

	{#if state.loading}
		<p class="loading">Loading...</p>
	{/if}

	{#if state.error}
		<p class="error">{state.error}</p>
	{/if}

	{#if state.providers.length > 0}
		<div class="provider-grid">
			{#each state.providers as provider}
				<ProviderCard {provider} />
			{/each}
		</div>
	{:else}
		<div class="empty-state">
			<p>No providers configured</p>
		</div>
	{/if}
</div>

<style>
	.providers-page h2 {
		font-size: 1.5rem;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	.header-stats {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.stat {
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.provider-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 1rem;
	}

	.btn-primary {
		background: var(--accent-primary);
		color: white;
		border: none;
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.btn-primary:hover {
		background: var(--accent-secondary);
	}

	.empty-state {
		text-align: center;
		color: var(--text-muted);
		padding: 3rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 0.5rem;
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
