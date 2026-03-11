<script>
/**
 * @type {{
 *   tasks: readonly import('../stores/tasks.js').TrackedTask[],
 *   selectedTask: import('../stores/tasks.js').TrackedTask | null
 * }}
 */
const { tasks, selectedTask } = $props();

const _statusColors = {
  submitted: 'var(--color-accent)',
  in_progress: 'var(--color-warning)',
  completed: 'var(--color-success)',
  denied: 'var(--color-error)',
  cancelled: 'var(--color-text-muted)',
  challenged: 'var(--color-warning)',
};
</script>

<div class="task-tracker">
	<div class="task-list">
		{#each tasks as task}
			<div
				class="task-card"
				class:selected={selectedTask?.taskId === task.taskId}
				class:active={task.status === 'submitted' || task.status === 'in_progress' || task.status === 'challenged'}
			>
				<div class="task-header">
					<span class="task-action">{task.action}</span>
					<span class="status-badge" style="--status-color: {statusColors[task.status] ?? 'var(--color-text-muted)'}">
						{task.status.replace('_', ' ')}
					</span>
				</div>
				<div class="task-target">{task.target}</div>
				<div class="task-meta">
					<span class="priority priority-{task.priority}">{task.priority}</span>
					<span class="task-id">{task.taskId.slice(0, 8)}</span>
					<span class="task-time">{new Date(task.submittedAt).toLocaleTimeString()}</span>
				</div>

				{#if task.status === 'in_progress' && task.completionPercentage > 0}
					<div class="progress-bar">
						<div class="progress-fill" style="width: {task.completionPercentage}%"></div>
						<span class="progress-text">{task.completionPercentage}%{task.currentAction ? ` — ${task.currentAction}` : ''}</span>
					</div>
				{/if}

				{#if task.status === 'challenged'}
					<div class="challenge-info">
						<span class="challenge-icon">!</span>
						<span>Layer {task.challengeLayer}: {task.challengeReason}</span>
					</div>
				{/if}

				{#if task.status === 'denied'}
					<div class="denial-info">
						Layer {task.denialLayer}: {task.denialReason}
					</div>
				{/if}

				{#if task.status === 'completed' && task.resultSummary}
					<div class="result-summary">{task.resultSummary}</div>
				{/if}

				{#if task.cost}
					<div class="cost-info">
						{task.cost.inputTokens + task.cost.outputTokens} tokens &middot; ${task.cost.estimatedCostUsd.toFixed(4)}
					</div>
				{/if}

				{#if task.safetyOutcome}
					<div class="safety-info">
						Safety: <span class="safety-outcome safety-{task.safetyOutcome}">{task.safetyOutcome}</span>
						{#if task.decidingLayer}
							<span class="deciding-layer">Layer {task.decidingLayer}</span>
						{/if}
					</div>
				{/if}
			</div>
		{:else}
			<div class="empty">No tasks submitted yet</div>
		{/each}
	</div>
</div>

<style>
	.task-tracker {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.task-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.task-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 0.875rem;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		cursor: pointer;
		transition: border-color 0.15s;
	}

	.task-card:hover,
	.task-card.selected {
		border-color: var(--color-accent);
	}

	.task-card.active {
		border-left: 3px solid var(--color-accent);
	}

	.task-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.task-action {
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--color-text);
	}

	.status-badge {
		padding: 0.125rem 0.5rem;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		background: color-mix(in srgb, var(--status-color) 20%, transparent);
		color: var(--status-color);
	}

	.task-target {
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.task-meta {
		display: flex;
		gap: 0.75rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.priority {
		font-weight: 600;
		text-transform: uppercase;
		font-size: 0.65rem;
		padding: 0.1rem 0.35rem;
		border-radius: 3px;
	}

	.priority-critical {
		background: color-mix(in srgb, var(--color-error) 20%, transparent);
		color: var(--color-error);
	}

	.priority-high {
		background: color-mix(in srgb, var(--color-warning) 20%, transparent);
		color: var(--color-warning);
	}

	.priority-normal {
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent-hover);
	}

	.priority-low {
		background: color-mix(in srgb, var(--color-text-muted) 15%, transparent);
		color: var(--color-text-muted);
	}

	.task-id {
		font-family: var(--font-mono);
	}

	.progress-bar {
		position: relative;
		height: 20px;
		background: var(--color-bg);
		border-radius: 4px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: var(--color-accent);
		transition: width 0.3s ease;
	}

	.progress-text {
		position: absolute;
		top: 50%;
		left: 0.5rem;
		transform: translateY(-50%);
		font-size: 0.7rem;
		color: var(--color-text);
	}

	.challenge-info {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.5rem;
		background: color-mix(in srgb, var(--color-warning) 10%, transparent);
		border-left: 2px solid var(--color-warning);
		border-radius: 0 4px 4px 0;
		font-size: 0.8rem;
		color: var(--color-warning);
	}

	.challenge-icon {
		font-weight: bold;
		font-size: 0.9rem;
	}

	.denial-info {
		padding: 0.375rem 0.5rem;
		background: color-mix(in srgb, var(--color-error) 10%, transparent);
		border-left: 2px solid var(--color-error);
		border-radius: 0 4px 4px 0;
		font-size: 0.8rem;
		color: var(--color-error);
	}

	.result-summary {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		font-style: italic;
	}

	.cost-info {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
	}

	.safety-info {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.safety-outcome {
		font-weight: 600;
	}

	.safety-allow { color: var(--color-success); }
	.safety-challenge { color: var(--color-warning); }
	.safety-deny { color: var(--color-error); }
	.safety-clarify { color: var(--color-accent-hover); }

	.deciding-layer {
		font-size: 0.65rem;
		padding: 0.1rem 0.3rem;
		background: var(--color-bg);
		border-radius: 3px;
	}

	.empty {
		text-align: center;
		padding: 2rem;
		color: var(--color-text-muted);
	}
</style>
