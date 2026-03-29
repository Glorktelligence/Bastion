<script>
import '../app.css';
import { onMount } from 'svelte';
import { browser } from '$app/environment';
import { page } from '$app/state';
import * as session from '$lib/session.js';
import SetupWizard from '$lib/components/SetupWizard.svelte';

const { children } = $props();

// During SSR: assume setup is complete (prevents wizard flash).
// Client hydration reads the real value from ConfigStore (localStorage).
const initialSetup = browser ? session.getConfigStore().get('setupComplete') : true;
let setupComplete = $state(initialSetup);

function handleSetupComplete() {
	setupComplete = true;
	if (browser) session.tryAutoConnect();
}

// Conversation state
let convList = $state([]);
let activeConvId = $state(null);
let archivedConvs = $state([]);
let showArchived = $state(false);
let showNewForm = $state(false);
let newConvName = $state('');
let newConvType = $state('normal');
let newConvAdapter = $state('');
let availableAdapters = $state([]);
let extensionPages = $state([]);

// Use onMount (NOT $effect) to set up store subscriptions.
// $effect tracks reactive reads inside synchronous callbacks — our custom
// store.subscribe() calls the callback immediately with the current value,
// and if that callback reads $state (e.g. `if (!newConvAdapter)`), Svelte
// tracks it as a dependency. The subsequent $state write triggers the
// effect to re-run, creating an infinite loop (effect_update_depth_exceeded).
// onMount has no reactive tracking context, so this problem cannot occur.
onMount(() => {
	// Auto-connect once
	const cfg = session.getConfigStore();
	setupComplete = cfg.get('setupComplete');
	if (setupComplete) {
		session.tryAutoConnect();
	}

	// Store subscriptions — callbacks update $state but onMount won't re-run
	const subs = [
		session.conversations.store.subscribe((s) => {
			convList = s.conversations.filter((c) => !c.archived);
			activeConvId = s.activeConversationId;
		}),
		session.conversations.archivedConversations.subscribe((a) => {
			archivedConvs = a;
		}),
		session.provider.store.subscribe((v) => {
			const adpts = v.provider?.adapters ?? [];
			availableAdapters = adpts.filter((a) => a.roles.includes('default') || a.roles.includes('conversation'));
			if (!newConvAdapter && availableAdapters.length > 0) {
				const def = availableAdapters.find((a) => a.roles.includes('default'));
				newConvAdapter = def?.id ?? availableAdapters[0]?.id ?? '';
			}
		}),
		session.extensions.extensionsWithUI.subscribe((exts) => {
			extensionPages = exts.flatMap((e) => (e.ui?.pages ?? []).map((p) => ({ namespace: e.namespace, pageId: p.id, name: p.name, icon: p.icon })));
		}),
	];

	return () => {
		for (const u of subs) u();
	};
});

function handleSwitchConversation(id) {
	const client = session.getClient();
	if (!client) return;
	client.send(JSON.stringify({
		type: 'conversation_switch',
		id: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		sender: session.getIdentity(),
		payload: { conversationId: id },
	}));
}

function handleCreateConversation() {
	const client = session.getClient();
	if (!client) return;
	client.send(JSON.stringify({
		type: 'conversation_create',
		id: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		sender: session.getIdentity(),
		payload: { name: newConvName.trim() || undefined, type: newConvType, preferredAdapter: newConvAdapter || undefined },
	}));
	newConvName = '';
	newConvType = 'normal';
	showNewForm = false;
}

