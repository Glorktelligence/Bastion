<script>
// Tools — M16 admin page
// Read-only view of registered tools from MCP providers

import StatCard from '$lib/components/StatCard.svelte';
import { createToolsStore } from '$lib/stores/tools.js';
import { createSharedService } from '$lib/api/service-instance.js';

const tools = createToolsStore();
const service = createSharedService();

/** @type {import('$lib/stores/tools.js').ToolsState} */
let state = $state(tools.store.get());

/** @type {number} */
let providerCount = $state(tools.providerCount.get());

/** @type {number} */
let dangerousToolCount = $state(tools.dangerousToolCount.get());

$effect(() => {
	const unsub1 = tools.store.subscribe((s) => { state = s; });
	const unsub2 = tools.providerCount.subscribe((c) => { providerCount = c; });
	const unsub3 = tools.dangerousToolCount.subscribe((c) => { dangerousToolCount = c; });

	service.fetchTools(tools);

	return () => { unsub1(); unsub2(); unsub3(); };
});

/** @type {Record<string, boolean>} */
let expandedProviders = $state({});

function toggleProvider(/** @type {string} */ providerId) {
	expandedProviders = {
		...expandedProviders,
		[providerId]: !expandedProviders[providerId],
	};
}
</script>

<div class="tools-page">
	<div class="page-header">
		<h2>Tools</h2>
		<span class="count">{state.totalTools} registered</span>
	</div>

	{#if state.loading}
		<p class="loading">Loading...</p>
	{/if}

	{#if state.error}
		<p class="error">{state.error}</p>
	{/if}

	<div class="stat-row">
		<StatCard label="Providers" value={providerCount} status="info" />
		<StatCard label="Total Tools" value={state.totalTools} status="info" />
		<StatCard label="Dangerous" value={dangerousToolCount} status={dangerousToolCount > 0 ? 'warning' : 'success'} />
	</div>

	<div class="registry-status">
		Tool registry is read-only via admin API. Tools are configured via <code>tools.json</code> and managed through the protocol.
		{#if state.message}
			<br />{state.message}
		{/if}
	</div>

	{#if state.providers.length === 0 && !state.loading}
		<div class="empty-state">
			<p class="empty">No tool providers registered.</p>
			<p class="empty-hint">Tool providers connect via MCP (Model Context Protocol). When an MCP provider registers tools, they appear here.</p>
			<div class="info-card">
				<h4>Tool Governance</h4>
				<ul>
					<li>Destructive tools always require per-call human approval (Dangerous Tool Blindness)</li>
					<li>AI cannot see parameters of dangerous tools until human approves</li>
					<li>Tool requests flow through the protocol — not the admin API</li>
					<li>Tool violations are logged as audit events</li>
				</ul>
			</div>
		</div>
	{/if}

	{#each state.providers as provider}
		<div class="provider-card">
			<button class="provider-header" onclick={() => toggleProvider(provider.id)}>
				<div class="provider-info">
					<span class="provider-name">{provider.name}</span>
					<span class="provider-id">{provider.id}</span>
					<span class="provider-auth">{provider.authType}</span>
				</div>
				<div class="provider-meta">
					<span class="meta-badge">{provider.tools.length} tools</span>
					<span class="expand-icon">{expandedProviders[provider.id] ? '\u25B2' : '\u25BC'}</span>
				</div>
			</button>

			{#if expandedProviders[provider.id]}
				<div class="provider-detail">
					<table class="detail-table">
						<thead>
							<tr>
								<th>Tool</th>
								<th>Category</th>
								<th>Dangerous</th>
								<th>Description</th>
							</tr>
						</thead>
						<tbody>
							{#each provider.tools as tool}
								<tr>
									<td class="mono">{tool.name}</td>
									<td>
										<span class="category-badge category-{tool.category}">{tool.category}</span>
									</td>
									<td>
										{#if tool.dangerous}
											<span class="danger-flag">YES</span>
										{:else}
											<span class="safe-flag">no</span>
										{/if}
									</td>
									<td>{tool.description}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	{/each}
</div>

<style>
	.tools-page h2 {
		margin-bottom: 0;
		font-size: 1.5rem;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	.count {
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.stat-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.registry-status {
		font-size: 0.8rem;
		color: var(--text-muted);
		padding: 0.5rem 0.75rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 0.375rem;
		margin-bottom: 1.5rem;
	}

	.registry-status code {
		color: var(--accent-secondary);
		font-size: 0.75rem;
	}

	.empty-state {
		margin-top: 1rem;
	}

	.empty {
		color: var(--text-muted);
		font-style: italic;
		font-size: 0.875rem;
		margin-bottom: 0.5rem;
	}

	.empty-hint {
		color: var(--text-muted);
		font-size: 0.8rem;
		margin-bottom: 1.5rem;
	}

	.info-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 0.5rem;
		padding: 1rem;
	}

	.info-card h4 {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.info-card ul {
		list-style: disc;
		padding-left: 1.25rem;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.info-card li {
		padding: 0.25rem 0;
	}

	.provider-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 0.5rem;
		margin-bottom: 0.75rem;
		overflow: hidden;
	}

	.provider-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
		padding: 0.75rem 1rem;
		background: transparent;
		border: none;
		color: var(--text-primary);
		cursor: pointer;
		text-align: left;
		font-size: 0.875rem;
	}

	.provider-header:hover {
		background: var(--accent-muted);
	}

	.provider-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.provider-name {
		font-weight: 600;
	}

	.provider-id {
		color: var(--text-muted);
		font-size: 0.75rem;
		font-family: monospace;
	}

	.provider-auth {
		font-size: 0.7rem;
		color: var(--text-muted);
		background: var(--bg-secondary);
		padding: 0.1rem 0.375rem;
		border-radius: 0.25rem;
	}

	.provider-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.meta-badge {
		font-size: 0.75rem;
		color: var(--accent-secondary);
		background: var(--accent-muted);
		padding: 0.125rem 0.5rem;
		border-radius: 0.25rem;
	}

	.expand-icon {
		font-size: 0.625rem;
		color: var(--text-muted);
	}

	.provider-detail {
		border-top: 1px solid var(--border-subtle);
		padding: 1rem;
		background: var(--bg-base);
	}

	.detail-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}

	.detail-table th {
		text-align: left;
		padding: 0.375rem 0.5rem;
		color: var(--text-muted);
		border-bottom: 1px solid var(--border-subtle);
		font-weight: 500;
	}

	.detail-table td {
		padding: 0.375rem 0.5rem;
		color: var(--text-secondary);
		border-bottom: 1px solid var(--border-subtle);
	}

	.detail-table tr:last-child td {
		border-bottom: none;
	}

	.mono {
		font-family: monospace;
		font-size: 0.75rem;
	}

	.category-badge {
		font-size: 0.7rem;
		padding: 0.1rem 0.375rem;
		border-radius: 0.25rem;
		font-weight: 500;
	}

	.category-read {
		background: color-mix(in srgb, var(--status-success) 20%, transparent);
		color: var(--status-success);
	}

	.category-write {
		background: color-mix(in srgb, var(--status-warning) 20%, transparent);
		color: var(--status-warning);
	}

	.category-destructive {
		background: color-mix(in srgb, var(--status-error) 20%, transparent);
		color: var(--status-error);
	}

	.danger-flag {
		color: var(--status-error);
		font-weight: 600;
		font-size: 0.75rem;
	}

	.safe-flag {
		color: var(--text-muted);
		font-size: 0.75rem;
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
