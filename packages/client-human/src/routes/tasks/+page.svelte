<script>

</script>

<div class="tasks-page">
	<header class="page-header">
		<h2>Task Tracker</h2>
		<p class="subtitle">View submitted tasks, their status, safety evaluations, and outcomes.</p>
	</header>

	<TaskTracker tasks={[]} selectedTask={null} />
</div>

<style>
	.tasks-page {
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
