<script>
// System Configuration — Tabbed interface for operator deep-dive
// Tabs: Relay | Providers | Security | Challenge | Disclosure

import { onMount } from 'svelte';
import ConfigPanel from '$lib/components/ConfigPanel.svelte';
import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
import { createConfigStore } from '$lib/stores/config.js';
import { createSharedService } from '$lib/api/service-instance.js';

const TABS = ['Relay', 'Providers', 'Security', 'Challenge', 'Disclosure'];
let activeTab = $state('Relay');

const config = createConfigStore();
const service = createSharedService();

/** @type {import('$lib/stores/config.js').ConfigState} */
let state = $state(config.store.get());
let tlsHealthy = $state(config.tlsHealthy.get());
let chainHealthy = $state(config.chainHealthy.get());
let systemHealthy = $state(config.systemHealthy.get());

// Provider/adapter data from status endpoint
let adapterList = $state([]);

onMount(() => {
	const unsub1 = config.store.subscribe((s) => { state = s; });
	const unsub2 = config.tlsHealthy.subscribe((h) => { tlsHealthy = h; });
	const unsub3 = config.chainHealthy.subscribe((h) => { chainHealthy = h; });
	const unsub4 = config.systemHealthy.subscribe((h) => { systemHealthy = h; });
	service.fetchConfig(config);

	// Fetch provider info for Providers tab
	service.client.listProviders().then(result => {
		if (result.ok && result.data?.providers) {
			providerList = result.data.providers;
		}
	});

	return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
});

let relayFields = $derived([
	{ label: 'Host', value: state.relaySettings.host },
	{ label: 'Port', value: state.relaySettings.port },
	{ label: 'Admin Port', value: state.relaySettings.adminPort },
	{ label: 'Max Connections', value: state.relaySettings.maxConnections },
	{ label: 'Heartbeat Interval', value: `${state.relaySettings.heartbeatIntervalMs / 1000}s` },
	{ label: 'Heartbeat Timeout', value: `${state.relaySettings.heartbeatTimeoutMs / 1000}s` },
]);

let safetyFields = $derived([
	{ label: 'Challenge Threshold', value: state.safetyFloors.challengeThreshold },
	{ label: 'Denial Threshold', value: state.safetyFloors.denialThreshold },
	{ label: 'Max Risk Score', value: state.safetyFloors.maxRiskScore },
]);

let tlsFields = $derived([
	{ label: 'Enabled', value: state.tlsStatus.enabled },
	{ label: 'Certificate Expiry', value: state.tlsStatus.certExpiry ?? '\u2014' },
	{ label: 'Protocol', value: state.tlsStatus.protocol },
	{ label: 'Cipher', value: state.tlsStatus.cipher },
]);

let auditFields = $derived([
	{ label: 'Total Entries', value: state.auditChainIntegrity.totalEntries },
	{ label: 'Chain Valid', value: state.auditChainIntegrity.chainValid },
	{ label: 'Last Verified', value: state.auditChainIntegrity.lastVerifiedAt ?? '\u2014' },
]);

// --- Provider list ---
let providerList = $state([]);

// --- Challenge Me More config ---
let chalActive = $state(false);
let chalTimezone = $state('');
let chalWeekdayStart = $state('22:00');
let chalWeekdayEnd = $state('06:00');
let chalWeekendStart = $state('23:00');
let chalWeekendEnd = $state('08:00');
let chalBudgetDays = $state(7);
let chalScheduleDays = $state(7);
let chalToolDays = $state(1);
let chalLastChange = $state('');
let chalNote = $state('');
let chalSaving = $state(false);
let chalSaved = $state(false);
let chalError = $state('');
let chalLoaded = $state(false);

