<script lang="ts">
import { onMount } from 'svelte';
import * as session from '$lib/session.js';
import type { TrackedTask } from '$lib/stores/tasks.js';
import TaskTracker from '$lib/components/TaskTracker.svelte';

// ---------------------------------------------------------------------------
// Reactive state from shared session stores
// ---------------------------------------------------------------------------

let allTasks: readonly TrackedTask[] = $state([]);
let selectedTask: TrackedTask | null = $state(null);

// Use onMount (NOT $effect) to set up store subscriptions.
// See +layout.svelte for detailed explanation of the reactive loop issue.
onMount(() => {
	const unsubs = [
		session.tasks.store.subscribe((v) => (allTasks = v.tasks)),
		session.tasks.selectedTask.subscribe((v) => (selectedTask = v)),
	];

	return () => {
		for (const u of unsubs) u();
	};
});
</script>

<div class="tasks-page">
	<header class="page-header">
		<h2>Task Tracker</h2>
		<p class="subtitle">View submitted tasks, their status, safety evaluations, and outcomes.</p>
		{#if allTasks.length > 0}
			<p class="task-count">{allTasks.length} task{allTasks.length === 1 ? '' : 's'} tracked</p>
		{/if}
	</header>

	<TaskTracker tasks={allTasks} {selectedTask} />
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

	.task-count {
		font-size: 0.75rem;
		color: var(--color-accent);
		margin-top: 0.25rem;
	}
</style>
