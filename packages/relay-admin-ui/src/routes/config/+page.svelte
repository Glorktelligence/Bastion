<script>
// System Configuration — Task 3.11
// Relay settings, safety floors, TLS status, audit chain integrity

import { onMount } from 'svelte';
import ConfigPanel from '$lib/components/ConfigPanel.svelte';
import { createConfigStore } from '$lib/stores/config.js';
import { createSharedService } from '$lib/api/service-instance.js';

const config = createConfigStore();
const service = createSharedService();

/** @type {import('$lib/stores/config.js').ConfigState} */
let state = $state(config.store.get());

/** @type {boolean} */
let tlsHealthy = $state(config.tlsHealthy.get());

/** @type {boolean} */
let chainHealthy = $state(config.chainHealthy.get());

/** @type {boolean} */
let systemHealthy = $state(config.systemHealthy.get());

onMount(() => {
	const unsub1 = config.store.subscribe((s) => { state = s; });
	const unsub2 = config.tlsHealthy.subscribe((h) => { tlsHealthy = h; });
	const unsub3 = config.chainHealthy.subscribe((h) => { chainHealthy = h; });
	const unsub4 = config.systemHealthy.subscribe((h) => { systemHealthy = h; });

	// Fetch config/integrity from the admin API
	service.fetchConfig(config);

	return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
});

/** @type {{ label: string, value: string | number | boolean }[]} */
let relayFields = $derived([
	{ label: 'Host', value: state.relaySettings.host },
	{ label: 'Port', value: state.relaySettings.port },
	{ label: 'Admin Port', value: state.relaySettings.adminPort },
	{ label: 'Max Connections', value: state.relaySettings.maxConnections },
	{ label: 'Heartbeat Interval', value: `${state.relaySettings.heartbeatIntervalMs / 1000}s` },
	{ label: 'Heartbeat Timeout', value: `${state.relaySettings.heartbeatTimeoutMs / 1000}s` },
]);

/** @type {{ label: string, value: string | number | boolean }[]} */
let safetyFields = $derived([
	{ label: 'Challenge Threshold', value: state.safetyFloors.challengeThreshold },
	{ label: 'Denial Threshold', value: state.safetyFloors.denialThreshold },
	{ label: 'Max Risk Score', value: state.safetyFloors.maxRiskScore },
]);

/** @type {{ label: string, value: string | number | boolean }[]} */
let tlsFields = $derived([
	{ label: 'Enabled', value: state.tlsStatus.enabled },
	{ label: 'Certificate Expiry', value: state.tlsStatus.certExpiry ?? '\u2014' },
	{ label: 'Protocol', value: state.tlsStatus.protocol },
	{ label: 'Cipher', value: state.tlsStatus.cipher },
]);

/** @type {{ label: string, value: string | number | boolean }[]} */
let auditFields = $derived([
	{ label: 'Total Entries', value: state.auditChainIntegrity.totalEntries },
	{ label: 'Chain Valid', value: state.auditChainIntegrity.chainValid },
	{ label: 'Last Verified', value: state.auditChainIntegrity.lastVerifiedAt ?? '\u2014' },
]);

// --- AI Disclosure Banner config ---
let discEnabled = $state(false);
let discText = $state('You are interacting with an AI system powered by {provider} ({model}).');
let discStyle = $state('info');
let discPosition = $state('banner');
let discDismissible = $state(true);
let discLink = $state('');
let discLinkText = $state('');
let discJurisdiction = $state('');
let discSaving = $state(false);
let discSaved = $state(false);
let discError = $state('');

// Fetch current disclosure config on mount
onMount(() => {
	fetch('/api/disclosure').then(r => r.json()).then(data => {
		if (data.enabled !== undefined) discEnabled = data.enabled;
		if (data.text) discText = data.text;
		if (data.style) discStyle = data.style;
		if (data.position) discPosition = data.position;
		if (data.dismissible !== undefined) discDismissible = data.dismissible;
		if (data.link) discLink = data.link;
		if (data.linkText) discLinkText = data.linkText;
		if (data.jurisdiction) discJurisdiction = data.jurisdiction;
	}).catch(() => {});
});

async function saveDisclosure() {
	discSaving = true;
	discError = '';
	discSaved = false;
	try {
		const body = {
			enabled: discEnabled, text: discText, style: discStyle,
			position: discPosition, dismissible: discDismissible,
			link: discLink || undefined, linkText: discLinkText || undefined,
			jurisdiction: discJurisdiction || undefined,
		};
		const res = await fetch('/api/disclosure', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			discError = err.error || `HTTP ${res.status}`;
		} else {
			discSaved = true;
			setTimeout(() => { discSaved = false; }, 3000);
		}
	} catch (e) {
		discError = e instanceof Error ? e.message : String(e);
	} finally {
		discSaving = false;
	}
}

const DISC_STYLE_COLORS = { info: '#3b82f6', legal: '#6b7280', warning: '#f59e0b' };
const DISC_STYLE_ICONS = { info: 'ℹ️', legal: '🤖', warning: '⚠️' };
</script>

