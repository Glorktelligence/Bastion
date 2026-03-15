<script lang="ts">
import type { ActiveChallenge } from '../stores/challenges.js';

const {
  challenge,
  onApprove,
  onModify,
  onCancel,
}: {
  challenge: ActiveChallenge;
  onApprove?: () => void;
  onModify?: () => void;
  onCancel?: () => void;
} = $props();

let expanded = $state(true);
</script>

<div class="challenge-banner">
	<button class="banner-header" onclick={() => (expanded = !expanded)}>
		<span class="warning-icon">&#9888;</span>
		<span class="title">Safety Challenge — Layer {challenge.payload.layer}</span>
		<span class="toggle">{expanded ? '▾' : '▸'}</span>
	</button>

	{#if expanded}
		<div class="banner-body">
			<div class="section">
				<h4>Reason</h4>
				<p>{challenge.payload.reason}</p>
			</div>

			<div class="section">
				<h4>Risk Assessment</h4>
				<p>{challenge.payload.riskAssessment}</p>
			</div>

			{#if challenge.payload.factors.length > 0}
				<div class="section">
					<h4>Contributing Factors</h4>
					<table class="factors-table">
						<thead>
							<tr>
								<th>Factor</th>
								<th>Description</th>
								<th>Weight</th>
							</tr>
						</thead>
						<tbody>
							{#each challenge.payload.factors as factor}
								<tr>
									<td class="factor-name">{factor.name}</td>
									<td>{factor.description}</td>
									<td>
										<div class="weight-bar">
											<div class="weight-fill" style="width:{Math.round(factor.weight * 100)}%"></div>
										</div>
										<span class="weight-label">{factor.weight.toFixed(2)}</span>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			{#if challenge.payload.suggestedAlternatives.length > 0}
				<div class="section">
					<h4>Suggested Alternatives</h4>
					<ul>
						{#each challenge.payload.suggestedAlternatives as alt}
							<li>{alt}</li>
						{/each}
					</ul>
				</div>
			{/if}

			<div class="actions">
				<button class="btn btn-warning" onclick={() => onApprove?.()}>
					Proceed Anyway
				</button>
				<button class="btn btn-secondary" onclick={() => onModify?.()}>
					Modify Task
				</button>
				<button class="btn btn-neutral" onclick={() => onCancel?.()}>
					Cancel
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.challenge-banner {
		background: var(--color-surface);
		border: 1px solid var(--color-warning);
		border-radius: 8px;
		margin: 0.5rem 1rem;
		overflow: hidden;
	}

	.banner-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.625rem 0.875rem;
		background: none;
		border: none;
		color: var(--color-warning);
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		text-align: left;
	}

	.warning-icon {
		font-size: 1rem;
	}

	.title {
		flex: 1;
	}

	.toggle {
		opacity: 0.6;
	}

	.banner-body {
		padding: 0 0.875rem 0.875rem;
	}

	.section {
		margin-bottom: 0.75rem;
	}

	.section h4 {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.25rem;
	}

	.section p,
	.section li {
		font-size: 0.8125rem;
		color: var(--color-text);
		line-height: 1.4;
	}

	.section ul {
		list-style: disc;
		padding-left: 1.25rem;
	}

	.factors-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	.factors-table th {
		text-align: left;
		font-size: 0.6875rem;
		color: var(--color-text-muted);
		padding: 0.25rem 0.5rem;
		border-bottom: 1px solid var(--color-border);
	}

	.factors-table td {
		padding: 0.375rem 0.5rem;
		border-bottom: 1px solid var(--color-border);
	}

	.factor-name {
		font-weight: 500;
		white-space: nowrap;
	}

	.weight-bar {
		width: 60px;
		height: 6px;
		background: var(--color-border);
		border-radius: 3px;
		overflow: hidden;
		display: inline-block;
		vertical-align: middle;
	}

	.weight-fill {
		height: 100%;
		background: var(--color-warning);
		border-radius: 3px;
	}

	.weight-label {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
		margin-left: 0.375rem;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.btn {
		padding: 0.375rem 0.75rem;
		border-radius: 6px;
		font-size: 0.8125rem;
		font-weight: 500;
		border: none;
		cursor: pointer;
	}

	.btn-warning {
		background: var(--color-warning);
		color: #000;
	}

	.btn-secondary {
		background: var(--color-accent);
		color: #fff;
	}

	.btn-neutral {
		background: var(--color-border);
		color: var(--color-text);
	}
</style>
