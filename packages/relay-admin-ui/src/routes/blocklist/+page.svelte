<script>
// Blocklist Manager — Task 3.8
// MaliClaw entries (immutable) + custom blocked identifiers

import BlocklistTable from '$lib/components/BlocklistTable.svelte';
import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
import { createBlocklistStore } from '$lib/stores/blocklist.js';

const blocklist = createBlocklistStore();

/** @type {import('$lib/stores/blocklist.js').BlocklistState} */
let state = $state(blocklist.store.get());

/** @type {number} */
let totalCount = $state(blocklist.totalCount.get());

/** @type {number} */
let maliClawCount = $state(blocklist.maliClawCount.get());

let newEntryId = $state('');
let addError = $state('');

// Confirmation dialog state
let confirmOpen = $state(false);
let pendingRemoveId = $state('');

function handleAddEntry() {
	const id = newEntryId.trim();
	if (!id) return;
	const ok = blocklist.addCustomEntry({ id, label: id, addedAt: new Date().toISOString(), addedBy: 'admin' });
	if (ok) {
		newEntryId = '';
		addError = '';
	} else {
		addError = blocklist.isMaliClaw(id)
			? 'This identifier matches MaliClaw — it is already permanently blocked.'
			: 'Entry already exists.';
	}
}

function requestRemoveEntry(id) {
	pendingRemoveId = id;
	confirmOpen = true;
}

function confirmRemoveEntry() {
	confirmOpen = false;
	blocklist.removeCustomEntry(pendingRemoveId);
	pendingRemoveId = '';
}

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

	<div class="add-form">
		<input type="text" bind:value={newEntryId} placeholder="Identifier to block" onkeydown={(e) => e.key === 'Enter' && handleAddEntry()} />
		<button class="btn-add" onclick={handleAddEntry} disabled={!newEntryId.trim()}>Add to Blocklist</button>
		{#if addError}<span class="add-error">{addError}</span>{/if}
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
		onRemove={requestRemoveEntry}
	/>
</div>

<ConfirmDialog
	open={confirmOpen}
	title="Remove Blocklist Entry"
	message={`Remove '${pendingRemoveId}' from blocklist? This provider will be able to connect again.`}
	confirmLabel="Remove"
	destructive={true}
	onConfirm={confirmRemoveEntry}
	onCancel={() => { confirmOpen = false; pendingRemoveId = ''; }}
/>

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

	.add-form {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	.add-form input {
		flex: 1;
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--border-default);
		border-radius: 0.25rem;
		background: var(--bg-surface);
		color: var(--text-primary);
		font-family: monospace;
		font-size: 0.85rem;
	}

	.btn-add {
		background: var(--accent-primary);
		color: white;
		border: none;
		padding: 0.375rem 0.75rem;
		border-radius: 0.25rem;
		font-size: 0.8rem;
		font-weight: 500;
		white-space: nowrap;
	}

	.btn-add:hover { background: var(--accent-secondary); }
	.btn-add:disabled { opacity: 0.5; }

	.add-error {
		color: var(--status-error);
		font-size: 0.75rem;
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
