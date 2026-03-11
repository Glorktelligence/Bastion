<script>
// System Configuration — Task 3.11
// Relay settings, safety floors, TLS status, audit chain integrity
</script>

<div class="config-page">
	<h2>System Configuration</h2>

	<div class="config-grid">
		<div class="config-section">
			<h3>Relay Settings</h3>
			<dl>
				<dt>Port</dt><dd>9443</dd>
				<dt>Admin Port</dt><dd>9444</dd>
				<dt>Max Connections</dt><dd>100</dd>
				<dt>Heartbeat Interval</dt><dd>30s</dd>
				<dt>Heartbeat Timeout</dt><dd>90s</dd>
			</dl>
		</div>

		<div class="config-section">
			<h3>Safety Floors</h3>
			<dl>
				<dt>Challenge Threshold</dt><dd>0.6</dd>
				<dt>Denial Threshold</dt><dd>0.9</dd>
				<dt>Max Risk Score</dt><dd>1.0</dd>
			</dl>
			<p class="note">Safety floors can be tightened but never lowered below factory defaults.</p>
		</div>

		<div class="config-section">
			<h3>TLS Status</h3>
			<dl>
				<dt>Enabled</dt><dd><span class="badge badge-warning">Pending</span></dd>
				<dt>Certificate Expiry</dt><dd>—</dd>
				<dt>Protocol</dt><dd>—</dd>
				<dt>Cipher</dt><dd>—</dd>
			</dl>
		</div>

		<div class="config-section">
			<h3>Audit Chain Integrity</h3>
			<dl>
				<dt>Total Entries</dt><dd>0</dd>
				<dt>Chain Valid</dt><dd><span class="badge badge-success">Valid</span></dd>
				<dt>Last Verified</dt><dd>—</dd>
			</dl>
		</div>
	</div>
</div>

<style>
	.config-page h2 {
		margin-bottom: 1.5rem;
		font-size: 1.5rem;
	}

	.config-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 1.5rem;
	}

	.config-section {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 0.5rem;
		padding: 1.25rem;
	}

	.config-section h3 {
		margin-bottom: 1rem;
		font-size: 1rem;
		color: var(--text-secondary);
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.375rem 1rem;
	}

	dt {
		color: var(--text-muted);
		font-size: 0.8rem;
	}

	dd {
		color: var(--text-primary);
		font-size: 0.875rem;
		font-weight: 500;
	}

	.note {
		margin-top: 0.75rem;
		font-size: 0.75rem;
		color: var(--text-muted);
		font-style: italic;
	}

	.badge {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 600;
	}

	.badge-success {
		background: color-mix(in srgb, var(--status-success) 20%, transparent);
		color: var(--status-success);
	}

	.badge-warning {
		background: color-mix(in srgb, var(--status-warning) 20%, transparent);
		color: var(--status-warning);
	}
</style>
