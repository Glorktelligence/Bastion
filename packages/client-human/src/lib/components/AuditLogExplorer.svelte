<script>
/**
 * @type {{
 *   entries: readonly { index: number, timestamp: string, eventType: string, sessionId: string, detail: Record<string, unknown>, chainHash: string }[],
 *   filter: { startTime?: string, endTime?: string, eventType?: string, senderId?: string, taskId?: string, safetyOutcome?: string, fileTransferStatus?: string },
 *   currentPage: number,
 *   pageCount: number,
 *   totalCount: number,
 *   loading: boolean
 * }}
 */
const { entries, filter, currentPage, pageCount, totalCount, loading } = $props();
</script>

<div class="audit-explorer">
	<div class="filter-bar">
		<div class="filter-group">
			<label for="event-type">Event Type</label>
			<select id="event-type" value={filter.eventType ?? ''}>
				<option value="">All</option>
				<option value="message_routed">Message Routed</option>
				<option value="message_rejected">Message Rejected</option>
				<option value="auth_success">Auth Success</option>
				<option value="auth_failure">Auth Failure</option>
				<option value="session_started">Session Started</option>
				<option value="session_ended">Session Ended</option>
				<option value="file_manifest">File Manifest</option>
				<option value="file_quarantine">File Quarantine</option>
				<option value="file_delivered">File Delivered</option>
				<option value="file_rejected">File Rejected</option>
				<option value="protocol_violation">Protocol Violation</option>
				<option value="maliclaw_rejected">MaliClaw Rejected</option>
			</select>
		</div>
		<div class="filter-group">
			<label for="task-id">Task ID</label>
			<input id="task-id" type="text" placeholder="Filter by task..." value={filter.taskId ?? ''} />
		</div>
		<div class="filter-group">
			<label for="safety-outcome">Safety Outcome</label>
			<select id="safety-outcome" value={filter.safetyOutcome ?? ''}>
				<option value="">All</option>
				<option value="allow">Allow</option>
				<option value="challenge">Challenge</option>
				<option value="deny">Deny</option>
				<option value="clarify">Clarify</option>
			</select>
		</div>
		<span class="result-count">{totalCount} entries</span>
	</div>

	{#if loading}
		<div class="loading">Loading audit log...</div>
	{:else}
		<table>
			<thead>
				<tr>
					<th>#</th>
					<th>Timestamp</th>
					<th>Event Type</th>
					<th>Session</th>
					<th>Detail</th>
					<th>Chain Hash</th>
				</tr>
			</thead>
			<tbody>
				{#each entries as entry}
					<tr class="event-row event-{entry.eventType.includes('reject') || entry.eventType.includes('failure') || entry.eventType.includes('violation') ? 'error' : entry.eventType.includes('success') || entry.eventType.includes('delivered') || entry.eventType.includes('routed') ? 'success' : 'neutral'}">
						<td class="mono">{entry.index}</td>
						<td class="timestamp">{new Date(entry.timestamp).toLocaleString()}</td>
						<td><span class="event-badge">{entry.eventType}</span></td>
						<td class="mono">{entry.sessionId.slice(0, 8)}...</td>
						<td class="detail">{JSON.stringify(entry.detail).slice(0, 80)}</td>
						<td class="mono hash">{entry.chainHash.slice(0, 12)}...</td>
					</tr>
				{:else}
					<tr>
						<td colspan="6" class="empty">No audit entries match filters</td>
					</tr>
				{/each}
			</tbody>
		</table>

		<div class="pagination">
			<button disabled={currentPage <= 0}>Prev</button>
			<span>Page {currentPage + 1} of {pageCount}</span>
			<button disabled={currentPage >= pageCount - 1}>Next</button>
		</div>
	{/if}
</div>

<style>
	.audit-explorer {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.filter-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: flex-end;
		padding: 0.75rem;
		background: var(--color-surface);
		border-radius: 8px;
		border: 1px solid var(--color-border);
	}

	.filter-group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.filter-group label {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.filter-group select,
	.filter-group input {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		padding: 0.375rem 0.5rem;
		color: var(--color-text);
		font-size: 0.8rem;
	}

	.result-count {
		margin-left: auto;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		align-self: center;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}

	th {
		text-align: left;
		padding: 0.5rem;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-border);
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	td {
		padding: 0.5rem;
		border-bottom: 1px solid color-mix(in srgb, var(--color-border) 50%, transparent);
	}

	.mono {
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}

	.timestamp {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.event-badge {
		display: inline-block;
		padding: 0.125rem 0.4rem;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 500;
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
		color: var(--color-accent-hover);
	}

	.event-error .event-badge {
		background: color-mix(in srgb, var(--color-error) 20%, transparent);
		color: var(--color-error);
	}

	.event-success .event-badge {
		background: color-mix(in srgb, var(--color-success) 20%, transparent);
		color: var(--color-success);
	}

	.detail {
		max-width: 300px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.hash {
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.pagination {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 1rem;
		padding: 0.5rem;
	}

	.pagination button {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		padding: 0.375rem 0.75rem;
		color: var(--color-text);
		cursor: pointer;
		font-size: 0.8rem;
	}

	.pagination button:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.pagination span {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.loading,
	.empty {
		text-align: center;
		padding: 2rem;
		color: var(--color-text-muted);
	}
</style>
