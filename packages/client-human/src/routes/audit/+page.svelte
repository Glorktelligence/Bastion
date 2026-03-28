<script lang="ts">
import { browser } from '$app/environment';
import * as session from '$lib/session.js';
import type { AuditLogEntry, ChainIntegrityStatus } from '$lib/stores/audit-log.js';
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
let integrity: ChainIntegrityStatus | null = $state(null);

$effect(() => {
	if (!browser) return () => {};
	const unsubs = [
		session.auditLog.currentPageEntries.subscribe((v) => (entries = v)),
		session.auditLog.store.subscribe((v) => {
			filter = v.filter;
			currentPage = v.currentPage;
			loading = v.loading;
		}),
		session.auditLog.pageCount.subscribe((v) => (pageCount = v)),
		session.auditLog.totalCount.subscribe((v) => (totalCount = v)),
		session.auditLog.integrity.subscribe((v) => (integrity = v)),
	];

	// Send audit_query on mount if connected
	sendAuditQuery();

	return () => {
		for (const u of unsubs) u();
	};
});

// ---------------------------------------------------------------------------
// Audit query
// ---------------------------------------------------------------------------

function sendAuditQuery(): void {
	const client = session.getClient();
	if (!client || !client.isConnected) return;
	session.auditLog.setLoading(true);
	const query = session.auditLog.buildAuditQuery();
	client.send(JSON.stringify({
		type: 'audit_query',
		id: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		sender: session.IDENTITY,
		payload: query,
	}));
}

// ---------------------------------------------------------------------------
// Interactive callbacks
// ---------------------------------------------------------------------------

function handleFilterChange(update: Record<string, string>): void {
	session.auditLog.setFilter(update);
	sendAuditQuery();
}

function handlePageChange(page: number): void {
	session.auditLog.setPage(page);
}

function handleRefresh(): void {
	sendAuditQuery();
}
</script>

<div class="audit-page">
	<header class="page-header">
		<div class="header-row">
			<div>
				<h2>Audit Log</h2>
				<p class="subtitle">Tamper-evident audit trail — filter by time, type, sender, task, and safety outcome.</p>
			</div>
			<div class="header-actions">
				{#if integrity}
					<span class="integrity-badge" class:valid={integrity.chainValid} class:broken={!integrity.chainValid}>
						{integrity.chainValid ? 'Chain Valid' : 'Chain Broken'}
						({integrity.entriesChecked} entries)
					</span>
				{/if}
				<button class="btn-refresh" onclick={handleRefresh} disabled={loading}>
					{loading ? 'Loading...' : 'Refresh'}
				</button>
			</div>
		</div>
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

	.page-header h2 { font-size: 1.25rem; color: var(--color-text); }
	.subtitle { font-size: 0.85rem; color: var(--color-text-muted); margin-top: 0.25rem; }

	.header-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-shrink: 0;
	}

	.integrity-badge {
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.25rem 0.5rem;
		border-radius: 999px;
	}
	.integrity-badge.valid {
		background: color-mix(in srgb, #22c55e 20%, transparent);
		color: #22c55e;
	}
	.integrity-badge.broken {
		background: color-mix(in srgb, #ef4444 20%, transparent);
		color: #ef4444;
	}

	.btn-refresh {
		background: var(--color-bg-secondary, #1a1a2e);
		color: var(--color-text);
		border: 1px solid var(--color-border, #2a2a4a);
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.btn-refresh:hover { border-color: var(--color-accent, #4a9eff); }
	.btn-refresh:disabled { opacity: 0.5; }
</style>
