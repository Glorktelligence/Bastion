<script>
// Self-Update Panel — Phase 2
// Check for updates, trigger builds, monitor progress

import { onMount } from 'svelte';
import { createUpdateStore } from '$lib/stores/update.js';
import { createSharedService } from '$lib/api/service-instance.js';

const update = createUpdateStore();
const service = createSharedService();

/** @type {import('$lib/stores/update.js').UpdateState} */
let state = $state(update.store.get());

/** @type {boolean} */
let isActive = $state(update.isActive.get());

/** @type {string} */
let repo = $state('Glorktelligence/Bastion');

/** @type {string} */
let currentVersion = $state('0.5.0');

/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null;

onMount(() => {
	const unsub1 = update.store.subscribe((s) => { state = s; });
	const unsub2 = update.isActive.subscribe((a) => { isActive = a; });

	// Initial fetch
	fetchStatus();

	return () => {
		unsub1();
		unsub2();
		if (pollTimer) clearInterval(pollTimer);
	};
});

async function fetchStatus() {
	const result = await service.client.getUpdateStatus();
	if (result.ok) {
		const d = result.data;
		update.setStatus({
			phase: d.phase ?? 'idle',
			targetVersion: d.targetVersion ?? null,
			startedAt: d.startedAt ?? null,
			error: d.error ?? null,
			agents: d.agents ?? [],
			buildResults: d.buildResults ?? {},
		});
	}
}

function startPolling() {
	if (pollTimer) return;
	pollTimer = setInterval(fetchStatus, 2000);
}

function stopPolling() {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
}

async function handleCheckForUpdates() {
	update.setLoading(true);
	const result = await service.client.checkForUpdate(repo, currentVersion);
	if (result.ok) {
		update.setStatus({ phase: 'checking' });
		startPolling();
	} else {
		update.setError(result.error ?? 'Failed to check for updates');
	}
	update.setLoading(false);
}

async function handleExecuteUpdate() {
	update.setLoading(true);
	const commands = [
		{ type: 'git_pull' },
		{ type: 'pnpm_install' },
		{ type: 'pnpm_build' },
	];
	const result = await service.client.executeUpdate(
		'relay',
		state.targetVersion ?? '0.0.0',
		'HEAD',
		commands,
	);
	if (result.ok) {
		update.setStatus({ phase: 'building' });
		startPolling();
	} else {
		update.setError(result.error ?? 'Failed to execute update');
	}
	update.setLoading(false);
}

async function handleCancel() {
	const result = await service.client.cancelUpdate();
	if (result.ok) {
		update.setStatus({ phase: 'idle', error: null });
		stopPolling();
	} else {
		update.setError(result.error ?? 'Failed to cancel update');
	}
}

// Auto-start/stop polling based on active state
$effect(() => {
	if (isActive) {
		startPolling();
	} else {
		stopPolling();
	}
});

/** @param {string} phase */
function phaseLabel(phase) {
	const labels = {
		idle: 'Idle',
		checking: 'Checking...',
		preparing: 'Preparing...',
		building: 'Building...',
		restarting: 'Restarting...',
		verifying: 'Verifying...',
		complete: 'Complete',
		failed: 'Failed',
	};
	return labels[phase] ?? phase;
}

/** @param {string} phase */
function phaseClass(phase) {
	if (phase === 'complete') return 'success';
	if (phase === 'failed') return 'error';
	if (phase === 'idle') return 'idle';
	return 'active';
}
</script>

