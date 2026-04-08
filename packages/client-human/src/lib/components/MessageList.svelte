<script lang="ts">
import type { DisplayMessage } from '../stores/messages.js';
import { conversationRendererRegistry } from '../extensions/conversation-renderer-registry.js';
import MessageBubble from './MessageBubble.svelte';

const { messages }: { messages: DisplayMessage[] } = $props();

// Filter out extension-namespaced messages that have no registered renderer
const visibleMessages = $derived(
  messages.filter(msg => {
    if (msg.type.includes(':') && !conversationRendererRegistry.has(msg.type)) return false;
    return true;
  }),
);

let container: HTMLDivElement | undefined = $state();

$effect(() => {
  // Scroll to bottom whenever messages change
  if (visibleMessages.length && container) {
    container.scrollTop = container.scrollHeight;
  }
});
</script>

<div class="message-list" bind:this={container}>
	{#if visibleMessages.length === 0}
		<div class="empty-state">
			<p>No messages yet. Start a conversation or submit a task.</p>
		</div>
	{:else}
		{#each visibleMessages as msg (msg.id)}
			<MessageBubble message={msg} />
		{/each}
	{/if}
</div>

<style>
	.message-list {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.empty-state {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}
</style>
