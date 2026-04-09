// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Extension UI Message Bridge — host-side postMessage handler.
 *
 * Manages communication between sandboxed extension iframes and the
 * Bastion session. Each iframe gets an injected bridge script that
 * provides a `window.bastion` API. The host-side validates every
 * message against the component's declared messageTypes.
 *
 * Core protocol types are ALWAYS rejected from extension UI —
 * extensions can only send their own namespaced types.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Iframe reference — typed loosely for Node.js compilation compatibility. */
type IFrameRef = { contentWindow?: { postMessage(data: unknown, origin: string): void } | null };

export interface BridgeComponent {
  readonly componentId: string;
  readonly namespace: string;
  readonly allowedTypes: ReadonlySet<string>;
  readonly iframe: IFrameRef;
  violationCount: number;
}

export interface BridgeMessage {
  readonly bridge: 'bastion';
  readonly action:
    | 'send'
    | 'getTheme'
    | 'getConversationId'
    | 'isChallengeHoursActive'
    | 'requestConfirmation'
    | 'getExtensionState'
    | 'switchConversation';
  readonly type?: string;
  readonly payload?: unknown;
  readonly requestId?: string;
  readonly message?: string;
  readonly namespace?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Core protocol types — NEVER allowed from extension UI. */
const CORE_TYPES = new Set([
  'task',
  'conversation',
  'challenge',
  'confirmation',
  'denial',
  'status',
  'result',
  'error',
  'heartbeat',
  'session_init',
  'session_end',
  'key_exchange',
  'token_refresh',
  'memory_proposal',
  'memory_decision',
  'memory_list',
  'memory_delete',
  'memory_update',
  'file_manifest',
  'file_offer',
  'file_request',
  'tool_request',
  'tool_approved',
  'tool_denied',
  'provider_register',
  'budget_config',
]);

const MAX_VIOLATIONS = 5;

// ---------------------------------------------------------------------------
// Content scanning patterns for extension UI HTML
// ---------------------------------------------------------------------------

export const BLOCKED_UI_PATTERNS = [
  { pattern: /<script[^>]+src\s*=/i, reason: 'External script tag' },
  { pattern: /<link[^>]+rel\s*=\s*["']?stylesheet[^>]+href\s*=/i, reason: 'External stylesheet' },
  { pattern: /\bfetch\s*\(/i, reason: 'fetch() call' },
  { pattern: /\bXMLHttpRequest\b/i, reason: 'XMLHttpRequest' },
  { pattern: /\bnew\s+WebSocket\b/i, reason: 'WebSocket creation' },
  { pattern: /\beval\s*\(/i, reason: 'eval() call' },
  { pattern: /\bnew\s+Function\s*\(/i, reason: 'Function constructor' },
  { pattern: /\bsetTimeout\s*\(\s*["'`]/i, reason: 'setTimeout with string argument' },
  { pattern: /\bdocument\.cookie\b/i, reason: 'document.cookie access' },
  { pattern: /\bwindow\.(parent|top)\b(?!.*bastion)/i, reason: 'window.parent/top access' },
  { pattern: /<iframe[\s>]/i, reason: 'Nested iframe' },
  { pattern: /\bwindow\.open\s*\(/i, reason: 'window.open()' },
  { pattern: /\bwindow\.location\s*[=.]/i, reason: 'window.location modification' },
];

// ---------------------------------------------------------------------------
// Bridge script injected into every extension iframe
// ---------------------------------------------------------------------------

export const BRIDGE_SCRIPT = `
<script>
(function() {
  var listeners = {};
  window.bastion = {
    send: function(type, payload) {
      window.parent.postMessage({ bridge: 'bastion', action: 'send', type: type, payload: payload }, '*');
    },
    on: function(type, callback) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(callback);
    },
    off: function(type, callback) {
      if (listeners[type]) listeners[type] = listeners[type].filter(function(c) { return c !== callback; });
    },
    getTheme: function() { return document.documentElement.dataset.theme || 'dark'; },
    getConversationId: function() {
      return new Promise(function(resolve) {
        var rid = Math.random().toString(36).slice(2);
        function handler(event) {
          if (event.data && event.data.bridge === 'bastion-reply' && event.data.requestId === rid) {
            window.removeEventListener('message', handler);
            resolve(event.data.value);
          }
        }
        window.addEventListener('message', handler);
        window.parent.postMessage({ bridge: 'bastion', action: 'getConversationId', requestId: rid }, '*');
      });
    },
    isChallengeHoursActive: function() {
      return new Promise(function(resolve) {
        var rid = Math.random().toString(36).slice(2);
        function handler(event) {
          if (event.data && event.data.bridge === 'bastion-reply' && event.data.requestId === rid) {
            window.removeEventListener('message', handler);
            resolve(event.data.value);
          }
        }
        window.addEventListener('message', handler);
        window.parent.postMessage({ bridge: 'bastion', action: 'isChallengeHoursActive', requestId: rid }, '*');
      });
    },
    requestConfirmation: function(message) {
      return new Promise(function(resolve) {
        var rid = Math.random().toString(36).slice(2);
        function handler(event) {
          if (event.data && event.data.bridge === 'bastion-reply' && event.data.requestId === rid) {
            window.removeEventListener('message', handler);
            resolve(event.data.value);
          }
        }
        window.addEventListener('message', handler);
        window.parent.postMessage({ bridge: 'bastion', action: 'requestConfirmation', requestId: rid, message: message }, '*');
      });
    },
    getExtensionState: function(namespace) {
      return new Promise(function(resolve) {
        var rid = Math.random().toString(36).slice(2);
        function handler(event) {
          if (event.data && event.data.bridge === 'bastion-reply' && event.data.requestId === rid) {
            window.removeEventListener('message', handler);
            resolve(event.data.value);
          }
        }
        window.addEventListener('message', handler);
        window.parent.postMessage({ bridge: 'bastion', action: 'getExtensionState', requestId: rid, namespace: namespace }, '*');
      });
    },
    switchConversation: function(conversationId) {
      window.parent.postMessage({ bridge: 'bastion', action: 'switchConversation', payload: { conversationId: conversationId } }, '*');
    }
  };
  // Receive messages forwarded by host
  window.addEventListener('message', function(event) {
    if (event.data && event.data.bridge === 'bastion-forward' && event.data.type) {
      var cbs = listeners[event.data.type];
      if (cbs) cbs.forEach(function(cb) { cb(event.data.payload); });
    }
  });
})();
</script>
`;

// ---------------------------------------------------------------------------
// Content scanner
// ---------------------------------------------------------------------------

export function scanExtensionHTML(html: string): { safe: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const { pattern, reason } of BLOCKED_UI_PATTERNS) {
    if (pattern.test(html)) {
      violations.push(reason);
    }
  }
  return { safe: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Bridge Manager
// ---------------------------------------------------------------------------

export class ExtensionBridgeManager {
  private components = new Map<string, BridgeComponent>();
  private sendMessage: ((type: string, payload: unknown) => void) | null = null;
  private getConversationId: (() => string | null) | null = null;
  private isChallengeActive: (() => boolean) | null = null;
  private onViolation: ((componentId: string, attempted: string, reason: string) => void) | null = null;
  private onDisable: ((componentId: string) => void) | null = null;
  private onSwitchConversation: ((conversationId: string) => void) | null = null;

  configure(options: {
    sendMessage: (type: string, payload: unknown) => void;
    getConversationId: () => string | null;
    isChallengeActive: () => boolean;
    onViolation?: (componentId: string, attempted: string, reason: string) => void;
    onDisable?: (componentId: string) => void;
    onSwitchConversation?: (conversationId: string) => void;
  }): void {
    this.sendMessage = options.sendMessage;
    this.getConversationId = options.getConversationId;
    this.isChallengeActive = options.isChallengeActive;
    this.onViolation = options.onViolation ?? null;
    this.onDisable = options.onDisable ?? null;
    this.onSwitchConversation = options.onSwitchConversation ?? null;
  }

  registerComponent(componentId: string, namespace: string, allowedTypes: readonly string[], iframe: IFrameRef): void {
    this.components.set(componentId, {
      componentId,
      namespace,
      allowedTypes: new Set(allowedTypes),
      iframe,
      violationCount: 0,
    });
  }

  unregisterComponent(componentId: string): void {
    this.components.delete(componentId);
  }

  /**
   * Handle a postMessage from any extension iframe.
   *
   * Origin validation: srcdoc sandboxed iframes have origin 'null' (string),
   * so we cannot use targeted postMessage origins for SENDING. Instead we
   * validate on the RECEIVING side: only accept messages whose `source`
   * matches a registered component's iframe contentWindow.
   */
  handleMessage(event: { data: unknown; source: unknown; origin?: string }): void {
    const data = event.data as BridgeMessage;
    if (!data || data.bridge !== 'bastion') return;

    // Origin validation: only accept messages from sandboxed srcdoc iframes ('null')
    // or from our own window origin. Reject all other origins.
    const windowOrigin =
      typeof globalThis !== 'undefined' &&
      (globalThis as unknown as { location?: { origin?: string } }).location?.origin;
    if (event.origin !== undefined && event.origin !== 'null' && windowOrigin && event.origin !== windowOrigin) {
      return;
    }

    // Find which component sent this — validates source is a registered iframe
    const component = this.findComponentBySource(event.source);
    if (!component) return;

    switch (data.action) {
      case 'send':
        this.handleSend(component, String(data.type ?? ''), data.payload);
        break;
      case 'getConversationId':
        this.reply(component.iframe, data.requestId, this.getConversationId?.() ?? null);
        break;
      case 'isChallengeHoursActive':
        this.reply(component.iframe, data.requestId, this.isChallengeActive?.() ?? false);
        break;
      case 'requestConfirmation':
        // Simple confirm dialog — future: custom UI
        this.reply(
          component.iframe,
          data.requestId,
          (globalThis as unknown as Record<string, unknown>).confirm
            ? (globalThis as unknown as { confirm: (m: string) => boolean }).confirm(String(data.message ?? 'Confirm?'))
            : false,
        );
        break;
      case 'getExtensionState': {
        const requestId = data.requestId;
        const namespace = data.namespace;
        if (!requestId || !namespace) break;
        // Send a protocol message to request extension state from AI client.
        // The AI client would respond via a forwarded message.
        // For now, reply with null (state bridge requires AI client handler).
        this.reply(component.iframe, requestId, null);
        break;
      }
      case 'switchConversation': {
        const p = data.payload as Record<string, unknown> | undefined;
        const convId = p?.conversationId ? String(p.conversationId) : null;
        if (convId) {
          this.onSwitchConversation?.(convId);
        }
        break;
      }
    }
  }

  /**
   * Forward an incoming protocol message to matching extension iframes.
   * Uses '*' as target origin because srcdoc iframes have origin 'null' (string),
   * which makes targeted postMessage impossible. Security is enforced on the
   * receiving side via source validation in handleMessage().
   */
  forwardToExtensions(type: string, payload: unknown): void {
    for (const comp of this.components.values()) {
      if (comp.allowedTypes.has(type)) {
        comp.iframe.contentWindow?.postMessage({ bridge: 'bastion-forward', type, payload }, '*');
      }
    }
  }

  destroy(): void {
    this.components.clear();
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private handleSend(component: BridgeComponent, type: string, payload: unknown): void {
    // Check: is this a core type? ALWAYS reject
    if (CORE_TYPES.has(type)) {
      this.recordViolation(component, type, 'Core protocol type — extensions cannot send core messages');
      return;
    }

    // Check: is this type in the component's allowed set?
    if (!component.allowedTypes.has(type)) {
      this.recordViolation(component, type, 'Message type not in component declared messageTypes');
      return;
    }

    // Valid — forward through session
    this.sendMessage?.(type, payload);
  }

  private recordViolation(component: BridgeComponent, attempted: string, reason: string): void {
    component.violationCount++;
    this.onViolation?.(component.componentId, attempted, reason);

    if (component.violationCount >= MAX_VIOLATIONS) {
      this.components.delete(component.componentId);
      this.onDisable?.(component.componentId);
    }
  }

  private findComponentBySource(source: unknown): BridgeComponent | undefined {
    for (const comp of this.components.values()) {
      if (comp.iframe.contentWindow === source) return comp;
    }
    return undefined;
  }

  // Uses '*' because srcdoc iframes have origin 'null' — see forwardToExtensions() comment
  private reply(iframe: IFrameRef, requestId: string | undefined, value: unknown): void {
    iframe.contentWindow?.postMessage({ bridge: 'bastion-reply', requestId, value }, '*');
  }
}
