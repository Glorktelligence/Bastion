<script>
/** @type {{ onSetupComplete: (username: string, password: string, totpSecret: string, totpCode: string) => Promise<string | null> }} */
const { onSetupComplete } = $props();

let step = $state(1);
let username = $state('admin');
let password = $state('');
let confirmPassword = $state('');
let totpSecret = $state('');
let totpCode = $state('');
let error = $state('');
let loading = $state(false);

// Password strength
let pwErrors = $derived.by(() => {
	const errs = [];
	if (password.length < 12) errs.push('12+ characters');
	if (!/[A-Z]/.test(password)) errs.push('uppercase letter');
	if (!/[a-z]/.test(password)) errs.push('lowercase letter');
	if (!/[0-9]/.test(password)) errs.push('digit');
	return errs;
});

let passwordValid = $derived(pwErrors.length === 0 && password === confirmPassword && password.length > 0);

// Base32 encoding for TOTP secret generation
function generateSecret() {
	const bytes = new Uint8Array(20);
	crypto.getRandomValues(bytes);
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	let bits = '';
	for (const b of bytes) bits += b.toString(2).padStart(8, '0');
	while (bits.length % 5 !== 0) bits += '0';
	let result = '';
	for (let i = 0; i < bits.length; i += 5) result += chars[parseInt(bits.slice(i, i + 5), 2)];
	while (result.length % 8 !== 0) result += '=';
	return result;
}

function goToStep2() {
	if (!passwordValid) return;
	totpSecret = generateSecret();
	step = 2;
}

function goToStep3() {
	step = 3;
}

async function handleVerify() {
	if (totpCode.length < 6) return;
	loading = true;
	error = '';
	const err = await onSetupComplete(username, password, totpSecret, totpCode);
	loading = false;
	if (err) {
		error = err;
		totpCode = '';
	}
}

let otpauthUri = $derived(
	`otpauth://totp/Bastion:${encodeURIComponent(username)}?secret=${totpSecret.replace(/=+$/, '')}&issuer=Bastion&digits=6&period=30`
);
</script>

<div class="setup-container">
	<div class="setup-card">
		<h1>Bastion Admin Setup</h1>
		<p class="subtitle">First-time configuration — create your admin account</p>
		<div class="steps">
			<span class="step" class:active={step >= 1}>1. Credentials</span>
			<span class="step" class:active={step >= 2}>2. Authenticator</span>
			<span class="step" class:active={step >= 3}>3. Verify</span>
		</div>

		{#if error}
			<div class="error-banner">{error}</div>
		{/if}

		{#if step === 1}
			<div class="step-content">
				<label>
					Username
					<input type="text" bind:value={username} />
				</label>
				<label>
					Password
					<input type="password" bind:value={password} />
				</label>
				{#if password.length > 0 && pwErrors.length > 0}
					<p class="pw-hint">Needs: {pwErrors.join(', ')}</p>
				{/if}
				<label>
					Confirm Password
					<input type="password" bind:value={confirmPassword} />
				</label>
				{#if confirmPassword && password !== confirmPassword}
					<p class="pw-hint">Passwords don't match</p>
				{/if}
				<button onclick={goToStep2} disabled={!passwordValid}>Next</button>
			</div>
		{/if}

		{#if step === 2}
			<div class="step-content">
				<p>Add this account to your authenticator app (Google Authenticator, Authy, etc.):</p>
				<div class="totp-display">
					<label>Manual Entry Key</label>
					<code class="secret-code">{totpSecret}</code>
					<label>Or copy this URI</label>
					<code class="secret-code uri">{otpauthUri}</code>
				</div>
				<p class="hint">Account: Bastion:{username} | Algorithm: SHA1 | Digits: 6 | Period: 30s</p>
				<button onclick={goToStep3}>I've added it — Next</button>
			</div>
		{/if}

		{#if step === 3}
			<div class="step-content">
				<p>Enter the 6-digit code from your authenticator to verify setup:</p>
				<label>
					TOTP Code
					<input type="text" bind:value={totpCode} placeholder="6-digit code" maxlength="6" inputmode="numeric" />
				</label>
				<button onclick={handleVerify} disabled={loading || totpCode.length < 6}>
					{loading ? 'Verifying...' : 'Complete Setup'}
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.setup-container { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--bg-base, #0a0a1a); }
	.setup-card { background: var(--bg-surface, #111128); border: 1px solid var(--border-default, #2a2a4a); border-radius: 0.75rem; padding: 2rem; width: 100%; max-width: 440px; }
	h1 { font-size: 1.5rem; margin-bottom: 0.25rem; color: var(--text-primary, #e0e0ff); }
	.subtitle { font-size: 0.85rem; color: var(--text-muted, #666); margin-bottom: 1rem; }
	.steps { display: flex; gap: 1rem; margin-bottom: 1.5rem; font-size: 0.75rem; color: var(--text-muted, #666); }
	.step.active { color: var(--accent-primary, #4a9eff); font-weight: 600; }
	.step-content { display: flex; flex-direction: column; gap: 0.75rem; }
	label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.8rem; color: var(--text-secondary, #aaa); }
	input { padding: 0.5rem; border: 1px solid var(--border-default, #2a2a4a); border-radius: 0.25rem; background: var(--bg-base, #0a0a1a); color: var(--text-primary, #e0e0ff); font-size: 0.9rem; }
	button { padding: 0.6rem; background: var(--accent-primary, #4a9eff); color: white; border: none; border-radius: 0.375rem; font-size: 0.9rem; font-weight: 500; cursor: pointer; }
	button:hover { background: var(--accent-secondary, #3a8eef); }
	button:disabled { opacity: 0.5; cursor: not-allowed; }
	.pw-hint { font-size: 0.75rem; color: var(--status-warning, #f59e0b); margin: 0; }
	.hint { font-size: 0.75rem; color: var(--text-muted, #666); }
	.totp-display { background: var(--bg-base, #0a0a1a); border: 1px solid var(--border-default, #2a2a4a); border-radius: 0.375rem; padding: 1rem; }
	.totp-display label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.5rem; }
	.totp-display label:first-child { margin-top: 0; }
	.secret-code { display: block; font-size: 0.85rem; word-break: break-all; color: var(--accent-primary, #4a9eff); padding: 0.375rem 0; user-select: all; cursor: text; }
	.secret-code.uri { font-size: 0.7rem; color: var(--text-muted, #666); }
	.error-banner { background: color-mix(in srgb, #ef4444 15%, transparent); color: #ef4444; padding: 0.5rem 0.75rem; border-radius: 0.25rem; font-size: 0.8rem; margin-bottom: 1rem; }
</style>
