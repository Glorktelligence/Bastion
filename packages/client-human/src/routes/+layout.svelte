<script>
import '../app.css';
import { page } from '$app/state';

const { children } = $props();
</script>

<div class="app-layout">
	<aside class="sidebar">
		<div class="sidebar-header">
			<h1>Bastion</h1>
		</div>
		<nav class="sidebar-nav">
			<a href="/" class="nav-item" class:active={page.url.pathname === '/'}>Messages</a>
			<a href="/tasks" class="nav-item" class:active={page.url.pathname === '/tasks'}>Tasks</a>
			<a href="/challenges" class="nav-item" class:active={page.url.pathname === '/challenges'}>Challenges</a>
			<a href="/audit" class="nav-item" class:active={page.url.pathname === '/audit'}>Audit Log</a>
			<a href="/settings" class="nav-item" class:active={page.url.pathname === '/settings'}>Settings</a>
		</nav>
	</aside>
	<main class="main-area">
		{@render children()}
	</main>
</div>

<style>
	.app-layout {
		display: flex;
		height: 100vh;
		width: 100vw;
	}

	.sidebar {
		width: 220px;
		min-width: 220px;
		background: var(--color-surface);
		border-right: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
	}

	.sidebar-header {
		padding: 1rem;
		border-bottom: 1px solid var(--color-border);
	}

	.sidebar-header h1 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--color-accent);
	}

	.sidebar-nav {
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.nav-item {
		display: block;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		text-decoration: none;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.nav-item:hover,
	.nav-item.active {
		background: var(--color-border);
		color: var(--color-text);
	}

	.main-area {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
</style>
