<script lang="ts">
import { browser } from '$app/environment';
import * as session from '$lib/session.js';
import type { ConnectionStoreState } from '$lib/stores/connection.js';
import type { DisplayMessage } from '$lib/stores/messages.js';
import type { ConversationEntry, ConversationMessage } from '$lib/stores/conversations.js';
import type { ActiveChallenge } from '$lib/stores/challenges.js';
import type { PendingToolRequest } from '$lib/stores/tools.js';
import StatusIndicator from '$lib/components/StatusIndicator.svelte';
import MessageList from '$lib/components/MessageList.svelte';
import ChallengeBanner from '$lib/components/ChallengeBanner.svelte';
import InputBar from '$lib/components/InputBar.svelte';
import ToolApprovalDialog from '$lib/components/ToolApprovalDialog.svelte';
import BudgetIndicator from '$lib/components/BudgetIndicator.svelte';
import type { BudgetStatusData, BudgetAlert } from '$lib/stores/budget.js';

// ---------------------------------------------------------------------------
// Reactive UI state — subscribed from shared session stores
// ---------------------------------------------------------------------------

let conn: ConnectionStoreState = $state({
	status: 'disconnected',
	jwt: null,
	sessionId: null,
	peerStatus: 'unknown',
	reconnectAttempt: 0,
	lastError: null,
});
let messages: DisplayMessage[] = $state([]);
let activeChallenge: ActiveChallenge | null = $state(null);
let pendingToolRequest: PendingToolRequest | null = $state(null);
let budgetStatus: BudgetStatusData | null = $state(null);
let lastBudgetAlert: BudgetAlert | null = $state(null);
let connecting = $state(false);
let isAutoConnecting = $state(false);
let e2eActive = $state(false);
let e2eAvailable = $state(false);
let toasts: session.ToastNotification[] = $state([]);
let providerName = $state('');
let providerActive = $state(false);
let providerModel = $state('');
let activeConv: ConversationEntry | null = $state(null);
let convMessages: ConversationMessage[] = $state([]);
let hasMoreHistory = $state(false);
let loadingHistory = $state(false);
let streamingContent = $state('');
let isStreaming = $state(false);
let showConvActions = $state(false);
let deleteConfirm = $state(false);

const isConnected = $derived(
	conn.status === 'connected' || conn.status === 'authenticated',
);

let unsubs: (() => void)[] = [];

$effect(() => {
	if (!browser) return () => {};
	unsubs.push(session.connection.subscribe((v) => (conn = v)));
	unsubs.push(session.messages.store.subscribe((v) => (messages = [...v.messages])));
	unsubs.push(session.challenges.store.subscribe((v) => (activeChallenge = v.active)));
	unsubs.push(session.tools.store.subscribe((v) => (pendingToolRequest = v.pendingRequest)));
	unsubs.push(session.budget.store.subscribe((v) => { budgetStatus = v.status; lastBudgetAlert = v.lastAlert; }));
	unsubs.push(session.autoConnecting.subscribe((v) => (isAutoConnecting = v)));
	unsubs.push(session.e2eStatus.subscribe((v) => { e2eActive = v.active; e2eAvailable = v.available; }));
	unsubs.push(session.notifications.subscribe((v) => { toasts = [...v]; }));
	unsubs.push(session.provider.store.subscribe((v) => { providerName = v.provider?.providerName ?? ''; providerActive = v.provider?.status === 'active'; providerModel = v.provider?.model ?? ''; }));
	unsubs.push(session.conversations.activeConversation.subscribe((v) => { activeConv = v; }));
	unsubs.push(session.conversations.store.subscribe((v) => { convMessages = [...v.activeMessages]; hasMoreHistory = v.hasMoreHistory; loadingHistory = v.loadingHistory; isStreaming = v.streaming !== null; streamingContent = v.streaming?.content ?? ''; }));

	return () => {
		for (const u of unsubs) u();
		unsubs = [];
	};
});

// ---------------------------------------------------------------------------
// Connect / Disconnect
// ---------------------------------------------------------------------------

async function handleConnect(): Promise<void> {
	if (session.getClient() || connecting) return;
	connecting = true;
	try {
		await session.connect();
	} catch (err) {
		console.error('Connection failed:', err);
	} finally {
		connecting = false;
	}
}

async function handleDisconnect(): Promise<void> {
	await session.disconnect();
}

// ---------------------------------------------------------------------------
// Sending messages
// ---------------------------------------------------------------------------

