<script lang="ts">
// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

type TaskFields = {
  action: string;
  target: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  parameters: Record<string, string>;
  constraints: string[];
  description: string;
};

type FileUploadRequest = {
  file: File;
  purpose: 'conversation' | 'skill' | 'project';
};

const {
  disabled = false,
  providerAvailable = true,
  onSendConversation,
  onSendTask,
  onFileUpload,
}: {
  disabled?: boolean;
  providerAvailable?: boolean;
  onSendConversation?: (text: string) => void;
  onSendTask?: (task: TaskFields) => void;
  onFileUpload?: (req: FileUploadRequest) => void;
} = $props();

let mode: 'chat' | 'task' = $state('chat');
let chatText = $state('');

// Task fields
let taskAction = $state('');
let taskTarget = $state('');
let taskDescription = $state('');
let taskPriority: 'low' | 'normal' | 'high' | 'critical' = $state('normal');
let paramEntries: { key: string; value: string }[] = $state([]);
let constraints: string[] = $state([]);
let newConstraint = $state('');

// Task submit button state
let taskSubmitState: 'idle' | 'submitting' | 'submitted' = $state('idle');

// File upload state
let fileError: string | null = $state(null);
let fileInput: HTMLInputElement | null = $state(null);

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

function sendChat(): void {
  const text = chatText.trim();
  if (!text || disabled) return;
  onSendConversation?.(text);
  chatText = '';
}

function handleChatKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
}

function sendTask(): void {
  if (!taskAction.trim() || !taskTarget.trim() || disabled || !providerAvailable) return;
  if (taskSubmitState !== 'idle') return;

  taskSubmitState = 'submitting';

  const params: Record<string, string> = {};
  for (const entry of paramEntries) {
    if (entry.key.trim()) {
      params[entry.key.trim()] = entry.value;
    }
  }
  onSendTask?.({
    action: taskAction.trim(),
    target: taskTarget.trim(),
    priority: taskPriority,
    parameters: params,
    constraints: constraints.filter((c) => c.trim()),
    description: taskDescription.trim(),
  });

  // Brief "Submitted" flash
  taskSubmitState = 'submitted';
  setTimeout(() => {
    taskSubmitState = 'idle';
    taskAction = '';
    taskTarget = '';
    taskDescription = '';
    taskPriority = 'normal';
    paramEntries = [];
    constraints = [];
  }, 800);
}

function addParam(): void {
  paramEntries = [...paramEntries, { key: '', value: '' }];
}

function removeParam(idx: number): void {
  paramEntries = paramEntries.filter((_, i) => i !== idx);
}

function addConstraint(): void {
  const c = newConstraint.trim();
  if (!c) return;
  constraints = [...constraints, c];
  newConstraint = '';
}

function removeConstraint(idx: number): void {
  constraints = constraints.filter((_, i) => i !== idx);
}

function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function handleFileSelect(): void {
  fileInput?.click();
}

function handleFileChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  fileError = null;

  const ext = getFileExtension(file.name);

  // Check blocked extensions first
  if (BLOCKED_EXTENSIONS.has(ext)) {
    if (['.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.bz2', '.xz'].includes(ext)) {
      fileError = `Archive files (${ext}) are not allowed — archives bypass content scanning and may contain malicious content`;
    } else if (['.exe', '.msi', '.sh', '.bat', '.cmd', '.ps1'].includes(ext)) {
      fileError = `Executable files (${ext}) are not allowed for security reasons`;
    } else {
      fileError = `File type ${ext} is not allowed for security reasons`;
    }
    input.value = '';
    return;
  }

  // Check allowed extensions
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    fileError = `File type ${ext} is not in the allowed list. Allowed: text, code, image, and PDF files`;
    input.value = '';
    return;
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    fileError = `File exceeds the 50 MB limit (file is ${formatFileSize(file.size)})`;
    input.value = '';
    return;
  }

  onFileUpload?.({ file, purpose: 'conversation' });
  input.value = '';
}

