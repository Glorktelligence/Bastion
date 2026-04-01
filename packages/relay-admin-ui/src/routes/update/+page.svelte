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
let currentVersion = $state('');

/** @type {string[]} */
let changelog = $state([]);

/** @type {string|null} */
let availableVersion = $state(null);

/** @type {string} */
let commitHash = $state('HEAD');

/** @type {Record<string, unknown>|null} */
let checkResult = $state(null);

/** @type {Array<Record<string, unknown>>} */
let updateHistory = $state([]);

/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null;

const PHASE_ORDER = ['checking', 'preparing', 'building', 'restarting', 'verifying', 'complete'];

onMount(() => {
	const unsub1 = update.store.subscribe((s) => { state = s; });
	const unsub2 = update.isActive.subscribe((a) => { isActive = a; });

	// Initial fetch
	fetchStatus();
	fetchHistory();

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
		// Sync currentVersion from relay if available (single source of truth)
		if (d.currentVersion && !currentVersion) {
			currentVersion = d.currentVersion;
		}
		// Cache check result for display
		if (d.checkResult) {
			checkResult = d.checkResult;
			if (d.checkResult.status === 'update_available') {
				availableVersion = d.checkResult.availableVersion ?? null;
				commitHash = d.checkResult.commitHash ?? 'HEAD';
			}
		}
	}
}

