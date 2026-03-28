<script>
import { browser } from '$app/environment';
import { page } from '$app/state';
import * as session from '$lib/session.js';
import ExtensionUIHost from '$lib/components/ExtensionUIHost.svelte';

let extensions = $state([]);
let unsub = null;

$effect(() => {
	if (!browser) return () => {};
	unsub = session.extensions.store.subscribe((s) => { extensions = s.extensions; });
	return () => { if (unsub) unsub(); };
});

const namespace = $derived(page.params.namespace);
const extension = $derived(extensions.find((e) => e.namespace === namespace));
const uiPages = $derived(extension?.ui?.pages ?? []);
const mainComponents = $derived(uiPages.flatMap((p) => p.components.filter((c) => c.placement === 'main' || c.placement === 'full-page')));
</script>

<div class="ext-page">
	{#if extension}
		<header class="ext-header">
			<h2>{extension.name}</h2>
			<span class="ext-meta">v{extension.version} — {extension.namespace}</span>
		</header>

		{#if mainComponents.length > 0}
			<ExtensionUIHost components={mainComponents} namespace={extension.namespace} />
		{:else}
			<p class="ext-empty">This extension has no UI components for this view.</p>
		{/if}
	{:else}
		<div class="ext-not-found">
			<p>Extension not found: <code>{namespace}</code></p>
			<p class="ext-hint">Extensions are loaded by the relay at startup.</p>
		</div>
	{/if}
</div>

<style>
	.ext-page { padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; overflow-y: auto; height: 100%; }
	.ext-header h2 { font-size: 1.25rem; color: var(--color-text); }
	.ext-meta { font-size: 0.75rem; color: var(--color-text-muted); }
	.ext-empty { color: var(--color-text-muted); font-size: 0.85rem; text-align: center; padding: 2rem; }
	.ext-not-found { text-align: center; padding: 3rem; color: var(--color-text-muted); }
	.ext-hint { font-size: 0.8rem; margin-top: 0.5rem; }
</style>