function dismissFileError(): void {
  fileError = null;
}

const canSendChat = $derived(!disabled && chatText.trim().length > 0);
const canSendTask = $derived(
  !disabled && providerAvailable && taskAction.trim().length > 0 && taskTarget.trim().length > 0,
);

const taskBtnLabel = $derived(
  taskSubmitState === 'submitting' ? 'Submitting...'
    : taskSubmitState === 'submitted' ? 'Submitted'
    : 'Submit Task',
);
</script>

<div class="input-bar">
	<div class="mode-toggle">
		<button
			class="pill"
			class:active={mode === 'chat'}
			onclick={() => (mode = 'chat')}
		>
			Chat
		</button>
		<button
			class="pill"
			class:active={mode === 'task'}
			onclick={() => (mode = 'task')}
		>
			Task
		</button>
	</div>

	{#if mode === 'chat'}
		{#if fileError}
			<div class="file-error">
				<span>{fileError}</span>
				<button class="file-error-dismiss" onclick={dismissFileError}>×</button>
			</div>
		{/if}
		<div class="chat-input">
			<textarea
				bind:value={chatText}
				placeholder="Type a message…"
				rows="1"
				{disabled}
				onkeydown={handleChatKeydown}
			></textarea>
			<input
				type="file"
				class="file-input-hidden"
				bind:this={fileInput}
				onchange={handleFileChange}
			/>
			<button
				class="attach-btn"
				onclick={handleFileSelect}
				disabled={disabled || !onFileUpload}
				title="Attach file"
			>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
					<path d="M14 8.5L8.35 14.15C7.53 14.97 6.44 15.43 5.3 15.43C4.16 15.43 3.07 14.97 2.25 14.15C1.43 13.33 0.97 12.24 0.97 11.1C0.97 9.96 1.43 8.87 2.25 8.05L7.9 2.4C8.43 1.87 9.14 1.57 9.9 1.57C10.66 1.57 11.37 1.87 11.9 2.4C12.43 2.93 12.73 3.64 12.73 4.4C12.73 5.16 12.43 5.87 11.9 6.4L6.25 12.05C5.98 12.32 5.63 12.47 5.25 12.47C4.87 12.47 4.52 12.32 4.25 12.05C3.98 11.78 3.83 11.43 3.83 11.05C3.83 10.67 3.98 10.32 4.25 10.05L9.2 5.1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
				</svg>
			</button>
			<button class="send-btn" disabled={!canSendChat} onclick={sendChat}>
				Send
			</button>
		</div>
	{:else}
		<div class="task-input">
			<p class="task-help">Tasks are evaluated by the safety pipeline before execution. Actions are classified by risk level.</p>

			{#if !providerAvailable}
				<div class="unavailable-notice">AI provider unavailable</div>
			{/if}

			<div class="field-row">
				<input bind:value={taskAction} placeholder="Action (what to do)" disabled={disabled || !providerAvailable} />
				<input bind:value={taskTarget} placeholder="Target (what to affect)" disabled={disabled || !providerAvailable} />
			</div>

			<textarea
				class="task-description"
				bind:value={taskDescription}
				placeholder="Description / notes — explain WHY you want this done, context, or special instructions"
				rows="2"
				disabled={disabled || !providerAvailable}
			></textarea>

			<div class="field-row">
				<label>
					Priority
					<select bind:value={taskPriority} disabled={disabled || !providerAvailable}>
						<option value="low">Low</option>
						<option value="normal">Normal</option>
						<option value="high">High</option>
						<option value="critical">Critical</option>
					</select>
				</label>
			</div>

			<div class="section-label">
				Parameters
				<button class="add-btn" onclick={addParam} disabled={disabled || !providerAvailable}>+</button>
			</div>
			{#each paramEntries as entry, idx}
				<div class="field-row param-row">
					<input bind:value={entry.key} placeholder="Key" disabled={disabled || !providerAvailable} />
					<input bind:value={entry.value} placeholder="Value" disabled={disabled || !providerAvailable} />
					<button class="remove-btn" onclick={() => removeParam(idx)}>×</button>
				</div>
			{/each}

			<div class="section-label">
				Constraints
				<button class="add-btn" onclick={addConstraint} disabled={disabled || !providerAvailable}>+</button>
			</div>
			<div class="field-row">
				<input
					bind:value={newConstraint}
					placeholder="Add constraint…"
					disabled={disabled || !providerAvailable}
					onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addConstraint(); } }}
				/>
			</div>
			{#each constraints as constraint, idx}
				<div class="constraint-item">
					<span>{constraint}</span>
					<button class="remove-btn" onclick={() => removeConstraint(idx)}>×</button>
				</div>
			{/each}

			<button
				class="send-btn task-send"
				class:task-submitted={taskSubmitState === 'submitted'}
				disabled={!canSendTask || taskSubmitState !== 'idle'}
				onclick={sendTask}
			>
				{taskBtnLabel}
			</button>
		</div>
	{/if}
</div>

<style>
	.input-bar {
		border-top: 1px solid var(--color-border);
		padding: 0.5rem 1rem 0.75rem;
		background: var(--color-surface);
	}

	.mode-toggle {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
	}

	.pill {
		padding: 0.25rem 0.75rem;
		border-radius: 999px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.75rem;
		cursor: pointer;
	}

	.pill.active {
		background: var(--color-accent);
		color: #fff;
		border-color: var(--color-accent);
	}

	.chat-input {
		display: flex;
		gap: 0.5rem;
		align-items: flex-end;
	}

	textarea {
		flex: 1;
		resize: none;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.875rem;
		font-family: inherit;
		min-height: 2.25rem;
	}

	textarea:disabled {
		opacity: 0.5;
	}

	.send-btn {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: none;
		background: var(--color-accent);
		color: #fff;
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.2s;
	}

	.send-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.task-input {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.task-help {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		padding: 0.25rem 0.5rem;
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
		border-radius: 4px;
		line-height: 1.3;
	}

	.unavailable-notice {
		font-size: 0.75rem;
		color: var(--color-warning);
		padding: 0.25rem 0;
	}

	.field-row {
		display: flex;
		gap: 0.375rem;
	}

	.field-row input {
		flex: 1;
		padding: 0.375rem 0.5rem;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.8125rem;
	}

	.field-row input:disabled {
		opacity: 0.5;
	}

	.task-description {
		padding: 0.375rem 0.5rem;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.8125rem;
		font-family: inherit;
		resize: vertical;
		min-height: 2.5rem;
	}

	label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	select {
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.8125rem;
	}

	.section-label {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.25rem;
	}

	.add-btn {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.75rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
	}

	.remove-btn {
		width: 24px;
		height: 24px;
		border-radius: 4px;
		border: none;
		background: transparent;
		color: var(--color-error);
		font-size: 0.875rem;
		cursor: pointer;
		padding: 0;
	}

	.param-row {
		align-items: center;
	}

	.constraint-item {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.8125rem;
		background: var(--color-bg);
		border-radius: 6px;
		border: 1px solid var(--color-border);
	}

	.constraint-item span {
		flex: 1;
	}

	.task-send {
		margin-top: 0.5rem;
		align-self: flex-end;
	}

	.task-submitted {
		background: var(--color-success, #22c55e) !important;
		opacity: 1 !important;
	}

	/* File upload */
	.file-input-hidden {
		display: none;
	}

	.attach-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 8px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		flex-shrink: 0;
		transition: color 0.15s, border-color 0.15s;
	}

	.attach-btn:hover:not(:disabled) {
		color: var(--color-accent);
		border-color: var(--color-accent);
	}

	.attach-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.file-error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.375rem 0.625rem;
		margin-bottom: 0.375rem;
		background: color-mix(in srgb, var(--color-error) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-error) 30%, transparent);
		border-radius: 6px;
		font-size: 0.75rem;
		color: var(--color-error);
		line-height: 1.3;
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
</style>
