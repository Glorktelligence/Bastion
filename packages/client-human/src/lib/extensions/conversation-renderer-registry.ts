// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * ConversationRendererRegistry — generic extension message renderers.
 *
 * Extensions declare how their message types render in conversation view
 * via HTML files in their renderers/ directory. The relay reads these files
 * and includes them in extension_list_response. The registry stores them
 * so the conversation view can render extension messages generically
 * without per-extension hardcoding.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RendererConfig {
  readonly html: string;
  readonly style: 'compact' | 'full';
  readonly markdown?: boolean;
  readonly namespace: string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class ConversationRendererRegistry {
  private renderers = new Map<string, RendererConfig>();

  register(messageType: string, config: RendererConfig): void {
    this.renderers.set(messageType, config);
  }

  has(messageType: string): boolean {
    return this.renderers.has(messageType);
  }

  get(messageType: string): RendererConfig | undefined {
    return this.renderers.get(messageType);
  }

  clear(): void {
    this.renderers.clear();
  }

  /** Number of registered renderers. */
  get size(): number {
    return this.renderers.size;
  }

  /**
   * Populate registry from extension_list_response data.
   * Each extension's conversationRenderers map type names to renderer configs.
   * Types are stored as namespace:type (e.g. "chronicle:game-turn").
   */
  loadFromExtensions(
    extensions: ReadonlyArray<{
      namespace: string;
      conversationRenderers?: Readonly<Record<string, { html: string; style?: string; markdown?: boolean }>>;
    }>,
  ): void {
    for (const ext of extensions) {
      if (!ext.conversationRenderers) continue;
      for (const [type, config] of Object.entries(ext.conversationRenderers)) {
        this.register(`${ext.namespace}:${type}`, {
          html: config.html,
          style: config.style === 'compact' || config.style === 'full' ? config.style : 'compact',
          markdown: config.markdown ?? false,
          namespace: ext.namespace,
        });
      }
    }
  }
}

/** Singleton registry instance. */
export const conversationRendererRegistry = new ConversationRendererRegistry();