<div class="config-page">
	<h2>System Configuration</h2>

	{#if state.loading}
		<p class="loading">Loading...</p>
	{/if}

	{#if state.error}
		<p class="error">{state.error}</p>
	{/if}

	{#if !systemHealthy}
		<div class="health-warning">
			System health: degraded
			{#if !tlsHealthy} &mdash; TLS not configured{/if}
			{#if !chainHealthy} &mdash; Audit chain integrity issue{/if}
		</div>
	{/if}

	<div class="config-grid">
		<ConfigPanel title="Relay Settings" fields={relayFields} />
		<div>
			<ConfigPanel title="Safety Floors" fields={safetyFields} />
			<p class="note">Safety floors can be tightened but never lowered below factory defaults.</p>
		</div>
		<ConfigPanel title="TLS Status" fields={tlsFields} />
		<ConfigPanel title="Audit Chain Integrity" fields={auditFields} />
	</div>

	<!-- AI Disclosure Banner Configuration -->
	<div class="disclosure-section">
		<h3>AI Disclosure Banner</h3>
		<p class="note">Regulatory transparency banner (EU AI Act Article 50, etc.). Default: OFF — deployers opt in.</p>

		<div class="disc-form">
			<label class="disc-toggle">
				<input type="checkbox" bind:checked={discEnabled} />
				<span>Enabled</span>
			</label>

			<label>
				<span class="disc-label">Text</span>
				<textarea class="disc-input" bind:value={discText} rows="3" placeholder={'Use {provider} and {model} for dynamic substitution'}></textarea>
			</label>

			<label>
				<span class="disc-label">Style</span>
				<select class="disc-input" bind:value={discStyle}>
					<option value="info">Info (blue)</option>
					<option value="legal">Legal (grey)</option>
					<option value="warning">Warning (amber)</option>
				</select>
			</label>

			<label>
				<span class="disc-label">Position</span>
				<select class="disc-input" bind:value={discPosition}>
					<option value="banner">Banner (top of chat)</option>
					<option value="footer">Footer (bottom of chat)</option>
				</select>
			</label>

			<label class="disc-toggle">
				<input type="checkbox" bind:checked={discDismissible} />
				<span>Dismissible</span>
			</label>

			<label>
				<span class="disc-label">Link URL (optional)</span>
				<input type="text" class="disc-input" bind:value={discLink} placeholder="https://example.com/ai-policy" />
			</label>

			<label>
				<span class="disc-label">Link text (optional)</span>
				<input type="text" class="disc-input" bind:value={discLinkText} placeholder="Learn more about our AI system" />
			</label>

			<label>
				<span class="disc-label">Jurisdiction (optional — for audit trail)</span>
				<input type="text" class="disc-input" bind:value={discJurisdiction} placeholder="EU AI Act Article 50" />
			</label>

			<!-- Preview -->
			{#if discEnabled}
				<div class="disc-preview" style="background: color-mix(in srgb, {DISC_STYLE_COLORS[discStyle] ?? '#3b82f6'} 12%, transparent); border-left: 3px solid {DISC_STYLE_COLORS[discStyle] ?? '#3b82f6'};">
					<span>{DISC_STYLE_ICONS[discStyle] ?? 'ℹ️'}</span>
					<span>{discText.replace(/\{provider\}/g, 'Anthropic').replace(/\{model\}/g, 'Claude 3.5 Sonnet')}</span>
					{#if discLink && discLinkText}
						<a href={discLink} target="_blank" rel="noopener noreferrer" style="color: {DISC_STYLE_COLORS[discStyle] ?? '#3b82f6'}; margin-left: 0.5rem;">{discLinkText}</a>
					{/if}
					{#if discDismissible}
						<span style="margin-left:auto;opacity:0.5;cursor:pointer;">×</span>
					{/if}
				</div>
			{/if}

			{#if discError}
				<p class="error">{discError}</p>
			{/if}

			<button class="disc-save" onclick={saveDisclosure} disabled={discSaving}>
				{discSaving ? 'Saving...' : discSaved ? 'Saved!' : 'Save Disclosure Config'}
			</button>
		</div>
	</div>
</div>

<style>
	.config-page h2 {
		margin-bottom: 1.5rem;
		font-size: 1.5rem;
	}

	.config-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 1.5rem;
	}

	.note {
		margin-top: 0.75rem;
		font-size: 0.75rem;
		color: var(--text-muted);
		font-style: italic;
	}

	.health-warning {
		background: color-mix(in srgb, var(--status-warning) 15%, transparent);
		color: var(--status-warning);
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		margin-bottom: 1.5rem;
	}

	.loading {
		color: var(--text-muted);
		font-style: italic;
		margin-bottom: 1rem;
	}

	.error {
		color: var(--status-error);
		margin-bottom: 1rem;
	}

	/* AI Disclosure */
	.disclosure-section { margin-top: 2rem; }
	.disclosure-section h3 { font-size: 1.125rem; margin-bottom: 0.5rem; }
	.disc-form { display: flex; flex-direction: column; gap: 0.75rem; max-width: 600px; }
	.disc-label { display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem; }
	.disc-input {
		width: 100%; padding: 0.375rem 0.5rem; font-size: 0.85rem;
		border: 1px solid var(--border-default); border-radius: 0.375rem;
		background: var(--bg-surface); color: var(--text-primary); font-family: inherit;
	}
	.disc-input:focus { border-color: var(--accent-primary); outline: none; }
	.disc-toggle { display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; cursor: pointer; }
	.disc-preview {
		display: flex; align-items: center; gap: 0.5rem; padding: 0.625rem 0.75rem;
		border-radius: 0.375rem; font-size: 0.85rem; color: var(--text-primary);
	}
	.disc-save {
		align-self: flex-start; padding: 0.375rem 1rem; border-radius: 0.375rem;
		border: none; background: var(--accent-primary); color: #fff;
		font-size: 0.85rem; cursor: pointer;
	}
	.disc-save:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
