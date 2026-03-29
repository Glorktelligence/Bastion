<script lang="ts">
import { onMount } from 'svelte';
import * as session from '$lib/session.js';
import type { ActiveChallenge } from '$lib/stores/challenges.js';
import type { ChallengeStats } from '$lib/stores/challenge-stats.js';
import ChallengeHistory from '$lib/components/ChallengeHistory.svelte';

// ---------------------------------------------------------------------------
// Reactive state from shared session stores
// ---------------------------------------------------------------------------

let history: readonly ActiveChallenge[] = $state([]);
let stats: ChallengeStats = $state({
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
});

// Use onMount (NOT $effect) to set up store subscriptions.
// See +layout.svelte for detailed explanation of the reactive loop issue.
onMount(() => {
	const unsubs = [
		session.challenges.store.subscribe((v) => (history = v.history)),
		session.challengeStats.subscribe((v) => (stats = v)),
	];

	return () => {
		for (const u of unsubs) u();
	};
});
</script>

<div class="challenges-page">
	<header class="page-header">
		<h2>Challenge History</h2>
		<p class="subtitle">Past safety challenges — decisions, trigger factors, and aggregate statistics.</p>
	</header>

	<ChallengeHistory {history} {stats} />
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
