<script lang="ts">
import { onMount } from 'svelte';
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
import FileUploadStatus from '$lib/components/FileUploadStatus.svelte';
import type { BudgetStatusData, BudgetAlert } from '$lib/stores/budget.js';
import type { FileUploadProgress } from '$lib/stores/file-transfers.js';
import type { ProviderAdapterInfo } from '$lib/stores/provider.js';
import { type UserPreferences, DEFAULT_USER_PREFERENCES } from '$lib/config/config-store.js';

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
let initialising = $state(true);
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
let activeUploads: readonly FileUploadProgress[] = $state([]);
let availableAdapters: readonly ProviderAdapterInfo[] = $state([]);
let showAdapterPicker = $state(false);
let challengeActive = $state(false);
let challengePeriodEnd: string | null = $state(null);
let challengeHighRiskStart = $state(0);
let challengeHighRiskEnd = $state(6);
let challengeRemainingLabel = $state('');
let showChallengeBar = $state(true);
let groupConsecutiveMessages = $state(true);
let currentAdapterName = $state('');

const isConnected = $derived(
	conn.status === 'connected' || conn.status === 'authenticated',
);

// Use onMount (NOT $effect) to set up store subscriptions.
// See +layout.svelte for detailed explanation of the reactive loop issue.
onMount(() => {
	const subs = [
		session.connection.subscribe((v) => {
			conn = v;
			if (v.status === 'connected' || v.status === 'authenticated') initialising = false;
		}),
		session.messages.store.subscribe((v) => (messages = [...v.messages])),
		session.challenges.store.subscribe((v) => (activeChallenge = v.active)),
		session.tools.store.subscribe((v) => (pendingToolRequest = v.pendingRequest)),
		session.budget.store.subscribe((v) => { budgetStatus = v.status; lastBudgetAlert = v.lastAlert; }),
		session.autoConnecting.subscribe((v) => {
			isAutoConnecting = v;
			if (!v && initialising) initialising = false;
		}),
		session.e2eStatus.subscribe((v) => { e2eActive = v.active; e2eAvailable = v.available; }),
		session.notifications.subscribe((v) => { toasts = [...v]; }),
		session.provider.store.subscribe((v) => {
			providerName = v.provider?.providerName ?? '';
			providerActive = v.provider?.status === 'active';
			providerModel = v.provider?.model ?? '';
			const adpts = v.provider?.adapters ?? [];
			availableAdapters = adpts.filter((a) => a.roles.includes('default') || a.roles.includes('conversation'));
		}),
		session.conversations.activeConversation.subscribe((v) => { activeConv = v; }),
		session.conversations.store.subscribe((v) => { convMessages = [...v.activeMessages]; hasMoreHistory = v.hasMoreHistory; loadingHistory = v.loadingHistory; isStreaming = v.streaming !== null; streamingContent = v.streaming?.content ?? ''; }),
		session.fileTransfers.store.subscribe((v) => { activeUploads = v.uploads; }),
		session.challengeStatus.subscribe((v) => {
			challengeActive = v.active;
			challengePeriodEnd = v.periodEnd;
			updateChallengeRemaining();
		}),
		session.settings.store.subscribe((v) => {
			challengeHighRiskStart = v.settings.highRiskHoursStart;
			challengeHighRiskEnd = v.settings.highRiskHoursEnd;
		}),
	];

	// Countdown interval — ticks every 30s to keep remaining-time label fresh
	const challengeTimer = setInterval(updateChallengeRemaining, 30_000);

	// Load user preferences
	const cfg = session.getConfigStore();
	const prefs: UserPreferences = (cfg.get('preferences') as UserPreferences) ?? DEFAULT_USER_PREFERENCES;
	showChallengeBar = prefs.showChallengeBar;
	groupConsecutiveMessages = prefs.groupConsecutiveMessages;

	// Keyboard shortcuts
	function handleKeydown(e: KeyboardEvent): void {
		// Ctrl+N / Cmd+N — new conversation (bubble up to layout)
		if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
			e.preventDefault();
			// Click the new-conversation button in sidebar
			const btn = document.querySelector('.conv-new-btn') as HTMLButtonElement | null;
			btn?.click();
		}
		// Escape — close any open menu/panel
		if (e.key === 'Escape') {
			showConvActions = false;
			showAdapterPicker = false;
			deleteConfirm = false;
		}
	}
	document.addEventListener('keydown', handleKeydown);

	// Auto-focus input on mount
	focusChatInput();

	return () => {
		clearInterval(challengeTimer);
		document.removeEventListener('keydown', handleKeydown);
		for (const u of subs) u();
	};
});

