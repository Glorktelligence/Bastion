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
import type { DataPortabilityState, UsageStatusState } from '$lib/session.js';
import SettingsPanel from '$lib/components/SettingsPanel.svelte';
import { type UserPreferences, DEFAULT_USER_PREFERENCES, type BastionConfig } from '$lib/config/config-store.js';

// Tab navigation
const TABS = ['Appearance', 'Profile', 'Safety', 'Context', 'Files', 'Privacy', 'Usage', 'Tools', 'Provider', 'About'] as const;
type TabId = typeof TABS[number];

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
let settingsConnStatus: 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'error' = $state('disconnected');

// Appearance preferences
const ACCENT_PRESETS = [
	{ name: 'Indigo', color: '#6366f1' },
	{ name: 'Blue', color: '#3b82f6' },
	{ name: 'Emerald', color: '#10b981' },
	{ name: 'Amber', color: '#f59e0b' },
	{ name: 'Rose', color: '#f43f5e' },
	{ name: 'Purple', color: '#a855f7' },
	{ name: 'Cyan', color: '#06b6d4' },
	{ name: 'Gold', color: '#c9a227' },
] as const;

let prefs: UserPreferences = $state({ ...DEFAULT_USER_PREFERENCES, ...(cfgStore.get('preferences') as UserPreferences ?? {}) });

function savePreferences(): void {
	cfgStore.set('preferences' as keyof BastionConfig, { ...prefs } as BastionConfig[keyof BastionConfig]);
	applyPreferencesLive(prefs);
}

/** Lighten a hex colour by blending toward white. No color-mix() — WebView safe. */
function lightenHex(hex: string): string {
	const blend = (ch: string, pct: number): number =>
		Math.min(255, Math.round(parseInt(ch, 16) + (255 - parseInt(ch, 16)) * pct));
	const r = blend(hex.slice(1, 3), 0.3);
	const g = blend(hex.slice(3, 5), 0.3);
	const b = blend(hex.slice(5, 7), 0.3);
	return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function applyPreferencesLive(p: UserPreferences): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	root.style.setProperty('--color-accent', p.accentColor);
	root.style.setProperty('--color-accent-hover', lightenHex(p.accentColor));
	root.style.setProperty('--color-user-bubble', p.userBubbleColor || p.accentColor);
	root.style.setProperty('--color-ai-bubble', p.aiBubbleColor || '#1a1d27');
	root.style.setProperty('--msg-font-size', `${p.messageFontSize}rem`);
	if (p.compactMode) root.classList.add('compact');
	else root.classList.remove('compact');
	if (p.timestampDisplay === 'hover') root.classList.add('timestamp-hover');
	else root.classList.remove('timestamp-hover');
}

function handlePrefChange<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]): void {
	prefs = { ...prefs, [key]: value };
	savePreferences();
}

function resetPreferences(): void {
	prefs = { ...DEFAULT_USER_PREFERENCES };
	savePreferences();
}

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

// Data portability state
let dpState: DataPortabilityState = $state(session.dataPortability.get());
let importFileInput: HTMLInputElement | null = $state(null);
let importFileError: string | null = $state(null);

// Usage status state
let usage: UsageStatusState = $state(session.usageStatus.get());

// Tab navigation state
let activeTab: TabId = $state('Appearance');

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
		session.dataPortability.subscribe((v) => { dpState = v; }),
		session.usageStatus.subscribe((v) => { usage = v; }),
		session.connection.subscribe((v) => { settingsConnStatus = v.status; }),
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
let showAddMemory = $state(false);
let newMemoryContent = $state('');
let newMemoryCategory = $state<'preference' | 'fact' | 'workflow' | 'project'>('fact');

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

function handleAddMemory(): void {
  const client = session.getClient();
  if (!client || !newMemoryContent.trim()) return;
  client.send(JSON.stringify({
    type: 'memory_proposal',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: session.IDENTITY,
    payload: {
      proposalId: crypto.randomUUID(),
      content: newMemoryContent.trim(),
      category: newMemoryCategory,
      sourceMessageId: 'settings-manual-add',
    },
  }));
  newMemoryContent = '';
  newMemoryCategory = 'fact';
  showAddMemory = false;
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

// File airlock upload state
let airlockFileInput: HTMLInputElement | null = $state(null);
let airlockPurpose: 'skill' | 'project' = $state('project');
let airlockError: string | null = $state(null);

const AIRLOCK_ALLOWED_EXT = new Set([
  '.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.xml', '.toml',
  '.ts', '.js', '.py', '.rs', '.go', '.java', '.html', '.css', '.svelte',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf',
]);

const AIRLOCK_BLOCKED_EXT = new Set([
  '.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.bz2', '.xz',
  '.exe', '.msi', '.sh', '.bat', '.cmd', '.ps1',
  '.dll', '.so', '.dylib', '.bin', '.com',
  '.iso', '.img', '.dmg', '.deb', '.rpm', '.apk', '.ipa',
]);

const AIRLOCK_MAX_SIZE = 50 * 1024 * 1024; // 50 MB

function triggerAirlockUpload(purpose: 'skill' | 'project'): void {
  airlockPurpose = purpose;
  airlockError = null;
  airlockFileInput?.click();
}

function handleAirlockFileChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  airlockError = null;

  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';

  if (AIRLOCK_BLOCKED_EXT.has(ext)) {
    if (['.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.bz2', '.xz'].includes(ext)) {
      airlockError = `Archive files (${ext}) are not allowed — archives bypass content scanning and may contain malicious content`;
    } else if (['.exe', '.msi', '.sh', '.bat', '.cmd', '.ps1'].includes(ext)) {
      airlockError = `Executable files (${ext}) are not allowed for security reasons`;
    } else {
      airlockError = `File type ${ext} is not allowed for security reasons`;
    }
    input.value = '';
    return;
  }

  if (!AIRLOCK_ALLOWED_EXT.has(ext)) {
    airlockError = `File type ${ext} is not in the allowed list`;
    input.value = '';
    return;
  }

  if (file.size > AIRLOCK_MAX_SIZE) {
    airlockError = `File exceeds the 50 MB limit (file is ${formatSize(file.size)})`;
    input.value = '';
    return;
  }

  const client = session.getClient();
  if (!client) {
    airlockError = 'Not connected to relay';
    input.value = '';
    return;
  }

  const transferId = crypto.randomUUID();
  session.fileTransfers.startUpload(transferId, file.name, file.size);

  const reader = new FileReader();
  reader.onload = async (): Promise<void> => {
    try {
      const data = new Uint8Array(reader.result as ArrayBuffer);
      const hashBuf = await globalThis.crypto.subtle.digest('SHA-256', data);
      const hash = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
      const mimeType = file.type || 'application/octet-stream';

      const fileDataB64 = btoa(String.fromCharCode(...data));
      client.send(JSON.stringify({
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
          purpose: airlockPurpose,
          projectContext: airlockPurpose === 'skill' ? 'skill upload' : 'project file upload',
          fileData: fileDataB64,
        },
      }));
      session.fileTransfers.updateUploadPhase(transferId, 'uploading');
      session.addNotification(`File "${file.name}" submitted as ${airlockPurpose}`, 'info');
    } catch (err) {
      session.fileTransfers.updateUploadPhase(transferId, 'failed', err instanceof Error ? err.message : 'Upload failed');
    }
  };
  reader.readAsArrayBuffer(file);
  input.value = '';
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

