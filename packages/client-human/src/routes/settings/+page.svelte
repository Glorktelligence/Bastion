<script lang="ts">
import { onMount } from 'svelte';
import * as session from '$lib/session.js';
import type { SafetySettings, SettingUpdateResult } from '$lib/stores/settings.js';
import type { MemoryEntry } from '$lib/stores/memories.js';
import type { ApprovedTool } from '$lib/stores/tools.js';
import type { ProjectFile, LoadingMode } from '$lib/stores/projects.js';
import type { ProviderInfo } from '$lib/stores/provider.js';
import type { ExtensionInfo } from '$lib/stores/extensions.js';
import type { ConversationEntry } from '$lib/stores/conversations.js';
import SettingsPanel from '$lib/components/SettingsPanel.svelte';

// ---------------------------------------------------------------------------
// Reactive state from shared session stores
// ---------------------------------------------------------------------------

let currentSettings: SafetySettings = $state(session.settings.store.get().settings);
let dirty = $state(false);
let error: string | null = $state(null);
let floorValues: SafetySettings = $state(session.SAFETY_FLOOR_VALUES);
let isAtFloor: Record<keyof SafetySettings, boolean> = $state(session.settings.isAtFloor.get());
let userContext: string = $state(session.settings.store.get().userContext);
let contextSaving = $state(false);
let contextSaved = $state(false);

// Config store
const cfgStore = session.getConfigStore();
let cfgRelayUrl = $state(cfgStore.get('relayUrl'));
let cfgDisplayName = $state(cfgStore.get('displayName'));
let cfgUserId = $state(cfgStore.get('userId'));
let cfgAutoConnect = $state(cfgStore.get('autoConnect'));
let cfgAutoReconnect = $state(cfgStore.get('autoReconnect'));
let showResetConfirm = $state(false);

// Tool state
let approvedTools: readonly ApprovedTool[] = $state([]);

// Provider state
let providerInfo: ProviderInfo | null = $state(null);

// Extensions state
let extensionList: readonly ExtensionInfo[] = $state([]);
let extensionCount = $state(0);
let extensionMessageTypes = $state(0);

// Conversation list — for memory filter dropdown (scoped per-conversation filtering)
let convList: ConversationEntry[] = $state([]);

function handleToolRevoke(toolId: string): void {
  const client = session.getClient();
  if (!client) return;
  client.send(JSON.stringify({
    type: 'tool_revoke',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: session.getIdentity(),
    payload: { toolId, reason: 'Revoked from settings' },
  }));
  session.tools.removeApproved(toolId);
}

function handleResetSetup(): void {
  cfgStore.clear();
  // Force page reload to show setup wizard
  globalThis.location?.reload();
}

// Use onMount (NOT $effect) to set up store subscriptions.
// See +layout.svelte for detailed explanation of the reactive loop issue.
onMount(() => {
	const unsubs = [
		session.settings.store.subscribe((v) => {
			currentSettings = v.settings;
			dirty = v.dirty;
			error = v.error;
			userContext = v.userContext;
		}),
		session.settings.floorValues.subscribe((v) => (floorValues = v)),
		session.settings.isAtFloor.subscribe((v) => (isAtFloor = v)),
		session.memories.store.subscribe((v) => {
			memoryList = v.memories;
			memoryNotification = v.lastNotification;
		}),
		session.memories.totalCount.subscribe((v) => (memoryCount = v)),
		session.tools.store.subscribe((v) => (approvedTools = v.sessionApproved)),
		session.projects.store.subscribe((v) => {
			projectFiles = v.files;
			projectTotalSize = v.totalSize;
			projectTotalCount = v.totalCount;
			projectNotification = v.notification;
		}),
		session.projects.alwaysLoadedTokens.subscribe((v) => (projectAlwaysTokens = v)),
		session.projects.alwaysLoadedCount.subscribe((v) => (projectAlwaysCount = v)),
		session.challengeStatus.subscribe((v) => { challengeActive = v.active; }),
		session.provider.store.subscribe((v) => { providerInfo = v.provider; }),
		session.extensions.store.subscribe((v) => { extensionList = v.extensions; }),
		session.extensions.totalCount.subscribe((v) => { extensionCount = v; }),
		session.extensions.totalMessageTypes.subscribe((v) => { extensionMessageTypes = v; }),
		session.conversations.store.subscribe((v) => {
			convList = v.conversations.filter((c: ConversationEntry) => !c.archived);
		}),
	];

	// Request data when connected (not on mount — WebSocket may not be ready)
	let settingsDataLoaded = false;
	unsubs.push(session.connection.subscribe((v) => {
		if ((v.status === 'connected' || v.status === 'authenticated') && !settingsDataLoaded) {
			settingsDataLoaded = true;
			requestMemoryList();
			requestProjectList();
		}
	}));

	return () => {
		for (const u of unsubs) u();
		if (deleteTimerInterval) clearInterval(deleteTimerInterval);
	};
});

