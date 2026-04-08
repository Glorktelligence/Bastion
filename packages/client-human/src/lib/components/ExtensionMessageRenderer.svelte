<script lang="ts">
import type { RendererConfig } from '../extensions/conversation-renderer-registry.js';
import { scanExtensionHTML } from '../extensions/bridge.js';

const { type, content, config }: { type: string; content: string; config: RendererConfig } = $props();

let iframeRef: HTMLIFrameElement | null = $state(null);
let height = $state(config.style === 'compact' ? '40px' : '200px');

const RENDERER_BRIDGE = `<script>
  window.addEventListener('message', function(e) {
    if (e.data && e.data.bridge === 'bastion-render') {
      if (window.bastionRenderer && window.bastionRenderer.render) {
        window.bastionRenderer.render(e.data.content, e.data.metadata);
      }
      // Report height back to parent
      requestAnimationFrame(function() {
        var h = document.body.scrollHeight;
        window.parent.postMessage({ bridge: 'bastion-render-height', height: h }, '*');
      });
    }
  });
<\/script>`;

const CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:;">';

function prepareHTML(): string | null {
  if (!config?.html) return null;
  const scan = scanExtensionHTML(config.html);
  if (!scan.safe) return null;

  if (config.html.includes('</head>')) {
    return config.html.replace('</head>', CSP + RENDERER_BRIDGE + '</head>');
  }
  return '<!DOCTYPE html><html><head>' + CSP + RENDERER_BRIDGE + '</head><body>' + config.html + '</body></html>';
}

function onLoad() {
  if (iframeRef?.contentWindow) {
    iframeRef.contentWindow.postMessage({
      bridge: 'bastion-render',
      content,
      metadata: { type, namespace: config.namespace },
    }, '*');
  }
}

// Listen for height updates from the iframe
$effect(() => {
  function handleMessage(e: MessageEvent) {
    if (e.data?.bridge === 'bastion-render-height' && e.source === iframeRef?.contentWindow) {
      height = Math.min(e.data.height + 16, 800) + 'px';
    }
  }
  globalThis.addEventListener('message', handleMessage);
  return () => globalThis.removeEventListener('message', handleMessage);
});

const html = prepareHTML();
</script>

{#if html}
  <iframe
    bind:this={iframeRef}
    sandbox="allow-scripts"
    srcdoc={html}
    onload={onLoad}
    style="width:100%;border:none;height:{height};background:transparent;"
    title="Extension renderer: {type}"
  ></iframe>
{/if}

<style>
  iframe {
    display: block;
    border-radius: 8px;
  }
</style>
