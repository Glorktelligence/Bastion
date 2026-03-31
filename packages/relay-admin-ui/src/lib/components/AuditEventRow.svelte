<script>
/** @type {{ event: import('../types.js').AuditEventSummary }} */
const { event } = $props();

/** Key fields to extract and display inline from detail objects. */
const INLINE_KEYS = [
	'clientId', 'reason', 'messageType', 'remoteAddress', 'providerId',
	'providerName', 'transferId', 'filename', 'direction', 'violation',
	'alertLevel', 'decision', 'action', 'pattern', 'code',
];

/**
 * Extract the most important fields from detail for inline display.
 * Returns an array of { key, value } pairs (max 3).
 */
function getInlineFields(detail) {
	if (!detail || typeof detail !== 'object') return [];
	const fields = [];
	for (const k of INLINE_KEYS) {
		if (k in detail && detail[k] !== undefined && detail[k] !== null && detail[k] !== '') {
			fields.push({ key: k, value: String(detail[k]) });
			if (fields.length >= 3) break;
		}
	}
	return fields;
}

const inlineFields = getInlineFields(event.detail);
const hasExtraFields = event.detail && Object.keys(event.detail).length > inlineFields.length;

let expanded = $state(false);

function toggleExpand() {
	expanded = !expanded;
}
</script>

<tr>
	<td class="timestamp">{new Date(event.timestamp).toLocaleTimeString()}</td>
	<td><span class="event-type">{event.eventType}</span></td>
	<td class="session">{event.sessionId}</td>
	<td class="detail">
		<span class="detail-inline">
			{#each inlineFields as field, i}
				<span class="field"><span class="field-key">{field.key}:</span> {field.value}</span>{#if i < inlineFields.length - 1}<span class="field-sep">&middot;</span>{/if}
			{/each}
			{#if inlineFields.length === 0 && event.detail && Object.keys(event.detail).length > 0}
				<span class="field-muted">{Object.keys(event.detail).length} field(s)</span>
			{/if}
		</span>
		{#if hasExtraFields || inlineFields.length > 0}
			<button class="expand-btn" onclick={toggleExpand} title={expanded ? 'Collapse' : 'Show full detail'}>
				{expanded ? '\u25B4' : '\u25BE'}
			</button>
		{/if}
		{#if expanded}
			<pre class="detail-full">{JSON.stringify(event.detail, null, 2)}</pre>
		{/if}
	</td>
</tr>

<style>
	.timestamp {
		color: var(--text-muted);
		font-size: 0.8rem;
		white-space: nowrap;
	}

	.event-type {
		font-family: monospace;
		font-size: 0.8rem;
		padding: 0.125rem 0.375rem;
		background: var(--bg-elevated);
		border-radius: 0.25rem;
	}

	.session {
		color: var(--text-secondary);
		font-size: 0.8rem;
		font-family: monospace;
	}

	.detail {
		font-size: 0.8rem;
		max-width: 400px;
	}

	.detail-inline {
		display: inline;
	}

	.field {
		font-size: 0.78rem;
	}

	.field-key {
		color: var(--text-muted);
		font-family: monospace;
		font-size: 0.75rem;
	}

	.field-sep {
		color: var(--text-muted);
		margin: 0 0.25rem;
	}

	.field-muted {
		color: var(--text-muted);
		font-style: italic;
		font-size: 0.78rem;
	}

	.expand-btn {
		display: inline-block;
		margin-left: 0.375rem;
		padding: 0 0.25rem;
		font-size: 0.7rem;
		cursor: pointer;
		background: none;
		border: 1px solid var(--border-default);
		border-radius: 0.2rem;
		color: var(--text-muted);
		vertical-align: middle;
		line-height: 1;
	}
	.expand-btn:hover {
		background: var(--bg-elevated);
		color: var(--text-primary);
	}

	.detail-full {
		margin-top: 0.375rem;
		padding: 0.5rem;
		font-size: 0.75rem;
		font-family: monospace;
		background: var(--bg-elevated);
		border: 1px solid var(--border-default);
		border-radius: 0.25rem;
		white-space: pre-wrap;
		word-break: break-all;
		max-height: 200px;
		overflow-y: auto;
	}
</style>
