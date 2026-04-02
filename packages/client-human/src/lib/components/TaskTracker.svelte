<script>
// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * @type {{
 *   tasks: readonly import('../stores/tasks.js').TrackedTask[],
 *   selectedTask: import('../stores/tasks.js').TrackedTask | null,
 *   onResolveChallenge?: (taskId: string, decision: string) => void,
 *   onClearCompleted?: () => void
 * }}
 */
const { tasks, selectedTask, onResolveChallenge, onClearCompleted } = $props();

/** @type {'all' | 'active' | 'completed' | 'denied'} */
let filter = $state('all');
let sortNewest = $state(true);
/** @type {Set<string>} */
let expandedIds = $state(new Set());

const statusColors = {
  submitted: 'var(--color-accent)',
  in_progress: 'var(--color-warning)',
  completed: 'var(--color-success)',
  denied: 'var(--color-error)',
  cancelled: 'var(--color-text-muted)',
  challenged: 'var(--color-warning)',
};

const filteredTasks = $derived.by(() => {
  let list = [...tasks];

  if (filter === 'active') {
    list = list.filter((t) => t.status === 'submitted' || t.status === 'in_progress' || t.status === 'challenged');
  } else if (filter === 'completed') {
    list = list.filter((t) => t.status === 'completed' || t.status === 'cancelled');
  } else if (filter === 'denied') {
    list = list.filter((t) => t.status === 'denied');
  }

  list.sort((a, b) => {
    const diff = new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
    return sortNewest ? diff : -diff;
  });

  return list;
});

const hasCompleted = $derived(tasks.some((t) => t.status === 'completed' || t.status === 'cancelled' || t.status === 'denied'));

function toggleExpand(taskId) {
  const next = new Set(expandedIds);
  if (next.has(taskId)) next.delete(taskId);
  else next.add(taskId);
  expandedIds = next;
}

function riskScorePercent(score, threshold) {
  return Math.min(100, Math.round((score / Math.max(threshold, 1)) * 100));
}
</script>

