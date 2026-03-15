<script lang="ts">
import * as session from '$lib/session.js';
import type { SafetySettings, SettingUpdateResult } from '$lib/stores/settings.js';
import SettingsPanel from '$lib/components/SettingsPanel.svelte';

// ---------------------------------------------------------------------------
// Reactive state from shared session stores
// ---------------------------------------------------------------------------

let currentSettings: SafetySettings = $state(session.settings.store.get().settings);
let dirty = $state(false);
let error: string | null = $state(null);
let floorValues: SafetySettings = $state(session.SAFETY_FLOOR_VALUES);
let isAtFloor: Record<keyof SafetySettings, boolean> = $state(session.settings.isAtFloor.get());

$effect(() => {
	const unsubs = [
		session.settings.store.subscribe((v) => {
			currentSettings = v.settings;
			dirty = v.dirty;
			error = v.error;
		}),
		session.settings.floorValues.subscribe((v) => (floorValues = v)),
		session.settings.isAtFloor.subscribe((v) => (isAtFloor = v)),
	];

	return () => {
		for (const u of unsubs) u();
	};
});

// ---------------------------------------------------------------------------
// Interactive callbacks
// ---------------------------------------------------------------------------

function handleSettingChange(key: string, value: unknown): void {
	const result: SettingUpdateResult = session.settings.tryUpdate(key as keyof SafetySettings, value);
	if (!result.ok) {
		console.warn(`[Settings] Rejected: ${result.reason}`);
	}
}

function handleSave(): void {
	session.settings.markSaved();
}

function handleReset(): void {
	session.settings.resetToDefaults();
}
</script>

<div class="settings-page">
	<header class="page-header">
		<h2>Safety Settings</h2>
		<p class="subtitle">Tighten safety controls — restrictions can be increased but never lowered below factory floors.</p>
	</header>

	<SettingsPanel
		settings={currentSettings}
		floors={floorValues}
		{isAtFloor}
		{dirty}
		{error}
		onSettingChange={handleSettingChange}
		onSave={handleSave}
		onReset={handleReset}
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
