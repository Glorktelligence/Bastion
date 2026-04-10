<script>
// Extensions — M16 admin page
// Read-only view of loaded protocol extensions

import StatCard from '$lib/components/StatCard.svelte';
import { createExtensionsStore } from '$lib/stores/extensions.js';
import { createSharedService } from '$lib/api/service-instance.js';

const extensions = createExtensionsStore();
const service = createSharedService();

/** @type {import('$lib/stores/extensions.js').ExtensionsState} */
let state = $state(extensions.store.get());

/** @type {number} */
let totalCount = $state(extensions.totalCount.get());

/** @type {number} */
let totalMessageTypes = $state(extensions.totalMessageTypes.get());

$effect(() => {
	const unsub1 = extensions.store.subscribe((s) => { state = s; });
	const unsub2 = extensions.totalCount.subscribe((c) => { totalCount = c; });
	const unsub3 = extensions.totalMessageTypes.subscribe((c) => { totalMessageTypes = c; });

	service.fetchExtensions(extensions);

	return () => { unsub1(); unsub2(); unsub3(); };
});

async function toggleDetail(/** @type {string} */ namespace) {
	if (state.selectedNamespace === namespace) {
		extensions.selectNamespace(null);
		return;
	}
	extensions.selectNamespace(namespace);
	await service.fetchExtensionDetail(extensions, namespace);
}
</script>

<div class="extensions-page">
	<div class="page-header">
		<h2>Extensions</h2>
		<span class="count">{totalCount} loaded</span>
	</div>

	{#if state.loading}
		<p class="loading">Loading...</p>
	{/if}

	{#if state.error}
		<p class="error">{state.error}</p>
	{/if}

	<div class="stat-row">
		<StatCard label="Extensions" value={totalCount} status="info" />
		<StatCard label="Message Types" value={totalMessageTypes} status="info" />
	</div>

	<div class="registry-status">
		Registry locked after startup — extensions are loaded from disk and cannot be modified at runtime.
	</div>

	{#if state.extensions.length === 0 && !state.loading}
		<p class="empty">No extensions loaded. Extensions are loaded from the extensions directory on relay startup.</p>
	{/if}

	{#each state.extensions as ext}
		<div class="extension-card">
			<button class="extension-header" onclick={() => toggleDetail(ext.namespace)}>
				<div class="extension-info">
					<span class="ext-name">{ext.name}</span>
					<span class="ext-namespace">{ext.namespace}</span>
					<span class="ext-version">v{ext.version}</span>
				</div>
				<div class="extension-meta">
					<span class="meta-badge">{ext.messageTypeCount} message types</span>
					<span class="expand-icon">{state.selectedNamespace === ext.namespace ? '\u25B2' : '\u25BC'}</span>
				</div>
			</button>
			<div class="extension-summary">
				<span class="ext-description">{ext.description}</span>
				<span class="ext-author">by {ext.author}</span>
			</div>

			{#if state.selectedNamespace === ext.namespace}
				<div class="extension-detail">
					{#if state.detailLoading}
						<p class="loading">Loading detail...</p>
					{:else if state.selectedDetail}
						{#if state.selectedDetail.messageTypes.length > 0}
							<div class="detail-section">
								<h4>Message Types</h4>
								<table class="detail-table">
									<thead>
										<tr>
											<th>Name</th>
											<th>Safety</th>
											<th>Direction</th>
											<th>Description</th>
										</tr>
									</thead>
									<tbody>
										{#each state.selectedDetail.messageTypes as mt}
											<tr>
												<td class="mono">{ext.namespace}:{mt.name}</td>
												<td><span class="safety-badge safety-{mt.safety}">{mt.safety}</span></td>
												<td>{mt.direction ?? 'bidirectional'}</td>
												<td>{mt.description}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}

						{#if state.selectedDetail.uiComponents.length > 0}
							<div class="detail-section">
								<h4>UI Components</h4>
								<table class="detail-table">
									<thead>
										<tr>
											<th>Name</th>
											<th>Placement</th>
											<th>Size</th>
										</tr>
									</thead>
									<tbody>
										{#each state.selectedDetail.uiComponents as comp}
											<tr>
												<td>{comp.name}</td>
												<td>{comp.placement}</td>
												<td>{comp.size}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}

						{#if state.selectedDetail.conversationRenderers.length > 0}
							<div class="detail-section">
								<h4>Conversation Renderers</h4>
								<table class="detail-table">
									<thead>
										<tr>
											<th>Message Type</th>
											<th>Style</th>
										</tr>
									</thead>
									<tbody>
										{#each state.selectedDetail.conversationRenderers as renderer}
											<tr>
												<td class="mono">{renderer.messageType}</td>
												<td>{renderer.style}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}

						{#if state.selectedDetail.dependencies && state.selectedDetail.dependencies.length > 0}
							<div class="detail-section">
								<h4>Dependencies</h4>
								<ul class="dep-list">
									{#each state.selectedDetail.dependencies as dep}
										<li>{dep}</li>
									{/each}
								</ul>
							</div>
						{/if}

						{#if state.selectedDetail.messageTypes.length === 0 && state.selectedDetail.uiComponents.length === 0 && state.selectedDetail.conversationRenderers.length === 0}
							<p class="empty-detail">No message types, UI components, or renderers declared.</p>
						{/if}
					{/if}
				</div>
			{/if}
		</div>
	{/each}
</div>

<style>
	.extensions-page h2 {
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

	.extension-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 0.5rem;
		margin-bottom: 0.75rem;
		overflow: hidden;
	}

	.extension-header {
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

	.extension-header:hover {
		background: var(--accent-muted);
	}

	.extension-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.ext-name {
		font-weight: 600;
	}

	.ext-namespace {
		color: var(--text-muted);
		font-size: 0.75rem;
		font-family: monospace;
	}

	.ext-version {
		color: var(--text-muted);
		font-size: 0.75rem;
	}

	.extension-meta {
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

	.extension-summary {
		padding: 0 1rem 0.75rem;
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
	}

	.ext-description {
		color: var(--text-secondary);
	}

	.ext-author {
		color: var(--text-muted);
		font-size: 0.75rem;
	}

	.extension-detail {
		border-top: 1px solid var(--border-subtle);
		padding: 1rem;
		background: var(--bg-base);
	}

	.detail-section {
		margin-bottom: 1rem;
	}

	.detail-section:last-child {
		margin-bottom: 0;
	}

	.detail-section h4 {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
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

	.safety-badge {
		font-size: 0.7rem;
		padding: 0.1rem 0.375rem;
		border-radius: 0.25rem;
		font-weight: 500;
	}

	.safety-passthrough {
		background: color-mix(in srgb, var(--status-success) 20%, transparent);
		color: var(--status-success);
	}

	.safety-task {
		background: color-mix(in srgb, var(--status-info) 20%, transparent);
		color: var(--status-info);
	}

	.safety-admin {
		background: color-mix(in srgb, var(--status-warning) 20%, transparent);
		color: var(--status-warning);
	}

	.safety-blocked {
		background: color-mix(in srgb, var(--status-error) 20%, transparent);
		color: var(--status-error);
	}

	.dep-list {
		list-style: disc;
		padding-left: 1.25rem;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.dep-list li {
		padding: 0.125rem 0;
	}

	.empty {
		color: var(--text-muted);
		font-style: italic;
		font-size: 0.875rem;
	}

	.empty-detail {
		color: var(--text-muted);
		font-style: italic;
		font-size: 0.8rem;
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