<div class="task-tracker">
	<div class="toolbar">
		<div class="filter-bar">
			{#each [['all', 'All'], ['active', 'Active'], ['completed', 'Completed'], ['denied', 'Denied']] as [key, label]}
				<button
					class="filter-pill"
					class:active={filter === key}
					onclick={() => { filter = key; }}
				>
					{label}
				</button>
			{/each}
		</div>
		<div class="toolbar-right">
			<button class="sort-btn" onclick={() => { sortNewest = !sortNewest; }} title="Toggle sort order">
				{sortNewest ? 'Newest' : 'Oldest'}
			</button>
			{#if hasCompleted && onClearCompleted}
				<button class="clear-btn" onclick={onClearCompleted}>Clear completed</button>
			{/if}
		</div>
	</div>

	<div class="task-list">
		{#each filteredTasks as task (task.taskId)}
			{@const expanded = expandedIds.has(task.taskId)}
			<div
				class="task-card"
				class:selected={selectedTask?.taskId === task.taskId}
				class:active={task.status === 'submitted' || task.status === 'in_progress' || task.status === 'challenged'}
				onclick={() => toggleExpand(task.taskId)}
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
					<span class="expand-indicator">{expanded ? '▾' : '▸'}</span>
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

					{#if task.challengeFactors && task.challengeFactors.length > 0}
						<div class="factor-breakdown">
							<div class="factor-heading">Safety Evaluation — Layer {task.challengeLayer}</div>
							{#if task.challengeRiskScore != null && task.challengeThreshold != null}
								<div class="risk-score-row">
									<span class="risk-label">Risk: {task.challengeRiskScore.toFixed(2)} / threshold {task.challengeThreshold.toFixed(2)}</span>
									<div class="risk-bar">
										<div
											class="risk-fill"
											class:risk-over={task.challengeRiskScore >= task.challengeThreshold}
											style="width: {riskScorePercent(task.challengeRiskScore, task.challengeThreshold)}%"
										></div>
										<div class="risk-threshold-line" style="left: {Math.min(100, Math.round((task.challengeThreshold / Math.max(task.challengeRiskScore, task.challengeThreshold, 1)) * 100))}%"></div>
									</div>
								</div>
							{/if}
							<div class="factors-grid">
								{#each task.challengeFactors as factor}
									<div class="factor-row" class:factor-triggered={factor.triggered}>
										<span class="factor-name">{factor.name.replace(/_/g, ' ')}</span>
										<span class="factor-triggered-badge">{factor.triggered ? 'triggered' : 'ok'}</span>
										<span class="factor-weight">{factor.weight.toFixed(1)}x</span>
										<span class="factor-detail">{factor.detail}</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					{#if onResolveChallenge}
						<div class="challenge-actions" onclick={(e) => e.stopPropagation()}>
							<button class="action-btn action-approve" onclick={() => onResolveChallenge(task.taskId, 'approve')}>Accept Challenge</button>
							<button class="action-btn action-cancel" onclick={() => onResolveChallenge(task.taskId, 'cancel')}>Cancel Task</button>
						</div>
					{/if}

					{#if task.challengeSuggestedAlternatives && task.challengeSuggestedAlternatives.length > 0}
						<div class="alternatives">
							<span class="alt-label">Suggested alternatives:</span>
							{#each task.challengeSuggestedAlternatives as alt}
								<span class="alt-item">{alt}</span>
							{/each}
						</div>
					{/if}
				{/if}

				{#if task.status === 'denied'}
					<div class="denial-info">
						Layer {task.denialLayer}: {task.denialReason}
					</div>
					{#if task.denialDetail}
						<div class="denial-detail">{task.denialDetail}</div>
					{/if}
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

				{#if expanded}
					<div class="expanded-detail" onclick={(e) => e.stopPropagation()}>
						<div class="detail-section">
							<span class="detail-label">Task ID</span>
							<span class="detail-value mono">{task.taskId}</span>
						</div>
						{#if task.description}
							<div class="detail-section">
								<span class="detail-label">Description</span>
								<span class="detail-value">{task.description}</span>
							</div>
						{/if}
						{#if task.parameters && Object.keys(task.parameters).length > 0}
							<div class="detail-section">
								<span class="detail-label">Parameters</span>
								<div class="detail-params">
									{#each Object.entries(task.parameters) as [k, v]}
										<div class="param-pair"><span class="param-key">{k}:</span> <span class="param-val">{String(v)}</span></div>
									{/each}
								</div>
							</div>
						{/if}
						{#if task.constraints.length > 0}
							<div class="detail-section">
								<span class="detail-label">Constraints</span>
								<div class="detail-constraints">
									{#each task.constraints as c}
										<span class="constraint-tag">{c}</span>
									{/each}
								</div>
							</div>
						{/if}
						{#if task.actionsTaken && task.actionsTaken.length > 0}
							<div class="detail-section">
								<span class="detail-label">Actions Taken</span>
								<ul class="detail-actions-list">
									{#each task.actionsTaken as act}
										<li>{act}</li>
									{/each}
								</ul>
							</div>
						{/if}
						<div class="detail-section">
							<span class="detail-label">Timeline</span>
							<div class="detail-timeline">
								<span>Submitted: {new Date(task.submittedAt).toLocaleString()}</span>
								<span>Updated: {new Date(task.updatedAt).toLocaleString()}</span>
							</div>
						</div>
					</div>
				{/if}
			</div>
		{:else}
			<div class="empty">No tasks {filter !== 'all' ? `matching "${filter}"` : 'submitted yet'}</div>
		{/each}
	</div>
</div>

<style>
	.task-tracker {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.filter-bar {
		display: flex;
		gap: 0.25rem;
	}

	.filter-pill {
		padding: 0.25rem 0.625rem;
		border-radius: 999px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.7rem;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}

	.filter-pill.active {
		background: var(--color-accent);
		color: #fff;
		border-color: var(--color-accent);
	}

	.toolbar-right {
		display: flex;
		gap: 0.375rem;
		align-items: center;
	}

	.sort-btn {
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.7rem;
		cursor: pointer;
	}

	.sort-btn:hover {
		color: var(--color-text);
		border-color: var(--color-text-muted);
	}

	.clear-btn {
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
		border: 1px solid color-mix(in srgb, var(--color-error) 40%, transparent);
		background: transparent;
		color: var(--color-error);
		font-size: 0.7rem;
		cursor: pointer;
	}

	.clear-btn:hover {
		background: color-mix(in srgb, var(--color-error) 10%, transparent);
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
		align-items: center;
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

	.expand-indicator {
		margin-left: auto;
		font-size: 0.7rem;
		opacity: 0.5;
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

	/* Factor breakdown */
	.factor-breakdown {
		padding: 0.5rem;
		background: var(--color-bg);
		border-radius: 6px;
		border: 1px solid var(--color-border);
	}

	.factor-heading {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-warning);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		margin-bottom: 0.375rem;
	}

	.risk-score-row {
		margin-bottom: 0.5rem;
	}

	.risk-label {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		display: block;
		margin-bottom: 0.25rem;
	}

	.risk-bar {
		position: relative;
		height: 8px;
		background: color-mix(in srgb, var(--color-text-muted) 15%, transparent);
		border-radius: 4px;
		overflow: visible;
	}

	.risk-fill {
		height: 100%;
		background: var(--color-warning);
		border-radius: 4px;
		transition: width 0.3s;
	}

	.risk-fill.risk-over {
		background: var(--color-error);
	}

	.risk-threshold-line {
		position: absolute;
		top: -2px;
		bottom: -2px;
		width: 2px;
		background: var(--color-text);
		border-radius: 1px;
	}

	.factors-grid {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.factor-row {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 0.5rem;
		align-items: center;
		padding: 0.25rem 0.375rem;
		border-radius: 4px;
		font-size: 0.7rem;
	}

	.factor-row.factor-triggered {
		background: color-mix(in srgb, var(--color-warning) 8%, transparent);
	}

	.factor-name {
		color: var(--color-text);
		text-transform: capitalize;
	}

	.factor-triggered-badge {
		font-size: 0.6rem;
		font-weight: 600;
		padding: 0.0625rem 0.3rem;
		border-radius: 999px;
	}

	.factor-triggered .factor-triggered-badge {
		background: color-mix(in srgb, var(--color-warning) 20%, transparent);
		color: var(--color-warning);
	}

	.factor-row:not(.factor-triggered) .factor-triggered-badge {
		background: color-mix(in srgb, var(--color-success) 15%, transparent);
		color: var(--color-success);
	}

	.factor-weight {
		font-family: var(--font-mono);
		color: var(--color-text-muted);
		font-size: 0.65rem;
	}

	.factor-detail {
		grid-column: 1 / -1;
		color: var(--color-text-muted);
		font-size: 0.65rem;
		padding-left: 0.375rem;
	}

	/* Challenge actions */
	.challenge-actions {
		display: flex;
		gap: 0.375rem;
		margin-top: 0.25rem;
	}

	.action-btn {
		padding: 0.3rem 0.625rem;
		border-radius: 6px;
		border: none;
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
	}

	.action-approve {
		background: var(--color-accent);
		color: #fff;
	}

	.action-approve:hover {
		opacity: 0.9;
	}

	.action-cancel {
		background: transparent;
		color: var(--color-error);
		border: 1px solid var(--color-error);
	}

	.action-cancel:hover {
		background: color-mix(in srgb, var(--color-error) 10%, transparent);
	}

	.alternatives {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		align-items: center;
		margin-top: 0.25rem;
	}

	.alt-label {
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.alt-item {
		font-size: 0.7rem;
		padding: 0.125rem 0.375rem;
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-accent);
		border-radius: 4px;
	}

	.denial-info {
		padding: 0.375rem 0.5rem;
		background: color-mix(in srgb, var(--color-error) 10%, transparent);
		border-left: 2px solid var(--color-error);
		border-radius: 0 4px 4px 0;
		font-size: 0.8rem;
		color: var(--color-error);
	}

	.denial-detail {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		padding-left: 0.5rem;
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

	/* Expanded detail */
	.expanded-detail {
		margin-top: 0.375rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.detail-section {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.detail-label {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.detail-value {
		font-size: 0.8rem;
		color: var(--color-text);
		line-height: 1.3;
	}

	.detail-value.mono {
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}

	.detail-params {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.param-pair {
		font-size: 0.8rem;
	}

	.param-key {
		color: var(--color-accent);
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}

	.param-val {
		color: var(--color-text);
	}

	.detail-constraints {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.constraint-tag {
		font-size: 0.7rem;
		padding: 0.1rem 0.375rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		color: var(--color-text);
	}

	.detail-actions-list {
		margin: 0;
		padding-left: 1.25rem;
		font-size: 0.8rem;
		color: var(--color-text);
	}

	.detail-actions-list li {
		margin-bottom: 0.125rem;
	}

	.detail-timeline {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.empty {
		text-align: center;
		padding: 2rem;
		color: var(--color-text-muted);
	}
</style>
