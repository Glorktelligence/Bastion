<script lang="ts">
import { onMount } from 'svelte';
import type { DisplayMessage } from '../stores/messages.js';
import { conversationRendererRegistry } from '../extensions/conversation-renderer-registry.js';
import MessageBubble from './MessageBubble.svelte';

const {
  messages,
  groupConsecutive = true,
  adapterName = '',
  isStreaming = false,
  streamingContent = '',
}: {
  messages: DisplayMessage[];
  groupConsecutive?: boolean;
  adapterName?: string;
  isStreaming?: boolean;
  streamingContent?: string;
} = $props();

// Filter out extension-namespaced messages that have no registered renderer
const visibleMessages = $derived(
  messages.filter(msg => {
    if (msg.type.includes(':') && !conversationRendererRegistry.has(msg.type)) return false;
    return true;
  }),
);

/** Check if a message is grouped with the previous one (same sender, consecutive). */
function isGrouped(idx: number): boolean {
  if (!groupConsecutive || idx === 0) return false;
  const prev = visibleMessages[idx - 1];
  const curr = visibleMessages[idx];
  return prev.senderType === curr.senderType && prev.senderName === curr.senderName;
}

let container: HTMLDivElement | undefined = $state();
let isNearBottom = $state(true);
let prevMessageCount = $state(0);

// Threshold in pixels — if scrolled within this distance of the bottom,
// consider the user "at the bottom" and auto-scroll on new messages.
const SCROLL_THRESHOLD = 80;

function checkNearBottom(): void {
  if (!container) return;
  const { scrollTop, scrollHeight, clientHeight } = container;
  isNearBottom = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
}

function scrollToBottom(): void {
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

onMount(() => {
  // Scroll to bottom on initial load
  scrollToBottom();
});

$effect(() => {
  const count = visibleMessages.length;
  const streaming = isStreaming;
  if (container) {
    if (count !== prevMessageCount || streaming) {
      if (isNearBottom) {
        requestAnimationFrame(() => scrollToBottom());
      }
      prevMessageCount = count;
    }
  }
});
</script>

<div class="message-list" bind:this={container} onscroll={checkNearBottom}>
	{#if visibleMessages.length === 0}
		<div class="empty-state">
			<div class="empty-icon">💬</div>
			<p class="empty-title">Start a conversation{adapterName ? ` with ${adapterName}` : ''}</p>
			<p class="empty-hint">Type a message below or submit a task to get started.</p>
		</div>
	{:else}
		{#each visibleMessages as msg, idx (msg.id)}
			<MessageBubble message={msg} grouped={isGrouped(idx)} />
		{/each}
	{/if}
	{#if isStreaming}
		<div class="streaming-bubble incoming">
			<span class="streaming-sender">Claude</span>
			<span class="streaming-text">{streamingContent}<span class="streaming-cursor">|</span></span>
		</div>
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
		min-height: 0;
	}

	.empty-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		color: var(--color-text-muted);
	}

	.empty-icon { font-size: 2.5rem; opacity: 0.4; }
	.empty-title { font-size: 1rem; font-weight: 500; color: var(--color-text); }
	.empty-hint { font-size: 0.8rem; }

	/* Streaming indicator — inside the scrollable area */
	.streaming-bubble {
		align-self: flex-start;
		background: var(--color-ai-bubble, var(--color-surface));
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 0.625rem 0.875rem;
		max-width: 75%;
	}
	.streaming-sender { font-size: 0.7rem; color: var(--color-accent); font-weight: 500; display: block; margin-bottom: 0.2rem; }
	.streaming-text { font-size: var(--msg-font-size, 0.875rem); color: var(--color-text); white-space: pre-wrap; overflow-wrap: break-word; word-break: break-word; }
	.streaming-cursor {
		display: inline-block; animation: blink 0.7s infinite;
		color: var(--color-accent); font-weight: 300;
	}
	@keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
</style>
