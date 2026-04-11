<script lang="ts">
import '../app.css';
import { onMount } from 'svelte';
import { browser } from '$app/environment';
import { page } from '$app/state';
import { goto } from '$app/navigation';
import * as session from '$lib/session.js';
import { type UserPreferences, DEFAULT_USER_PREFERENCES } from '$lib/config/config-store.js';
import SetupWizard from '$lib/components/SetupWizard.svelte';
import AiDisclosureBanner from '$lib/components/AiDisclosureBanner.svelte';
import FileOfferBanner from '$lib/components/FileOfferBanner.svelte';

const { children } = $props();

// During SSR: assume setup is complete (prevents wizard flash).
// Client hydration reads the real value from ConfigStore (localStorage).
const initialSetup = browser ? session.getConfigStore().get('setupComplete') : true;
let setupComplete = $state(initialSetup);

// AI challenge dialog state
/** @type {import('$lib/session.js').AiChallengeState | null} */
let aiChallenge = $state(null);
let challengeTimerRemaining = $state(0);
let challengeTimerInterval = $state(null);

// AI memory proposal state
/** @type {import('$lib/session.js').AiMemoryProposalState | null} */
let aiMemoryProposal = $state(null);
let memoryEditText = $state('');

function handleSetupComplete() {
	setupComplete = true;
	if (browser) session.tryAutoConnect();
}