onMount(() => {
	service.client.getChallengeStatus().then(result => {
		if (!result.ok) return;
		const d = result.data;
		chalActive = Boolean(d.active);
		chalTimezone = d.timezone || '';
		if (d.schedule) {
			chalWeekdayStart = d.schedule.weekdays?.start || '22:00';
			chalWeekdayEnd = d.schedule.weekdays?.end || '06:00';
			chalWeekendStart = d.schedule.weekends?.start || '23:00';
			chalWeekendEnd = d.schedule.weekends?.end || '08:00';
		}
		if (d.cooldowns) {
			chalBudgetDays = d.cooldowns.budgetChangeDays ?? 7;
			chalScheduleDays = d.cooldowns.scheduleChangeDays ?? 7;
			chalToolDays = d.cooldowns.toolRegistrationDays ?? 1;
		}
		if (d.lastChanges?.schedule_change) chalLastChange = d.lastChanges.schedule_change;
		if (d.note) chalNote = d.note;
		chalLoaded = true;
	});
});

async function saveChallengeConfig() {
	chalSaving = true;
	chalError = '';
	chalSaved = false;
	try {
		const result = await service.client.updateChallengeConfig(
			{ weekdays: { start: chalWeekdayStart, end: chalWeekdayEnd }, weekends: { start: chalWeekendStart, end: chalWeekendEnd } },
			{ budgetChangeDays: chalBudgetDays, scheduleChangeDays: chalScheduleDays, toolRegistrationDays: chalToolDays },
		);
		if (!result.ok) {
			chalError = result.data?.error || result.error || `HTTP ${result.status}`;
		} else {
			chalSaved = true;
			setTimeout(() => { chalSaved = false; }, 3000);
		}
	} catch (e) {
		chalError = e instanceof Error ? e.message : String(e);
	} finally {
		chalSaving = false;
	}
}

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

onMount(() => {
	service.client.getDisclosure().then(result => {
		if (!result.ok) return;
		const data = result.data;
		if (data.enabled !== undefined) discEnabled = data.enabled;
		if (data.text) discText = data.text;
		if (data.style) discStyle = data.style;
		if (data.position) discPosition = data.position;
		if (data.dismissible !== undefined) discDismissible = data.dismissible;
		if (data.link) discLink = data.link;
		if (data.linkText) discLinkText = data.linkText;
		if (data.jurisdiction) discJurisdiction = data.jurisdiction;
	});
});

/** Validate URL protocol — only https:// and http:// allowed. */
function isValidLinkUrl(url) {
	if (!url) return true;
	return /^https?:\/\//i.test(url.trim());
}

