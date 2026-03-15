<script>
/**
 * @type {{
 *   settings: import('../stores/settings.js').SafetySettings,
 *   floors: import('../stores/settings.js').SafetySettings,
 *   isAtFloor: Record<string, boolean>,
 *   dirty: boolean,
 *   error: string | null,
 *   onSettingChange?: (key: string, value: unknown) => void,
 *   onSave?: () => void,
 *   onReset?: () => void
 * }}
 */
const { settings, floors, isAtFloor, dirty, error, onSettingChange, onSave, onReset } = $props();
</script>

<div class="settings-panel">
	{#if error}
		<div class="error-banner">{error}</div>
	{/if}

	<section class="settings-section">
		<h3>Risk Thresholds</h3>
		<p class="section-desc">Lower values are stricter — challenges/denials trigger at lower risk scores.</p>

		<div class="setting-row">
			<div class="setting-info">
				<label for="setting-challengeThreshold">Challenge Threshold</label>
				<span class="floor-label">Floor: {floors.challengeThreshold}</span>
			</div>
			<div class="setting-control">
				<input id="setting-challengeThreshold" type="range" min="0" max={floors.challengeThreshold} step="0.05" value={settings.challengeThreshold} oninput={(e) => onSettingChange?.('challengeThreshold', parseFloat(e.currentTarget.value))} />
				<span class="value-display" class:at-floor={isAtFloor.challengeThreshold}>{settings.challengeThreshold}</span>
			</div>
		</div>

		<div class="setting-row">
			<div class="setting-info">
				<label for="setting-denialThreshold">Denial Threshold</label>
				<span class="floor-label">Floor: {floors.denialThreshold}</span>
			</div>
			<div class="setting-control">
				<input id="setting-denialThreshold" type="range" min="0" max={floors.denialThreshold} step="0.05" value={settings.denialThreshold} oninput={(e) => onSettingChange?.('denialThreshold', parseFloat(e.currentTarget.value))} />
				<span class="value-display" class:at-floor={isAtFloor.denialThreshold}>{settings.denialThreshold}</span>
			</div>
		</div>
	</section>

	<section class="settings-section">
		<h3>Behaviour Controls</h3>

		<div class="setting-row">
			<div class="setting-info">
				<label for="setting-timeOfDayWeight">Time-of-Day Weight</label>
				<span class="floor-label">Floor: {floors.timeOfDayWeight}</span>
			</div>
			<div class="setting-control">
				<input id="setting-timeOfDayWeight" type="range" min={floors.timeOfDayWeight} max="3.0" step="0.1" value={settings.timeOfDayWeight} oninput={(e) => onSettingChange?.('timeOfDayWeight', parseFloat(e.currentTarget.value))} />
				<span class="value-display">{settings.timeOfDayWeight}x</span>
			</div>
		</div>

		<div class="setting-row">
			<div class="setting-info">
				<label for="setting-patternSensitivity">Pattern Deviation Sensitivity</label>
				<span class="floor-label">Floor: {floors.patternDeviationSensitivity}</span>
			</div>
			<div class="setting-control">
				<select id="setting-patternSensitivity" value={settings.patternDeviationSensitivity} onchange={(e) => onSettingChange?.('patternDeviationSensitivity', e.currentTarget.value)}>
					<option value="low">Low</option>
					<option value="medium">Medium</option>
					<option value="high">High</option>
				</select>
			</div>
		</div>

		<div class="setting-row">
			<div class="setting-info">
				<label for="setting-gracePeriod">Grace Period</label>
				<span class="floor-label">Floor: {floors.gracePeriodMs / 60000} min</span>
			</div>
			<div class="setting-control">
				<input id="setting-gracePeriod" type="range" min={floors.gracePeriodMs / 60000} max="30" step="1" value={settings.gracePeriodMs / 60000} oninput={(e) => onSettingChange?.('gracePeriodMs', parseFloat(e.currentTarget.value) * 60000)} />
				<span class="value-display">{settings.gracePeriodMs / 60000} min</span>
			</div>
		</div>

		<div class="setting-row">
			<div class="setting-info">
				<label for="setting-auditRetention">Audit Retention</label>
				<span class="floor-label">Floor: {floors.auditRetentionDays} days</span>
			</div>
			<div class="setting-control">
				<input id="setting-auditRetention" type="number" min={floors.auditRetentionDays} max="3650" value={settings.auditRetentionDays} onchange={(e) => onSettingChange?.('auditRetentionDays', parseInt(e.currentTarget.value, 10))} />
				<span class="value-display">{settings.auditRetentionDays} days</span>
			</div>
		</div>
	</section>

	<section class="settings-section">
		<h3>Locked Settings</h3>
		<p class="section-desc">These safety features cannot be disabled.</p>

		<div class="setting-row locked">
			<div class="setting-info">
				<span class="setting-label">Irreversible Action Always Challenge</span>
			</div>
			<div class="setting-control">
				<span class="locked-badge">Locked ON</span>
			</div>
		</div>

		<div class="setting-row locked">
			<div class="setting-info">
				<span class="setting-label">File Quarantine Enabled</span>
			</div>
			<div class="setting-control">
				<span class="locked-badge">Locked ON</span>
			</div>
		</div>
	</section>

	{#if dirty}
		<div class="save-bar">
			<span class="unsaved">Unsaved changes</span>
			<div class="save-actions">
				{#if onReset}
					<button class="reset-btn" onclick={onReset}>Reset to Defaults</button>
				{/if}
				<button class="save-btn" onclick={() => onSave?.()}>Save Settings</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.settings-panel {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.error-banner {
		padding: 0.75rem 1rem;
		background: color-mix(in srgb, var(--color-error) 15%, transparent);
		border: 1px solid var(--color-error);
		border-radius: 6px;
		color: var(--color-error);
		font-size: 0.85rem;
	}

	.settings-section {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 1.25rem;
	}

	.settings-section h3 {
		font-size: 1rem;
		margin-bottom: 0.25rem;
		color: var(--color-text);
	}

	.section-desc {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin-bottom: 1rem;
	}

	.setting-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 0;
		border-bottom: 1px solid color-mix(in srgb, var(--color-border) 50%, transparent);
	}

	.setting-row:last-child {
		border-bottom: none;
	}

	.setting-info {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.setting-info label,
	.setting-info .setting-label {
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.floor-label {
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.setting-control {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.setting-control input[type="range"] {
		width: 150px;
		accent-color: var(--color-accent);
	}

	.setting-control input[type="number"] {
		width: 80px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		color: var(--color-text);
		font-size: 0.85rem;
	}

	.setting-control select {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		padding: 0.375rem 0.5rem;
		color: var(--color-text);
		font-size: 0.85rem;
	}

	.value-display {
		font-family: var(--font-mono);
		font-size: 0.85rem;
		min-width: 4rem;
		text-align: right;
		color: var(--color-accent-hover);
	}

	.value-display.at-floor {
		color: var(--color-text-muted);
	}

	.locked-badge {
		padding: 0.2rem 0.6rem;
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: 600;
		background: color-mix(in srgb, var(--color-success) 15%, transparent);
		color: var(--color-success);
	}

	.save-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-accent);
		border-radius: 8px;
	}

	.unsaved {
		font-size: 0.85rem;
		color: var(--color-warning);
	}

	.save-actions {
		display: flex;
		gap: 0.5rem;
	}

	.reset-btn {
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 1rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.reset-btn:hover {
		border-color: var(--color-text-muted);
	}

	.save-btn {
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 6px;
		padding: 0.5rem 1.25rem;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
	}

	.save-btn:hover {
		background: var(--color-accent-hover);
	}
</style>