/** Convert hex colour to rgba string. Safe fallback for color-mix(). */
function hexToRgba(hex: string, alpha: number): string {
	const r = parseInt(hex.slice(1, 3), 16) || 0;
	const g = parseInt(hex.slice(3, 5), 16) || 0;
	const b = parseInt(hex.slice(5, 7), 16) || 0;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Lighten a hex colour by blending toward white. */
function lightenHex(hex: string): string {
	const blend = (ch: string, pct: number): number =>
		Math.min(255, Math.round(parseInt(ch, 16) + (255 - parseInt(ch, 16)) * pct));
	const r = blend(hex.slice(1, 3), 0.3);
	const g = blend(hex.slice(3, 5), 0.3);
	const b = blend(hex.slice(5, 7), 0.3);
	return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Apply UserPreferences as CSS custom properties on the document root.
 *  IMPORTANT: No color-mix() — Tauri WebView may not support it. Use
 *  hexToRgba() and lightenHex() for all derived colours. */
function applyPreferences(prefs: UserPreferences): void {
	if (!browser) return;
	const root = document.documentElement;
	root.style.setProperty('--color-accent', prefs.accentColor);
	root.style.setProperty('--color-accent-hover', lightenHex(prefs.accentColor));
	root.style.setProperty(
		'--color-user-bubble',
		prefs.userBubbleColor || prefs.accentColor,
	);
	root.style.setProperty(
		'--color-ai-bubble',
		prefs.aiBubbleColor || '#1a1d27',
	);
	root.style.setProperty('--msg-font-size', `${prefs.messageFontSize}rem`);

	if (prefs.compactMode) root.classList.add('compact');
	else root.classList.remove('compact');

	if (prefs.timestampDisplay === 'hover') root.classList.add('timestamp-hover');
	else root.classList.remove('timestamp-hover');
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

// AI Disclosure banner state (relay-configurable, all pages)
let disclosureData = $state(null);
let disclosureDismissed = $state(false);

// File offer banner state (global — file offers can arrive on any page)
let pendingFileOffer = $state(null);

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
		session.aiDisclosure.store.subscribe((v) => {
			disclosureData = v.disclosure;
			disclosureDismissed = v.dismissed;
		}),
		session.fileTransfers.store.subscribe((v) => {
			pendingFileOffer = v.pendingOffer;
		}),
		session.activeAiChallenge.subscribe((v) => {
			aiChallenge = v;
			if (v && v.waitSeconds > 0) {
				challengeTimerRemaining = v.waitSeconds;
				if (challengeTimerInterval) clearInterval(challengeTimerInterval);
				challengeTimerInterval = setInterval(() => {
					challengeTimerRemaining--;
					if (challengeTimerRemaining <= 0 && challengeTimerInterval) {
						clearInterval(challengeTimerInterval);
						challengeTimerInterval = null;
					}
				}, 1000);
			} else {
				challengeTimerRemaining = 0;
			}
		}),
		session.activeAiMemoryProposal.subscribe((v) => {
			aiMemoryProposal = v;
			memoryEditText = v?.content ?? '';
		}),
	];

	session.aiDisclosure.resetDismissal();

	// Apply user preferences from ConfigStore
	const prefs = cfg.get('preferences') ?? DEFAULT_USER_PREFERENCES;
	applyPreferences(prefs as UserPreferences);

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
	// Navigate to messages view if on another page
	if (page.url.pathname !== '/') {
		goto('/');
	}
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

function handleFileAccept() {
	const client = session.getClient();
	if (!client) return;
	const offer = session.fileTransfers.acceptOffer();
	if (!offer) return;
	client.send(JSON.stringify({
		type: 'file_request',
		id: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		sender: session.getIdentity(),
		payload: {
			transferId: offer.transferId,
			manifestMessageId: offer.messageId,
		},
	}));
}

function handleChallengeResponse(decision) {
	const client = session.getClient();
	if (!client || !aiChallenge) return;
	client.send(JSON.stringify({
		type: 'ai_challenge_response',
		id: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		sender: session.getIdentity(),
		payload: { challengeId: aiChallenge.challengeId, decision },
	}));
	session.activeAiChallenge.set(null);
	if (challengeTimerInterval) { clearInterval(challengeTimerInterval); challengeTimerInterval = null; }
}

function handleMemoryProposalSave(editedContent) {
	const client = session.getClient();
	if (!client || !aiMemoryProposal) return;
	client.send(JSON.stringify({
		type: 'memory_proposal',
		id: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		sender: session.getIdentity(),
		payload: {
			proposalId: aiMemoryProposal.proposalId,
			content: editedContent || aiMemoryProposal.content,
			category: aiMemoryProposal.category,
			sourceMessageId: 'ai-proposal',
		},
	}));
	session.activeAiMemoryProposal.set(null);
}

function handleMemoryProposalDismiss() {
	session.activeAiMemoryProposal.set(null);
}

function handleFileReject() {
	const offer = session.fileTransfers.rejectOffer();
	if (offer) {
		// Notify relay so it can purge from quarantine
		const client = session.getClient();
		if (client) {
			client.send(JSON.stringify({
				type: 'file_reject',
				id: crypto.randomUUID(),
				timestamp: new Date().toISOString(),
				sender: session.getIdentity(),
				payload: { transferId: offer.transferId },
			}));
		}
		session.addNotification(`File rejected: ${offer.filename}`, 'info');
	}
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
							<option value={ad.id}>{ad.name}{ad.maxContextTokens ? ` (${ad.maxContextTokens >= 1000000 ? `${Math.round(ad.maxContextTokens / 1000000)}M` : `${Math.round(ad.maxContextTokens / 1000)}k`} context)` : ''}</option>
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
			<a href="/dreams" class="nav-item" class:active={page.url.pathname === '/dreams'}>Dreams</a>
			<a href="/file-transfer" class="nav-item" class:active={page.url.pathname === '/file-transfer'}>File Transfer</a>
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
		<div class="sidebar-footer">
			<span class="version-label">Bastion v{__BASTION_VERSION__}</span>
		</div>
	</aside>
	<main class="main-area">
		{#if pendingFileOffer}
			<FileOfferBanner
				offer={pendingFileOffer}
				onAccept={handleFileAccept}
				onReject={handleFileReject}
			/>
		{/if}
		{#if disclosureData?.position === 'banner'}
			<AiDisclosureBanner disclosure={disclosureData} dismissed={disclosureDismissed} onDismiss={() => session.aiDisclosure.dismiss()} />
		{/if}
		{@render children()}

		{#if aiMemoryProposal}
		<div class="ai-memory-toast">
			<div class="ai-memory-header">Claude suggests remembering:</div>
			<textarea
				class="ai-memory-edit"
				bind:value={memoryEditText}
				rows="3"
			></textarea>
			<div class="ai-memory-meta">Category: {aiMemoryProposal.category} &middot; {aiMemoryProposal.reason}</div>
			<div class="ai-memory-actions">
				<button class="ai-mem-btn ai-mem-save" onclick={() => handleMemoryProposalSave(memoryEditText)}>Save</button>
				<button class="ai-mem-btn ai-mem-dismiss" onclick={handleMemoryProposalDismiss}>Dismiss</button>
			</div>
		</div>
		{/if}

		{#if disclosureData?.position === 'footer'}
			<AiDisclosureBanner disclosure={disclosureData} dismissed={disclosureDismissed} onDismiss={() => session.aiDisclosure.dismiss()} />
		{/if}
	</main>
</div>

{#if aiChallenge}
<div class="challenge-overlay">
	<div class="challenge-dialog" class:challenge-critical={aiChallenge.severity === 'critical'} class:challenge-warning={aiChallenge.severity === 'warning'}>
		<div class="challenge-header">
			{#if aiChallenge.severity === 'critical'}&#9888;&#65039;{:else if aiChallenge.severity === 'warning'}&#9888;&#65039;{:else}&#8505;&#65039;{/if}
			AI Challenge
		</div>
		<p class="challenge-reason">{aiChallenge.reason}</p>
		{#if aiChallenge.suggestedAction}
		<p class="challenge-suggestion"><strong>Suggested:</strong> {aiChallenge.suggestedAction}</p>
		{/if}
		<div class="challenge-actions">
			<button class="ai-mem-btn ai-mem-save" onclick={() => handleChallengeResponse('accept')} disabled={challengeTimerRemaining > 0}>
				Accept{#if challengeTimerRemaining > 0} ({challengeTimerRemaining}s){/if}
			</button>
			<button class="ai-mem-btn ai-mem-dismiss" onclick={() => handleChallengeResponse('override')} disabled={challengeTimerRemaining > 0}>
				Override{#if challengeTimerRemaining > 0} ({challengeTimerRemaining}s){/if}
			</button>
			<button class="ai-mem-btn" onclick={() => handleChallengeResponse('cancel')}>Cancel</button>
		</div>
	</div>
</div>
{/if}
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
	.main-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; position: relative; }

	/* AI Challenge Dialog */
	.challenge-overlay {
		position: fixed; inset: 0; z-index: 1000;
		background: rgba(0, 0, 0, 0.6); display: flex; align-items: center; justify-content: center;
	}
	.challenge-dialog {
		background: var(--color-surface, #1a1a2e); border: 2px solid #e5a100;
		border-radius: 0.75rem; padding: 1.5rem; max-width: 420px; width: 90%;
	}
	.challenge-critical { border-color: #ef4444; }
	.challenge-warning { border-color: #e5a100; }
	.challenge-header {
		font-size: 1.1rem; font-weight: 700; color: var(--color-text); margin-bottom: 0.75rem;
	}
	.challenge-reason { font-size: 0.9rem; color: var(--color-text); margin-bottom: 0.5rem; line-height: 1.5; }
	.challenge-suggestion { font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 1rem; }
	.challenge-actions { display: flex; gap: 0.5rem; }

	/* AI Memory Proposal Toast */
	.ai-memory-toast {
		position: absolute; bottom: 1rem; right: 1rem; z-index: 100;
		background: var(--color-surface, #1a1a2e); border: 1px solid var(--color-accent, #4a9eff);
		border-radius: 0.5rem; padding: 0.75rem 1rem; max-width: 360px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}
	.ai-memory-header { font-size: 0.75rem; color: var(--color-accent, #4a9eff); font-weight: 600; margin-bottom: 0.25rem; }
	.ai-memory-edit {
		width: 100%;
		padding: 0.5rem;
		border: 1px solid var(--color-border, #2a2a4a);
		border-radius: 0.375rem;
		background: var(--color-bg, #0a0a1a);
		color: var(--color-text, #eee);
		font-size: 0.85rem;
		font-family: inherit;
		resize: vertical;
		margin-bottom: 0.25rem;
	}
	.ai-memory-meta { font-size: 0.7rem; color: var(--color-text-muted); margin-bottom: 0.5rem; }
	.ai-memory-actions { display: flex; gap: 0.375rem; }
	.ai-mem-btn {
		padding: 0.25rem 0.625rem; border-radius: 4px; border: 1px solid var(--color-border);
		background: transparent; color: var(--color-text-muted); font-size: 0.75rem; cursor: pointer;
	}
	.ai-mem-btn:hover { background: var(--color-border); color: var(--color-text); }
	.ai-mem-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.ai-mem-save { border-color: var(--color-accent, #4a9eff); color: var(--color-accent, #4a9eff); }
	.ai-mem-dismiss { border-color: var(--color-text-muted); }

	/* Version footer */
	.sidebar-footer {
		padding: 0.5rem 0.75rem;
		border-top: 1px solid var(--color-border);
	}
	.version-label {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		opacity: 0.6;
	}
</style>
