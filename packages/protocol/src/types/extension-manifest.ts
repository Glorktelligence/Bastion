// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Extension manifest type definitions (Protocol First).
 *
 * These types define the structure of extension manifests loaded by the
 * relay at startup. Extensions declare namespaced message types, UI
 * components, and conversation renderers.
 *
 * Moved here from the relay package to satisfy Protocol First — all
 * shared type definitions live in @bastion/protocol.
 */

// ---------------------------------------------------------------------------
// Safety level
// ---------------------------------------------------------------------------

/** Safety evaluation level for an extension message type. */
export type ExtensionSafetyLevel = 'passthrough' | 'task' | 'admin' | 'blocked';

// ---------------------------------------------------------------------------
// Message type definition
// ---------------------------------------------------------------------------

/** Extension message type definition. */
export interface ExtensionMessageType {
  readonly name: string;
  readonly description: string;
  readonly fields: Record<string, { type: string; required: boolean; description: string }>;
  readonly safety: ExtensionSafetyLevel;
  /** Adapter selection hint: 'cheapest' | 'fastest' | 'smartest' | 'default' | adapter ID. */
  readonly adapterHint?: string;
  /** Whether this message type can be compacted (summarised). Default: true.
   *  Set to false for structural data (game state, tension updates) that must be preserved verbatim.
   *  When false, messages of this type are stored with pinned=true in the ConversationStore,
   *  which excludes them from compaction via the existing getCompactableMessages() filter. */
  readonly compactable?: boolean;
  /** Sender-type restriction: which direction this message can flow. Default: 'bidirectional'. */
  readonly direction?: 'human_to_ai' | 'ai_to_human' | 'bidirectional';
  readonly audit: {
    readonly logEvent: string;
    readonly logContent: boolean;
  };
}

// ---------------------------------------------------------------------------
// UI types
// ---------------------------------------------------------------------------

/** UI component size constraints. */
export interface ExtensionUISize {
  readonly minHeight: string;
  readonly maxHeight: string;
}

/** Audit configuration for a UI component. */
export interface ExtensionUIAudit {
  readonly logRender: boolean;
  readonly logInteractions: boolean;
  readonly logEvent: string;
}

/** A UI component definition within an extension page. */
export interface ExtensionUIComponent {
  readonly id: string;
  readonly name: string;
  readonly file: string;
  readonly description: string;
  readonly function: string;
  readonly messageTypes: readonly string[];
  readonly size: ExtensionUISize;
  readonly placement: 'main' | 'full-page' | 'sidebar' | 'settings-tab';
  readonly dangerous: boolean;
  readonly audit: ExtensionUIAudit;
}

/** A UI page grouping components. */
export interface ExtensionUIPage {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly components: readonly ExtensionUIComponent[];
}

/** UI manifest for an extension. */
export interface ExtensionUI {
  readonly pages: readonly ExtensionUIPage[];
}

// ---------------------------------------------------------------------------
// Extension manifest
// ---------------------------------------------------------------------------

/** A loaded and validated extension manifest. */
export interface ExtensionManifest {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly license?: string;
  readonly messageTypes: readonly ExtensionMessageType[];
  readonly dependencies?: readonly string[];
  readonly ui?: ExtensionUI;
  readonly conversationRenderers?: Readonly<
    Record<
      string,
      {
        readonly html: string;
        readonly style?: 'compact' | 'full';
        readonly markdown?: boolean;
      }
    >
  >;
}

/**
 * ExtensionDefinition — alias for ExtensionManifest for backward compatibility.
 * The relay uses this name extensively.
 */
export type ExtensionDefinition = ExtensionManifest;

/** Result of loading an extension. */
export type ExtensionLoadResult =
  | { readonly ok: true; readonly extension: ExtensionDefinition }
  | { readonly ok: false; readonly error: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Namespaces reserved for core protocol use — extensions cannot claim these. */
export const RESERVED_NAMESPACES: ReadonlySet<string> = new Set([
  'bastion',
  'admin',
  'system',
  'internal',
  'core',
  'protocol',
  'relay',
  'auth',
  'safety',
  'audit',
  'debug',
  'test',
]);