async function saveDisclosure() {
	discSaving = true;
	discError = '';
	discSaved = false;
	try {
		if (discLink && !isValidLinkUrl(discLink)) {
			discError = 'Disclosure link must use https:// or http:// protocol';
			discSaving = false;
			return;
		}
		const body = {
			enabled: discEnabled, text: discText, style: discStyle,
			position: discPosition, dismissible: discDismissible,
			link: discLink || undefined, linkText: discLinkText || undefined,
			jurisdiction: discJurisdiction || undefined,
		};
		const result = await service.client.updateDisclosure(body);
		if (!result.ok) {
			discError = result.error || `HTTP ${result.status}`;
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

// --- Confirmation dialog state ---
let confirmOpen = $state(false);
let confirmTitle = $state('');
let confirmMessage = $state('');
let confirmLabel = $state('');
let confirmDestructive = $state(false);
let confirmAction = $state(() => {});

function requestSaveChallengeConfig() {
	confirmTitle = 'Update Challenge Configuration';
	confirmMessage = 'Update challenge hours and budget configuration? Changes take effect immediately.';
	confirmLabel = 'Update';
	confirmDestructive = false;
	confirmAction = () => { confirmOpen = false; saveChallengeConfig(); };
	confirmOpen = true;
}

function requestSaveDisclosure() {
	confirmTitle = 'Update Disclosure Configuration';
	confirmMessage = 'Update AI disclosure banner configuration? Changes take effect immediately for all connected clients.';
	confirmLabel = 'Update';
	confirmDestructive = false;
	confirmAction = () => { confirmOpen = false; saveDisclosure(); };
	confirmOpen = true;
}
</script>

<div class="config-page">
	<h2>System Configuration</h2>

	<div class="tab-bar">
		{#each TABS as tab}
			<button
				class="tab-btn"
				class:tab-active={activeTab === tab}
				onclick={() => { activeTab = tab; }}
			>{tab}</button>
		{/each}
	</div>

	{#if state.loading}
		<p class="loading">Loading...</p>
	{/if}

	{#if state.error}
		<p class="error">{state.error}</p>
	{/if}

	<!-- ===== Relay Tab ===== -->
	{#if activeTab === 'Relay'}
		{#if !systemHealthy}
			<div class="health-warning">
				System health: degraded
				{#if !tlsHealthy} &mdash; TLS not configured{/if}
				{#if !chainHealthy} &mdash; Audit chain integrity issue{/if}
			</div>
		{/if}

		<div class="config-grid">
			<ConfigPanel title="Relay Settings" fields={relayFields} />
			<ConfigPanel title="TLS Status" fields={tlsFields} />
			<ConfigPanel title="Audit Chain Integrity" fields={auditFields} />
		</div>
	{/if}

	<!-- ===== Providers Tab ===== -->
	{#if activeTab === 'Providers'}
		<div class="section-block">
			<h3>Registered Adapters</h3>
			<p class="note">Context window and pricing from AI client provider registration. Future: per-adapter context caps.</p>

			{#if providerList.length > 0}
				{#each providerList as prov}
					<div class="provider-card">
						<div class="prov-header">
							<span class="prov-name">{prov.providerName || prov.providerId}</span>
							<span class="prov-status" class:prov-active={prov.status === 'active'}>{prov.status}</span>
						</div>
						{#if prov.adapters}
							{#each prov.adapters as ad}
								<div class="adapter-card">
									<span class="adapter-model">{ad.model}</span>
									<span class="adapter-roles">{(ad.roles || []).join(', ')}</span>
									{#if ad.maxContextTokens}
										<span class="adapter-detail">Context: {(ad.maxContextTokens / 1000).toLocaleString()}k tokens</span>
									{/if}
									{#if ad.pricingInputPerMTok != null}
										<span class="adapter-detail">Pricing: ${ad.pricingInputPerMTok} / ${ad.pricingOutputPerMTok ?? '?'} per MTok (in/out)</span>
									{/if}
								</div>
							{/each}
						{/if}
					</div>
				{/each}
			{:else}
				<p class="note">No providers registered. Connect an AI client to see adapter details.</p>
			{/if}
		</div>
	{/if}

	<!-- ===== Security Tab ===== -->
	{#if activeTab === 'Security'}
		<div class="config-grid">
			<div>
				<ConfigPanel title="Safety Floors" fields={safetyFields} />
				<p class="note">Safety floors can be tightened but never lowered below factory defaults.</p>
			</div>
		</div>
		<div class="section-block">
			<h3>MaliClaw Clause</h3>
			<p class="note">13 blocked identifiers + /claw/i regex. Checked before allowlist. Hardcoded — cannot be removed or configured.</p>
		</div>
	{/if}

	<!-- ===== Challenge Tab ===== -->
	{#if activeTab === 'Challenge'}
		<div class="challenge-section">
			<h3>Challenge Me More &mdash; Temporal Governance</h3>
			<p class="note">Restricts impulsive actions during user-configured vulnerable hours. Cannot be disabled (safety floor).</p>

			<div class="chal-status">
				<span class="chal-badge" class:chal-active={chalActive} class:chal-inactive={!chalActive}>
					{chalActive ? 'ACTIVE' : 'Inactive'}
				</span>
				{#if chalTimezone}
					<span class="chal-tz">Timezone: {chalTimezone} (AI VM system time)</span>
				{/if}
			</div>

			{#if chalLoaded}
			<div class="chal-form">
				<div class="chal-grid">
					<div class="chal-group">
						<span class="disc-label">Weekday Hours</span>
						<div class="chal-range">
							<input type="text" class="chal-time" bind:value={chalWeekdayStart} placeholder="22:00" />
							<span>to</span>
							<input type="text" class="chal-time" bind:value={chalWeekdayEnd} placeholder="06:00" />
						</div>
					</div>
					<div class="chal-group">
						<span class="disc-label">Weekend Hours</span>
						<div class="chal-range">
							<input type="text" class="chal-time" bind:value={chalWeekendStart} placeholder="23:00" />
							<span>to</span>
							<input type="text" class="chal-time" bind:value={chalWeekendEnd} placeholder="08:00" />
						</div>
					</div>
				</div>

				<div class="chal-grid">
					<div class="chal-group">
						<span class="disc-label">Budget change cooldown (days)</span>
						<input type="number" class="chal-time" bind:value={chalBudgetDays} min="1" max="30" />
					</div>
					<div class="chal-group">
						<span class="disc-label">Schedule change cooldown (days)</span>
						<input type="number" class="chal-time" bind:value={chalScheduleDays} min="1" max="30" />
					</div>
					<div class="chal-group">
						<span class="disc-label">Tool registration cooldown (days)</span>
						<input type="number" class="chal-time" bind:value={chalToolDays} min="1" max="30" />
					</div>
				</div>

				{#if chalLastChange}
					<p class="chal-meta">Last schedule change: {chalLastChange}</p>
				{/if}

				<div class="chal-warnings">
					<p>Cannot modify during active challenge hours</p>
					<p>7-day cooldown between schedule changes</p>
					<p>Challenge Me More cannot be disabled</p>
					<p>Minimum 6-hour challenge window</p>
				</div>

				{#if chalError}
					<p class="error">{chalError}</p>
				{/if}

				<button class="disc-save" onclick={requestSaveChallengeConfig} disabled={chalSaving || chalActive}>
					{chalSaving ? 'Saving...' : chalSaved ? 'Saved!' : chalActive ? 'Blocked — Challenge Hours Active' : 'Save Challenge Config'}
				</button>
			</div>
			{:else if !chalNote}
				<p class="note">Loading challenge status from AI client...</p>
			{:else}
				<p class="note">{chalNote}</p>
			{/if}
		</div>
	{/if}

	<!-- ===== Disclosure Tab ===== -->
	{#if activeTab === 'Disclosure'}
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

				{#if discEnabled}
					<div class="disc-preview" style="background: color-mix(in srgb, {DISC_STYLE_COLORS[discStyle] ?? '#3b82f6'} 12%, transparent); border-left: 3px solid {DISC_STYLE_COLORS[discStyle] ?? '#3b82f6'};">
						<span>{DISC_STYLE_ICONS[discStyle] ?? 'ℹ️'}</span>
						<span>{discText.replace(/\{provider\}/g, 'Anthropic').replace(/\{model\}/g, 'Claude Sonnet 4.6')}</span>
						{#if discLink && discLinkText && isValidLinkUrl(discLink)}
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

				<button class="disc-save" onclick={requestSaveDisclosure} disabled={discSaving}>
					{discSaving ? 'Saving...' : discSaved ? 'Saved!' : 'Save Disclosure Config'}
				</button>
			</div>
		</div>
	{/if}
</div>

<ConfirmDialog
	open={confirmOpen}
	title={confirmTitle}
	message={confirmMessage}
	confirmLabel={confirmLabel}
	destructive={confirmDestructive}
	onConfirm={confirmAction}
	onCancel={() => { confirmOpen = false; }}
/>

<style>
	.config-page h2 {
		margin-bottom: 0.75rem;
		font-size: 1.5rem;
	}

	/* Tab bar */
	.tab-bar {
		display: flex; gap: 0.125rem; flex-wrap: wrap;
		border-bottom: 1px solid var(--border-default);
		padding-bottom: 0.375rem;
		margin-bottom: 1.5rem;
	}
	.tab-btn {
		padding: 0.375rem 0.75rem; border-radius: 4px 4px 0 0;
		border: 1px solid transparent; border-bottom: none;
		background: transparent; color: var(--text-muted);
		font-size: 0.8rem; cursor: pointer; transition: background 0.15s, color 0.15s;
	}
	.tab-btn:hover { background: color-mix(in srgb, var(--border-default) 50%, transparent); color: var(--text-primary); }
	.tab-active {
		background: var(--bg-surface);
		border-color: var(--border-default);
		color: var(--accent-primary); font-weight: 500;
	}

	.config-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 1.5rem;
	}

	.section-block { margin-top: 1.5rem; }
	.section-block h3 { font-size: 1.125rem; margin-bottom: 0.5rem; }

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

	.loading { color: var(--text-muted); font-style: italic; margin-bottom: 1rem; }
	.error { color: var(--status-error); margin-bottom: 1rem; }

	/* Providers */
	.provider-card {
		background: var(--bg-surface); border: 1px solid var(--border-default);
		border-radius: 0.5rem; padding: 1rem; margin-bottom: 0.75rem;
	}
	.prov-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
	.prov-name { font-weight: 500; font-size: 0.95rem; }
	.prov-status {
		font-size: 0.7rem; font-weight: 600; padding: 0.125rem 0.5rem;
		border-radius: 999px; background: color-mix(in srgb, var(--text-muted) 15%, transparent); color: var(--text-muted);
	}
	.prov-active { background: color-mix(in srgb, var(--status-success) 15%, transparent) !important; color: var(--status-success) !important; }

	.adapter-card {
		padding: 0.625rem 0.75rem; margin-bottom: 0.375rem;
		background: var(--bg-primary); border: 1px solid var(--border-default);
		border-radius: 0.375rem; display: flex; flex-direction: column; gap: 0.2rem;
	}
	.adapter-model { font-family: monospace; font-size: 0.85rem; font-weight: 500; }
	.adapter-roles { font-size: 0.75rem; color: var(--text-muted); }
	.adapter-detail { font-size: 0.75rem; color: var(--text-secondary); font-family: monospace; }

	/* Challenge Me More */
	.challenge-section h3 { font-size: 1.125rem; margin-bottom: 0.5rem; }
	.chal-status { display: flex; align-items: center; gap: 0.75rem; margin: 0.75rem 0; }
	.chal-badge { font-size: 0.75rem; font-weight: 600; padding: 0.125rem 0.5rem; border-radius: 999px; }
	.chal-active { background: color-mix(in srgb, var(--status-success) 15%, transparent); color: var(--status-success); }
	.chal-inactive { background: color-mix(in srgb, var(--text-muted) 15%, transparent); color: var(--text-muted); }
	.chal-tz { font-size: 0.8rem; color: var(--text-muted); }
	.chal-form { display: flex; flex-direction: column; gap: 0.75rem; max-width: 600px; }
	.chal-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; }
	.chal-group { display: flex; flex-direction: column; gap: 0.25rem; }
	.chal-range { display: flex; align-items: center; gap: 0.375rem; font-size: 0.85rem; }
	.chal-time {
		width: 80px; padding: 0.375rem 0.5rem; font-size: 0.85rem;
		border: 1px solid var(--border-default); border-radius: 0.375rem;
		background: var(--bg-surface); color: var(--text-primary); font-family: monospace;
	}
	.chal-meta { font-size: 0.75rem; color: var(--text-muted); }
	.chal-warnings { font-size: 0.75rem; color: var(--status-warning); display: flex; flex-direction: column; gap: 0.125rem; }
	.chal-warnings p { margin: 0; }
	.chal-warnings p::before { content: '\26A0\FE0F  '; }

	/* AI Disclosure */
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
