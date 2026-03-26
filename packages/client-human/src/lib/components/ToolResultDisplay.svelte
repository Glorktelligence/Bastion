<script lang="ts">
import type { ToolResult } from '../stores/tools.js';

const { result }: { result: ToolResult } = $props();

let expanded = $state(false);

const [provider, toolName] = result.toolId.split(':');

function getSummary(): string {
  if (!result.success) return `Error: ${result.error ?? 'Unknown error'}`;
  if (result.result && typeof result.result === 'object' && 'content' in result.result) {
    const content = (result.result as { content: { type: string; text?: string }[] }).content;
    if (Array.isArray(content) && content.length > 0 && content[0].text) {
      const text = content[0].text;
      return text.length > 120 ? `${text.slice(0, 120)}...` : text;
    }
  }
  const json = JSON.stringify(result.result);
  return json.length > 120 ? `${json.slice(0, 120)}...` : json;
}
</script>

<div class="tool-result" class:error={!result.success}>
  <button class="tool-header" onclick={() => { expanded = !expanded; }}>
    <span class="tool-icon">T</span>
    <span class="tool-name">{provider}:{toolName}</span>
    <span class="tool-duration">{result.durationMs}ms</span>
    <span class="tool-status" class:success={result.success} class:fail={!result.success}>
      {result.success ? 'OK' : 'ERR'}
    </span>
    <span class="expand-arrow">{expanded ? '▼' : '▶'}</span>
  </button>

  {#if !expanded}
    <p class="tool-summary">{getSummary()}</p>
  {/if}

  {#if expanded}
    <div class="tool-detail">
      <pre>{JSON.stringify(result.result, null, 2)}</pre>
    </div>
  {/if}
</div>

<style>
  .tool-result { background: var(--color-surface, #111128); border: 1px solid var(--color-border, #2a2a4a); border-left: 3px solid #4a9eff; border-radius: 0.5rem; padding: 0.625rem 0.75rem; margin-bottom: 0.5rem; max-width: 85%; }
  .tool-result.error { border-left-color: #ef4444; }

  .tool-header { display: flex; align-items: center; gap: 0.5rem; background: none; border: none; color: var(--color-text, #eee); cursor: pointer; width: 100%; text-align: left; padding: 0; font-size: 0.8rem; }

  .tool-icon { width: 1.25rem; height: 1.25rem; background: #4a9eff20; color: #4a9eff; border-radius: 0.25rem; display: flex; align-items: center; justify-content: center; font-size: 0.65rem; font-weight: 700; flex-shrink: 0; }
  .tool-result.error .tool-icon { background: #ef444420; color: #ef4444; }

  .tool-name { font-family: monospace; font-size: 0.8rem; font-weight: 600; }
  .tool-duration { font-size: 0.7rem; color: var(--color-text-muted, #666); }
  .tool-status { font-size: 0.65rem; padding: 0.1rem 0.25rem; border-radius: 0.2rem; font-weight: 600; }
  .tool-status.success { background: #22c55e20; color: #22c55e; }
  .tool-status.fail { background: #ef444420; color: #ef4444; }
  .expand-arrow { font-size: 0.6rem; color: var(--color-text-muted, #666); margin-left: auto; }

  .tool-summary { font-size: 0.8rem; color: var(--color-text-muted, #aaa); margin: 0.375rem 0 0; line-height: 1.3; white-space: pre-wrap; word-break: break-word; }

  .tool-detail { margin-top: 0.5rem; }
  .tool-detail pre { font-size: 0.75rem; background: var(--color-bg, #0a0a1a); padding: 0.5rem; border-radius: 0.25rem; overflow-x: auto; max-height: 300px; margin: 0; color: var(--color-text, #ddd); }
</style>
