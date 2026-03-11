<script>
/**
 * @type {{
 *   history: readonly import('../stores/challenges.js').ActiveChallenge[],
 *   stats: import('../stores/challenge-stats.js').ChallengeStats
 * }}
 */
const { history, stats } = $props();
</script>

<div class="challenge-history">
	<!-- Stats Summary -->
	<div class="stats-grid">
		<div class="stat-card">
			<span class="stat-value">{stats.totalChallenges}</span>
			<span class="stat-label">Total Challenges</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{stats.thisWeek}</span>
			<span class="stat-label">This Week</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{stats.thisMonth}</span>
			<span class="stat-label">This Month</span>
		</div>
		<div class="stat-card">
			<span class="stat-value trend-{stats.recentTrend}">{stats.recentTrend}</span>
			<span class="stat-label">Trend</span>
		</div>
	</div>

	<!-- Decision Breakdown -->
	{#if Object.keys(stats.byDecision).length > 0}
		<div class="breakdown-section">
			<h4>Decisions</h4>
			<div class="breakdown-bars">
				{#each Object.entries(stats.byDecision) as [decision, count]}
					<div class="bar-row">
						<span class="bar-label decision-{decision}">{decision}</span>
						<div class="bar-track">
							<div
								class="bar-fill decision-fill-{decision}"
								style="width: {stats.resolvedCount > 0 ? (count / stats.resolvedCount * 100) : 0}%"
							></div>
						</div>
						<span class="bar-count">{count}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Layer Breakdown -->
	{#if Object.keys(stats.byLayer).length > 0}
		<div class="breakdown-section">
			<h4>By Safety Layer</h4>
			<div class="breakdown-bars">
				{#each Object.entries(stats.byLayer) as [layer, count]}
					<div class="bar-row">
						<span class="bar-label">Layer {layer}</span>
						<div class="bar-track">
							<div
								class="bar-fill"
								style="width: {stats.totalChallenges > 0 ? (count / stats.totalChallenges * 100) : 0}%"
							></div>
						</div>
						<span class="bar-count">{count}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Top Trigger Factors -->
	{#if stats.topTriggerFactors.length > 0}
		<div class="breakdown-section">
			<h4>Most Common Triggers</h4>
			<div class="factor-list">
				{#each stats.topTriggerFactors as factor}
					<div class="factor-row">
						<span class="factor-name">{factor.name}</span>
						<span class="factor-count">{factor.count}x</span>
						<span class="factor-weight">avg weight: {factor.avgWeight.toFixed(2)}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- History List -->
	<div class="history-section">
		<h4>Challenge History ({history.length})</h4>
		<div class="history-list">
			{#each history as challenge}
				<div class="history-entry" class:resolved={challenge.decision}>
					<div class="entry-header">
						<span class="entry-layer">Layer {challenge.payload?.layer}</span>
						<span class="entry-time">{new Date(challenge.receivedAt).toLocaleString()}</span>
						{#if challenge.decision}
							<span class="entry-decision decision-{challenge.decision}">{challenge.decision}</span>
						{:else}
							<span class="entry-decision pending">pending</span>
						{/if}
					</div>
					<div class="entry-reason">{challenge.payload?.reason}</div>
					{#if challenge.payload?.factors?.length > 0}
						<div class="entry-factors">
							{#each challenge.payload.factors as factor}
								<span class="factor-tag">{factor.name} ({factor.weight.toFixed(1)})</span>
							{/each}
						</div>
					{/if}
				</div>
			{:else}
				<div class="empty">No challenges recorded</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.challenge-history {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.75rem;
	}

	.stat-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 1rem;
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.stat-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-text);
	}

	.stat-label {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.trend-increasing { color: var(--color-warning); }
	.trend-stable { color: var(--color-success); }
	.trend-decreasing { color: var(--color-accent-hover); }

	.breakdown-section {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 1rem;
	}

	.breakdown-section h4 {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		margin-bottom: 0.75rem;
	}

	.breakdown-bars {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.bar-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.bar-label {
		width: 80px;
		font-size: 0.8rem;
		font-weight: 500;
		text-transform: capitalize;
	}

	.bar-track {
		flex: 1;
		height: 8px;
		background: var(--color-bg);
		border-radius: 4px;
		overflow: hidden;
	}

	.bar-fill {
		height: 100%;
		background: var(--color-accent);
		border-radius: 4px;
		transition: width 0.3s ease;
	}

	.bar-count {
		font-size: 0.8rem;
		font-family: var(--font-mono);
		color: var(--color-text-muted);
		width: 30px;
		text-align: right;
	}

	.decision-approve { color: var(--color-success); }
	.decision-modify { color: var(--color-warning); }
	.decision-cancel { color: var(--color-text-muted); }
	.decision-fill-approve { background: var(--color-success); }
	.decision-fill-modify { background: var(--color-warning); }
	.decision-fill-cancel { background: var(--color-text-muted); }

	.factor-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.factor-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.8rem;
	}

	.factor-name {
		font-weight: 500;
		color: var(--color-text);
	}

	.factor-count {
		font-family: var(--font-mono);
		color: var(--color-accent-hover);
	}

	.factor-weight {
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}

	.history-section h4 {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		margin-bottom: 0.75rem;
	}

	.history-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.history-entry {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.history-entry.resolved {
		opacity: 0.85;
	}

	.entry-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.8rem;
	}

	.entry-layer {
		font-weight: 600;
		color: var(--color-warning);
	}

	.entry-time {
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}

	.entry-decision {
		margin-left: auto;
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
	}

	.entry-decision.pending {
		background: color-mix(in srgb, var(--color-warning) 20%, transparent);
		color: var(--color-warning);
	}

	.entry-reason {
		font-size: 0.85rem;
		color: var(--color-text);
	}

	.entry-factors {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.factor-tag {
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		font-size: 0.7rem;
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent-hover);
	}

	.empty {
		text-align: center;
		padding: 2rem;
		color: var(--color-text-muted);
	}
</style>
