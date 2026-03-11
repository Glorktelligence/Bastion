<script>
const _emptyStats = {
  totalChallenges: 0,
  resolvedCount: 0,
  pendingCount: 0,
  thisWeek: 0,
  thisMonth: 0,
  byLayer: {},
  byDecision: {},
  topTriggerFactors: [],
  averageFactorsPerChallenge: 0,
  recentTrend: 'stable',
};
</script>

<div class="challenges-page">
	<header class="page-header">
		<h2>Challenge History</h2>
		<p class="subtitle">Past safety challenges — decisions, trigger factors, and aggregate statistics.</p>
	</header>

	<ChallengeHistory history={[]} stats={emptyStats} />
</div>

<style>
	.challenges-page {
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
