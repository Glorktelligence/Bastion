<script>
import '../app.css';

const { children } = $props();
</script>

<div class="admin-layout">
	<nav class="sidebar">
		<div class="sidebar-header">
			<h1>Bastion</h1>
			<span class="subtitle">Relay Admin</span>
		</div>
		<ul class="nav-items">
			<li><a href="/">Overview</a></li>
			<li><a href="/providers">Providers</a></li>
			<li><a href="/blocklist">Blocklist</a></li>
			<li><a href="/quarantine">Quarantine</a></li>
			<li><a href="/connections">Connections</a></li>
			<li><a href="/config">Configuration</a></li>
		</ul>
	</nav>
	<main class="content">
		{@render children()}
	</main>
</div>

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

	.content {
		flex: 1;
		padding: 2rem;
		overflow-y: auto;
	}
</style>
