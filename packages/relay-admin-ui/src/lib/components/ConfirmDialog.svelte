<script>
// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Reusable confirmation dialog for destructive actions.
 * Shows a modal overlay with title, message, and confirm/cancel buttons.
 * Destructive variant styles the confirm button in red.
 */

/** @type {{ open: boolean, title: string, message: string, confirmLabel?: string, cancelLabel?: string, destructive?: boolean, onConfirm: () => void, onCancel: () => void }} */
const { open, title, message, confirmLabel, cancelLabel, destructive, onConfirm, onCancel } = $props();

function handleKeydown(e) {
	if (e.key === 'Escape') onCancel();
}
</script>

{#if open}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="confirm-overlay" onclick={onCancel} onkeydown={handleKeydown}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="confirm-dialog" onclick={(e) => e.stopPropagation()} onkeydown={handleKeydown}>
		<h3 class="confirm-title">{title}</h3>
		<p class="confirm-message">{message}</p>
		<div class="confirm-actions">
			<button class="btn-cancel" onclick={onCancel}>{cancelLabel ?? 'Cancel'}</button>
			<button
				class="btn-confirm"
				class:btn-destructive={destructive}
				onclick={onConfirm}
			>{confirmLabel ?? 'Confirm'}</button>
		</div>
	</div>
</div>
{/if}

<style>
	.confirm-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.confirm-dialog {
		background: var(--bg-surface, #1a2740);
		border: 1px solid var(--border-default, #1e3a5f);
		border-radius: 0.5rem;
		padding: 1.5rem;
		max-width: 420px;
		width: 90vw;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
	}

	.confirm-title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary, #e2e8f0);
		margin: 0 0 0.75rem;
	}

	.confirm-message {
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
		line-height: 1.5;
		margin: 0 0 1.25rem;
	}

	.confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.btn-cancel {
		padding: 0.375rem 0.75rem;
		border-radius: 0.25rem;
		border: 1px solid var(--border-default, #1e3a5f);
		background: transparent;
		color: var(--text-secondary, #94a3b8);
		font-size: 0.8rem;
		cursor: pointer;
	}

	.btn-cancel:hover {
		color: var(--text-primary, #e2e8f0);
		border-color: var(--text-muted, #64748b);
	}

	.btn-confirm {
		padding: 0.375rem 0.75rem;
		border-radius: 0.25rem;
		border: none;
		background: var(--accent-primary, #3b82f6);
		color: #fff;
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
	}

	.btn-confirm:hover {
		background: var(--accent-secondary, #60a5fa);
	}

	.btn-destructive {
		background: var(--status-error, #ef4444);
	}

	.btn-destructive:hover {
		background: #dc2626;
	}
</style>
