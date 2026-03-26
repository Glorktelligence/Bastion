<script lang="ts">
import * as session from '$lib/session.js';
import type { SafetySettings, SettingUpdateResult } from '$lib/stores/settings.js';
import type { MemoryEntry } from '$lib/stores/memories.js';
import type { ApprovedTool } from '$lib/stores/tools.js';
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
let showResetConfirm = $state(false);

// Tool state
let approvedTools: readonly ApprovedTool[] = $state([]);

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

$effect(() => {
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
	];

	// Request memory list on mount
	requestMemoryList();

	return () => {
		for (const u of unsubs) u();
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

const categoryColors: Record<string, string> = {
  preference: '#4a9eff',
  fact: '#22c55e',
  workflow: '#a855f7',
  project: '#f59e0b',
};

function requestMemoryList(): void {
  const client = session.getClient();
  if (!client || !client.isConnected) return;
  client.send(JSON.stringify({
    type: 'memory_list',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: session.IDENTITY,
    payload: {},
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
		<h3>Memories <span class="mem-count">{memoryCount} memories (top 20 included in AI context)</span></h3>
		{#if memoryNotification}
			<div class="toast">{memoryNotification}</div>
		{/if}
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
		<h3>Active Tools <span class="mem-count">{approvedTools.length} approved this session</span></h3>
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

	.danger-zone { border-color: #ef4444 !important; }
	.danger-zone h3 { color: #ef4444; }
	.danger-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
	.btn-danger { padding: 0.375rem 0.75rem; background: #ef4444; color: white; border: none; border-radius: 0.25rem; font-size: 0.8rem; cursor: pointer; }
	.btn-danger-outline { padding: 0.375rem 0.75rem; background: transparent; color: #ef4444; border: 1px solid #ef4444; border-radius: 0.25rem; font-size: 0.8rem; cursor: pointer; }
</style>