// ---------------------------------------------------------------------------
// Interactive callbacks
// ---------------------------------------------------------------------------

function handleSettingChange(key: string, value: unknown): void {
	const result: SettingUpdateResult = session.settings.tryUpdate(key as keyof SafetySettings, value);
	if (!result.ok) {
		console.warn(`[Settings] Rejected: ${result.reason}`);
	}
}

function handleSave(): void {
	session.settings.markSaved();
}

function handleReset(): void {
	session.settings.resetToDefaults();
}

// Memory state
let memoryList: readonly MemoryEntry[] = $state([]);
let memoryCount = $state(0);
let memoryNotification: string | null = $state(null);
let editingMemoryId: string | null = $state(null);
let editingContent = $state('');
let deleteConfirmId: string | null = $state(null);
let memoryFilter = $state('all'); // 'all' | 'global' | conversationId

const categoryColors: Record<string, string> = {
  preference: '#4a9eff',
  fact: '#22c55e',
  workflow: '#a855f7',
  project: '#f59e0b',
};

function requestMemoryList(): void {
  const client = session.getClient();
  if (!client || !client.isConnected) return;
  const payload = {};
  if (memoryFilter === 'global') {
    payload.conversationId = null;
  } else if (memoryFilter !== 'all') {
    payload.conversationId = memoryFilter;
  }
  client.send(JSON.stringify({
    type: 'memory_list',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: session.IDENTITY,
    payload,
  }));
}

function handleMemoryEdit(id: string, content: string): void {
  editingMemoryId = id;
  editingContent = content;
}

function handleMemorySave(): void {
  const client = session.getClient();
  if (!client || !editingMemoryId) return;
  client.send(JSON.stringify({
    type: 'memory_update',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: session.IDENTITY,
    payload: { memoryId: editingMemoryId, content: editingContent },
  }));
  editingMemoryId = null;
  editingContent = '';
  setTimeout(requestMemoryList, 200);
}

function handleMemoryDelete(id: string): void {
  const client = session.getClient();
  if (!client) return;
  client.send(JSON.stringify({
    type: 'memory_delete',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: session.IDENTITY,
    payload: { memoryId: id },
  }));
  deleteConfirmId = null;
  setTimeout(requestMemoryList, 200);
}

// ---------------------------------------------------------------------------
// Project files state
// ---------------------------------------------------------------------------

let projectFiles: readonly ProjectFile[] = $state([]);
let projectTotalSize = $state(0);
let projectTotalCount = $state(0);
let projectNotification: string | null = $state(null);
let projectAlwaysTokens = $state(0);
let projectAlwaysCount = $state(0);

// Upload form state
let uploadPath = $state('');
let uploadContent = $state('');
let uploadMimeType = $state('text/markdown');

// Delete confirmation (with optional challenge-hours timer)
let deleteConfirmPath: string | null = $state(null);
let deleteTimer = $state(0);
let deleteTimerInterval: ReturnType<typeof setInterval> | null = null;
let challengeActive = $state(false);

function requestProjectList(): void {
  const client = session.getClient();
  if (!client || !client.isConnected) return;
  client.send(JSON.stringify({
    type: 'project_list',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: session.getIdentity(),
    payload: {},
  }));
}

function handleProjectUpload(): void {
  const client = session.getClient();
  if (!client || !uploadPath.trim() || !uploadContent.trim()) return;

  const ext = uploadPath.lastIndexOf('.') >= 0 ? uploadPath.slice(uploadPath.lastIndexOf('.')) : '';
  const allowed = ['.md', '.json', '.yaml', '.yml', '.txt'];
  if (!allowed.includes(ext.toLowerCase())) {
    session.projects.setNotification(`File type not allowed: ${ext} — use .md, .json, .yaml, .yml, or .txt`);
    return;
  }

  client.send(JSON.stringify({
    type: 'project_sync',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: session.getIdentity(),
    payload: {
      path: uploadPath.trim(),
      content: uploadContent,
      mimeType: uploadMimeType,
    },
  }));
  uploadPath = '';
  uploadContent = '';
}

