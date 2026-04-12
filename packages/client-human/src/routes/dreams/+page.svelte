<script lang="ts">
import { onMount } from 'svelte';
import * as session from '$lib/session.js';
import type { DreamCycleCompleteInfo, DreamProposal, MemoryBatch } from '$lib/stores/dream-cycles.js';

// ---------------------------------------------------------------------------
// Reactive state from shared session stores
// ---------------------------------------------------------------------------

let status: 'idle' | 'running' | 'reviewing' | 'complete' = $state('idle');
let proposals: readonly DreamProposal[] = $state([]);
let lastResult: DreamCycleCompleteInfo | null = $state(null);
let history: readonly DreamCycleCompleteInfo[] = $state([]);
let pendingBatches: readonly MemoryBatch[] = $state([]);
let conversationName: string = $state('Current conversation');

// Use onMount (NOT $effect) to set up store subscriptions.
onMount(() => {
	const unsubs = [
		session.dreamCycles.store.subscribe((v) => {
			status = v.status;
			proposals = v.proposals;
			lastResult = v.lastResult;
			history = v.history;
			pendingBatches = v.pendingBatches ?? [];
		}),
		session.conversations.store.subscribe((v) => {
			const active = (v.conversations ?? []).find((c: any) => c.id === v.activeConversationId);
			conversationName = active?.name ?? 'Current conversation';
		}),
	];
	return () => unsubs.forEach((u) => u());
});

function startDreamCycle() {
	session.sendDreamCycleRequest();
}

function toggleProposal(id: string) {
	session.dreamCycles.toggleProposal(id);
}

function approveSelected() {
	const selected = session.dreamCycles.getSelectedProposals();
	for (const p of selected) {
		session.sendMemoryDecision(p.proposalId, 'approve');
	}
	session.dreamCycles.dismissAll();
}

function dismissAll() {
	const current = proposals;
	for (const p of current) {
		session.sendMemoryDecision(p.proposalId, 'reject');
	}
	session.dreamCycles.dismissAll();
}

function toggleBatchProposal(batchId: string, proposalId: string) {
	session.dreamCycles.toggleBatchProposal(batchId, proposalId);
}

function approveBatch(batchId: string) {
	const decisions = session.dreamCycles.getBatchDecisions(batchId);
	session.sendMemoryBatchDecision(batchId, decisions);
	session.dreamCycles.removeBatch(batchId);
}

function dismissBatch(batchId: string) {
	const batch = pendingBatches.find(b => b.batchId === batchId);
	if (batch) {
		const decisions = batch.proposals.map(p => ({
			proposalId: p.proposalId,
			decision: 'rejected' as const,
			editedContent: null,
		}));
		session.sendMemoryBatchDecision(batchId, decisions);
	}
	session.dreamCycles.removeBatch(batchId);
}

function selectAllInBatch(batchId: string) {
	const batch = pendingBatches.find(b => b.batchId === batchId);
	if (!batch) return;
	for (const p of batch.proposals) {
		if (!p.selected) session.dreamCycles.toggleBatchProposal(batchId, p.proposalId);
	}
}

function formatCost(cost: number): string {
	return `$${cost.toFixed(4)}`;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}
</script>