<div class="update-page">
	<div class="page-header">
		<h2>System Update</h2>
		<span class="phase-badge {phaseClass(state.phase)}">{phaseLabel(state.phase)}</span>
	</div>

	{#if state.error}
		<div class="error-banner">{state.error}</div>
	{/if}

	<!-- Connected Agents -->
	<div class="panel">
		<h3>Connected Update Agents</h3>
		{#if state.agents.length === 0}
			<p class="muted">No update agents connected</p>
		{:else}
			<div class="agent-list">
				{#each state.agents as agent}
					<div class="agent-card">
						<span class="agent-dot"></span>
						<span class="agent-name">{agent.component}</span>
						<span class="agent-id">{agent.agentId}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Actions -->
	<div class="panel">
		<h3>Actions</h3>
		<div class="action-row">
			<div class="input-group">
				<label for="repo">Repository</label>
				<input id="repo" type="text" bind:value={repo} disabled={isActive} />
			</div>
			<div class="input-group">
				<label for="version">Current Version</label>
				<input id="version" type="text" bind:value={currentVersion} disabled={isActive} />
			</div>
		</div>
		<div class="button-row">
			<button
				class="btn btn-primary"
				onclick={handleCheckForUpdates}
				disabled={isActive || state.loading || state.agents.length === 0}
			>
				Check for Updates
			</button>
			<button
				class="btn btn-warning"
				onclick={handleExecuteUpdate}
				disabled={state.phase !== 'checking' && state.phase !== 'preparing' || state.agents.length === 0}
			>
				Update Now
			</button>
			<button
				class="btn btn-danger"
				onclick={handleCancel}
				disabled={!isActive}
			>
				Cancel
			</button>
		</div>
	</div>

	<!-- Build Progress -->
	{#if Object.keys(state.buildResults).length > 0}
		<div class="panel">
			<h3>Build Progress</h3>
			<div class="build-results">
				{#each Object.entries(state.buildResults) as [component, result]}
					<div class="build-row">
						<span class="build-component">{component}</span>
						<span class="build-status {result.status}">{result.status}</span>
						{#if result.duration}
							<span class="build-duration">{result.duration}s</span>
						{/if}
						{#if result.error}
							<span class="build-error">{result.error}</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Update Summary -->
	{#if state.phase === 'complete'}
		<div class="panel success-panel">
			<h3>Update Complete</h3>
			<p>Successfully updated to version <strong>{state.targetVersion}</strong></p>
			{#if state.startedAt}
				<p class="muted">Started: {new Date(state.startedAt).toLocaleString()}</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.update-page h2 { margin-bottom: 0; font-size: 1.5rem; }

	.page-header {
		display: flex; justify-content: space-between; align-items: center;
		margin-bottom: 1.5rem;
	}

	.phase-badge {
		padding: 0.25rem 0.75rem; border-radius: 1rem;
		font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
	}
	.phase-badge.idle { background: var(--bg-surface); color: var(--text-muted); }
	.phase-badge.active { background: var(--accent-muted); color: var(--accent-secondary); }
	.phase-badge.success { background: #1a3a2a; color: #4ade80; }
	.phase-badge.error { background: #3a1a1a; color: #f87171; }

	.error-banner {
		background: #3a1a1a; color: #f87171; padding: 0.75rem 1rem;
		border-radius: 0.5rem; margin-bottom: 1rem; font-size: 0.85rem;
	}

	.panel {
		background: var(--bg-surface); border: 1px solid var(--border-default);
		border-radius: 0.5rem; padding: 1.25rem; margin-bottom: 1rem;
	}
	.panel h3 { font-size: 0.95rem; margin-bottom: 0.75rem; color: var(--text-primary); }

	.muted { color: var(--text-muted); font-size: 0.85rem; }

	.agent-list { display: flex; gap: 0.75rem; flex-wrap: wrap; }
	.agent-card {
		display: flex; align-items: center; gap: 0.5rem;
		background: var(--bg-primary); padding: 0.5rem 0.75rem;
		border-radius: 0.375rem; font-size: 0.85rem;
	}
	.agent-dot {
		width: 8px; height: 8px; border-radius: 50%; background: #4ade80;
	}
	.agent-name { font-weight: 600; color: var(--text-primary); }
	.agent-id { color: var(--text-muted); font-size: 0.75rem; }

	.action-row { display: flex; gap: 1rem; margin-bottom: 1rem; }
	.input-group { flex: 1; }
	.input-group label {
		display: block; font-size: 0.75rem; color: var(--text-muted);
		margin-bottom: 0.25rem;
	}
	.input-group input {
		width: 100%; padding: 0.5rem; background: var(--bg-primary);
		border: 1px solid var(--border-default); border-radius: 0.375rem;
		color: var(--text-primary); font-size: 0.85rem;
	}
	.input-group input:disabled { opacity: 0.5; }

	.button-row { display: flex; gap: 0.75rem; }
	.btn {
		padding: 0.5rem 1rem; border-radius: 0.375rem;
		font-size: 0.85rem; font-weight: 600; cursor: pointer; border: none;
	}
	.btn:disabled { opacity: 0.4; cursor: not-allowed; }
	.btn-primary { background: var(--accent-primary); color: white; }
	.btn-warning { background: #f59e0b; color: #1a1a1a; }
	.btn-danger { background: #ef4444; color: white; }

	.build-results { display: flex; flex-direction: column; gap: 0.5rem; }
	.build-row {
		display: flex; align-items: center; gap: 0.75rem;
		padding: 0.5rem; background: var(--bg-primary); border-radius: 0.375rem;
		font-size: 0.85rem;
	}
	.build-component { font-weight: 600; min-width: 100px; }
	.build-status { padding: 0.125rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; }
	.build-status.pending { background: var(--bg-surface); color: var(--text-muted); }
	.build-status.building { background: var(--accent-muted); color: var(--accent-secondary); }
	.build-status.complete { background: #1a3a2a; color: #4ade80; }
	.build-status.failed { background: #3a1a1a; color: #f87171; }
	.build-duration { color: var(--text-muted); font-size: 0.75rem; }
	.build-error { color: #f87171; font-size: 0.75rem; }

	.success-panel { border-color: #4ade80; }
	.success-panel h3 { color: #4ade80; }
</style>
