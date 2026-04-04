<script>
import '../app.css';
import { page } from '$app/state';
import { AdminApiClient } from '$lib/api/admin-client.js';
import LoginPage from '$lib/components/LoginPage.svelte';
import SetupWizard from '$lib/components/SetupWizard.svelte';

const { children } = $props();

// Auth state
let authState = $state('loading'); // 'loading' | 'setup' | 'login' | 'authenticated'
let authError = $state('');

const client = new AdminApiClient({
	baseUrl: '',
	credentials: { username: '', password: '', totpCode: '' },
});

// Check admin status once on mount — not reactive
let checked = false;
$effect(() => {
	if (!checked) {
		checked = true;
		checkAdminStatus();
	}
	return () => {};
});

async function checkAdminStatus() {
	try {
		const result = await client.getAdminStatus();
		if (result.ok) {
			const d = result.data;
			if (d.requiresSetup) {
				authState = 'setup';
			} else {
				// Configured but we need to check if we have a session
				authState = client.hasSession ? 'authenticated' : 'login';
			}
		} else {
			// API unreachable — show dashboard in read-only mode
			authState = 'authenticated';
		}
	} catch {
		authState = 'authenticated'; // Fallback to read-only
	}
}

async function handleLogin(username, password, totpCode) {
	const result = await client.login(username, password, totpCode);
	if (result.ok) {
		authState = 'authenticated';
		return null;
	}
	const d = result.data;
	if (d.reason === 'account_locked') {
		return `Account locked until ${d.lockedUntil || 'unknown'}`;
	}
	return d.error || 'Authentication failed';
}

async function handleSetupComplete(username, password, totpSecret, totpCode) {
	const result = await client.setup(username, password, totpSecret, totpCode);
	if (result.ok) {
		authState = 'login';
		return null;
	}
	return result.data?.error || 'Setup failed';
}

async function handleLogout() {
	await client.logout();
	authState = 'login';
}
</script>

{#if authState === 'loading'}
	<div class="loading-screen">
		<p>Connecting to admin API...</p>
	</div>
{:else if authState === 'setup'}
	<SetupWizard onSetupComplete={handleSetupComplete} />
{:else if authState === 'login'}
	<LoginPage onLogin={handleLogin} />
{:else}
	<div class="admin-layout">
		<nav class="sidebar">
			<div class="sidebar-header">
				<h1>Bastion</h1>
				<span class="subtitle">Relay Admin</span>
			</div>
			<ul class="nav-items">
				<li><a href="/" class:active={page.url.pathname === '/'}>Overview</a></li>
				<li><a href="/providers" class:active={page.url.pathname === '/providers'}>Providers</a></li>
				<li><a href="/blocklist" class:active={page.url.pathname === '/blocklist'}>Blocklist</a></li>
				<li><a href="/quarantine" class:active={page.url.pathname === '/quarantine'}>Quarantine</a></li>
				<li><a href="/connections" class:active={page.url.pathname === '/connections'}>Connections</a></li>
				<li><a href="/audit" class:active={page.url.pathname === '/audit'}>Audit Log</a></li>
				<li><a href="/config" class:active={page.url.pathname === '/config'}>Configuration</a></li>
			</ul>
			<div class="sidebar-footer">
				<button class="logout-btn" onclick={handleLogout}>Logout</button>
			</div>
		</nav>
		<main class="content">
			{@render children()}
		</main>
	</div>
{/if}

<style>
	.admin-layout {
		display: flex;
		min-height: 100vh;
	}

	.sidebar {
		width: var(--sidebar-width);
		background-color: var(--bg-secondary);
		border-right: 1px solid var(--border-default);
		padding: 1.5rem 0;
		flex-shrink: 0;
	}

	.sidebar-header {
		padding: 0 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border-default);
	}

	.sidebar-header h1 {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--accent-primary);
	}

	.subtitle {
		font-size: 0.75rem;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}

	.nav-items {
		list-style: none;
		padding: 1rem 0;
	}

	.nav-items li a {
		display: block;
		padding: 0.625rem 1.25rem;
		color: var(--text-secondary);
		font-size: 0.875rem;
		transition: all 0.15s;
	}

	.nav-items li a:hover {
		color: var(--text-primary);
		background-color: var(--accent-muted);
		text-decoration: none;
	}

	.nav-items li a.active {
		color: var(--accent-secondary);
		background-color: var(--accent-muted);
		border-left: 3px solid var(--accent-primary);
		font-weight: 600;
	}

	.content {
		flex: 1;
		padding: 2rem;
		overflow-y: auto;
	}

	.sidebar-footer {
		padding: 1rem 1.25rem;
		margin-top: auto;
		border-top: 1px solid var(--border-default);
	}

	.logout-btn {
		width: 100%;
		padding: 0.5rem;
		background: transparent;
		color: var(--text-muted);
		border: 1px solid var(--border-default);
		border-radius: 0.25rem;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.logout-btn:hover {
		color: var(--status-error);
		border-color: var(--status-error);
	}

	.loading-screen {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		color: var(--text-muted, #666);
		font-size: 0.9rem;
	}
</style>
