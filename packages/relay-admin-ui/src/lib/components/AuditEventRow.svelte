<script>
/** @type {{ event: import('../types.js').AuditEventSummary }} */
const { event } = $props();
</script>

<tr>
	<td class="timestamp">{new Date(event.timestamp).toLocaleTimeString()}</td>
	<td><span class="event-type">{event.eventType}</span></td>
	<td class="session">{event.sessionId}</td>
	<td class="detail">{JSON.stringify(event.detail).slice(0, 80)}</td>
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
		color: var(--text-secondary);
		font-size: 0.8rem;
		max-width: 300px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
