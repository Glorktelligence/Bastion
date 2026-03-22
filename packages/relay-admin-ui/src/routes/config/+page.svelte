<script>
// System Configuration — Task 3.11
// Relay settings, safety floors, TLS status, audit chain integrity

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

$effect(() => {
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
</style>
