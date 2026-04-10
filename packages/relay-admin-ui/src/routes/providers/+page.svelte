<script>
// Provider Management — Task 3.7
// List, approve, revoke, view/edit capability matrix

import ProviderCard from '$lib/components/ProviderCard.svelte';
import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
import { createProvidersStore } from '$lib/stores/providers.js';
import { createSharedService } from '$lib/api/service-instance.js';

const providers = createProvidersStore();
const service = createSharedService();

let showApproveForm = $state(false);
let approveId = $state('');
let approveName = $state('');
let approving = $state(false);

// Confirmation dialog state
let confirmOpen = $state(false);
let confirmTitle = $state('');
let confirmMessage = $state('');
let confirmLabel = $state('');
let confirmDestructive = $state(false);
let confirmAction = $state(() => {});

function requestRevoke(id, name) {
	confirmTitle = 'Revoke Provider';
	confirmMessage = `Revoke provider '${name}'? This will disconnect all active sessions for this provider.`;
	confirmLabel = 'Revoke';
	confirmDestructive = true;
	confirmAction = async () => {
		confirmOpen = false;
		await service.revokeProvider(providers, id);
	};
	confirmOpen = true;
}

function requestActivate(id, name) {
	confirmTitle = 'Activate Provider';
	confirmMessage = `Reactivate provider '${name}'? This will allow new connections from this provider.`;
	confirmLabel = 'Activate';
	confirmDestructive = false;
	confirmAction = async () => {
		confirmOpen = false;
		await service.activateProvider(providers, id);
	};
	confirmOpen = true;
}

async function handleApprove() {
	if (!approveId.trim() || !approveName.trim()) return;
	approving = true;
	const ok = await service.approveProvider(providers, approveId.trim(), approveName.trim());
	approving = false;
	if (ok) {
		showApproveForm = false;
		approveId = '';
		approveName = '';
	}
}

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

	// Fetch providers on mount
	service.fetchProviders(providers);

	return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
});
</script>

<div class="providers-page">
	<div class="page-header">
		<h2>Provider Management</h2>
		<div class="header-stats">
			<span class="stat">{activeCount} active / {totalCount} total</span>
			<button class="btn-primary" onclick={() => { showApproveForm = !showApproveForm; }}>
				{showApproveForm ? 'Cancel' : 'Approve Provider'}
			</button>
		</div>
	</div>

	{#if showApproveForm}
		<div class="approve-form">
			<h3>Approve New Provider</h3>
			<label>
				Provider ID
				<input type="text" bind:value={approveId} placeholder="e.g. anthropic-bastion" />
			</label>
			<label>
				Provider Name
				<input type="text" bind:value={approveName} placeholder="e.g. Anthropic (Bastion Official)" />
			</label>
			<button class="btn-primary" onclick={handleApprove} disabled={approving || !approveId.trim() || !approveName.trim()}>
				{approving ? 'Approving...' : 'Approve'}
			</button>
		</div>
	{/if}

	{#if state.loading}
		<p class="loading">Loading...</p>
	{/if}

	{#if state.error}
		<p class="error">{state.error}</p>
	{/if}

	{#if state.providers.length > 0}
		<div class="provider-grid">
			{#each state.providers as provider}
				<ProviderCard {provider} onRevoke={requestRevoke} onActivate={requestActivate} />
			{/each}
		</div>
	{:else}
		<div class="empty-state">
			<p>No providers configured</p>
		</div>
	{/if}
</div>

<ConfirmDialog
	open={confirmOpen}
	title={confirmTitle}
	message={confirmMessage}
	confirmLabel={confirmLabel}
	destructive={confirmDestructive}
	onConfirm={confirmAction}
	onCancel={() => { confirmOpen = false; }}
/>

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

	.approve-form {
		background: var(--bg-surface);
		border: 1px solid var(--accent-primary);
		border-radius: 0.5rem;
		padding: 1.25rem;
		margin-bottom: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.approve-form h3 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}

	.approve-form label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.approve-form input {
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--border-default);
		border-radius: 0.25rem;
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.875rem;
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
