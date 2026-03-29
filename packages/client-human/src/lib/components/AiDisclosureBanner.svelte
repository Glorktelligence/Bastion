<script lang="ts">
import type { AiDisclosureData } from '$lib/stores/ai-disclosure.js';

const { disclosure, dismissed, onDismiss }: {
	disclosure: AiDisclosureData | null;
	dismissed: boolean;
	onDismiss: () => void;
} = $props();

const visible = $derived(disclosure !== null && !dismissed);

const STYLE_ICONS: Record<string, string> = { info: '\u2139\uFE0F', legal: '\uD83E\uDD16', warning: '\u26A0\uFE0F' };
</script>

{#if visible && disclosure}
<div class="disclosure disclosure-{disclosure.style}" role="status" aria-label="AI disclosure">
	<span class="disclosure-icon">{STYLE_ICONS[disclosure.style] ?? '\u2139\uFE0F'}</span>
	<span class="disclosure-text">{disclosure.text}</span>
	{#if disclosure.link && disclosure.linkText}
		<a class="disclosure-link" href={disclosure.link} target="_blank" rel="noopener noreferrer">{disclosure.linkText}</a>
	{/if}
	{#if disclosure.dismissible}
		<button class="disclosure-close" onclick={onDismiss} aria-label="Dismiss disclosure">&times;</button>
	{/if}
</div>
{/if}

<style>
	.disclosure {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.5rem 0.75rem; font-size: 0.8rem;
		border-left: 3px solid; flex-shrink: 0;
	}
	.disclosure-info { background: color-mix(in srgb, #3b82f6 10%, transparent); border-color: #3b82f6; color: #93c5fd; }
	.disclosure-legal { background: color-mix(in srgb, #6b7280 10%, transparent); border-color: #6b7280; color: #d1d5db; }
	.disclosure-warning { background: color-mix(in srgb, #f59e0b 10%, transparent); border-color: #f59e0b; color: #fcd34d; }
	.disclosure-icon { flex-shrink: 0; }
	.disclosure-text { flex: 1; }
	.disclosure-link {
		flex-shrink: 0; font-size: 0.75rem; text-decoration: underline;
		opacity: 0.8; white-space: nowrap;
	}
	.disclosure-info .disclosure-link { color: #60a5fa; }
	.disclosure-legal .disclosure-link { color: #9ca3af; }
	.disclosure-warning .disclosure-link { color: #fbbf24; }
	.disclosure-close {
		flex-shrink: 0; background: none; border: none;
		color: inherit; opacity: 0.5; cursor: pointer;
		font-size: 1.1rem; line-height: 1; padding: 0;
	}
	.disclosure-close:hover { opacity: 1; }
</style>
