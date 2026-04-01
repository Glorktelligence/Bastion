<script>
// Audit Log Explorer — Advanced filtering for relay audit events
// Supports: date range, event type, session ID, pagination, JSON export

import { onMount } from 'svelte';
import AuditEventRow from '$lib/components/AuditEventRow.svelte';
import { createAdminAuditStore, AUDIT_EVENT_TYPES } from '$lib/stores/audit.js';
import { createSharedService } from '$lib/api/service-instance.js';

const audit = createAdminAuditStore();
const service = createSharedService();

/** @type {import('$lib/stores/audit.js').AdminAuditState} */
let state = $state(audit.store.get());

/** @type {number} */
let pages = $state(audit.pageCount.get());

onMount(() => {
	const unsub1 = audit.store.subscribe((s) => { state = s; });
	const unsub2 = audit.pageCount.subscribe((p) => { pages = p; });

	// Initial fetch
	fetchAudit();

	return () => { unsub1(); unsub2(); };
});

async function fetchAudit() {
	audit.setLoading(true);
	const params = audit.getQueryParams();
	const result = await service.client.queryAudit(params);
	if (result.ok) {
		const d = /** @type {Record<string, unknown>} */ (result.data);
		const entries = /** @type {import('$lib/types.js').AuditEventSummary[]} */ (d.entries ?? []);
		audit.setEntries(entries, Number(d.totalCount ?? entries.length));
	} else {
		audit.setError(result.error ?? 'Failed to fetch audit events');
		audit.setLoading(false);
	}
	// Also fetch chain integrity
	const intResult = await service.client.getChainIntegrity();
	if (intResult.ok) {
		const d = /** @type {Record<string, unknown>} */ (intResult.data);
		audit.setIntegrity({
			totalEntries: Number(d.totalEntries ?? 0),
			chainValid: Boolean(d.chainValid),
			lastVerifiedAt: d.lastVerifiedAt ? String(d.lastVerifiedAt) : null,
		});
	}
}

function applyFilters() {
	audit.setPage(0);
	fetchAudit();
}

function clearFilters() {
	audit.clearFilter();
	fetchAudit();
}

function goToPage(/** @type {number} */ page) {
	audit.setPage(page);
	fetchAudit();
}

function changePageSize(/** @type {number} */ size) {
	audit.setPageSize(size);
	fetchAudit();
}

