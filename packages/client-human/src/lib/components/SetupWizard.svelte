<script lang="ts">
import * as session from '../session.js';

const { onComplete }: { onComplete: () => void } = $props();

const configStore = session.getConfigStore();

let step = $state(1);
let relayUrl = $state('');
let displayName = $state('');
let userId = $state(session.generateUserId());
let testStatus = $state<'idle' | 'testing' | 'success' | 'failed'>('idle');
let testError = $state('');

function testConnection(): void {
	if (!relayUrl.trim()) return;
	testStatus = 'testing';
	testError = '';

	let ws: WebSocket;
	try {
		ws = new WebSocket(relayUrl.trim());
	} catch (err) {
		testStatus = 'failed';
		testError = err instanceof Error ? err.message : String(err);
		return;
	}

	const timer = setTimeout(() => {
		ws.close();
		testStatus = 'failed';
		testError = 'Connection timed out (10s). Check the URL and ensure the relay is running.';
	}, 10000);

	ws.onopen = () => {
		clearTimeout(timer);
		testStatus = 'success';
		ws.close();
	};

	ws.onerror = () => {
		clearTimeout(timer);
		testStatus = 'failed';
		testError = 'Connection failed. If using a self-signed certificate, accept it in your browser first by visiting the relay URL.';
	};
}

function completeSetup(): void {
	configStore.set('relayUrl', relayUrl.trim());
	configStore.set('displayName', displayName.trim());
	configStore.set('userId', userId.trim());
	configStore.set('setupComplete', true);
	configStore.set('lastConnected', new Date().toISOString());
	onComplete();
}
</script>

