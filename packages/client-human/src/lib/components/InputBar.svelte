<script lang="ts">
type TaskFields = {
  action: string;
  target: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  parameters: Record<string, string>;
  constraints: string[];
};

const {
  disabled = false,
  providerAvailable = true,
  onSendConversation,
  onSendTask,
}: {
  disabled?: boolean;
  providerAvailable?: boolean;
  onSendConversation?: (text: string) => void;
  onSendTask?: (task: TaskFields) => void;
} = $props();

let mode: 'chat' | 'task' = $state('chat');
let chatText = $state('');

// Task fields
let taskAction = $state('');
let taskTarget = $state('');
let taskPriority: 'low' | 'normal' | 'high' | 'critical' = $state('normal');
let paramEntries: { key: string; value: string }[] = $state([]);
let constraints: string[] = $state([]);
let newConstraint = $state('');

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
  });
  taskAction = '';
  taskTarget = '';
  taskPriority = 'normal';
  paramEntries = [];
  constraints = [];
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

const canSendChat = $derived(!disabled && chatText.trim().length > 0);
const canSendTask = $derived(
  !disabled && providerAvailable && taskAction.trim().length > 0 && taskTarget.trim().length > 0,
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
		<div class="chat-input">
			<textarea
				bind:value={chatText}
				placeholder="Type a message…"
				rows="1"
				{disabled}
				onkeydown={handleChatKeydown}
			></textarea>
			<button class="send-btn" disabled={!canSendChat} onclick={sendChat}>
				Send
			</button>
		</div>
	{:else}
		<div class="task-input">
			{#if !providerAvailable}
				<div class="unavailable-notice">AI provider unavailable</div>
			{/if}

			<div class="field-row">
				<input bind:value={taskAction} placeholder="Action" disabled={disabled || !providerAvailable} />
				<input bind:value={taskTarget} placeholder="Target" disabled={disabled || !providerAvailable} />
			</div>

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

			<button class="send-btn task-send" disabled={!canSendTask} onclick={sendTask}>
				Submit Task
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
</style>