// ---------------------------------------------------------------------------
// Data portability (GDPR Article 20)
// ---------------------------------------------------------------------------

function handleExportData(): void {
  const client = session.getClient();
  if (!client) return;
  session.dataPortability.update((s) => ({
    ...s,
    exporting: true,
    exportProgress: 0,
    exportPhase: 'Requesting export...',
    exportReady: false,
    exportFilename: null,
    exportTransferId: null,
    exportSizeBytes: 0,
    exportCounts: null,
    importComplete: null,
  }));
  client.send(JSON.stringify({
    type: 'data_export_request',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: session.IDENTITY,
    payload: { format: 'bdp' },
  }));
}

function handleImportClick(): void {
  importFileError = null;
  importFileInput?.click();
}

function handleImportFileChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  importFileError = null;

  if (!file.name.endsWith('.bdp') && !file.name.endsWith('.zip')) {
    importFileError = 'Only .bdp (Bastion Data Package) files are accepted';
    input.value = '';
    return;
  }

  const client = session.getClient();
  if (!client) {
    importFileError = 'Not connected to relay';
    input.value = '';
    return;
  }

  session.dataPortability.update((s) => ({ ...s, importing: true, importValidation: null, importComplete: null }));

  const transferId = crypto.randomUUID();
  session.fileTransfers.startUpload(transferId, file.name, file.size);

  const reader = new FileReader();
  reader.onload = async (): Promise<void> => {
    try {
      const data = new Uint8Array(reader.result as ArrayBuffer);
      const hashBuf = await globalThis.crypto.subtle.digest('SHA-256', data);
      const hash = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');

      const importFileDataB64 = btoa(String.fromCharCode(...data));
      client.send(JSON.stringify({
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
          mimeType: 'application/zip',
          purpose: 'import',
          projectContext: 'data import',
          fileData: importFileDataB64,
        },
      }));
      session.fileTransfers.updateUploadPhase(transferId, 'uploading');
    } catch (err) {
      importFileError = `Upload failed: ${err instanceof Error ? err.message : String(err)}`;
      session.dataPortability.update((s) => ({ ...s, importing: false }));
    }
  };
  reader.readAsArrayBuffer(file);
  input.value = '';
}

function handleImportConfirm(): void {
  const client = session.getClient();
  const validation = dpState.importValidation;
  if (!client || !validation) return;

  session.dataPortability.update((s) => ({ ...s, importing: true }));

  client.send(JSON.stringify({
    type: 'data_import_confirm',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: session.IDENTITY,
    payload: {
      importConversations: true,
      importMemories: true,
      importProjectFiles: true,
      importSkills: true,
      importConfig: false,
      conflictResolutions: validation.conflicts.map((c) => ({
        type: c.type,
        path: c.path,
        action: 'skip' as const,
      })),
    },
  }));
}

function handleImportDismiss(): void {
  session.dataPortability.update((s) => ({
    ...s,
    importing: false,
    importValidation: null,
    importComplete: null,
  }));
}

// ---------------------------------------------------------------------------
// Data Erasure (GDPR Article 17)
// ---------------------------------------------------------------------------

let erasureConfirmText: string = $state('');

function handleErasureRequest(): void {
  const client = session.getClient();
  if (!client) return;
  session.dataPortability.update((s) => ({
    ...s,
    erasureRequesting: true,
    erasurePreview: null,
    erasureComplete: null,
  }));
  client.send(JSON.stringify({
    type: 'data_erasure_request',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: session.IDENTITY,
    payload: {},
  }));
}

function handleErasureConfirm(): void {
  const client = session.getClient();
  if (!client || erasureConfirmText !== 'DELETE MY DATA') return;
  client.send(JSON.stringify({
    type: 'data_erasure_confirm',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: session.IDENTITY,
    payload: { confirmed: true },
  }));
  erasureConfirmText = '';
}

function handleErasureCancel(): void {
  const client = session.getClient();
  if (!client || !dpState.erasureComplete) return;
  client.send(JSON.stringify({
    type: 'data_erasure_cancel',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: session.IDENTITY,
    payload: { erasureId: dpState.erasureComplete.erasureId },
  }));
  session.dataPortability.update((s) => ({
    ...s,
    erasureComplete: null,
    erasurePreview: null,
  }));
}