<div class="wizard-container">
	<div class="wizard-card">
		<div class="wizard-header">
			<h1>Project Bastion</h1>
			<p class="subtitle">Secure Human-AI Communication</p>
		</div>

		<div class="steps-indicator">
			<span class="step-dot" class:active={step >= 1}>1</span>
			<span class="step-line" class:active={step >= 2}></span>
			<span class="step-dot" class:active={step >= 2}>2</span>
			<span class="step-line" class:active={step >= 3}></span>
			<span class="step-dot" class:active={step >= 3}>3</span>
		</div>

		{#if step === 1}
			<div class="step-content">
				<h2>Connect to a Relay</h2>
				<p class="hint">Enter the WebSocket URL of your Bastion relay server.</p>

				<label>
					Relay URL
					<input type="text" bind:value={relayUrl} placeholder="wss://relay.example.com:9443" />
				</label>

				<button class="btn-test" onclick={testConnection} disabled={!relayUrl.trim() || testStatus === 'testing'}>
					{testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
				</button>

				{#if testStatus === 'success'}
					<div class="status-msg success">Connected successfully</div>
				{/if}
				{#if testStatus === 'failed'}
					<div class="status-msg error">{testError}</div>
				{/if}

				<button class="btn-next" onclick={() => { step = 2; }} disabled={testStatus !== 'success'}>Next</button>
			</div>
		{/if}

		{#if step === 2}
			<div class="step-content">
				<h2>Create Your Identity</h2>
				<p class="hint">Your display name is visible to the relay. Your user ID is your unique identifier.</p>

				<label>
					Display Name
					<input type="text" bind:value={displayName} placeholder="e.g. Harry" />
				</label>

				<label>
					User ID <span class="label-hint">(auto-generated, editable for advanced users)</span>
					<input type="text" bind:value={userId} class="mono-input" />
				</label>

				<div class="step-nav">
					<button class="btn-back" onclick={() => { step = 1; }}>Back</button>
					<button class="btn-next" onclick={() => { step = 3; }} disabled={!displayName.trim() || !userId.trim()}>Next</button>
				</div>
			</div>
		{/if}

		{#if step === 3}
			<div class="step-content">
				<h2>Ready to Go</h2>
				<div class="summary">
					<div class="summary-row">
						<span class="summary-label">Relay</span>
						<code class="summary-value">{relayUrl}</code>
					</div>
					<div class="summary-row">
						<span class="summary-label">Name</span>
						<span class="summary-value">{displayName}</span>
					</div>
					<div class="summary-row">
						<span class="summary-label">User ID</span>
						<code class="summary-value">{userId}</code>
					</div>
				</div>

				<div class="step-nav">
					<button class="btn-back" onclick={() => { step = 2; }}>Back</button>
					<button class="btn-start" onclick={completeSetup}>Start Messaging</button>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.wizard-container { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--color-bg, #0a0a1a); padding: 1rem; }
	.wizard-card { background: var(--color-surface, #111128); border: 1px solid var(--color-border, #2a2a4a); border-radius: 0.75rem; padding: 2rem; width: 100%; max-width: 440px; }
	.wizard-header { text-align: center; margin-bottom: 1.5rem; }
	h1 { font-size: 1.5rem; color: var(--color-accent, #4a9eff); }
	.subtitle { font-size: 0.85rem; color: var(--color-text-muted, #666); }

	.steps-indicator { display: flex; align-items: center; justify-content: center; gap: 0; margin-bottom: 1.5rem; }
	.step-dot { width: 1.5rem; height: 1.5rem; border-radius: 50%; background: var(--color-border, #333); color: var(--color-text-muted, #666); font-size: 0.7rem; display: flex; align-items: center; justify-content: center; font-weight: 600; }
	.step-dot.active { background: var(--color-accent, #4a9eff); color: white; }
	.step-line { width: 2rem; height: 2px; background: var(--color-border, #333); }
	.step-line.active { background: var(--color-accent, #4a9eff); }

	.step-content { display: flex; flex-direction: column; gap: 0.75rem; }
	h2 { font-size: 1.1rem; color: var(--color-text, #eee); margin: 0; }
	.hint { font-size: 0.8rem; color: var(--color-text-muted, #888); margin: 0; }

	label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.8rem; color: var(--color-text-muted, #aaa); }
	.label-hint { font-size: 0.7rem; opacity: 0.7; }
	input { padding: 0.5rem; border: 1px solid var(--color-border, #333); border-radius: 0.25rem; background: var(--color-bg, #0a0a1a); color: var(--color-text, #eee); font-size: 0.9rem; }
	.mono-input { font-family: monospace; font-size: 0.8rem; }

	.btn-test, .btn-next, .btn-back, .btn-start { padding: 0.5rem 1rem; border-radius: 0.375rem; font-size: 0.875rem; font-weight: 500; cursor: pointer; border: none; }
	.btn-test { background: var(--color-surface, #1a1a2e); color: var(--color-text, #eee); border: 1px solid var(--color-border, #333); }
	.btn-next, .btn-start { background: var(--color-accent, #4a9eff); color: white; }
	.btn-back { background: transparent; color: var(--color-text-muted, #888); border: 1px solid var(--color-border, #333); }
	.btn-next:disabled, .btn-test:disabled { opacity: 0.5; cursor: not-allowed; }

	.step-nav { display: flex; gap: 0.5rem; justify-content: space-between; margin-top: 0.5rem; }

	.status-msg { padding: 0.375rem 0.75rem; border-radius: 0.25rem; font-size: 0.8rem; }
	.status-msg.success { background: #22c55e20; color: #22c55e; }
	.status-msg.error { background: #ef444420; color: #ef4444; }

	.summary { background: var(--color-bg, #0a0a1a); border: 1px solid var(--color-border, #333); border-radius: 0.375rem; padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
	.summary-row { display: flex; justify-content: space-between; align-items: center; }
	.summary-label { font-size: 0.8rem; color: var(--color-text-muted, #888); }
	.summary-value { font-size: 0.85rem; color: var(--color-text, #eee); }
	code.summary-value { font-family: monospace; font-size: 0.8rem; }
</style>