function exportJson() {
	const json = JSON.stringify(state.entries, null, 2);
	const blob = new Blob([json], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `bastion-audit-${new Date().toISOString().slice(0, 10)}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

// Local filter form state bound to inputs
let filterStartTime = $state('');
let filterEndTime = $state('');
let filterEventType = $state('');
let filterSessionId = $state('');

function handleApplyFilters() {
	audit.setFilter({
		startTime: filterStartTime ? new Date(filterStartTime).toISOString() : '',
		endTime: filterEndTime ? new Date(filterEndTime).toISOString() : '',
		eventType: filterEventType,
		sessionId: filterSessionId.trim(),
	});
	applyFilters();
}

function handleClearFilters() {
	filterStartTime = '';
	filterEndTime = '';
	filterEventType = '';
	filterSessionId = '';
	clearFilters();
}
</script>

<div class="audit-page">
	<div class="page-header">
		<h2>Audit Log</h2>
		<div class="header-badges">
			{#if state.integrity}
				<span class="badge" class:badge-ok={state.integrity.chainValid} class:badge-err={!state.integrity.chainValid}>
					{state.integrity.chainValid ? 'Chain Valid' : 'Chain Broken'} ({state.integrity.totalEntries} entries)
				</span>
			{/if}
			<span class="count">{state.totalServerCount} total events</span>
		</div>
	</div>

	<!-- Filters -->
	<div class="filter-bar">
		<label class="filter-field">
			<span class="filter-label">From</span>
			<input type="datetime-local" bind:value={filterStartTime} class="filter-input" />
		</label>
		<label class="filter-field">
			<span class="filter-label">To</span>
			<input type="datetime-local" bind:value={filterEndTime} class="filter-input" />
		</label>
		<label class="filter-field">
			<span class="filter-label">Event Type</span>
			<select bind:value={filterEventType} class="filter-input">
				<option value="">All types</option>
				{#each AUDIT_EVENT_TYPES as et}
					<option value={et}>{et}</option>
				{/each}
			</select>
		</label>
		<label class="filter-field">
			<span class="filter-label">Session ID</span>
			<input type="text" bind:value={filterSessionId} class="filter-input mono" placeholder="abc123..." />
		</label>
		<div class="filter-actions">
			<button class="btn btn-primary" onclick={handleApplyFilters}>Apply</button>
			<button class="btn btn-secondary" onclick={handleClearFilters}>Clear</button>
			<button class="btn btn-secondary" onclick={exportJson} title="Download filtered results as JSON">Export JSON</button>
		</div>
	</div>

	<!-- Loading / Error -->
	{#if state.loading}
		<p class="loading">Loading...</p>
	{/if}
	{#if state.error}
		<p class="error">{state.error}</p>
	{/if}

	<!-- Table -->
	<div class="section">
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
				{#each state.entries as event}
					<AuditEventRow {event} />
				{:else}
					<tr>
						<td colspan="4" class="empty">No events match the current filters</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- Pagination -->
	<div class="pagination">
		<div class="page-size">
			<span class="page-label">Per page:</span>
			{#each [25, 50, 100] as size}
				<button
					class="btn btn-sm"
					class:btn-active={state.pageSize === size}
					onclick={() => changePageSize(size)}
				>{size}</button>
			{/each}
		</div>
		<div class="page-range">
			<span class="page-label">Showing {state.totalServerCount === 0 ? '0' : `${state.currentPage * state.pageSize + 1}\u2013${Math.min(state.currentPage * state.pageSize + state.entries.length, state.totalServerCount)}`} of {state.totalServerCount.toLocaleString()} entries</span>
		</div>
		<div class="page-nav">
			<button class="btn btn-sm" disabled={state.currentPage === 0} onclick={() => goToPage(state.currentPage - 1)}>Previous</button>
			<span class="page-label">Page {state.currentPage + 1} of {pages}</span>
			<button class="btn btn-sm" disabled={state.currentPage >= pages - 1} onclick={() => goToPage(state.currentPage + 1)}>Next</button>
		</div>
	</div>
</div>

<style>
	.audit-page { display: flex; flex-direction: column; gap: 1rem; }

	.page-header { display: flex; align-items: baseline; justify-content: space-between; }
	.page-header h2 { font-size: 1.5rem; }
	.header-badges { display: flex; align-items: center; gap: 0.75rem; }
	.count { color: var(--text-muted); font-size: 0.85rem; }

	.badge {
		font-size: 0.75rem; font-weight: 600;
		padding: 0.125rem 0.5rem; border-radius: 999px;
	}
	.badge-ok { background: color-mix(in srgb, var(--status-success) 15%, transparent); color: var(--status-success); }
	.badge-err { background: color-mix(in srgb, var(--status-error) 15%, transparent); color: var(--status-error); }

	.filter-bar {
		display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: flex-end;
		background: var(--bg-surface); border: 1px solid var(--border-default);
		border-radius: 0.5rem; padding: 1rem;
	}
	.filter-field { display: flex; flex-direction: column; gap: 0.2rem; }
	.filter-label { font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.03em; }
	.filter-input {
		padding: 0.375rem 0.5rem; font-size: 0.85rem;
		border: 1px solid var(--border-default); border-radius: 0.25rem;
		background: var(--bg-primary); color: var(--text-primary);
	}
	.filter-input.mono { font-family: monospace; font-size: 0.8rem; }
	.filter-actions { display: flex; gap: 0.5rem; align-items: flex-end; }

	.btn {
		padding: 0.375rem 0.75rem; border-radius: 0.25rem;
		font-size: 0.8rem; cursor: pointer; border: 1px solid var(--border-default);
	}
	.btn-primary { background: var(--accent-primary); color: #fff; border-color: var(--accent-primary); }
	.btn-secondary { background: transparent; color: var(--text-secondary); }
	.btn-sm { padding: 0.25rem 0.5rem; font-size: 0.75rem; }
	.btn-active { background: var(--accent-primary); color: #fff; border-color: var(--accent-primary); }
	.btn:disabled { opacity: 0.4; cursor: not-allowed; }

	.section {
		background: var(--bg-surface); border: 1px solid var(--border-default);
		border-radius: 0.5rem; padding: 0; overflow-x: auto;
	}
	table { width: 100%; border-collapse: collapse; }
	th { text-align: left; padding: 0.625rem 1rem; font-size: 0.75rem; color: var(--text-muted); border-bottom: 1px solid var(--border-default); text-transform: uppercase; letter-spacing: 0.03em; }
	:global(td) { padding: 0.5rem 1rem; border-bottom: 1px solid var(--border-subtle, var(--border-default)); }
	.empty { text-align: center; color: var(--text-muted); padding: 2rem !important; }

	.loading { color: var(--text-muted); font-style: italic; }
	.error { color: var(--status-error); }

	.pagination {
		display: flex; justify-content: space-between; align-items: center;
		padding: 0.5rem 0; font-size: 0.85rem;
	}
	.page-size, .page-nav, .page-range { display: flex; align-items: center; gap: 0.375rem; }
	.page-label { color: var(--text-muted); font-size: 0.8rem; }
</style>
