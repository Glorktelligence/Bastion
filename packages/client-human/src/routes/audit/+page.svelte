<script lang="ts">
import * as session from '$lib/session.js';
import type { AuditLogEntry } from '$lib/stores/audit-log.js';
import type { AuditLogFilter } from '$lib/stores/audit-log.js';
import AuditLogExplorer from '$lib/components/AuditLogExplorer.svelte';

// ---------------------------------------------------------------------------
// Reactive state from shared session stores
// ---------------------------------------------------------------------------

let entries: readonly AuditLogEntry[] = $state([]);
let filter: AuditLogFilter = $state({});
let currentPage = $state(0);
let pageCount = $state(1);
let totalCount = $state(0);
let loading = $state(false);

$effect(() => {
	const unsubs = [
		session.auditLog.currentPageEntries.subscribe((v) => (entries = v)),
		session.auditLog.store.subscribe((v) => {
			filter = v.filter;
			currentPage = v.currentPage;
			loading = v.loading;
		}),
		session.auditLog.pageCount.subscribe((v) => (pageCount = v)),
		session.auditLog.totalCount.subscribe((v) => (totalCount = v)),
	];

	return () => {
		for (const u of unsubs) u();
	};
});

// ---------------------------------------------------------------------------
// Interactive callbacks
// ---------------------------------------------------------------------------

function handleFilterChange(update: Record<string, string>): void {
	session.auditLog.setFilter(update);
}

function handlePageChange(page: number): void {
	session.auditLog.setPage(page);
}
</script>

<div class="audit-page">
	<header class="page-header">
		<h2>Audit Log</h2>
		<p class="subtitle">Queryable view of the audit trail — filter by time, type, sender, task, and safety outcome.</p>
	</header>

	<AuditLogExplorer
		{entries}
		{filter}
		{currentPage}
		{pageCount}
		{totalCount}
		{loading}
		onFilterChange={handleFilterChange}
		onPageChange={handlePageChange}
	/>
</div>

<style>
	.audit-page {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		overflow-y: auto;
		height: 100%;
	}

	.page-header h2 {
		font-size: 1.25rem;
		color: var(--color-text);
	}

	.subtitle {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
	}
</style>