// ---------------------------------------------------------------------------
// Auto-focus chat input
// ---------------------------------------------------------------------------

function focusChatInput(): void {
	requestAnimationFrame(() => {
		const textarea = document.querySelector('.chat-input textarea') as HTMLTextAreaElement | null;
		textarea?.focus();
	});
}

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

// ---------------------------------------------------------------------------
// Challenge hours countdown
// ---------------------------------------------------------------------------

function formatHour(h: number): string {
	const hh = String(h).padStart(2, '0');
	return `${hh}:00`;
}

function updateChallengeRemaining(): void {
	if (!challengeActive || !challengePeriodEnd) {
		challengeRemainingLabel = '';
		return;
	}
	const now = Date.now();
	const end = new Date(challengePeriodEnd).getTime();
	const diffMs = end - now;
	if (diffMs <= 0) {
		challengeRemainingLabel = 'ending soon';
		return;
	}
	const totalMin = Math.ceil(diffMs / 60_000);
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	if (h > 0) {
		challengeRemainingLabel = `${h}h ${m}m remaining`;
	} else {
		challengeRemainingLabel = `${m}m remaining`;
	}
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

	// Re-focus input after send
	focusChatInput();
}

function handleSendTask(task: {
	action: string;
	target: string;
	priority: string;
	parameters: Record<string, string>;
	constraints: string[];
	description: string;
}): void {
	const client = session.getClient();
	if (!client) return;

	const id = crypto.randomUUID();
	const timestamp = new Date().toISOString();

	const envelope = {
		type: 'task',
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
		content: `Task: ${task.action} \u2192 ${task.target}${task.description ? ` — ${task.description}` : ''}`,
		payload: envelope.payload,
		direction: 'outgoing',
	});

	// Track in tasks store
	session.tasks.submitTask(id, task.action, task.target, task.priority, task.constraints, task.parameters, task.description);
}

