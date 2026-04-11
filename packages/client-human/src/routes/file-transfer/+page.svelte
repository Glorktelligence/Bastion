<!-- Copyright 2026 Glorktelligence — Harry Smith -->
<!-- Licensed under the Apache License, Version 2.0 -->

<!--
  File Transfer — Bastion Airlock

  Dedicated page for file operations through the Bastion airlock.
  Includes upload zone, outbound files, transfer history, and airlock rules.
-->
<script lang="ts">
import { onMount } from 'svelte';
import * as session from '$lib/session.js';
import TransferHistory from '$lib/components/TransferHistory.svelte';
import FileUploadStatus from '$lib/components/FileUploadStatus.svelte';
import type { FileUploadProgress, TransferHistoryEntry } from '$lib/stores/file-transfers.js';
import type { ConnectionStoreState } from '$lib/stores/connection.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let conn: ConnectionStoreState = $state({
	status: 'disconnected',
	jwt: null,
	sessionId: null,
	peerStatus: 'unknown',
	reconnectAttempt: 0,
	lastError: null,
});
let activeUploads: readonly FileUploadProgress[] = $state([]);
let historyEntries: readonly TransferHistoryEntry[] = $state([]);
let dragOver = $state(false);
let fileError: string | null = $state(null);
let fileInput: HTMLInputElement | null = $state(null);

const isConnected = $derived(
	conn.status === 'connected' || conn.status === 'authenticated',
);

// ---------------------------------------------------------------------------
// Allowed/blocked extensions (same as InputBar)
// ---------------------------------------------------------------------------

const ALLOWED_EXTENSIONS = new Set([
	'.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.xml', '.toml',
	'.ts', '.js', '.py', '.rs', '.go', '.java', '.html', '.css', '.svelte',
	'.png', '.jpg', '.jpeg', '.gif', '.svg',
	'.pdf',
]);

const BLOCKED_EXTENSIONS = new Set([
	'.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.bz2', '.xz',
	'.exe', '.msi', '.sh', '.bat', '.cmd', '.ps1',
	'.dll', '.so', '.dylib', '.bin', '.com',
	'.iso', '.img', '.dmg',
	'.deb', '.rpm', '.apk', '.ipa',
]);

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// ---------------------------------------------------------------------------
// Store subscriptions
// ---------------------------------------------------------------------------

onMount(() => {
	const subs = [
		session.connection.subscribe((v) => { conn = v; }),
		session.fileTransfers.store.subscribe((v) => {
			activeUploads = v.uploads;
			historyEntries = v.history;
		}),
	];

	return () => { for (const u of subs) u(); };
});

// ---------------------------------------------------------------------------
// File validation & upload
// ---------------------------------------------------------------------------

