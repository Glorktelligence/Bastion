<script>
/** @type {{ onLogin: (username: string, password: string, totpCode: string) => Promise<string | null> }} */
const { onLogin } = $props();

let username = $state('admin');
let password = $state('');
let totpCode = $state('');
let error = $state('');
let loading = $state(false);

async function handleSubmit() {
	if (!username || !password || !totpCode) return;
	loading = true;
	error = '';
	const err = await onLogin(username, password, totpCode);
	loading = false;
	if (err) {
		error = err;
		totpCode = '';
	}
}
</script>

<div class="login-container">
	<div class="login-card">
		<h1>Bastion Admin</h1>
		<p class="subtitle">Relay administration panel</p>

		{#if error}
			<div class="error-banner">{error}</div>
		{/if}

		<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
			<label>
				Username
				<input type="text" bind:value={username} autocomplete="username" />
			</label>
			<label>
				Password
				<input type="password" bind:value={password} autocomplete="current-password" />
			</label>
			<label>
				TOTP Code
				<input type="text" bind:value={totpCode} placeholder="6-digit code" maxlength="6" inputmode="numeric" autocomplete="one-time-code" />
			</label>
			<button type="submit" disabled={loading || !username || !password || totpCode.length < 6}>
				{loading ? 'Signing in...' : 'Sign In'}
			</button>
		</form>
	</div>
</div>

<style>
	.login-container {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		background: var(--bg-base, #0a0a1a);
	}
	.login-card {
		background: var(--bg-surface, #111128);
		border: 1px solid var(--border-default, #2a2a4a);
		border-radius: 0.75rem;
		padding: 2rem;
		width: 100%;
		max-width: 360px;
	}
	h1 { font-size: 1.5rem; margin-bottom: 0.25rem; color: var(--text-primary, #e0e0ff); }
	.subtitle { font-size: 0.85rem; color: var(--text-muted, #666); margin-bottom: 1.5rem; }
	label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.8rem; color: var(--text-secondary, #aaa); margin-bottom: 0.75rem; }
	input { padding: 0.5rem; border: 1px solid var(--border-default, #2a2a4a); border-radius: 0.25rem; background: var(--bg-base, #0a0a1a); color: var(--text-primary, #e0e0ff); font-size: 0.9rem; }
	button { width: 100%; padding: 0.6rem; background: var(--accent-primary, #4a9eff); color: white; border: none; border-radius: 0.375rem; font-size: 0.9rem; font-weight: 500; cursor: pointer; margin-top: 0.5rem; }
	button:hover { background: var(--accent-secondary, #3a8eef); }
	button:disabled { opacity: 0.5; cursor: not-allowed; }
	.error-banner { background: color-mix(in srgb, #ef4444 15%, transparent); color: #ef4444; padding: 0.5rem 0.75rem; border-radius: 0.25rem; font-size: 0.8rem; margin-bottom: 1rem; }
</style>