function handleErasureDismissPreview(): void {
  session.dataPortability.update((s) => ({
    ...s,
    erasureRequesting: false,
    erasurePreview: null,
  }));
  erasureConfirmText = '';
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
		<div class="tab-bar">
			{#each TABS as tab}
				<button
					class="tab-btn"
					class:tab-active={activeTab === tab}
					onclick={() => { activeTab = tab; }}
				>{tab}</button>
			{/each}
		</div>
	</header>

	{#if activeTab === 'Appearance'}
	<section class="section">
		<h3>Accent Colour</h3>
		<div class="accent-presets">
			{#each ACCENT_PRESETS as preset}
				<button
					class="accent-swatch"
					class:accent-active={prefs.accentColor === preset.color}
					style="background:{preset.color}"
					title={preset.name}
					onclick={() => handlePrefChange('accentColor', preset.color)}
				></button>
			{/each}
			<label class="accent-custom-label" title="Custom colour">
				<input
					type="color"
					class="accent-custom-input"
					value={prefs.accentColor}
					oninput={(e) => handlePrefChange('accentColor', e.currentTarget.value)}
				/>
				<span class="accent-custom-icon">+</span>
			</label>
		</div>
		<p class="hint">Current: {prefs.accentColor}</p>
	</section>

	<section class="section">
		<h3>Message Bubbles</h3>
		<div class="bubble-controls">
			<label class="bubble-ctrl">
				<span class="label">User bubble colour</span>
				<div class="bubble-color-row">
					<input
						type="color"
						value={prefs.userBubbleColor || prefs.accentColor}
						oninput={(e) => handlePrefChange('userBubbleColor', e.currentTarget.value)}
					/>
					<button class="btn-sm btn-cancel" onclick={() => handlePrefChange('userBubbleColor', '')}>Reset</button>
				</div>
			</label>
			<label class="bubble-ctrl">
				<span class="label">AI bubble colour</span>
				<div class="bubble-color-row">
					<input
						type="color"
						value={prefs.aiBubbleColor || '#1a1d27'}
						oninput={(e) => handlePrefChange('aiBubbleColor', e.currentTarget.value)}
					/>
					<button class="btn-sm btn-cancel" onclick={() => handlePrefChange('aiBubbleColor', '')}>Reset</button>
				</div>
			</label>
		</div>

		<div class="bubble-preview">
			<p class="preview-label">Preview</p>
			<div class="preview-chat">
				<div class="preview-bubble preview-user" style="background:{prefs.userBubbleColor || prefs.accentColor}">
					<span class="preview-sender">You</span>
					<span class="preview-text" style="font-size:{prefs.messageFontSize}rem">How does the safety engine work?</span>
				</div>
				<div class="preview-bubble preview-ai" style="background:{prefs.aiBubbleColor || '#1a1d27'}">
					<span class="preview-sender">Claude</span>
					<span class="preview-text" style="font-size:{prefs.messageFontSize}rem">The safety engine uses a three-layer evaluation system: absolute boundaries, contextual challenges, and completeness checks.</span>
				</div>
			</div>
		</div>
	</section>

	<section class="section">
		<h3>Typography</h3>
		<label class="slider-label">
			<span class="label">Message font size: {prefs.messageFontSize.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}rem</span>
			<input
				type="range"
				min="0.75"
				max="1.125"
				step="0.0625"
				value={prefs.messageFontSize}
				oninput={(e) => handlePrefChange('messageFontSize', parseFloat(e.currentTarget.value))}
				class="pref-slider"
			/>
		</label>
		<p class="preview-text-sample" style="font-size:{prefs.messageFontSize}rem">The quick brown fox jumps over the lazy dog.</p>
	</section>

	<section class="section">
		<h3>Layout</h3>
		<div class="toggle-fields">
			<label class="toggle-label">
				<input type="checkbox" checked={prefs.compactMode} onchange={(e) => handlePrefChange('compactMode', e.currentTarget.checked)} />
				<span>Compact mode</span>
			</label>
			<label class="toggle-label">
				<input type="checkbox" checked={prefs.timestampDisplay === 'always'} onchange={(e) => handlePrefChange('timestampDisplay', e.currentTarget.checked ? 'always' : 'hover')} />
				<span>Always show timestamps</span>
			</label>
			<label class="toggle-label">
				<input type="checkbox" checked={prefs.groupConsecutiveMessages} onchange={(e) => handlePrefChange('groupConsecutiveMessages', e.currentTarget.checked)} />
				<span>Group consecutive messages</span>
			</label>
			<label class="toggle-label">
				<input type="checkbox" checked={prefs.showChallengeBar} onchange={(e) => handlePrefChange('showChallengeBar', e.currentTarget.checked)} />
				<span>Show challenge hours bar</span>
			</label>
			<label class="toggle-label">
				<input type="checkbox" checked={prefs.soundsEnabled} onchange={(e) => handlePrefChange('soundsEnabled', e.currentTarget.checked)} />
				<span>Notification sounds</span>
			</label>
		</div>
	</section>

	<section class="section">
		<button class="btn-danger-outline" onclick={resetPreferences}>Reset to Defaults</button>
		<p class="hint">Restore all appearance settings to their factory values.</p>
	</section>
	{/if}

	{#if activeTab === 'Profile'}
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
	{/if}

	{#if activeTab === 'Context'}
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
			<button class="btn-airlock" onclick={() => { showAddMemory = !showAddMemory; }} disabled={!session.getClient()}>
				{showAddMemory ? 'Cancel' : 'Add Memory'}
			</button>
		</div>

		{#if showAddMemory}
			<div class="add-memory-form">
				<textarea bind:value={newMemoryContent} rows="2" placeholder="Memory content — what should the AI remember?"></textarea>
				<div class="add-memory-controls">
					<select class="add-memory-select" bind:value={newMemoryCategory}>
						<option value="fact">Fact</option>
						<option value="preference">Preference</option>
						<option value="workflow">Workflow</option>
						<option value="project">Project</option>
					</select>
					<button class="btn-sm btn-save" onclick={handleAddMemory} disabled={!newMemoryContent.trim()}>Save</button>
					<button class="btn-sm btn-cancel" onclick={() => { showAddMemory = false; }}>Cancel</button>
				</div>
			</div>
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
	{/if}

	{#if activeTab === 'Files'}
	<section class="section">
		<h3>Project Files <span class="mem-count">{projectTotalCount} files, {formatSize(projectTotalSize)} total</span></h3>
		<p class="hint">Upload files to give the AI persistent context about your project. Files are synced to the AI's project store and can be loaded into the system prompt.</p>

		{#if projectNotification}
			<div class="toast" role="status">{projectNotification}
				<button class="toast-dismiss" onclick={() => session.projects.clearNotification()}>×</button>
			</div>
		{/if}

		{#if airlockError}
			<div class="airlock-error">
				<span>{airlockError}</span>
				<button class="toast-dismiss" onclick={() => { airlockError = null; }}>×</button>
			</div>
		{/if}

		<input type="file" class="file-input-hidden" bind:this={airlockFileInput} onchange={handleAirlockFileChange} />

		<div class="airlock-upload-row">
			<button class="btn-airlock" onclick={() => triggerAirlockUpload('skill')} disabled={!session.getClient()}>
				Upload Skill
			</button>
			<button class="btn-airlock" onclick={() => triggerAirlockUpload('project')} disabled={!session.getClient()}>
				Upload Project File
			</button>
			<span class="hint" style="margin-top:0">Files go through the security airlock (quarantine + hash verification)</span>
		</div>

		<!-- Upload form (text-based) -->
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
	{/if}

	{#if activeTab === 'Tools'}
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
	{/if}

	{#if activeTab === 'Provider'}
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
								{#if ad.maxContextTokens}
									<span class="adapter-context">{(ad.maxContextTokens / 1000).toFixed(0)}k ctx</span>
								{/if}
								{#if ad.pricingInputPerMTok != null}
									<span class="adapter-pricing">${ad.pricingInputPerMTok} / ${ad.pricingOutputPerMTok ?? '?'} per MTok</span>
								{/if}
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
	{/if}

	{#if activeTab === 'Safety'}
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
	{/if}

	{#if activeTab === 'Privacy'}
	<section class="section">
		<h3>Data & Privacy <span class="mem-count">GDPR Article 20</span></h3>
		<p class="hint">Export all your data or import from a previous export. Exports produce a .bdp (Bastion Data Package) file.</p>

		<input type="file" class="file-input-hidden" accept=".bdp,.zip" bind:this={importFileInput} onchange={handleImportFileChange} />

		{#if importFileError}
			<div class="airlock-error">
				<span>{importFileError}</span>
				<button class="toast-dismiss" onclick={() => { importFileError = null; }}>×</button>
			</div>
		{/if}

		<div class="dp-section">
			<h4 class="dp-subtitle">Export</h4>
			<p class="hint" style="margin-top:0">Download all your conversations, memories, project files, skills, and configuration.</p>

			{#if dpState.exporting}
				<div class="dp-progress">
					<div class="dp-progress-bar">
						<div class="dp-progress-fill" style="width: {dpState.exportProgress}%"></div>
					</div>
					<span class="dp-progress-label">{dpState.exportProgress}% — {dpState.exportPhase}</span>
				</div>
			{:else if dpState.exportReady && dpState.exportFilename}
				<div class="dp-ready">
					<span class="dp-ready-icon">&#10003;</span>
					<div class="dp-ready-info">
						<span class="dp-ready-filename">{dpState.exportFilename}</span>
						<span class="dp-ready-size">{formatSize(dpState.exportSizeBytes)}</span>
						{#if dpState.exportCounts}
							<span class="dp-ready-counts">
								{dpState.exportCounts.conversations} conversations, {dpState.exportCounts.memories} memories, {dpState.exportCounts.projectFiles} project files, {dpState.exportCounts.skills} skills
							</span>
						{/if}
					</div>
				</div>
			{:else}
				<button class="btn-save" onclick={handleExportData} disabled={!session.getClient()}>
					Export All Data
				</button>
				{#if !session.getClient()}
					<span class="hint">Connect to relay first</span>
				{/if}
			{/if}
		</div>

		<div class="dp-section">
			<h4 class="dp-subtitle">Import</h4>
			<p class="hint" style="margin-top:0">Import data from a .bdp file. Conversations are appended, memories are deduplicated.</p>

			{#if dpState.importing && !dpState.importValidation}
				<span class="hint">Uploading and validating...</span>
			{:else if dpState.importValidation}
				{#if dpState.importValidation.valid}
					<div class="dp-import-preview">
						<div class="dp-preview-header">Import Preview <span class="mem-count">v{dpState.importValidation.version}, exported {new Date(dpState.importValidation.exportedAt).toLocaleDateString()}</span></div>
						<div class="dp-preview-counts">
							<span>{dpState.importValidation.contents.conversations} conversations</span>
							<span>{dpState.importValidation.contents.memories} memories</span>
							<span>{dpState.importValidation.contents.projectFiles} project files</span>
							<span>{dpState.importValidation.contents.skills} skills</span>
							{#if dpState.importValidation.contents.hasConfig}
								<span>+ config</span>
							{/if}
						</div>
						{#if dpState.importValidation.conflicts.length > 0}
							<div class="dp-conflicts">
								<span class="dp-conflicts-label">Conflicts ({dpState.importValidation.conflicts.length}):</span>
								{#each dpState.importValidation.conflicts as conflict}
									<div class="dp-conflict-item">
										<span class="mem-badge" style="background: #f59e0b20; color: #f59e0b">{conflict.type}</span>
										<span>{conflict.path}: {conflict.detail}</span>
									</div>
								{/each}
							</div>
						{/if}
						<div class="dp-import-actions">
							<button class="btn-save" onclick={handleImportConfirm} disabled={dpState.importing}>
								{dpState.importing ? 'Importing...' : 'Import Selected'}
							</button>
							<button class="btn-sm btn-cancel" onclick={handleImportDismiss}>Cancel</button>
						</div>
					</div>
				{:else}
					<div class="airlock-error">
						<span>Validation failed: {dpState.importValidation.errors.join(', ')}</span>
						<button class="toast-dismiss" onclick={handleImportDismiss}>×</button>
					</div>
				{/if}
			{:else if dpState.importComplete}
				<div class="dp-import-result">
					<span class="dp-ready-icon">&#10003;</span>
					<div class="dp-ready-info">
						<span>Imported: {dpState.importComplete.imported.conversations}c {dpState.importComplete.imported.memories}m {dpState.importComplete.imported.projectFiles}p {dpState.importComplete.imported.skills}s</span>
						{#if dpState.importComplete.errors.length > 0}
							<span class="dp-import-errors">{dpState.importComplete.errors.length} error(s)</span>
						{/if}
					</div>
					<button class="btn-sm btn-cancel" onclick={handleImportDismiss}>Dismiss</button>
				</div>
			{:else}
				<button class="btn-airlock" onclick={handleImportClick} disabled={!session.getClient()}>
					Import Data
				</button>
				{#if !session.getClient()}
					<span class="hint">Connect to relay first</span>
				{/if}
			{/if}
		</div>
		<div class="dp-section">
			<h4 class="dp-subtitle">Delete All Data <span class="mem-count">GDPR Article 17</span></h4>
			<p class="hint" style="margin-top:0">Permanently delete all your data after a 30-day cooling-off period.</p>

			{#if dpState.erasureComplete}
				<div class="erasure-active">
					<div class="erasure-active-header">Data Erasure In Progress</div>
					<div class="erasure-active-info">
						<span class="label">Erasure ID</span>
						<span class="value mono">{dpState.erasureComplete.erasureId.slice(0, 8)}...</span>
						<span class="label">Soft deleted</span>
						<span class="value">{new Date(dpState.erasureComplete.hardDeleteScheduledAt).toLocaleDateString()  !== 'Invalid Date' ? new Date(new Date(dpState.erasureComplete.hardDeleteScheduledAt).getTime() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString() : 'now'}</span>
						<span class="label">Hard delete</span>
						<span class="value">{new Date(dpState.erasureComplete.hardDeleteScheduledAt).toLocaleDateString()}</span>
						<span class="label">Deleted</span>
						<span class="value">{dpState.erasureComplete.softDeleted.conversations}c {dpState.erasureComplete.softDeleted.messages}m {dpState.erasureComplete.softDeleted.memories}mem {dpState.erasureComplete.softDeleted.projectFiles}p {dpState.erasureComplete.softDeleted.usageRecords}u</span>
					</div>
					<p class="hint">Your data is marked for deletion. You can cancel within 30 days.</p>
					<button class="btn-danger-outline" onclick={handleErasureCancel}>Cancel Erasure</button>
				</div>
			{:else if dpState.erasurePreview}
				<div class="erasure-preview">
					<div class="erasure-preview-header">Deletion Preview</div>
					<div class="erasure-preview-counts">
						<span>{dpState.erasurePreview.conversations} conversations ({dpState.erasurePreview.messages.toLocaleString()} messages)</span>
						<span>{dpState.erasurePreview.memories} memories</span>
						<span>{dpState.erasurePreview.projectFiles} project files</span>
						<span>{dpState.erasurePreview.usageRecords.toLocaleString()} usage records</span>
					</div>
					<p class="hint">{dpState.erasurePreview.auditNote}</p>
					<p class="hint">You have {dpState.erasurePreview.softDeleteDays} days to cancel this request.</p>
					<div class="erasure-confirm-input">
						<label>
							<span class="label">Type 'DELETE MY DATA' to confirm</span>
							<input type="text" class="config-input mono" placeholder="DELETE MY DATA" bind:value={erasureConfirmText} />
						</label>
					</div>
					<div class="dp-import-actions">
						<button class="btn-danger" onclick={handleErasureConfirm} disabled={erasureConfirmText !== 'DELETE MY DATA'}>Delete My Data</button>
						<button class="btn-sm btn-cancel" onclick={handleErasureDismissPreview}>Cancel</button>
					</div>
				</div>
			{:else if dpState.erasureRequesting}
				<span class="hint">Requesting erasure preview...</span>
			{:else}
				<p class="hint">Export your data first if you want a copy. Erasure is permanent after 30 days.</p>
				<div class="dp-import-actions">
					{#if !dpState.exportReady}
						<button class="btn-save" onclick={handleExportData} disabled={!session.getClient() || dpState.exporting}>
							{dpState.exporting ? 'Exporting...' : 'Export My Data First'}
						</button>
					{/if}
					<button class="btn-danger-outline" onclick={handleErasureRequest} disabled={!session.getClient()}>
						{dpState.exportReady ? 'Delete My Data' : "I Don't Need An Export"}
					</button>
				</div>
				{#if !session.getClient()}
					<span class="hint">Connect to relay first</span>
				{/if}
			{/if}
		</div>
	</section>
	{/if}

	{#if activeTab === 'Usage'}
	<section class="section">
		<h3>Usage & Budget</h3>
		<p class="hint">API token usage across all adapters. Budget enforcement is same tier as MaliClaw — tighten immediately, loosen next month.</p>

		<div class="usage-cards">
			<div class="usage-card">
				<span class="usage-card-label">Today</span>
				<span class="usage-card-value">{usage.today.calls} calls</span>
				<span class="usage-card-detail">{(usage.today.inputTokens + usage.today.outputTokens).toLocaleString()} tokens &middot; ${usage.today.costUsd.toFixed(4)}</span>
			</div>
			<div class="usage-card">
				<span class="usage-card-label">This Month</span>
				<span class="usage-card-value">{usage.thisMonth.calls} calls</span>
				<span class="usage-card-detail">{(usage.thisMonth.inputTokens + usage.thisMonth.outputTokens).toLocaleString()} tokens &middot; ${usage.thisMonth.costUsd.toFixed(2)} of ${usage.budget.monthlyCapUsd.toFixed(2)}</span>
				<div class="usage-budget-bar">
					<div class="usage-budget-fill" style="width: {Math.min(100, usage.budget.percentUsed)}%"></div>
				</div>
				<span class="usage-budget-label">{usage.budget.percentUsed.toFixed(1)}% used &middot; ${usage.budget.remaining.toFixed(2)} remaining</span>
			</div>
		</div>

		{#if Object.keys(usage.byAdapter).length > 0}
			<h4 class="usage-sub">By Adapter</h4>
			<div class="usage-adapter-list">
				{#each Object.entries(usage.byAdapter) as [adapterId, data]}
					<div class="usage-adapter-row">
						<span class="usage-adapter-name mono">{adapterId}</span>
						<span class="usage-adapter-calls">{data.calls} calls</span>
						<span class="usage-adapter-cost">${data.costUsd.toFixed(4)}</span>
					</div>
				{/each}
			</div>
		{/if}

		<h4 class="usage-sub">Budget Configuration</h4>
		<p class="hint" style="margin-top:0">Budget changes: tighten immediately, loosen next month. 7-day cooldown. Blocked during challenge hours.</p>
		<div class="config-fields">
			<label>
				<span class="label">Monthly cap (USD)</span>
				<input type="number" value="10.00" step="0.50" min="0.50" class="config-input mono" disabled />
			</label>
			<label>
				<span class="label">Alert at (%)</span>
				<input type="number" value="50" min="1" max="99" class="config-input mono" disabled />
			</label>
		</div>

		{#if usage.promptBudget}
		<h4 class="usage-sub">Context Budget</h4>
		<p class="hint" style="margin-top:0">System prompt zone utilization. Each zone has a token budget enforced by the compartmentalized prompt assembler.</p>
		<div class="ctx-budget-zones">
			{#each usage.promptBudget.zones as zone}
			{@const pct = zone.budget > 0 ? Math.min(100, (zone.tokenCount / zone.budget) * 100) : 0}
			<div class="ctx-zone-row">
				<span class="ctx-zone-name">{zone.name}{#if zone.truncated}<span class="ctx-truncated" title="Content was truncated to fit budget">⚠</span>{/if}</span>
				<div class="ctx-zone-bar">
					<div class="ctx-zone-fill" class:ctx-truncated-fill={zone.truncated} style="width: {pct}%"></div>
				</div>
				<span class="ctx-zone-stat mono">{zone.tokenCount.toLocaleString()}{#if zone.budget > 0} / {zone.budget.toLocaleString()}{/if} <span class="ctx-zone-pct">({zone.budget > 0 ? pct.toFixed(0) : '—'}%)</span></span>
			</div>
			{#if zone.components.length > 0}
			<div class="ctx-zone-components">{zone.components.join(', ')}</div>
			{/if}
			{/each}
		</div>
		<div class="ctx-budget-total">
			<div class="ctx-total-row">
				<span class="label">Total</span>
				<span class="value mono">{usage.promptBudget.totalTokens.toLocaleString()} / {usage.promptBudget.maxContextTokens.toLocaleString()} tokens ({usage.promptBudget.utilizationPercent.toFixed(1)}%)</span>
			</div>
			<div class="ctx-total-row">
				<span class="label">Available</span>
				<span class="value mono">{usage.promptBudget.available.toLocaleString()} tokens</span>
			</div>
		</div>
		{/if}
	</section>
	{/if}

	{#if activeTab === 'About'}
	<section class="section">
		<h3>About Bastion</h3>
		<div class="info-grid">
			<span class="label">Version</span>
			<span class="value mono">{__BASTION_VERSION__}</span>
			<span class="label">Protocol</span>
			<span class="value">85 message types, 48 error codes</span>
			<span class="label">Extensions</span>
			<span class="value">{extensionCount} loaded, {extensionMessageTypes} message types</span>
			{#if providerInfo}
			<span class="label">Provider</span>
			<span class="value">{providerInfo.providerName} ({providerInfo.model})</span>
			{/if}
		</div>
	</section>
	{/if}

	{#if activeTab === 'Profile'}
	<section class="section danger-zone">
		<h3>Danger Zone</h3>
		<div class="danger-item">
			<div class="danger-item-desc">
				<span class="danger-item-label">Disconnect from Relay</span>
				<span class="hint">Close the active WebSocket connection to the Bastion relay.</span>
			</div>
			<button
				class="btn-danger-outline"
				disabled={settingsConnStatus === 'disconnected'}
				onclick={() => { session.disconnect(); }}
			>Disconnect</button>
		</div>
		<div class="danger-item">
			<div class="danger-item-desc">
				<span class="danger-item-label">Reset Setup</span>
				<span class="hint">Clear all settings and show the setup wizard again.</span>
			</div>
			{#if showResetConfirm}
				<div class="danger-actions">
					<button class="btn-danger" onclick={handleResetSetup}>Yes, Reset Everything</button>
					<button class="btn-sm btn-cancel" onclick={() => { showResetConfirm = false; }}>Cancel</button>
				</div>
			{:else}
				<button class="btn-danger-outline" onclick={() => { showResetConfirm = true; }}>Reset Setup</button>
			{/if}
		</div>
	</section>
	{/if}
</div>

<style>
	.settings-page {
		padding: 1.5rem;
		padding-top: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		overflow-y: auto;
		height: 100%;
	}

	.page-header h2 { font-size: 1.25rem; color: var(--color-text); margin-bottom: 0.5rem; }

	/* Tab bar */
	.tab-bar {
		display: flex; gap: 0.125rem; flex-wrap: wrap;
		border-bottom: 1px solid var(--color-border, #2a2a4a);
		padding-bottom: 0.375rem;
	}
	.tab-btn {
		padding: 0.3rem 0.625rem; border-radius: 4px 4px 0 0;
		border: 1px solid transparent; border-bottom: none;
		background: transparent; color: var(--color-text-muted);
		font-size: 0.75rem; cursor: pointer; transition: background 0.15s, color 0.15s;
	}
	.tab-btn:hover { background: color-mix(in srgb, var(--color-border) 50%, transparent); color: var(--color-text); }
	.tab-active {
		background: var(--color-bg-secondary, #1a1a2e);
		border-color: var(--color-border, #2a2a4a);
		color: var(--color-accent, #4a9eff); font-weight: 500;
	}

	/* Usage dashboard */
	.usage-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 0.75rem; }
	.usage-card {
		background: var(--color-bg, #0f0f23); border: 1px solid var(--color-border, #2a2a4a);
		border-radius: 0.375rem; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.25rem;
	}
	.usage-card-label { font-size: 0.65rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.03em; }
	.usage-card-value { font-size: 1.1rem; font-weight: 600; color: var(--color-text); }
	.usage-card-detail { font-size: 0.75rem; color: var(--color-text-muted); }
	.usage-budget-bar { height: 6px; background: color-mix(in srgb, var(--color-text-muted) 15%, transparent); border-radius: 3px; overflow: hidden; margin-top: 0.25rem; }
	.usage-budget-fill { height: 100%; background: var(--color-accent, #4a9eff); border-radius: 3px; transition: width 0.3s; }
	.usage-budget-label { font-size: 0.65rem; color: var(--color-text-muted); }
	.usage-sub { font-size: 0.85rem; color: var(--color-text); margin: 0.75rem 0 0.375rem; }
	.usage-adapter-list { display: flex; flex-direction: column; gap: 0.25rem; }
	.usage-adapter-row {
		display: grid; grid-template-columns: 1fr auto auto; gap: 0.75rem;
		padding: 0.375rem 0.5rem; background: var(--color-bg, #0f0f23);
		border: 1px solid var(--color-border, #2a2a4a); border-radius: 0.25rem;
		font-size: 0.8rem; align-items: center;
	}
	.usage-adapter-name { color: var(--color-text); }
	.usage-adapter-calls { color: var(--color-text-muted); font-size: 0.75rem; }
	.usage-adapter-cost { color: var(--color-accent, #4a9eff); font-family: monospace; font-size: 0.75rem; }

	/* Context budget */
	.ctx-budget-zones { display: flex; flex-direction: column; gap: 0.125rem; }
	.ctx-zone-row {
		display: grid; grid-template-columns: 5.5rem 1fr auto; gap: 0.5rem;
		align-items: center; padding: 0.25rem 0;
	}
	.ctx-zone-name {
		font-size: 0.8rem; color: var(--color-text); text-transform: capitalize; font-weight: 500;
	}
	.ctx-truncated { color: #e5a100; margin-left: 0.25rem; font-size: 0.7rem; }
	.ctx-zone-bar {
		height: 8px; background: color-mix(in srgb, var(--color-text-muted) 15%, transparent);
		border-radius: 4px; overflow: hidden;
	}
	.ctx-zone-fill {
		height: 100%; background: var(--color-accent, #4a9eff); border-radius: 4px; transition: width 0.3s;
	}
	.ctx-truncated-fill { background: #e5a100; }
	.ctx-zone-stat { font-size: 0.7rem; color: var(--color-text-muted); white-space: nowrap; }
	.ctx-zone-pct { color: var(--color-text-muted); }
	.ctx-zone-components {
		font-size: 0.65rem; color: var(--color-text-muted); padding-left: 6rem; margin-top: -0.125rem; margin-bottom: 0.25rem;
	}
	.ctx-budget-total {
		margin-top: 0.5rem; padding-top: 0.5rem;
		border-top: 1px solid var(--color-border, #2a2a4a);
	}
	.ctx-total-row {
		display: flex; justify-content: space-between; font-size: 0.8rem; padding: 0.125rem 0;
	}

	/* Data erasure */
	.erasure-active, .erasure-preview {
		background: var(--color-bg, #0f0f23); border: 1px solid var(--color-border, #2a2a4a);
		border-radius: 0.375rem; padding: 0.75rem;
	}
	.erasure-active { border-color: #e5a100; }
	.erasure-active-header, .erasure-preview-header {
		font-size: 0.85rem; font-weight: 600; color: var(--color-text); margin-bottom: 0.5rem;
	}
	.erasure-active-info {
		display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem; font-size: 0.8rem; margin-bottom: 0.5rem;
	}
	.erasure-preview-counts {
		display: flex; flex-direction: column; gap: 0.125rem; font-size: 0.8rem; color: var(--color-text); margin-bottom: 0.5rem;
	}
	.erasure-confirm-input { margin: 0.5rem 0; }
	.erasure-confirm-input .config-input { width: 100%; }

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
	.danger-zone h3 { color: #ef4444; margin-bottom: 0.75rem; }
	.danger-item { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.5rem 0; border-top: 1px solid rgba(239, 68, 68, 0.15); }
	.danger-item:first-of-type { border-top: none; }
	.danger-item-desc { display: flex; flex-direction: column; gap: 0.125rem; }
	.danger-item-label { font-size: 0.85rem; color: var(--color-text); font-weight: 500; }
	.danger-actions { display: flex; gap: 0.5rem; }
	.btn-danger { padding: 0.375rem 0.75rem; background: #ef4444; color: white; border: none; border-radius: 0.25rem; font-size: 0.8rem; cursor: pointer; }
	.btn-danger-outline { padding: 0.375rem 0.75rem; background: transparent; color: #ef4444; border: 1px solid #ef4444; border-radius: 0.25rem; font-size: 0.8rem; cursor: pointer; white-space: nowrap; }
	.btn-danger-outline:disabled { opacity: 0.4; cursor: not-allowed; }

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
	.adapter-context { font-size: 0.65rem; color: var(--color-accent, #4a9eff); font-family: monospace; }
	.adapter-pricing { font-size: 0.65rem; color: var(--color-text-muted); font-family: monospace; }

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

	/* File airlock uploads */
	.file-input-hidden { display: none; }

	.airlock-upload-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		flex-wrap: wrap;
	}

	.btn-airlock {
		padding: 0.375rem 0.75rem;
		border-radius: 0.25rem;
		border: 1px solid var(--color-accent, #4a9eff);
		background: color-mix(in srgb, var(--color-accent, #4a9eff) 10%, transparent);
		color: var(--color-accent, #4a9eff);
		font-size: 0.8rem;
		cursor: pointer;
		transition: background 0.15s;
	}
	.btn-airlock:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-accent, #4a9eff) 20%, transparent);
	}
	.btn-airlock:disabled { opacity: 0.5; cursor: not-allowed; }

	.airlock-error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.375rem 0.75rem;
		margin-bottom: 0.75rem;
		background: color-mix(in srgb, #ef4444 12%, transparent);
		border: 1px solid color-mix(in srgb, #ef4444 30%, transparent);
		border-radius: 0.25rem;
		font-size: 0.75rem;
		color: #ef4444;
		line-height: 1.3;
	}

	/* Data portability */
	.dp-section { margin-top: 0.75rem; }
	.dp-subtitle { font-size: 0.85rem; color: var(--color-text); margin-bottom: 0.375rem; }

	.dp-progress { display: flex; flex-direction: column; gap: 0.25rem; }
	.dp-progress-bar { height: 8px; background: color-mix(in srgb, var(--color-text-muted) 15%, transparent); border-radius: 4px; overflow: hidden; }
	.dp-progress-fill { height: 100%; background: var(--color-accent, #4a9eff); transition: width 0.3s; border-radius: 4px; }
	.dp-progress-label { font-size: 0.75rem; color: var(--color-text-muted); }

	.dp-ready, .dp-import-result {
		display: flex; align-items: center; gap: 0.625rem;
		padding: 0.625rem; background: color-mix(in srgb, #22c55e 8%, transparent);
		border: 1px solid color-mix(in srgb, #22c55e 25%, transparent);
		border-radius: 0.375rem;
	}
	.dp-ready-icon { color: #22c55e; font-size: 1.25rem; font-weight: bold; flex-shrink: 0; }
	.dp-ready-info { display: flex; flex-direction: column; gap: 0.125rem; font-size: 0.8rem; color: var(--color-text); }
	.dp-ready-filename { font-family: monospace; font-size: 0.75rem; }
	.dp-ready-size { font-size: 0.7rem; color: var(--color-text-muted); }
	.dp-ready-counts { font-size: 0.7rem; color: var(--color-text-muted); }

	.dp-import-preview {
		padding: 0.625rem; background: var(--color-bg, #0f0f23);
		border: 1px solid var(--color-accent, #4a9eff);
		border-radius: 0.375rem;
	}
	.dp-preview-header { font-size: 0.85rem; font-weight: 500; color: var(--color-text); margin-bottom: 0.375rem; }
	.dp-preview-counts {
		display: flex; flex-wrap: wrap; gap: 0.5rem;
		font-size: 0.75rem; color: var(--color-text-muted);
		margin-bottom: 0.5rem;
	}
	.dp-conflicts { margin-bottom: 0.5rem; }
	.dp-conflicts-label { font-size: 0.7rem; color: #f59e0b; display: block; margin-bottom: 0.25rem; }
	.dp-conflict-item { display: flex; align-items: center; gap: 0.375rem; font-size: 0.7rem; color: var(--color-text-muted); margin-bottom: 0.125rem; }
	.dp-import-actions { display: flex; gap: 0.375rem; align-items: center; }
	.dp-import-errors { color: #ef4444; font-size: 0.7rem; }

	/* Add Memory button */
	.add-memory-form {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.625rem;
		background: var(--color-bg, #0f0f23);
		border: 1px solid var(--color-accent, #4a9eff);
		border-radius: 0.375rem;
		margin-bottom: 0.5rem;
	}
	.add-memory-form textarea {
		width: 100%;
		resize: vertical;
		padding: 0.375rem;
		border: 1px solid var(--color-border, #2a2a4a);
		border-radius: 0.25rem;
		background: var(--color-bg, #0f0f23);
		color: var(--color-text);
		font-size: 0.85rem;
		font-family: inherit;
	}
	.add-memory-controls {
		display: flex;
		gap: 0.375rem;
		align-items: center;
	}
	.add-memory-select {
		padding: 0.2rem 0.375rem;
		border: 1px solid var(--color-border, #2a2a4a);
		border-radius: 0.25rem;
		background: var(--color-bg, #0f0f23);
		color: var(--color-text);
		font-size: 0.75rem;
	}

	/* Appearance tab */
	.accent-presets {
		display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;
	}
	.accent-swatch {
		width: 32px; height: 32px; border-radius: 50%; border: 2px solid transparent;
		cursor: pointer; transition: border-color 0.15s, transform 0.15s;
	}
	.accent-swatch:hover { transform: scale(1.15); }
	.accent-active { border-color: var(--color-text) !important; box-shadow: 0 0 0 2px var(--color-bg); }

	.accent-custom-label {
		position: relative; width: 32px; height: 32px; cursor: pointer;
		display: flex; align-items: center; justify-content: center;
	}
	.accent-custom-input {
		position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer;
	}
	.accent-custom-icon {
		width: 32px; height: 32px; border-radius: 50%;
		border: 2px dashed var(--color-border);
		display: flex; align-items: center; justify-content: center;
		color: var(--color-text-muted); font-size: 1rem; pointer-events: none;
	}

	.bubble-controls { display: flex; gap: 1rem; flex-wrap: wrap; }
	.bubble-ctrl { display: flex; flex-direction: column; gap: 0.25rem; }
	.bubble-color-row { display: flex; align-items: center; gap: 0.375rem; }
	.bubble-color-row input[type="color"] {
		width: 36px; height: 28px; border: 1px solid var(--color-border);
		border-radius: 4px; background: var(--color-bg); cursor: pointer; padding: 0;
	}

	.bubble-preview { margin-top: 0.75rem; }
	.preview-label {
		font-size: 0.7rem; color: var(--color-text-muted); text-transform: uppercase;
		letter-spacing: 0.05em; margin-bottom: 0.375rem;
	}
	.preview-chat {
		display: flex; flex-direction: column; gap: 0.375rem;
		padding: 0.75rem;
		background: var(--color-bg, #0f0f23);
		border: 1px solid var(--color-border, #2a2a4a);
		border-radius: 0.5rem;
	}
	.preview-bubble {
		padding: 0.5rem 0.75rem; border-radius: 10px;
		max-width: 80%; display: flex; flex-direction: column; gap: 0.125rem;
	}
	.preview-user {
		align-self: flex-end; color: #fff;
		border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
	}
	.preview-ai {
		align-self: flex-start;
		border: 1px solid var(--color-border, #2a2a4a);
	}
	.preview-sender { font-size: 0.7rem; font-weight: 600; opacity: 0.8; }
	.preview-text { line-height: 1.4; }

	.slider-label { display: flex; flex-direction: column; gap: 0.375rem; font-size: 0.8rem; color: var(--color-text-muted); }
	.pref-slider {
		width: 100%; max-width: 320px; accent-color: var(--color-accent, #6366f1);
		cursor: pointer;
	}
	.preview-text-sample {
		margin-top: 0.375rem; color: var(--color-text); line-height: 1.4;
		padding: 0.5rem; background: var(--color-bg, #0f0f23);
		border: 1px solid var(--color-border); border-radius: 0.25rem;
	}
</style>
