<script>
/** @type {{ connections: readonly import('../types.js').ConnectionEntry[] }} */
const { connections } = $props();
</script>

<table>
	<thead>
		<tr>
			<th>Connection ID</th>
			<th>Address</th>
			<th>Type</th>
			<th>Auth</th>
			<th>Provider</th>
			<th>Messages</th>
			<th>Connected</th>
		</tr>
	</thead>
	<tbody>
		{#each connections as conn}
			<tr>
				<td class="conn-id">{conn.connectionId.slice(0, 8)}...</td>
				<td class="mono">{conn.remoteAddress}</td>
				<td>
					<span class="type-badge type-{conn.clientType}">{conn.clientType}</span>
				</td>
				<td>
					{#if conn.authenticated}
						<span class="dot dot-success"></span>
					{:else}
						<span class="dot dot-warning"></span>
					{/if}
				</td>
				<td class="mono">{conn.providerId ?? '—'}</td>
				<td>{conn.messageCount}</td>
				<td class="timestamp">{new Date(conn.connectedAt).toLocaleTimeString()}</td>
			</tr>
		{:else}
			<tr>
				<td colspan="7" class="empty">No active connections</td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	.conn-id {
		font-family: monospace;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.mono {
		font-family: monospace;
		font-size: 0.8rem;
	}

	.type-badge {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 600;
	}

	.type-human {
		background: color-mix(in srgb, var(--accent-primary) 20%, transparent);
		color: var(--accent-secondary);
	}

	.type-ai {
		background: color-mix(in srgb, var(--status-success) 20%, transparent);
		color: var(--status-success);
	}

	.type-unknown {
		background: color-mix(in srgb, var(--text-muted) 20%, transparent);
		color: var(--text-muted);
	}

	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.dot-success {
		background: var(--status-success);
	}

	.dot-warning {
		background: var(--status-warning);
	}

	.timestamp {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.empty {
		text-align: center;
		color: var(--text-muted);
		padding: 2rem;
	}
</style>