async function fetchHistory() {
	const result = await service.client.queryAudit({
		eventType: 'update_check',
		limit: 10,
		offset: 0,
	});
	if (result.ok && result.data?.entries) {
		updateHistory = result.data.entries;
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
		const d = result.data;
		if (d.status === 'update_available') {
			availableVersion = d.availableVersion ?? null;
			commitHash = d.commitHash ?? 'HEAD';
			changelog = Array.isArray(d.changelog) ? d.changelog : [];
			update.setStatus({ phase: 'checking', targetVersion: d.availableVersion ?? null });
		} else if (d.status === 'up_to_date') {
			update.setStatus({ phase: 'idle' });
			availableVersion = null;
			changelog = [];
		} else {
			update.setStatus({ phase: 'checking' });
		}
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
		commitHash,
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
				{#each state.agents as agent (agent.agentId)}
					<div class="agent-card">
						<span class="agent-dot"></span>
						<span class="agent-name">{agent.component}</span>
						<span class="agent-id">({agent.agentId})</span>
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

	<!-- Version Check Result -->
	{#if checkResult}
		<div class="panel" class:update-available-panel={checkResult.status === 'update_available'}>
			{#if checkResult.status === 'update_available'}
				<h3>Update Available: v{checkResult.availableVersion}</h3>
				<div class="check-details">
					<span>Current: v{checkResult.currentVersion}</span>
					<span>Available: v{checkResult.availableVersion}</span>
					{#if checkResult.commitCount}
						<span>{checkResult.commitCount} new commit{checkResult.commitCount > 1 ? 's' : ''}</span>
					{/if}
					{#if checkResult.commitHash}
						<span class="mono">{String(checkResult.commitHash).slice(0, 8)}</span>
					{/if}
				</div>
				{#if changelog.length > 0}
					<ul class="changelog">
						{#each changelog as entry}
							<li>{entry}</li>
						{/each}
					</ul>
				{/if}
			{:else if checkResult.status === 'up_to_date'}
				<h3>Up to Date</h3>
				<p class="muted">v{checkResult.currentVersion} — no updates available{checkResult.fetchFailed ? ' (fetch failed — showing local state)' : ''}</p>
			{/if}
		</div>
	{/if}

	<!-- Phase Progress Indicator -->
	{#if state.phase !== 'idle'}
		<div class="panel">
			<h3>Update Progress</h3>
			<div class="phase-progress">
				{#each PHASE_ORDER as phase, i}
					{@const currentIdx = PHASE_ORDER.indexOf(state.phase)}
					{@const isDone = i < currentIdx || state.phase === 'complete'}
					{@const isCurrent = phase === state.phase}
					{@const isFailed = state.phase === 'failed' && i === currentIdx}
					<div class="phase-step" class:done={isDone} class:current={isCurrent} class:failed={isFailed}>
						<span class="phase-dot">{isDone ? '\u2713' : isFailed ? '\u2717' : i + 1}</span>
						<span class="phase-name">{phaseLabel(phase)}</span>
					</div>
					{#if i < PHASE_ORDER.length - 1}
						<div class="phase-connector" class:done={isDone}></div>
					{/if}
				{/each}
			</div>
			{#if state.startedAt}
				<p class="muted" style="margin-top:0.5rem">Started: {new Date(state.startedAt).toLocaleString()}</p>
			{/if}
		</div>
	{/if}

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

	<!-- Update History (from audit trail) -->
	{#if updateHistory.length > 0}
		<div class="panel">
			<h3>Recent Update Activity</h3>
			<div class="history-list">
				{#each updateHistory as event}
					<div class="history-row">
						<span class="history-time">{new Date(event.timestamp || event.createdAt).toLocaleString()}</span>
						<span class="history-type">{event.eventType || event.type}</span>
						{#if event.metadata?.version || event.metadata?.component}
							<span class="muted">{event.metadata?.component ?? ''} {event.metadata?.version ?? ''}</span>
						{/if}
					</div>
				{/each}
			</div>
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

	.update-available-panel { border-color: #f59e0b; }
	.update-available-panel h3 { color: #f59e0b; }
	.changelog {
		list-style: none; padding: 0; margin: 0.5rem 0 0;
		font-size: 0.8rem; color: var(--text-muted);
	}
	.changelog li {
		padding: 0.2rem 0; border-bottom: 1px solid var(--border-default);
	}
	.changelog li:last-child { border-bottom: none; }

	/* Check result details */
	.check-details {
		display: flex; gap: 1rem; font-size: 0.8rem; color: var(--text-muted);
		margin-bottom: 0.5rem; flex-wrap: wrap;
	}
	.mono { font-family: monospace; }

	/* Phase progress indicator */
	.phase-progress {
		display: flex; align-items: center; gap: 0;
		overflow-x: auto; padding: 0.25rem 0;
	}
	.phase-step {
		display: flex; flex-direction: column; align-items: center;
		gap: 0.25rem; min-width: 80px; font-size: 0.75rem;
	}
	.phase-dot {
		width: 28px; height: 28px; border-radius: 50%;
		display: flex; align-items: center; justify-content: center;
		font-size: 0.75rem; font-weight: 700;
		background: var(--bg-primary); color: var(--text-muted);
		border: 2px solid var(--border-default);
	}
	.phase-step.done .phase-dot { background: #1a3a2a; color: #4ade80; border-color: #4ade80; }
	.phase-step.current .phase-dot { background: var(--accent-muted); color: var(--accent-secondary); border-color: var(--accent-primary); }
	.phase-step.failed .phase-dot { background: #3a1a1a; color: #f87171; border-color: #f87171; }
	.phase-name { color: var(--text-muted); }
	.phase-step.current .phase-name { color: var(--accent-secondary); font-weight: 600; }
	.phase-step.done .phase-name { color: #4ade80; }
	.phase-connector {
		flex: 1; height: 2px; min-width: 20px;
		background: var(--border-default); margin-bottom: 1.25rem;
	}
	.phase-connector.done { background: #4ade80; }

	/* Update history */
	.history-list { display: flex; flex-direction: column; gap: 0.25rem; }
	.history-row {
		display: flex; gap: 0.75rem; align-items: center;
		padding: 0.375rem 0.5rem; font-size: 0.8rem;
		border-bottom: 1px solid var(--border-default);
	}
	.history-row:last-child { border-bottom: none; }
	.history-time { color: var(--text-muted); font-size: 0.75rem; min-width: 150px; }
	.history-type { font-weight: 500; color: var(--text-primary); }
</style>