function handleSendConversation(text: string): void {
	const client = session.getClient();
	if (!client) return;

	const id = crypto.randomUUID();
	const timestamp = new Date().toISOString();

	const envelope = {
		type: 'conversation',
		id,
		timestamp,
		sender: session.IDENTITY,
		payload: { content: text },
	};

	// Encrypt with Double Ratchet if E2E active, plaintext fallback
	session.sendSecure(envelope);

	session.messages.addMessage({
		id,
		type: 'conversation',
		timestamp,
		senderType: 'human',
		senderName: session.IDENTITY.displayName,
		content: text,
		payload: envelope.payload,
		direction: 'outgoing',
	});

	// Add to active conversation
	const convId = session.conversations.store.get().activeConversationId;
	if (convId) {
		session.conversations.addMessage({
			id, conversationId: convId, role: 'user', type: 'conversation',
			content: text, timestamp, hash: '', previousHash: null, pinned: false,
			senderName: session.IDENTITY.displayName, direction: 'outgoing', payload: envelope.payload,
		});
	}
}

function handleSendTask(task: {
	action: string;
	target: string;
	priority: string;
	parameters: Record<string, string>;
	constraints: string[];
}): void {
	const client = session.getClient();
	if (!client) return;

	const id = crypto.randomUUID();
	const timestamp = new Date().toISOString();

	const envelope = {
		type: 'task_submission',
		id,
		timestamp,
		sender: session.IDENTITY,
		payload: task,
	};

	session.sendSecure(envelope);

	// Track in messages store
	session.messages.addMessage({
		id,
		type: 'conversation',
		timestamp,
		senderType: 'human',
		senderName: session.IDENTITY.displayName,
		content: `Task: ${task.action} \u2192 ${task.target}`,
		payload: envelope.payload,
		direction: 'outgoing',
	});

	// Track in tasks store
	session.tasks.submitTask(id, task.action, task.target, task.priority, task.constraints);
}

// ---------------------------------------------------------------------------
// Challenge responses
// ---------------------------------------------------------------------------

function handleLoadOlderMessages(): void {
	const client = session.getClient();
	const convId = session.conversations.store.get().activeConversationId;
	if (!client || !convId) return;
	session.conversations.setLoadingHistory(true);
	const currentCount = session.conversations.store.get().activeMessages.length;
	client.send(JSON.stringify({
		type: 'conversation_history',
		id: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		sender: session.getIdentity(),
		payload: { conversationId: convId, limit: 50, offset: currentCount, direction: 'older' },
	}));
}

function handleCompactConversation(): void {
	const client = session.getClient();
	const convId = session.conversations.store.get().activeConversationId;
	if (!client || !convId) return;
	client.send(JSON.stringify({
		type: 'conversation_compact',
		id: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		sender: session.getIdentity(),
		payload: { conversationId: convId },
	}));
	showConvActions = false;
	session.addNotification('Compacting conversation...', 'info');
}

function handleArchiveConversation(): void {
	const client = session.getClient();
	const convId = session.conversations.store.get().activeConversationId;
	if (!client || !convId) return;
	client.send(JSON.stringify({
		type: 'conversation_archive',
		id: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		sender: session.getIdentity(),
		payload: { conversationId: convId },
	}));
	showConvActions = false;
}

function handleDeleteConversation(): void {
	const client = session.getClient();
	const convId = session.conversations.store.get().activeConversationId;
	if (!client || !convId) return;
	client.send(JSON.stringify({
		type: 'conversation_delete',
		id: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		sender: session.getIdentity(),
		payload: { conversationId: convId },
	}));
	deleteConfirm = false;
	showConvActions = false;
}

function handleChallengeApprove(): void {
	const client = session.getClient();
	if (!client) return;
	const resolved = session.challenges.resolve('approve');
	if (resolved) {
		client.send(JSON.stringify({
			type: 'challenge_response',
			id: crypto.randomUUID(),
			timestamp: new Date().toISOString(),
			sender: session.IDENTITY,
			payload: { taskId: resolved.taskId, decision: 'approve' },
		}));
		session.tasks.resolveChallenge(resolved.taskId, 'approve');
	}
}

function handleChallengeModify(): void {
	const resolved = session.challenges.resolve('modify');
	if (resolved) {
		session.tasks.resolveChallenge(resolved.taskId, 'modify');
	}
}

