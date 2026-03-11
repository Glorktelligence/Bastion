<script>
// Provider Management — Task 3.7
// List, approve, revoke, view/edit capability matrix
</script>

<div class="providers-page">
	<div class="page-header">
		<h2>Provider Management</h2>
		<button class="btn-primary">Approve Provider</button>
	</div>

	<table>
		<thead>
			<tr>
				<th>ID</th>
				<th>Name</th>
				<th>Status</th>
				<th>Approved</th>
				<th>Message Types</th>
				<th>Actions</th>
			</tr>
		</thead>
		<tbody>
			<tr>
				<td colspan="6" class="empty">No providers configured</td>
			</tr>
		</tbody>
	</table>
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

	.empty {
		text-align: center;
		color: var(--text-muted);
		padding: 2rem;
	}
</style>
