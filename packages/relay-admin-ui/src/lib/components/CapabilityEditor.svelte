<script>
/** @type {{ matrix: import('../types.js').CapabilityMatrix, readonly?: boolean }} */
const { matrix, readonly: isReadonly = false } = $props();
</script>

<div class="capability-editor">
	<div class="section">
		<h4>Allowed Message Types ({matrix.allowedMessageTypes.length})</h4>
		<div class="tag-list">
			{#each matrix.allowedMessageTypes as msgType}
				<span class="tag">{msgType}</span>
			{/each}
		</div>
	</div>

	<div class="section">
		<h4>File Transfer</h4>
		<div class="field-grid">
			<span class="label">Can Send</span>
			<span class="value">{matrix.fileTransfer.canSend ? 'Yes' : 'No'}</span>
			<span class="label">Can Receive</span>
			<span class="value">{matrix.fileTransfer.canReceive ? 'Yes' : 'No'}</span>
			<span class="label">Max Size</span>
			<span class="value">{Math.round(matrix.fileTransfer.maxFileSizeBytes / 1024 / 1024)} MB</span>
			<span class="label">MIME Types</span>
			<span class="value">{matrix.fileTransfer.allowedMimeTypes.join(', ')}</span>
		</div>
	</div>

	<div class="section">
		<h4>Limits</h4>
		<div class="field-grid">
			<span class="label">Max Concurrent Tasks</span>
			<span class="value">{matrix.maxConcurrentTasks}</span>
			{#if matrix.budgetLimitUsd !== undefined}
				<span class="label">Budget Limit</span>
				<span class="value">${matrix.budgetLimitUsd}</span>
			{/if}
		</div>
	</div>
</div>

<style>
	.capability-editor {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.section h4 {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
	}

	.tag-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.tag {
		font-size: 0.7rem;
		padding: 0.125rem 0.5rem;
		background: var(--accent-muted);
		color: var(--accent-secondary);
		border-radius: 0.25rem;
		font-family: monospace;
	}

	.field-grid {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.25rem 1rem;
		font-size: 0.8rem;
	}

	.label {
		color: var(--text-muted);
	}

	.value {
		color: var(--text-primary);
	}
</style>
