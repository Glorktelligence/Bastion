<script>
const _defaultSettings = {
  challengeThreshold: 0.6,
  denialThreshold: 0.9,
  timeOfDayWeight: 1.5,
  irreversibleAlwaysChallenge: true,
  fileQuarantineEnabled: true,
  patternDeviationSensitivity: 'low',
  gracePeriodMs: 300000,
  auditRetentionDays: 365,
  highRiskHoursStart: 0,
  highRiskHoursEnd: 6,
};

const _isAtFloor = {
  challengeThreshold: true,
  denialThreshold: true,
  timeOfDayWeight: false,
  irreversibleAlwaysChallenge: true,
  fileQuarantineEnabled: true,
  patternDeviationSensitivity: true,
  gracePeriodMs: false,
  auditRetentionDays: false,
  highRiskHoursStart: true,
  highRiskHoursEnd: true,
};
</script>

<div class="settings-page">
	<header class="page-header">
		<h2>Safety Settings</h2>
		<p class="subtitle">Tighten safety controls — restrictions can be increased but never lowered below factory floors.</p>
	</header>

	<SettingsPanel
		settings={defaultSettings}
		floors={SAFETY_FLOOR_VALUES}
		{isAtFloor}
		dirty={false}
		error={null}
	/>
</div>

<style>
	.settings-page {
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