function getFileExtension(filename: string): string {
	const dot = filename.lastIndexOf('.');
	return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateAndUpload(file: File, purpose: 'conversation' | 'skill' | 'project'): void {
	fileError = null;
	const ext = getFileExtension(file.name);

	if (BLOCKED_EXTENSIONS.has(ext)) {
		if (['.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.bz2', '.xz'].includes(ext)) {
			fileError = `Archive files (${ext}) are not allowed — archives bypass content scanning`;
		} else if (['.exe', '.msi', '.sh', '.bat', '.cmd', '.ps1'].includes(ext)) {
			fileError = `Executable files (${ext}) are not allowed for security reasons`;
		} else {
			fileError = `File type ${ext} is not allowed for security reasons`;
		}
		return;
	}

	if (!ALLOWED_EXTENSIONS.has(ext)) {
		fileError = `File type ${ext || '(none)'} is not in the allowed list. Allowed: text, code, image, and PDF files`;
		return;
	}

	if (file.size > MAX_FILE_SIZE) {
		fileError = `File exceeds the 50 MB limit (file is ${formatFileSize(file.size)})`;
		return;
	}

	// Determine purpose: .md files can be skills
	const effectivePurpose = ext === '.md' && purpose === 'skill' ? 'skill' : purpose;
	uploadFile(file, effectivePurpose);
}

function uploadFile(file: File, purpose: 'conversation' | 'skill' | 'project'): void {
	const client = session.getClient();
	if (!client) return;

	const transferId = crypto.randomUUID();
	session.fileTransfers.startUpload(transferId, file.name, file.size);

	const reader = new FileReader();
	reader.onload = async (): Promise<void> => {
		try {
			const arrayBuf = reader.result as ArrayBuffer;
			const data = new Uint8Array(arrayBuf);

			const hashBuf = await globalThis.crypto.subtle.digest('SHA-256', data);
			const hashArr = new Uint8Array(hashBuf);
			const hash = Array.from(hashArr).map((b) => b.toString(16).padStart(2, '0')).join('');

			const mimeType = file.type || 'application/octet-stream';
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
					projectContext: purpose === 'conversation' ? 'file transfer page' : purpose,
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
// Drop zone handlers
// ---------------------------------------------------------------------------

function handleDragOver(e: DragEvent): void {
	e.preventDefault();
	dragOver = true;
}

function handleDragLeave(): void {
	dragOver = false;
}

function handleDrop(e: DragEvent): void {
	e.preventDefault();
	dragOver = false;
	if (!isConnected) return;

	const files = e.dataTransfer?.files;
	if (!files || files.length === 0) return;

	for (const file of files) {
		validateAndUpload(file, 'conversation');
	}
}

function handleFileSelect(): void {
	fileInput?.click();
}

function handleFileChange(e: Event): void {
	const input = e.target as HTMLInputElement;
	const files = input.files;
	if (!files) return;

	for (const file of files) {
		validateAndUpload(file, 'conversation');
	}
	input.value = '';
}

function handleSkillUpload(): void {
	const input = document.createElement('input');
	input.type = 'file';
	input.accept = '.md';
	input.onchange = (): void => {
		const file = input.files?.[0];
		if (file) validateAndUpload(file, 'skill');
	};
	input.click();
}

function dismissFileError(): void {
	fileError = null;
}
</script>

<div class="file-transfer-page">
	<div class="page-header">
		<h2>File Transfer</h2>
		<span class="page-subtitle">Bastion Airlock</span>
	</div>

	{#if !isConnected}
		<div class="disconnected-notice">
			Connect to the relay to manage file transfers.
		</div>
	{/if}

	{#if fileError}
		<div class="file-error">
			<span>{fileError}</span>
			<button class="file-error-dismiss" onclick={dismissFileError}>x</button>
		</div>
	{/if}

	<!-- Upload Zone -->
	<section class="section">
		<h3 class="section-title">Upload Files</h3>
		<div
			class="drop-zone"
			class:drag-over={dragOver}
			class:disabled={!isConnected}
			ondragover={handleDragOver}
			ondragleave={handleDragLeave}
			ondrop={handleDrop}
			role="button"
			tabindex="0"
			onclick={isConnected ? handleFileSelect : undefined}
			onkeydown={(e) => { if (e.key === 'Enter' && isConnected) handleFileSelect(); }}
		>
			<input
				type="file"
				class="file-input-hidden"
				bind:this={fileInput}
				onchange={handleFileChange}
				multiple
			/>
			<div class="drop-icon">
				<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
					<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
					<polyline points="17 8 12 3 7 8"/>
					<line x1="12" y1="3" x2="12" y2="15"/>
				</svg>
			</div>
			<p class="drop-text">Drag and drop files here, or click to browse</p>
			<p class="drop-hint">Text, code, images, and PDF files up to 50 MB</p>
		</div>
		<div class="upload-actions">
			<button class="skill-upload-btn" onclick={handleSkillUpload} disabled={!isConnected}>
				Upload Skill (.md)
			</button>
			<span class="upload-hint">Skill files go through forensic scan before hot-reload</span>
		</div>
	</section>

	<!-- Active Uploads -->
	{#if activeUploads.length > 0}
		<section class="section">
			<h3 class="section-title">Active Transfers</h3>
			<div class="active-uploads">
				{#each activeUploads as upload (upload.transferId)}
					<FileUploadStatus {upload} />
				{/each}
			</div>
		</section>
	{/if}

	<!-- Airlock Rules -->
	<section class="section">
		<h3 class="section-title">Airlock Rules</h3>
		<div class="rules-grid">
			<div class="rule-card">
				<div class="rule-header">Intake (AI receives)</div>
				<ul class="rule-list">
					<li>Read-only after submission</li>
					<li>Max 50 files per task</li>
					<li>SHA-256 hash verified at 3 stages</li>
					<li>Content scanned for 13 dangerous patterns</li>
				</ul>
			</div>
			<div class="rule-card">
				<div class="rule-header">Outbound (AI produces)</div>
				<ul class="rule-list">
					<li>Write-once, no read-back by AI</li>
					<li>Max 50 files per task</li>
					<li>Hash verified on delivery</li>
					<li>Human downloads trigger hash check</li>
				</ul>
			</div>
			<div class="rule-card">
				<div class="rule-header">Skills Upload</div>
				<ul class="rule-list">
					<li>Forensic content scan at relay</li>
					<li>Quarantine until human approval</li>
					<li>Hot-reload on approval</li>
					<li>.md files only</li>
				</ul>
			</div>
		</div>
	</section>

	<!-- Transfer History -->
	<section class="section">
		<h3 class="section-title">Transfer History</h3>
		<TransferHistory entries={historyEntries} />
	</section>
</div>

<style>
	.file-transfer-page {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		padding: 1.5rem;
		gap: 1.25rem;
	}

	.page-header {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}

	.page-header h2 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--color-text);
		margin: 0;
	}

	.page-subtitle {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.disconnected-notice {
		padding: 0.75rem 1rem;
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-warning) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent);
		color: var(--color-warning);
		font-size: 0.85rem;
	}

	.file-error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: color-mix(in srgb, var(--color-error) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-error) 30%, transparent);
		border-radius: 6px;
		font-size: 0.8rem;
		color: var(--color-error);
	}

	.file-error-dismiss {
		background: none;
		border: none;
		color: var(--color-error);
		cursor: pointer;
		font-size: 1rem;
		padding: 0;
		line-height: 1;
		flex-shrink: 0;
	}

	/* Sections */
	.section {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.section-title {
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin: 0;
	}

	/* Drop zone */
	.drop-zone {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 2rem 1rem;
		border: 2px dashed var(--color-border);
		border-radius: 12px;
		cursor: pointer;
		transition: border-color 0.2s, background 0.2s;
	}

	.drop-zone:hover:not(.disabled) {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 5%, transparent);
	}

	.drop-zone.drag-over {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}

	.drop-zone.disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.drop-icon {
		color: var(--color-text-muted);
	}

	.drop-text {
		font-size: 0.9rem;
		color: var(--color-text);
		margin: 0;
	}

	.drop-hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin: 0;
	}

	.file-input-hidden {
		display: none;
	}

	.upload-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.skill-upload-btn {
		padding: 0.375rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.8rem;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}

	.skill-upload-btn:hover:not(:disabled) {
		color: var(--color-accent);
		border-color: var(--color-accent);
	}

	.skill-upload-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.upload-hint {
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	/* Active uploads */
	.active-uploads {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	/* Rules grid */
	.rules-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 0.75rem;
	}

	.rule-card {
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-surface);
	}

	.rule-header {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 0.5rem;
	}

	.rule-list {
		margin: 0;
		padding: 0 0 0 1.25rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		line-height: 1.6;
	}
</style>