<div class="dreams-page">
	<h2>Dream Cycle</h2>
	<p class="subtitle">Review conversations and extract memories worth keeping.</p>

	<div class="dream-controls">
		<div class="info-row">
			<span class="label">Conversation:</span>
			<span class="value">{conversationName}</span>
		</div>
		{#if lastResult}
			<div class="info-row">
				<span class="label">Last dream:</span>
				<span class="value">{new Date(lastResult.completedAt).toLocaleString()} ({lastResult.candidateCount} candidates, {formatCost(lastResult.estimatedCost)})</span>
			</div>
		{:else}
			<div class="info-row">
				<span class="label">Last dream:</span>
				<span class="value dim">never</span>
			</div>
		{/if}

		<button
			class="dream-button"
			onclick={startDreamCycle}
			disabled={status === 'running'}
		>
			{#if status === 'running'}
				Running...
			{:else}
				Run Dream Cycle
			{/if}
		</button>

		{#if status === 'running'}
			<p class="status-text">Reviewing conversation with Opus...</p>
		{/if}
	</div>

	{#if status === 'reviewing' && proposals.length > 0}
		<div class="proposals-panel">
			<div class="proposals-header">
				<h3>Dream Cycle &mdash; {proposals.length} memory candidate{proposals.length !== 1 ? 's' : ''}</h3>
				{#if lastResult}
					<span class="cost-badge">Cost: {formatCost(lastResult.estimatedCost)} (Opus, {formatDuration(lastResult.durationMs)})</span>
				{/if}
			</div>

			<div class="proposals-list">
				{#each proposals as proposal}
					<label class="proposal-item" class:update={proposal.isUpdate}>
						<input
							type="checkbox"
							checked={proposal.selected}
							onchange={() => toggleProposal(proposal.proposalId)}
						/>
						<div class="proposal-content">
							<span class="proposal-text">{proposal.content}</span>
							<span class="proposal-meta">
								<span class="category-badge">{proposal.category}</span>
								{#if proposal.isUpdate}
									<span class="update-badge">Updates existing</span>
								{:else}
									<span class="new-badge">New memory</span>
								{/if}
							</span>
							{#if proposal.reason}
								<span class="proposal-reason">{proposal.reason}</span>
							{/if}
							{#if proposal.isUpdate && proposal.existingMemoryContent}
								<span class="existing-text">Replaces: {proposal.existingMemoryContent}</span>
							{/if}
						</div>
					</label>
				{/each}
			</div>

			<div class="proposals-actions">
				<button class="approve-button" onclick={approveSelected}>
					Approve Selected ({proposals.filter(p => p.selected).length})
				</button>
				<button class="dismiss-button" onclick={dismissAll}>
					Dismiss All
				</button>
			</div>
		</div>
	{/if}

	{#each pendingBatches as batch}
		<div class="proposals-panel batch-panel">
			<div class="proposals-header">
				<h3>Memory Batch &mdash; {batch.proposals.length} proposal{batch.proposals.length !== 1 ? 's' : ''}</h3>
				<span class="cost-badge">{batch.source} &middot; {new Date(batch.receivedAt).toLocaleTimeString()}</span>
			</div>

			<div class="proposals-list">
				{#each batch.proposals as proposal}
					<label class="proposal-item" class:update={proposal.isUpdate}>
						<input
							type="checkbox"
							checked={proposal.selected}
							onchange={() => toggleBatchProposal(batch.batchId, proposal.proposalId)}
						/>
						<div class="proposal-content">
							<span class="proposal-text">{proposal.content}</span>
							<span class="proposal-meta">
								<span class="category-badge">{proposal.category}</span>
								{#if proposal.isUpdate}
									<span class="update-badge">Updates existing</span>
								{:else}
									<span class="new-badge">New memory</span>
								{/if}
							</span>
							{#if proposal.reason}
								<span class="proposal-reason">{proposal.reason}</span>
							{/if}
							{#if proposal.isUpdate && proposal.existingMemoryContent}
								<span class="existing-text">Replaces: {proposal.existingMemoryContent}</span>
							{/if}
						</div>
					</label>
				{/each}
			</div>

			<div class="proposals-actions">
				<button class="approve-button" onclick={() => approveBatch(batch.batchId)}>
					Approve Selected ({batch.proposals.filter(p => p.selected).length})
				</button>
				<button class="select-all-button" onclick={() => selectAllInBatch(batch.batchId)}>
					Select All
				</button>
				<button class="dismiss-button" onclick={() => dismissBatch(batch.batchId)}>
					Dismiss All
				</button>
			</div>
		</div>
	{/each}

	{#if history.length > 0}
		<div class="history-section">
			<h3>Dream History</h3>
			<div class="history-list">
				{#each history as entry}
					<div class="history-item">
						<span class="history-date">{new Date(entry.completedAt).toLocaleString()}</span>
						<span class="history-detail">
							{entry.candidateCount} candidates &middot;
							{entry.tokensUsed.input + entry.tokensUsed.output} tokens &middot;
							{formatCost(entry.estimatedCost)}
						</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.subtitle { color: var(--color-text-muted); margin-bottom: 1.5rem; }

	.dream-controls {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		padding: 1rem;
		margin-bottom: 1.5rem;
	}

	.info-row { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
	.label { color: var(--color-text-muted); min-width: 120px; }
	.value { color: var(--color-text); }
	.dim { opacity: 0.5; }

	.dream-button {
		margin-top: 0.75rem;
		padding: 0.5rem 1.25rem;
		background: var(--color-primary, #6366f1);
		color: white;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
	}
	.dream-button:hover:not(:disabled) { opacity: 0.9; }
	.dream-button:disabled { opacity: 0.5; cursor: not-allowed; }

	.status-text { color: var(--color-text-muted); font-style: italic; margin-top: 0.5rem; }

	.proposals-panel {
		background: var(--color-surface);
		border: 1px solid var(--color-primary, #6366f1);
		border-radius: 0.5rem;
		padding: 1rem;
		margin-bottom: 1.5rem;
	}

	.proposals-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}
	.proposals-header h3 { margin: 0; }
	.cost-badge { font-size: 0.75rem; color: var(--color-text-muted); }

	.dreams-page { padding: 1.5rem; max-width: 800px; overflow-y: auto; max-height: 100vh; }
	.proposals-list { display: flex; flex-direction: column; gap: 0.5rem; max-height: 50vh; overflow-y: auto; padding-right: 0.25rem; }

	.proposal-item {
		display: flex;
		gap: 0.75rem;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		cursor: pointer;
		align-items: flex-start;
	}
	.proposal-item:hover { background: var(--color-bg); }
	.proposal-item.update { border-left: 3px solid #f59e0b; }

	.proposal-content { display: flex; flex-direction: column; gap: 0.25rem; flex: 1; }
	.proposal-text { font-size: 0.875rem; }
	.proposal-meta { display: flex; gap: 0.5rem; align-items: center; }
	.category-badge {
		font-size: 0.7rem;
		padding: 0.1rem 0.4rem;
		border-radius: 0.25rem;
		background: var(--color-border);
		color: var(--color-text-muted);
	}
	.update-badge {
		font-size: 0.7rem;
		padding: 0.1rem 0.4rem;
		border-radius: 0.25rem;
		background: #fef3c7;
		color: #92400e;
	}
	.new-badge {
		font-size: 0.7rem;
		padding: 0.1rem 0.4rem;
		border-radius: 0.25rem;
		background: #d1fae5;
		color: #065f46;
	}
	.proposal-reason { font-size: 0.75rem; color: var(--color-text-muted); }
	.existing-text { font-size: 0.75rem; color: #b45309; font-style: italic; }

	.proposals-actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
	}

	.approve-button {
		padding: 0.5rem 1rem;
		background: #059669;
		color: white;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
	}
	.approve-button:hover { opacity: 0.9; }

	.dismiss-button {
		padding: 0.5rem 1rem;
		background: transparent;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
	}
	.dismiss-button:hover { background: var(--color-bg); }

	.select-all-button {
		padding: 0.5rem 1rem;
		background: transparent;
		color: var(--color-primary, #6366f1);
		border: 1px solid var(--color-primary, #6366f1);
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
	}
	.select-all-button:hover { background: var(--color-bg); }

	.batch-panel { border-color: #f59e0b; }

	.history-section { margin-top: 1.5rem; }
	.history-section h3 { margin-bottom: 0.75rem; }
	.history-list { display: flex; flex-direction: column; gap: 0.5rem; }
	.history-item {
		display: flex;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		font-size: 0.875rem;
	}
	.history-date { color: var(--color-text); }
	.history-detail { color: var(--color-text-muted); }
</style>
