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
let userContext: string = $state(session.settings.store.get().userContext);
let contextSaving = $state(false);
let contextSaved = $state(false);

$effect(() => {
	const unsubs = [
		session.settings.store.subscribe((v) => {
			currentSettings = v.settings;
			dirty = v.dirty;
			error = v.error;
			userContext = v.userContext;
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

function handleContextSave(): void {
	const client = session.getClient();
	if (!client) return;
	contextSaving = true;
	client.send(JSON.stringify({
		type: 'context_update',
		id: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		sender: session.IDENTITY,
		payload: { content: userContext },
	}));
	session.settings.setUserContext(userContext);
	contextSaving = false;
	contextSaved = true;
	setTimeout(() => { contextSaved = false; }, 2000);
}
</script>

<div class="settings-page">
	<header class="page-header">
		<h2>Settings</h2>
		<p class="subtitle">Safety controls, personal context, and connection identity.</p>
	</header>

	<section class="section">
		<h3>Connection</h3>
		<div class="info-grid">
			<span class="label">Relay URL</span>
			<code class="value">{session.RELAY_URL}</code>
			<span class="label">User ID</span>
			<code class="value">{session.IDENTITY.id}</code>
			<span class="label">Display Name</span>
			<code class="value">{session.IDENTITY.displayName}</code>
		</div>
		<p class="hint">Override via globalThis.__BASTION_RELAY_URL__, __BASTION_USER_ID__, __BASTION_USER_NAME__</p>
	</section>

	<section class="section">
		<h3>Personal Context</h3>
		<p class="hint">This text is sent to the AI client and injected below the immutable role context in the system prompt. It is informative, not authoritative — it cannot override safety rules.</p>
		<textarea
			class="context-textarea"
			bind:value={userContext}
			placeholder="e.g. I'm a sysadmin managing the Naval Fleet infrastructure. I prefer concise answers with command examples."
			rows="5"
		></textarea>
		<div class="context-actions">
			<button class="btn-save" onclick={handleContextSave} disabled={contextSaving || !session.getClient()}>
				{contextSaving ? 'Saving...' : contextSaved ? 'Saved' : 'Save Context'}
			</button>
			{#if !session.getClient()}
				<span class="hint">Connect to relay first</span>
			{/if}
		</div>
	</section>

	<section class="section">
		<h3>Safety Controls</h3>
		<p class="hint">Restrictions can be increased but never lowered below factory floors.</p>
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
	</section>
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

	.page-header h2 { font-size: 1.25rem; color: var(--color-text); }
	.subtitle { font-size: 0.85rem; color: var(--color-text-muted); margin-top: 0.25rem; }

	.section {
		background: var(--color-bg-secondary, #1a1a2e);
		border: 1px solid var(--color-border, #2a2a4a);
		border-radius: 0.5rem;
		padding: 1.25rem;
	}
	.section h3 { font-size: 1rem; margin-bottom: 0.75rem; color: var(--color-text); }

	.info-grid {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.375rem 1rem;
		font-size: 0.85rem;
	}
	.label { color: var(--color-text-muted); }
	.value { color: var(--color-text); font-size: 0.8rem; }

	.hint { font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.5rem; }

	.context-textarea {
		width: 100%;
		resize: vertical;
		padding: 0.5rem;
		font-family: monospace;
		font-size: 0.85rem;
		border: 1px solid var(--color-border, #2a2a4a);
		border-radius: 0.25rem;
		background: var(--color-bg, #0f0f23);
		color: var(--color-text);
		margin-top: 0.5rem;
	}

	.context-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}

	.btn-save {
		background: var(--color-accent, #4a9eff);
		color: white;
		border: none;
		padding: 0.375rem 0.75rem;
		border-radius: 0.25rem;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