function handleChallengeCancel(): void {
	const client = session.getClient();
	if (!client) return;
	const resolved = session.challenges.resolve('cancel');
	if (resolved) {
		client.send(JSON.stringify({
			type: 'challenge_response',
			id: crypto.randomUUID(),
			timestamp: new Date().toISOString(),
			sender: session.IDENTITY,
			payload: { taskId: resolved.taskId, decision: 'cancel' },
		}));
		session.tasks.resolveChallenge(resolved.taskId, 'cancel');
	}
}
</script>

<div class="messages-view">
	{#if !session.getClient() && !connecting && !isAutoConnecting && conn.status === 'disconnected'}
		<div class="connect-screen">
			<p class="connect-label">Connect to the Bastion relay to start messaging.</p>
			<p class="connect-url">{session.getRelayUrl()}</p>
			<button class="connect-btn" onclick={handleConnect}>Connect</button>
		</div>
	{:else}
		<StatusIndicator
			status={conn.status}
			peerStatus={conn.peerStatus}
			reconnectAttempt={conn.reconnectAttempt}
			{e2eActive}
			{e2eAvailable}
			{providerName}
			{providerActive}
			{providerModel}
			onRetry={handleConnect}
		/>

		<BudgetIndicator
			status={budgetStatus}
			{lastBudgetAlert}
			onDismissAlert={() => session.budget.clearLastAlert()}
		/>

		{#if conn.lastError}
			<div class="error-bar">{conn.lastError}</div>
		{/if}

		{#each toasts as toast (toast.id)}
			<div class="toast-bar toast-{toast.level}">
				<span>{toast.message}</span>
				<button class="toast-x" onclick={() => session.dismissNotification(toast.id)}>×</button>
			</div>
		{/each}

		{#if activeChallenge}
			<ChallengeBanner
				challenge={activeChallenge}
				onApprove={handleChallengeApprove}
				onModify={handleChallengeModify}
				onCancel={handleChallengeCancel}
			/>
		{/if}

		{#if pendingToolRequest}
			<ToolApprovalDialog request={pendingToolRequest} />
		{/if}

		{#if activeConv}
			<div class="conv-header-bar">
				<span class="conv-header-icon">{activeConv.type === 'game' ? '🎮' : '💬'}</span>
				<span class="conv-header-name">{activeConv.name}</span>
				{#if activeConv.preferredAdapter}
					<span class="conv-model-badge">{activeConv.preferredAdapter}</span>
				{/if}
				<span class="conv-header-count">{activeConv.messageCount} messages</span>
				<div class="conv-header-actions">
					<button class="conv-action-btn" onclick={() => { showConvActions = !showConvActions; }}>···</button>
					{#if showConvActions}
						<div class="conv-action-menu">
							<button onclick={handleCompactConversation}>Summarise earlier messages</button>
							<button onclick={handleArchiveConversation}>Archive</button>
							{#if deleteConfirm}
								<button class="conv-delete-confirm" onclick={handleDeleteConversation}>Confirm Delete</button>
								<button onclick={() => { deleteConfirm = false; }}>Cancel</button>
							{:else}
								<button class="conv-delete-btn" onclick={() => { deleteConfirm = true; }}>Delete</button>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		{/if}

		{#if hasMoreHistory}
			<div class="load-more-bar">
				<button class="load-more-btn" onclick={handleLoadOlderMessages} disabled={loadingHistory}>
					{loadingHistory ? 'Loading...' : 'Load older messages'}
				</button>
			</div>
		{/if}

		<MessageList {messages} />

		{#if isStreaming}
			<div class="streaming-indicator">
				<div class="streaming-bubble">
					<span class="streaming-sender">Claude</span>
					<span class="streaming-text">{streamingContent}<span class="streaming-cursor">|</span></span>
				</div>
			</div>
		{/if}

		<InputBar
			disabled={!isConnected}
			onSendConversation={handleSendConversation}
			onSendTask={handleSendTask}
		/>

		{#if isConnected}
			<div class="disconnect-row">
				<button class="disconnect-btn" onclick={handleDisconnect}>Disconnect</button>
			</div>
		{/if}
	{/if}
</div>

<style>
	.messages-view {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* ---------- connect screen ---------- */
	.connect-screen {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
	}

	.connect-label {
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.connect-url {
		font-family: monospace;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		opacity: 0.7;
	}

	.connect-btn {
		padding: 0.5rem 1.5rem;
		border-radius: 8px;
		border: none;
		background: var(--color-accent);
		color: #fff;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
	}

	.connect-btn:hover {
		opacity: 0.9;
	}

	/* ---------- error bar ---------- */
	.error-bar {
		padding: 0.375rem 1rem;
		background: var(--color-error);
		color: #fff;
		font-size: 0.75rem;
	}

	/* ---------- disconnect ---------- */
	.disconnect-row {
		display: flex;
		justify-content: center;
		padding: 0.25rem 0 0.5rem;
	}

	.disconnect-btn {
		padding: 0.25rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.75rem;
		cursor: pointer;
	}

	.disconnect-btn:hover {
		border-color: var(--color-error);
		color: var(--color-error);
	}

	/* ---------- conversation header ---------- */
	.conv-header-bar {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.375rem 1rem; border-bottom: 1px solid var(--color-border);
		background: var(--color-surface); font-size: 0.85rem;
	}
	.conv-header-icon { font-size: 0.9rem; }
	.conv-header-name { font-weight: 500; color: var(--color-text); }
	.conv-model-badge { font-size: 0.65rem; padding: 0.0625rem 0.375rem; border-radius: 999px; background: color-mix(in srgb, var(--color-accent) 15%, transparent); color: var(--color-accent); white-space: nowrap; }
	.conv-header-count { color: var(--color-text-muted); font-size: 0.75rem; margin-left: auto; }
	.conv-header-actions { position: relative; }
	.conv-action-btn {
		padding: 0.125rem 0.375rem; border: 1px solid var(--color-border);
		border-radius: 4px; background: transparent; color: var(--color-text-muted);
		cursor: pointer; font-size: 0.8rem;
	}
	.conv-action-menu {
		position: absolute; right: 0; top: 100%; margin-top: 0.25rem;
		background: var(--color-surface); border: 1px solid var(--color-border);
		border-radius: 6px; padding: 0.25rem; display: flex; flex-direction: column; gap: 0.125rem;
		z-index: 10; min-width: 120px;
	}
	.conv-action-menu button {
		display: block; width: 100%; padding: 0.375rem 0.5rem; border: none;
		background: transparent; color: var(--color-text); font-size: 0.8rem;
		text-align: left; cursor: pointer; border-radius: 4px;
	}
	.conv-action-menu button:hover { background: var(--color-border); }
	.conv-delete-btn { color: var(--color-error) !important; }
	.conv-delete-confirm { color: #fff !important; background: var(--color-error) !important; }

	.load-more-bar { display: flex; justify-content: center; padding: 0.375rem; }
	.load-more-btn {
		padding: 0.25rem 0.75rem; border: 1px solid var(--color-border);
		border-radius: 4px; background: transparent; color: var(--color-text-muted);
		font-size: 0.75rem; cursor: pointer;
	}
	.load-more-btn:hover { background: var(--color-border); color: var(--color-text); }
	.load-more-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	/* ---------- streaming indicator ---------- */
	.streaming-indicator { padding: 0 1rem 0.25rem; }
	.streaming-bubble {
		background: var(--color-surface); border: 1px solid var(--color-border);
		border-radius: 0.5rem; padding: 0.5rem 0.75rem; max-width: 80%;
	}
	.streaming-sender { font-size: 0.7rem; color: var(--color-accent); font-weight: 500; display: block; margin-bottom: 0.2rem; }
	.streaming-text { font-size: 0.85rem; color: var(--color-text); white-space: pre-wrap; }
	.streaming-cursor {
		display: inline-block; animation: blink 0.7s infinite;
		color: var(--color-accent); font-weight: 300;
	}
	@keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }

	/* ---------- toast notifications ---------- */
	.toast-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.375rem 1rem;
		font-size: 0.8rem;
		border-bottom: 1px solid var(--color-border);
	}
	.toast-success { background: color-mix(in srgb, #22c55e 10%, transparent); color: #22c55e; }
	.toast-error   { background: color-mix(in srgb, #ef4444 10%, transparent); color: #ef4444; }
	.toast-warning { background: color-mix(in srgb, #f59e0b 10%, transparent); color: #f59e0b; }
	.toast-info    { background: color-mix(in srgb, #4a9eff 10%, transparent); color: #4a9eff; }
	.toast-x {
		background: none;
		border: none;
		color: inherit;
		cursor: pointer;
		font-size: 1rem;
		padding: 0;
		line-height: 1;
		opacity: 0.7;
	}
	.toast-x:hover { opacity: 1; }
</style>