function relativeTime(iso) {
	if (!iso) return '';
	const diff = Date.now() - new Date(iso).getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return 'now';
	if (mins < 60) return `${mins}m`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h`;
	const days = Math.floor(hrs / 24);
	return `${days}d`;
}
</script>

{#if !setupComplete}
	<SetupWizard onComplete={handleSetupComplete} />
{:else}
<div class="app-layout">
	<aside class="sidebar">
		<div class="sidebar-header">
			<h1>Bastion</h1>
		</div>

		<!-- Conversation list -->
		<div class="conv-section">
			<div class="conv-header">
				<span class="conv-title">Conversations</span>
				<button class="conv-new-btn" onclick={() => { showNewForm = !showNewForm; }} title="New conversation">+</button>
			</div>

			{#if showNewForm}
				<div class="conv-new-form">
					<input type="text" class="conv-input" bind:value={newConvName} placeholder="Name (optional)" onkeydown={(e) => { if (e.key === 'Enter') handleCreateConversation(); }} />
					<div class="conv-type-row">
						<label class="conv-type-label">
							<input type="radio" bind:group={newConvType} value="normal" /> Normal
						</label>
						<label class="conv-type-label">
							<input type="radio" bind:group={newConvType} value="game" /> Game
						</label>
					</div>
					{#if availableAdapters.length > 1}
					<select class="conv-input" bind:value={newConvAdapter} style="font-size:0.75rem;">
						{#each availableAdapters as ad}
							<option value={ad.id}>{ad.name} ({ad.model})</option>
						{/each}
					</select>
					{/if}
					<button class="conv-create-btn" onclick={handleCreateConversation}>Create</button>
				</div>
			{/if}

			<div class="conv-list">
				{#each convList as conv (conv.id)}
					<button
						class="conv-item"
						class:conv-active={conv.id === activeConvId}
						onclick={() => handleSwitchConversation(conv.id)}
					>
						<span class="conv-icon">{conv.type === 'game' ? '🎮' : '💬'}</span>
						<div class="conv-info">
							<span class="conv-name">{conv.name}</span>
							<span class="conv-preview">{conv.lastMessagePreview || 'No messages'}</span>
						</div>
						<span class="conv-time">{relativeTime(conv.updatedAt)}</span>
					</button>
				{:else}
					<p class="conv-empty">No conversations</p>
				{/each}
			</div>

			{#if archivedConvs.length > 0}
				<button class="conv-archived-toggle" onclick={() => { showArchived = !showArchived; }}>
					Archived ({archivedConvs.length}) {showArchived ? '▾' : '▸'}
				</button>
				{#if showArchived}
					<div class="conv-list conv-archived-list">
						{#each archivedConvs as conv (conv.id)}
							<button
								class="conv-item conv-archived-item"
								onclick={() => handleSwitchConversation(conv.id)}
							>
								<span class="conv-icon">{conv.type === 'game' ? '🎮' : '💬'}</span>
								<div class="conv-info">
									<span class="conv-name">{conv.name}</span>
								</div>
							</button>
						{/each}
					</div>
				{/if}
			{/if}
		</div>

		<!-- Navigation -->
		<nav class="sidebar-nav">
			<a href="/" class="nav-item" class:active={page.url.pathname === '/'}>Messages</a>
			<a href="/tasks" class="nav-item" class:active={page.url.pathname === '/tasks'}>Tasks</a>
			<a href="/challenges" class="nav-item" class:active={page.url.pathname === '/challenges'}>Challenges</a>
			<a href="/audit" class="nav-item" class:active={page.url.pathname === '/audit'}>Audit Log</a>
			<a href="/settings" class="nav-item" class:active={page.url.pathname === '/settings'}>Settings</a>

			{#if extensionPages.length > 0}
				<div class="nav-separator"></div>
				{#each extensionPages as ep}
					<a href="/extensions/{ep.namespace}" class="nav-item nav-ext" class:active={page.url.pathname === `/extensions/${ep.namespace}`}>
						<span class="nav-ext-icon">{ep.icon === 'sword' ? '⚔️' : ep.icon === 'game' ? '🎮' : '🧩'}</span>
						{ep.name}
					</a>
				{/each}
			{/if}
		</nav>
	</aside>
	<main class="main-area">
		{@render children()}
	</main>
</div>
{/if}

<style>
	.app-layout { display: flex; height: 100vh; width: 100vw; }

	.sidebar {
		width: 240px; min-width: 240px;
		background: var(--color-surface);
		border-right: 1px solid var(--color-border);
		display: flex; flex-direction: column;
	}

	.sidebar-header { padding: 1rem; border-bottom: 1px solid var(--color-border); }
	.sidebar-header h1 { font-size: 1.25rem; font-weight: 600; color: var(--color-accent); }

	/* Conversation section */
	.conv-section { flex: 1; overflow-y: auto; border-bottom: 1px solid var(--color-border); }
	.conv-header { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.75rem; }
	.conv-title { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-muted); }
	.conv-new-btn {
		width: 22px; height: 22px; border-radius: 4px;
		border: 1px solid var(--color-border); background: transparent;
		color: var(--color-text-muted); font-size: 1rem; line-height: 1; cursor: pointer;
		display: flex; align-items: center; justify-content: center;
	}
	.conv-new-btn:hover { background: var(--color-border); color: var(--color-text); }

	.conv-new-form { padding: 0.375rem 0.75rem 0.5rem; display: flex; flex-direction: column; gap: 0.375rem; }
	.conv-input {
		width: 100%; padding: 0.25rem 0.5rem; font-size: 0.8rem;
		border: 1px solid var(--color-border); border-radius: 4px;
		background: var(--color-bg, #0f0f23); color: var(--color-text);
	}
	.conv-type-row { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; }
	.conv-type-label { display: flex; align-items: center; gap: 0.2rem; color: var(--color-text-muted); cursor: pointer; }
	.conv-create-btn {
		margin-left: auto; padding: 0.2rem 0.5rem; font-size: 0.7rem;
		border-radius: 4px; border: none; background: var(--color-accent); color: #fff; cursor: pointer;
	}

	.conv-list { display: flex; flex-direction: column; padding: 0 0.375rem; }
	.conv-item {
		display: flex; align-items: flex-start; gap: 0.375rem;
		padding: 0.5rem; border-radius: 6px; border: none;
		background: transparent; cursor: pointer; text-align: left;
		width: 100%; color: var(--color-text-muted); font-size: 0.8rem;
	}
	.conv-item:hover { background: var(--color-border); color: var(--color-text); }
	.conv-active { background: color-mix(in srgb, var(--color-accent) 12%, transparent); color: var(--color-text); }
	.conv-icon { font-size: 0.9rem; flex-shrink: 0; margin-top: 0.05rem; }
	.conv-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.conv-name { font-size: 0.8rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.conv-preview { font-size: 0.7rem; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.conv-time { font-size: 0.65rem; color: var(--color-text-muted); flex-shrink: 0; margin-top: 0.1rem; }
	.conv-empty { text-align: center; color: var(--color-text-muted); font-size: 0.75rem; padding: 1rem; }

	.conv-archived-toggle {
		display: block; width: 100%; padding: 0.375rem 0.75rem;
		border: none; background: transparent; color: var(--color-text-muted);
		font-size: 0.7rem; text-align: left; cursor: pointer;
	}
	.conv-archived-toggle:hover { color: var(--color-text); }
	.conv-archived-list { opacity: 0.7; }
	.conv-archived-item { font-style: italic; }

	/* Navigation */
	.sidebar-nav { padding: 0.5rem; display: flex; flex-direction: column; gap: 0.25rem; }
	.nav-item {
		display: block; padding: 0.5rem 0.75rem; border-radius: 6px;
		text-decoration: none; color: var(--color-text-muted); font-size: 0.875rem;
	}
	.nav-item:hover, .nav-item.active { background: var(--color-border); color: var(--color-text); }
	.nav-separator { height: 1px; background: var(--color-border); margin: 0.375rem 0.75rem; }
	.nav-ext { display: flex; align-items: center; gap: 0.375rem; }
	.nav-ext-icon { font-size: 0.8rem; }
	.main-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
</style>