function handleProjectDelete(path: string): void {
  // If challenge hours active, require 10s countdown confirmation
  const cs = session.challengeStatus.get();
  if (cs.active && deleteTimer === 0) {
    deleteConfirmPath = path;
    challengeActive = true;
    deleteTimer = 10;
    deleteTimerInterval = setInterval(() => {
      deleteTimer--;
      if (deleteTimer <= 0) {
        if (deleteTimerInterval) clearInterval(deleteTimerInterval);
        deleteTimerInterval = null;
      }
    }, 1000);
    return;
  }

  const client = session.getClient();
  if (!client) return;
  client.send(JSON.stringify({
    type: 'project_delete',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: session.getIdentity(),
    payload: { path },
  }));
  session.projects.removeFile(path);
  deleteConfirmPath = null;
  challengeActive = false;
  deleteTimer = 0;
  if (deleteTimerInterval) { clearInterval(deleteTimerInterval); deleteTimerInterval = null; }
}

function cancelProjectDelete(): void {
  deleteConfirmPath = null;
  challengeActive = false;
  deleteTimer = 0;
  if (deleteTimerInterval) { clearInterval(deleteTimerInterval); deleteTimerInterval = null; }
}

function handleLoadingModeChange(path: string, mode: LoadingMode): void {
  const client = session.getClient();
  if (!client) return;

  const state = session.projects.store.get();
  const alwaysLoaded = state.config.alwaysLoaded.filter((p) => p !== path);
  const available = state.config.available.filter((p) => p !== path);

  if (mode === 'always') alwaysLoaded.push(path);
  else if (mode === 'available') available.push(path);

  session.projects.setConfig({ alwaysLoaded, available });

  client.send(JSON.stringify({
    type: 'project_config',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: session.getIdentity(),
    payload: { alwaysLoaded, available },
  }));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getLoadingModeForFile(path: string): LoadingMode {
  return session.projects.getLoadingMode(path);
}

function handleContextSave(): void {
	const client = session.getClient();
	if (!client) return;
	contextSaving = true;
	client.send(JSON.stringify({
		type: 'context_update',
		id: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		sender: session.IDENTITY,
		payload: { content: userContext },
	}));
	session.settings.setUserContext(userContext);
	contextSaving = false;
	contextSaved = true;
	session.addNotification('Personal context updated', 'success');
	setTimeout(() => { contextSaved = false; }, 2000);
}
</script>

<div class="settings-page">
	<header class="page-header">
		<h2>Settings</h2>
		<p class="subtitle">Safety controls, personal context, and connection identity.</p>
	</header>

	<section class="section">
		<h3>Connection</h3>
		<div class="config-fields">
			<label>
				<span class="label">Relay URL</span>
				<input type="text" value={cfgRelayUrl} onchange={(e) => { cfgRelayUrl = e.currentTarget.value; cfgStore.set('relayUrl', cfgRelayUrl); }} class="config-input mono" />
			</label>
			<label>
				<span class="label">Display Name</span>
				<input type="text" value={cfgDisplayName} onchange={(e) => { cfgDisplayName = e.currentTarget.value; cfgStore.set('displayName', cfgDisplayName); }} class="config-input" />
			</label>
			<label>
				<span class="label">User ID</span>
				<input type="text" value={cfgUserId} onchange={(e) => { cfgUserId = e.currentTarget.value; cfgStore.set('userId', cfgUserId); }} class="config-input mono" />
			</label>
		</div>
		<div class="toggle-fields">
			<label class="toggle-label">
				<input type="checkbox" bind:checked={cfgAutoConnect} onchange={() => { cfgStore.set('autoConnect', cfgAutoConnect); }} />
				<span>Auto-connect on launch</span>
			</label>
			<label class="toggle-label">
				<input type="checkbox" bind:checked={cfgAutoReconnect} onchange={() => { cfgStore.set('autoReconnect', cfgAutoReconnect); }} />
				<span>Auto-reconnect on disconnect</span>
			</label>
		</div>
		<p class="hint">Changes saved automatically. Relay URL change takes effect on next connect.</p>
	</section>

	<section class="section">
		<h3>Personal Context</h3>
		<p class="hint">This text is sent to the AI client and injected below the immutable role context in the system prompt. It is informative, not authoritative — it cannot override safety rules.</p>
		<textarea
			class="context-textarea"
			bind:value={userContext}
			placeholder="e.g. I'm a sysadmin managing the Naval Fleet infrastructure. I prefer concise answers with command examples."
			rows="5"
		></textarea>
		<div class="context-actions">
			<button class="btn-save" onclick={handleContextSave} disabled={contextSaving || !session.getClient()}>
				{contextSaving ? 'Saving...' : contextSaved ? 'Saved' : 'Save Context'}
			</button>
			{#if !session.getClient()}
				<span class="hint">Connect to relay first</span>
			{/if}
		</div>
	</section>

	<section class="section">
		<h3>Memories <span class="mem-count">{memoryCount} memories (10 global + 10 conversation in AI context)</span></h3>
		{#if memoryNotification}
			<div class="toast">{memoryNotification}</div>
		{/if}
		<div class="mem-filter-row">
			<span class="filter-label">Show:</span>
			<select class="mem-filter-select" bind:value={memoryFilter} onchange={() => requestMemoryList()}>
				<option value="all">All memories</option>
				<option value="global">Global only</option>
				{#each convList as conv}
					<option value={conv.id}>{conv.name}</option>
				{/each}
			</select>
		</div>
		{#if memoryList.length > 0}
			<div class="memory-list">
				{#each memoryList as mem}
					<div class="memory-entry">
						{#if editingMemoryId === mem.id}
							<textarea class="mem-edit-input" bind:value={editingContent} rows="2"></textarea>
							<div class="mem-actions">
								<button class="btn-sm btn-save" onclick={handleMemorySave}>Save</button>
								<button class="btn-sm btn-cancel" onclick={() => { editingMemoryId = null; }}>Cancel</button>
							</div>
						{:else}
							<div class="mem-content">
								<span class="mem-badge" style="background: {categoryColors[mem.category] ?? '#666'}20; color: {categoryColors[mem.category] ?? '#666'}">{mem.category}</span>
								{#if mem.conversationId}
									<span class="mem-scope-badge mem-scope-conv">conv</span>
								{:else}
									<span class="mem-scope-badge mem-scope-global">global</span>
								{/if}
								<span class="mem-text">{mem.content}</span>
							</div>
							<div class="mem-meta">
								<span class="mem-date">{new Date(mem.createdAt).toLocaleDateString()}</span>
								<button class="btn-sm btn-edit" onclick={() => handleMemoryEdit(mem.id, mem.content)}>Edit</button>
								{#if deleteConfirmId === mem.id}
									<button class="btn-sm btn-delete-confirm" onclick={() => handleMemoryDelete(mem.id)}>Confirm</button>
									<button class="btn-sm btn-cancel" onclick={() => { deleteConfirmId = null; }}>Cancel</button>
								{:else}
									<button class="btn-sm btn-delete" onclick={() => { deleteConfirmId = mem.id; }}>Delete</button>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{:else}
			<p class="empty-mem">No memories saved yet. Use the "R" button on any message to remember it.</p>
		{/if}
	</section>

	<section class="section">
		<h3>Project Files <span class="mem-count">{projectTotalCount} files, {formatSize(projectTotalSize)} total</span></h3>
		<p class="hint">Upload files to give the AI persistent context about your project. Files are synced to the AI's project store and can be loaded into the system prompt.</p>

		{#if projectNotification}
			<div class="toast" role="status">{projectNotification}
				<button class="toast-dismiss" onclick={() => session.projects.clearNotification()}>×</button>
			</div>
		{/if}

		<!-- Upload form -->
		<div class="proj-upload">
			<label>
				<span class="label">File path</span>
				<input type="text" class="config-input mono" bind:value={uploadPath} placeholder="e.g. factions/iron-league.md" />
			</label>
			<label>
				<span class="label">Content</span>
				<textarea class="context-textarea proj-textarea" bind:value={uploadContent} placeholder="File content (.md, .json, .yaml, .yml, .txt)" rows="4"></textarea>
			</label>
			<div class="proj-upload-actions">
				<button class="btn-save" onclick={handleProjectUpload} disabled={!uploadPath.trim() || !uploadContent.trim() || !session.getClient()}>
					Upload
				</button>
				{#if !session.getClient()}
					<span class="hint">Connect to relay first</span>
				{/if}
			</div>
		</div>

		<!-- Token budget impact -->
		{#if projectTotalCount > 0}
			<div class="proj-stats">
				<span class="proj-stat">~{projectAlwaysTokens.toLocaleString()} tokens of {projectAlwaysCount} alwaysLoaded file{projectAlwaysCount !== 1 ? 's' : ''} in context</span>
			</div>
		{/if}

		<!-- File list -->
		{#if projectFiles.length > 0}
			<div class="proj-table">
				<div class="proj-header">
					<span class="proj-col-path">Path</span>
					<span class="proj-col-size">Size</span>
					<span class="proj-col-mode">Loading Mode</span>
					<span class="proj-col-actions">Actions</span>
				</div>
				{#each projectFiles as file}
					<div class="proj-row">
						<span class="proj-col-path mono">{file.path}</span>
						<span class="proj-col-size">{formatSize(file.size)}</span>
						<span class="proj-col-mode">
							<select
								class="proj-mode-select"
								value={getLoadingModeForFile(file.path)}
								onchange={(e) => handleLoadingModeChange(file.path, e.currentTarget.value as LoadingMode)}
							>
								<option value="always">Always Loaded</option>
								<option value="available">Available</option>
								<option value="none">Not Loaded</option>
							</select>
						</span>
						<span class="proj-col-actions">
							{#if deleteConfirmPath === file.path}
								{#if challengeActive && deleteTimer > 0}
									<span class="proj-timer">Challenge hours active — {deleteTimer}s</span>
								{/if}
								<button class="btn-sm btn-delete-confirm" onclick={() => handleProjectDelete(file.path)} disabled={challengeActive && deleteTimer > 0}>
									{challengeActive && deleteTimer > 0 ? `Wait ${deleteTimer}s` : 'Confirm Delete'}
								</button>
								<button class="btn-sm btn-cancel" onclick={cancelProjectDelete}>Cancel</button>
							{:else}
								<button class="btn-sm btn-delete" onclick={() => { deleteConfirmPath = file.path; if (!session.challengeStatus.get().active) deleteTimer = 0; else handleProjectDelete(file.path); }}>Delete</button>
							{/if}
						</span>
					</div>
				{/each}
			</div>
		{:else}
			<p class="empty-mem">No project files. Upload files to give the AI context about your project.</p>
		{/if}
	</section>

	<section class="section">
		<h3>Active Tools <span class="mem-count">{approvedTools.length} approved (this conversation)</span></h3>
		<p class="hint">Tool approvals are per-conversation. Switching conversations starts with fresh trust.</p>
		{#if approvedTools.length > 0}
			<div class="memory-list">
				{#each approvedTools as tool}
					<div class="memory-entry">
						<div class="mem-content">
							<span class="mem-badge" style="background: #4a9eff20; color: #4a9eff">trust {tool.trustLevel}</span>
							<code class="mem-text">{tool.toolId}</code>
						</div>
						<div class="mem-meta">
							<span class="mem-date">{tool.scope} — {new Date(tool.approvedAt).toLocaleTimeString()}</span>
							<button class="btn-sm btn-delete" onclick={() => handleToolRevoke(tool.toolId)}>Revoke</button>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<p class="empty-mem">No tools approved this session</p>
		{/if}
	</section>

	<section class="section">
		<h3>Provider {#if providerInfo}<span class="mem-count">{providerInfo.providerName}</span>{:else}<span class="mem-count">not connected</span>{/if}</h3>
		{#if providerInfo}
			<div class="info-grid">
				<span class="label">Name</span>
				<span class="value">{providerInfo.providerName}</span>
				<span class="label">ID</span>
				<span class="value mono">{providerInfo.providerId}</span>
				{#if providerInfo.model}
				<span class="label">Model</span>
				<span class="value mono">{providerInfo.model}</span>
				{/if}
				<span class="label">Status</span>
				<span class="value">{#if providerInfo.status === 'active'}<span class="prov-active">Active</span>{:else}<span class="prov-inactive">{providerInfo.status}</span>{/if}</span>
				<span class="label">Capabilities</span>
				<span class="value cap-list">
					{#if providerInfo.capabilities.conversation}<span class="cap-tag cap-yes">conversation</span>{/if}
					{#if providerInfo.capabilities.taskExecution}<span class="cap-tag cap-yes">taskExecution</span>{/if}
					{#if providerInfo.capabilities.fileTransfer}<span class="cap-tag cap-yes">fileTransfer</span>{:else}<span class="cap-tag cap-no">fileTransfer</span>{/if}
					{#if providerInfo.capabilities.streaming != null}
						{#if providerInfo.capabilities.streaming}<span class="cap-tag cap-yes">streaming</span>{:else}<span class="cap-tag cap-no">streaming</span>{/if}
					{/if}
				</span>
				{#if providerInfo.adapters && providerInfo.adapters.length > 0}
				<span class="label">Adapters</span>
				<span class="value">
					<div class="adapter-list">
						{#each providerInfo.adapters as ad}
							<div class="adapter-entry">
								<span class="adapter-model mono">{ad.model}</span>
								<span class="adapter-roles">{ad.roles.join(', ')}</span>
							</div>
						{/each}
					</div>
				</span>
				{/if}
			</div>
		{:else}
			<p class="empty-mem">No AI provider connected. Connect to the relay to see provider info.</p>
		{/if}
	</section>

	<section class="section">
		<h3>Extensions <span class="mem-count">{extensionCount} extension{extensionCount !== 1 ? 's' : ''} loaded, {extensionMessageTypes} message type{extensionMessageTypes !== 1 ? 's' : ''}</span></h3>
		{#if extensionList.length > 0}
			<div class="proj-table">
				<div class="proj-header ext-header">
					<span>Namespace</span>
					<span>Name</span>
					<span>Version</span>
					<span class="ext-col-count">Types</span>
				</div>
				{#each extensionList as ext}
					<div class="proj-row ext-row">
						<span class="mono">{ext.namespace}</span>
						<span>{ext.name}</span>
						<span class="mono">{ext.version}</span>
						<span class="ext-col-count">{ext.messageTypes.length}</span>
					</div>
				{/each}
			</div>
		{:else}
			<p class="empty-mem">No extensions loaded. Extensions are registered in the relay's extensions/ directory.</p>
		{/if}
	</section>

	<section class="section">
		<h3>Budget Guard</h3>
		<p class="hint">Web search budget is immutable enforcement — same tier as MaliClaw. Limits can be tightened immediately; increases take effect next month.</p>
		<div class="config-fields">
			<label>
				<span class="label">Monthly cap (USD)</span>
				<input type="number" value="10.00" step="0.50" min="0.50" class="config-input mono" disabled />
			</label>
			<label>
				<span class="label">Max searches per month</span>
				<input type="number" value="500" min="1" class="config-input mono" disabled />
			</label>
			<label>
				<span class="label">Max searches per day</span>
				<input type="number" value="50" min="1" class="config-input mono" disabled />
			</label>
			<label>
				<span class="label">Max searches per session</span>
				<input type="number" value="20" min="1" class="config-input mono" disabled />
			</label>
		</div>
		<p class="hint">Budget configuration requires connection to the AI client. Changes have a 7-day cooldown and are blocked during challenge hours.</p>
	</section>

	<section class="section">
		<h3>Safety Controls</h3>
		<p class="hint">Restrictions can be increased but never lowered below factory floors.</p>
		<SettingsPanel
			settings={currentSettings}
			floors={floorValues}
			{isAtFloor}
			{dirty}
			{error}
			onSettingChange={handleSettingChange}
			onSave={handleSave}
			onReset={handleReset}
		/>
	</section>

	<section class="section danger-zone">
		<h3>Danger Zone</h3>
		{#if showResetConfirm}
			<p class="hint">This will clear all settings and show the setup wizard again. Are you sure?</p>
			<div class="danger-actions">
				<button class="btn-danger" onclick={handleResetSetup}>Yes, Reset Everything</button>
				<button class="btn-sm btn-cancel" onclick={() => { showResetConfirm = false; }}>Cancel</button>
			</div>
		{:else}
			<button class="btn-danger-outline" onclick={() => { showResetConfirm = true; }}>Reset Setup</button>
		{/if}
	</section>
</div>

<style>
	.settings-page {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		overflow-y: auto;
		height: 100%;
	}

	.page-header h2 { font-size: 1.25rem; color: var(--color-text); }
	.subtitle { font-size: 0.85rem; color: var(--color-text-muted); margin-top: 0.25rem; }

	.section {
		background: var(--color-bg-secondary, #1a1a2e);
		border: 1px solid var(--color-border, #2a2a4a);
		border-radius: 0.5rem;
		padding: 1.25rem;
	}
	.section h3 { font-size: 1rem; margin-bottom: 0.75rem; color: var(--color-text); }

	.info-grid {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.375rem 1rem;
		font-size: 0.85rem;
	}
	.label { color: var(--color-text-muted); }
	.value { color: var(--color-text); font-size: 0.8rem; }

	.hint { font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.5rem; }

	.context-textarea {
		width: 100%;
		resize: vertical;
		padding: 0.5rem;
		font-family: monospace;
		font-size: 0.85rem;
		border: 1px solid var(--color-border, #2a2a4a);
		border-radius: 0.25rem;
		background: var(--color-bg, #0f0f23);
		color: var(--color-text);
		margin-top: 0.5rem;
	}

	.context-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}

	.btn-save {
		background: var(--color-accent, #4a9eff);
		color: white;
		border: none;
		padding: 0.375rem 0.75rem;
		border-radius: 0.25rem;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.btn-save:disabled { opacity: 0.5; cursor: not-allowed; }

	.mem-count { font-size: 0.7rem; color: var(--color-text-muted); font-weight: 400; margin-left: 0.5rem; }

	.toast {
		background: color-mix(in srgb, #22c55e 15%, transparent);
		color: #22c55e;
		padding: 0.375rem 0.75rem;
		border-radius: 0.25rem;
		font-size: 0.8rem;
		margin-bottom: 0.75rem;
	}

	.memory-list { display: flex; flex-direction: column; gap: 0.5rem; }

	.memory-entry {
		background: var(--color-bg, #0f0f23);
		border: 1px solid var(--color-border, #2a2a4a);
		border-radius: 0.375rem;
		padding: 0.625rem;
	}

	.mem-content { display: flex; align-items: flex-start; gap: 0.5rem; }

	.mem-badge {
		font-size: 0.65rem;
		font-weight: 600;
		padding: 0.125rem 0.375rem;
		border-radius: 999px;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.mem-text { font-size: 0.85rem; line-height: 1.3; color: var(--color-text); }

	.mem-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.375rem;
	}

	.mem-date { font-size: 0.7rem; color: var(--color-text-muted); }

	.btn-sm {
		padding: 0.125rem 0.375rem;
		border-radius: 0.2rem;
		font-size: 0.7rem;
		cursor: pointer;
		border: 1px solid var(--color-border, #2a2a4a);
		background: transparent;
	}
	.btn-edit { color: var(--color-accent, #4a9eff); border-color: var(--color-accent, #4a9eff); }
	.btn-delete { color: #ef4444; border-color: #ef4444; }
	.btn-delete-confirm { color: white; background: #ef4444; border-color: #ef4444; }
	.btn-cancel { color: var(--color-text-muted); }
	.btn-sm.btn-save { color: white; background: var(--color-accent, #4a9eff); border-color: var(--color-accent, #4a9eff); }

	.mem-edit-input {
		width: 100%;
		resize: vertical;
		padding: 0.375rem;
		border: 1px solid var(--color-accent, #4a9eff);
		border-radius: 0.25rem;
		background: var(--color-bg, #0f0f23);
		color: var(--color-text);
		font-size: 0.85rem;
		font-family: inherit;
		margin-bottom: 0.375rem;
	}

	.mem-actions { display: flex; gap: 0.375rem; }

	.empty-mem {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		text-align: center;
		padding: 1.5rem;
	}

	.config-fields { display: flex; flex-direction: column; gap: 0.5rem; }
	.config-fields label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.8rem; color: var(--color-text-muted); }
	.config-input { padding: 0.375rem 0.5rem; border: 1px solid var(--color-border, #2a2a4a); border-radius: 0.25rem; background: var(--color-bg, #0f0f23); color: var(--color-text); font-size: 0.85rem; }
	.config-input.mono { font-family: monospace; font-size: 0.8rem; }

	.toggle-fields { display: flex; flex-direction: column; gap: 0.375rem; margin-top: 0.75rem; }
	.toggle-label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--color-text); cursor: pointer; }
	.toggle-label input[type="checkbox"] { accent-color: var(--color-accent, #4a9eff); width: 16px; height: 16px; }

	.danger-zone { border-color: #ef4444 !important; }
	.danger-zone h3 { color: #ef4444; }
	.danger-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
	.btn-danger { padding: 0.375rem 0.75rem; background: #ef4444; color: white; border: none; border-radius: 0.25rem; font-size: 0.8rem; cursor: pointer; }
	.btn-danger-outline { padding: 0.375rem 0.75rem; background: transparent; color: #ef4444; border: 1px solid #ef4444; border-radius: 0.25rem; font-size: 0.8rem; cursor: pointer; }

	/* Project files */
	.proj-upload { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.75rem; }
	.proj-textarea { margin-top: 0.25rem; min-height: 4rem; }
	.proj-upload-actions { display: flex; align-items: center; gap: 0.75rem; }

	.proj-stats {
		display: flex;
		gap: 1rem;
		padding: 0.5rem 0.75rem;
		background: color-mix(in srgb, var(--color-accent, #4a9eff) 8%, transparent);
		border-radius: 0.25rem;
		margin-bottom: 0.75rem;
		font-size: 0.8rem;
	}
	.proj-stat { color: var(--color-accent, #4a9eff); }

	.proj-table { display: flex; flex-direction: column; gap: 0; }
	.proj-header, .proj-row {
		display: grid;
		grid-template-columns: 1fr 5rem 9rem 10rem;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		align-items: center;
		font-size: 0.8rem;
	}
	.proj-header {
		font-weight: 600;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-border, #2a2a4a);
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.proj-row {
		background: var(--color-bg, #0f0f23);
		border: 1px solid var(--color-border, #2a2a4a);
		border-radius: 0.25rem;
		margin-top: 0.25rem;
		color: var(--color-text);
	}
	.proj-col-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.proj-col-size { text-align: right; color: var(--color-text-muted); font-size: 0.75rem; }
	.proj-col-mode { display: flex; }
	.proj-col-actions { display: flex; gap: 0.375rem; justify-content: flex-end; flex-wrap: wrap; }

	.proj-mode-select {
		font-size: 0.75rem;
		padding: 0.125rem 0.25rem;
		border: 1px solid var(--color-border, #2a2a4a);
		border-radius: 0.2rem;
		background: var(--color-bg, #0f0f23);
		color: var(--color-text);
		cursor: pointer;
		width: 100%;
	}

	.proj-timer {
		font-size: 0.7rem;
		color: #f59e0b;
		white-space: nowrap;
	}

	/* Memory filter + scope badges */
	.mem-filter-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; font-size: 0.8rem; }
	.mem-filter-select {
		padding: 0.25rem 0.375rem; font-size: 0.8rem;
		border: 1px solid var(--color-border, #2a2a4a); border-radius: 0.25rem;
		background: var(--color-bg, #0f0f23); color: var(--color-text);
	}
	.mem-scope-badge {
		font-size: 0.6rem; font-weight: 600;
		padding: 0.0625rem 0.3rem; border-radius: 999px;
		white-space: nowrap; flex-shrink: 0;
	}
	.mem-scope-global { background: color-mix(in srgb, #a855f7 15%, transparent); color: #a855f7; }
	.mem-scope-conv { background: color-mix(in srgb, #4a9eff 15%, transparent); color: #4a9eff; }

	/* Provider */
	.prov-active { color: #22c55e; font-weight: 600; }
	.prov-inactive { color: #ef4444; font-weight: 600; }
	.cap-list { display: flex; flex-wrap: wrap; gap: 0.25rem; }
	.cap-tag {
		font-size: 0.65rem;
		font-weight: 600;
		padding: 0.0625rem 0.375rem;
		border-radius: 999px;
		white-space: nowrap;
	}
	.cap-yes { background: color-mix(in srgb, #22c55e 15%, transparent); color: #22c55e; }
	.cap-no { background: color-mix(in srgb, #ef4444 15%, transparent); color: #ef4444; text-decoration: line-through; }

	/* Adapters */
	.adapter-list { display: flex; flex-direction: column; gap: 0.25rem; }
	.adapter-entry { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; }
	.adapter-model { font-size: 0.75rem; }
	.adapter-roles { font-size: 0.7rem; color: var(--color-text-muted); }

	/* Extensions */
	.ext-header, .ext-row {
		grid-template-columns: 1fr 1fr 5rem 3.5rem !important;
	}
	.ext-col-count { text-align: right; }

	.toast-dismiss {
		background: none;
		border: none;
		color: inherit;
		cursor: pointer;
		font-size: 1rem;
		margin-left: 0.5rem;
		padding: 0;
		line-height: 1;
	}
	.toast { display: flex; align-items: center; justify-content: space-between; }
</style>