function handleFileUpload(req: { file: File; purpose: 'conversation' | 'skill' | 'project' }): void {
	const client = session.getClient();
	if (!client) return;

	const transferId = crypto.randomUUID();
	const { file, purpose } = req;

	// Track upload progress
	session.fileTransfers.startUpload(transferId, file.name, file.size);

	// Read the file and compute hash, then send manifest
	const reader = new FileReader();
	reader.onload = async (): Promise<void> => {
		try {
			const arrayBuf = reader.result as ArrayBuffer;
			const data = new Uint8Array(arrayBuf);

			// Compute SHA-256 hash in browser
			const hashBuf = await globalThis.crypto.subtle.digest('SHA-256', data);
			const hashArr = new Uint8Array(hashBuf);
			const hash = Array.from(hashArr).map((b) => b.toString(16).padStart(2, '0')).join('');

			// Determine MIME type
			const mimeType = file.type || 'application/octet-stream';

			// Encode file data as base64 for relay quarantine
			const fileDataB64 = btoa(String.fromCharCode(...data));

			const envelope = {
				type: 'file_manifest',
				id: crypto.randomUUID(),
				timestamp: new Date().toISOString(),
				sender: session.IDENTITY,
				payload: {
					transferId,
					filename: file.name,
					sizeBytes: file.size,
					hash,
					hashAlgorithm: 'sha256',
					mimeType,
					purpose,
					projectContext: purpose === 'conversation' ? 'chat attachment' : purpose,
					fileData: fileDataB64,
				},
			};

			client.send(JSON.stringify(envelope));
			session.fileTransfers.updateUploadPhase(transferId, 'uploading');
			session.addNotification(`File "${file.name}" submitted for transfer`, 'info');
		} catch (err) {
			session.fileTransfers.updateUploadPhase(transferId, 'failed', err instanceof Error ? err.message : 'Upload failed');
		}
	};
	reader.onerror = (): void => {
		session.fileTransfers.updateUploadPhase(transferId, 'failed', 'Failed to read file');
	};
	reader.readAsArrayBuffer(file);
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

// ---------------------------------------------------------------------------
// Mid-conversation adapter switching
// ---------------------------------------------------------------------------

function adapterLabel(ad: ProviderAdapterInfo): string {
	if (ad.maxContextTokens) {
		const ctx = ad.maxContextTokens >= 1_000_000
			? `${Math.round(ad.maxContextTokens / 1_000_000)}M`
			: `${Math.round(ad.maxContextTokens / 1000)}k`;
		return `${ad.name} (${ctx} context)`;
	}
	return ad.name;
}

function adapterBadgeLabel(adapterId: string): string {
	const ad = availableAdapters.find((a) => a.id === adapterId);
	if (!ad) return adapterId;
	return adapterLabel(ad);
}

function handleSwitchAdapter(adapterId: string): void {
	const client = session.getClient();
	const convId = session.conversations.store.get().activeConversationId;
	if (!client || !convId) return;
	if (activeConv?.preferredAdapter === adapterId) {
		showAdapterPicker = false;
		return;
	}

	// Send context_update with preferredAdapter to the AI client
	client.send(JSON.stringify({
		type: 'context_update',
		id: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		sender: session.IDENTITY,
		payload: {
			preferredAdapter: adapterId,
			conversationId: convId,
		},
	}));

	// Update local conversation metadata immediately
	session.conversations.updateConversation(convId, { preferredAdapter: adapterId });
	showAdapterPicker = false;
	session.addNotification(`Adapter switched to ${adapterBadgeLabel(adapterId)}`, 'info');
}

// ---------------------------------------------------------------------------
// Challenge responses
// ---------------------------------------------------------------------------

// Auto-focus input when active conversation changes
$effect(() => {
	if (activeConv) {
		currentAdapterName = activeConv.preferredAdapter
			? adapterBadgeLabel(activeConv.preferredAdapter)
			: (providerModel || providerName || '');
		focusChatInput();
	}
});

function handleChallengeApprove(): void {
	const client = session.getClient();
	if (!client) return;
	const resolved = session.challenges.resolve('approve');
	if (resolved) {
		client.send(JSON.stringify({
			type: 'confirmation',
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
			type: 'confirmation',
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
	{#if initialising || isAutoConnecting}
		<div class="connect-screen">
			<p class="connect-label">Connecting...</p>
			<p class="connect-url">{session.getRelayUrl()}</p>
		</div>
	{:else if !session.getClient() && !connecting && conn.status === 'disconnected'}
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
			relayUrl={session.getRelayUrl()}
			adapterName={currentAdapterName}
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

		{#each activeUploads as upload (upload.transferId)}
			<FileUploadStatus {upload} />
		{/each}

		{#if activeConv}
			<div class="conv-header-bar">
				<span class="conv-header-icon">{activeConv.type === 'game' ? '🎮' : '💬'}</span>
				<span class="conv-header-name">{activeConv.name}</span>
				{#if availableAdapters.length > 1}
					<div class="adapter-picker-wrap">
						<button
							class="conv-model-badge adapter-badge-btn"
							onclick={() => { showAdapterPicker = !showAdapterPicker; }}
							title="Switch adapter"
						>
							{activeConv.preferredAdapter ? adapterBadgeLabel(activeConv.preferredAdapter) : 'Default'} ▾
						</button>
						{#if showAdapterPicker}
							<div class="adapter-picker-menu">
								{#each availableAdapters as ad (ad.id)}
									<button
										class="adapter-picker-item"
										class:adapter-picker-active={ad.id === activeConv.preferredAdapter}
										onclick={() => handleSwitchAdapter(ad.id)}
									>
										{adapterLabel(ad)}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{:else if activeConv.preferredAdapter}
					<span class="conv-model-badge">{adapterBadgeLabel(activeConv.preferredAdapter)}</span>
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

		<MessageList
			messages={activeConv ? convMessages.map(m => ({
				id: m.id,
				type: m.type,
				timestamp: m.timestamp,
				senderType: m.role === 'user' ? 'human' as const : 'ai' as const,
				senderName: m.senderName ?? (m.role === 'user' ? 'You' : 'Claude'),
				content: m.content,
				payload: m.payload ?? { content: m.content },
				direction: m.direction ?? (m.role === 'user' ? 'outgoing' as const : 'incoming' as const),
			})) : messages}
			groupConsecutive={groupConsecutiveMessages}
			adapterName={currentAdapterName}
		/>

		{#if isStreaming}
			<div class="streaming-indicator">
				<div class="streaming-bubble">
					<span class="streaming-sender">Claude</span>
					<span class="streaming-text">{streamingContent}<span class="streaming-cursor">|</span></span>
				</div>
			</div>
		{/if}

		{#if showChallengeBar}
			{#if challengeActive && challengePeriodEnd}
				<div class="challenge-bar challenge-bar--active">
					<span class="challenge-bar-icon">⚠</span>
					<span>Challenge hours active — ends {formatHour(challengeHighRiskEnd)} ({challengeRemainingLabel})</span>
				</div>
			{:else if isConnected}
				<div class="challenge-bar challenge-bar--inactive">
					<span>Challenge hours: {formatHour(challengeHighRiskStart)}–{formatHour(challengeHighRiskEnd)}</span>
				</div>
			{/if}
		{/if}

		<InputBar
			disabled={!isConnected}
			onSendConversation={handleSendConversation}
			onSendTask={handleSendTask}
			onFileUpload={handleFileUpload}
		/>
	{/if}
</div>

<style>
	.messages-view {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		min-height: 0;
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

	/* ---------- challenge hours bar ---------- */
	.challenge-bar {
		text-align: center;
		flex-shrink: 0;
	}

	.challenge-bar--inactive {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		padding: 0.25rem 1rem;
	}

	.challenge-bar--active {
		background: rgba(255, 165, 0, 0.1);
		border-top: 1px solid rgba(255, 165, 0, 0.3);
		color: #e67e00;
		padding: 0.4rem 1rem;
		font-size: 0.8rem;
		font-weight: 500;
	}

	.challenge-bar-icon {
		margin-right: 0.25rem;
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
	.adapter-picker-wrap { position: relative; }
	.adapter-badge-btn {
		border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
		cursor: pointer; transition: background 0.15s;
	}
	.adapter-badge-btn:hover { background: color-mix(in srgb, var(--color-accent) 25%, transparent); }
	.adapter-picker-menu {
		position: absolute; left: 0; top: 100%; margin-top: 0.25rem;
		background: var(--color-surface); border: 1px solid var(--color-border);
		border-radius: 6px; padding: 0.25rem; display: flex; flex-direction: column; gap: 0.125rem;
		z-index: 20; min-width: 160px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
	}
	.adapter-picker-item {
		display: block; width: 100%; padding: 0.375rem 0.5rem; border: none;
		background: transparent; color: var(--color-text); font-size: 0.75rem;
		text-align: left; cursor: pointer; border-radius: 4px; white-space: nowrap;
	}
	.adapter-picker-item:hover { background: var(--color-border); }
	.adapter-picker-active { color: var(--color-accent); font-weight: 600; }
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
