<script lang="ts">
import type { ExtensionUIComponentInfo } from '../stores/extensions.js';
import { scanExtensionHTML, BRIDGE_SCRIPT, ExtensionBridgeManager } from '../extensions/bridge.js';
import * as session from '../session.js';

const {
  components,
  namespace,
}: {
  components: ExtensionUIComponentInfo[];
  namespace: string;
} = $props();

let bridgeManager: ExtensionBridgeManager | null = $state(null);
let errors: Map<string, string> = $state(new Map());
let iframeRefs: Map<string, HTMLIFrameElement> = $state(new Map());

$effect(() => {
  const mgr = new ExtensionBridgeManager();
  mgr.configure({
    sendMessage: (type, payload) => {
      const client = session.getClient();
      if (!client) return;
      session.sendSecure({
        type,
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        sender: session.getIdentity(),
        payload,
      });
    },
    getConversationId: () => session.conversations.store.get().activeConversationId,
    isChallengeActive: () => session.challengeStatus.get().active,
    onViolation: (componentId, attempted, reason) => {
      console.warn(`[Extension] Scope violation: ${componentId} tried ${attempted} — ${reason}`);
      session.addNotification(`Extension scope violation: ${componentId} — ${reason}`, 'warning');
    },
    onDisable: (componentId) => {
      session.addNotification(`Extension component disabled (5 violations): ${componentId}`, 'error');
    },
  });
  bridgeManager = mgr;

  const handler = (e: MessageEvent) => mgr.handleMessage(e);
  globalThis.addEventListener('message', handler);

  return () => {
    globalThis.removeEventListener('message', handler);
    mgr.destroy();
  };
});

function prepareHTML(comp: ExtensionUIComponentInfo): string | null {
  // Use inline HTML from relay if available, otherwise show placeholder
  const content = comp.html
    ? comp.html
    : `<!DOCTYPE html>
<html><head><style>body { font-family: system-ui; color: #e0e0e0; background: transparent; padding: 8px; margin: 0; font-size: 14px; }</style></head>
<body><p>Extension component: <strong>${comp.name}</strong></p><p style="color:#888;font-size:12px;">${comp.description}</p><p style="color:#555;font-size:11px;">No UI content loaded from relay.</p></body></html>`;

  // Scan for blocked patterns (security gate — applies to all content)
  const scan = scanExtensionHTML(content);
  if (!scan.safe) {
    errors.set(comp.id, `Blocked: ${scan.violations.join(', ')}`);
    return null;
  }

  // CSP meta tag — blocks all external resources, allows only inline scripts/styles and data/blob images
  const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:;">`;

  // Inject CSP meta tag and bridge script before </head>
  if (content.includes('</head>')) {
    return content.replace('</head>', `${CSP_META}${BRIDGE_SCRIPT}</head>`);
  }
  // If no </head> tag, wrap with minimal structure
  return `<!DOCTYPE html><html><head>${CSP_META}${BRIDGE_SCRIPT}</head><body>${content}</body></html>`;
}

function onIframeLoad(comp: ExtensionUIComponentInfo, iframe: HTMLIFrameElement): void {
  if (bridgeManager && iframe) {
    bridgeManager.registerComponent(comp.id, namespace, [...comp.messageTypes], iframe);
    iframeRefs.set(comp.id, iframe);
  }
}
</script>

<div class="ext-ui-host">
  {#each components as comp (comp.id)}
    {@const html = prepareHTML(comp)}
    <div class="ext-component" style="min-height:{comp.size.minHeight};max-height:{comp.size.maxHeight}">
      <div class="ext-component-header">
        <span class="ext-comp-name">{comp.name}</span>
        {#if comp.dangerous}
          <span class="ext-dangerous-badge">DANGEROUS</span>
        {/if}
      </div>
      {#if errors.get(comp.id)}
        <div class="ext-error">{errors.get(comp.id)}</div>
      {:else if html}
        <iframe
          sandbox="allow-scripts"
          srcdoc={html}
          class="ext-iframe"
          title={comp.name}
          onload={(e) => onIframeLoad(comp, e.currentTarget)}
          style="min-height:{comp.size.minHeight};max-height:{comp.size.maxHeight}"
        ></iframe>
      {/if}
    </div>
  {/each}
</div>

<style>
  .ext-ui-host { display: flex; flex-direction: column; gap: 1rem; }
  .ext-component {
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    overflow: hidden;
    background: var(--color-surface);
  }
  .ext-component-header {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.375rem 0.75rem;
    border-bottom: 1px solid var(--color-border);
    font-size: 0.8rem;
  }
  .ext-comp-name { font-weight: 500; color: var(--color-text); }
  .ext-dangerous-badge {
    font-size: 0.65rem; font-weight: 700;
    padding: 0.0625rem 0.375rem; border-radius: 999px;
    background: color-mix(in srgb, #ef4444 15%, transparent);
    color: #ef4444;
  }
  .ext-iframe {
    width: 100%; border: none;
    background: transparent;
  }
  .ext-error {
    padding: 1rem; color: #ef4444;
    font-size: 0.85rem; text-align: center;
  }
</style>
