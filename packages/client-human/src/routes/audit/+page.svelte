<script>

</script>

<div class="audit-page">
	<header class="page-header">
		<h2>Audit Log</h2>
		<p class="subtitle">Queryable view of the audit trail — filter by time, type, sender, task, and safety outcome.</p>
	</header>

	<AuditLogExplorer
		entries={[]}
		filter={{}}
		currentPage={0}
		pageCount={1}
		totalCount={0}
		loading={false}
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
