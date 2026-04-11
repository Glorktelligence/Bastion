// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Extension message dispatcher — routes namespace:type messages
 * to registered handler functions. Locked after startup to prevent
 * runtime modification.
 */

import type { ConversationManager } from './conversation-manager.js';
import type { ConversationStore } from './conversation-store.js';
import type { MemoryStore } from './memory-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Context passed to extension handlers. */
export interface ExtensionContext {
  /** The raw message received. */
  readonly message: {
    type: string;
    id: string;
    payload: Record<string, unknown>;
    sender: Record<string, unknown>;
    timestamp: string;
  };
  /** Resolved adapter ID based on the extension's adapterHint. */
  readonly adapterId: string | null;
  /** The adapter hint from the extension manifest. */
  readonly adapterHint: string;
  /** Conversation manager for context building. */
  readonly conversationManager: ConversationManager;
  /** Conversation store for persistence. */
  readonly conversationStore: ConversationStore;
  /** Memory store for persistent memory. */
  readonly memoryStore: MemoryStore;
  /** Send a response message back to the human client. */
  readonly send: (type: string, payload: Record<string, unknown>) => void;
  /** Extension data directory path (e.g., /var/lib/bastion/extensions/game/). */
  readonly dataDir: string;
}

/** Handler function for an extension message type. */
export type ExtensionHandler = (ctx: ExtensionContext) => Promise<void>;

// ---------------------------------------------------------------------------
// ExtensionDispatcher
// ---------------------------------------------------------------------------

export class ExtensionDispatcher {
  private readonly handlers = new Map<string, ExtensionHandler>();
  private readonly stateProviders = new Map<string, () => Record<string, unknown>>();
  private locked = false;

  /**
   * Register a handler for an extension message type.
   * Type must use namespace:type format.
   */
  registerHandler(messageType: string, handler: ExtensionHandler): void {
    if (this.locked) throw new Error('Extension dispatcher locked after startup');
    if (!messageType.includes(':'))
      throw new Error(`Extension types must use namespace:type format, got: ${messageType}`);
    this.handlers.set(messageType, handler);
  }

  /**
   * Register a state provider for an extension namespace.
   * The provider function is called when state is queried.
   */
  registerStateProvider(namespace: string, getState: () => Record<string, unknown>): void {
    if (this.locked) throw new Error('Extension dispatcher locked after startup');
    this.stateProviders.set(namespace, getState);
  }

  /** Get the current state for a namespace, or null if no provider registered. */
  getState(namespace: string): Record<string, unknown> | null {
    const provider = this.stateProviders.get(namespace);
    return provider ? provider() : null;
  }

  /** Check if a state provider exists for the given namespace. */
  hasStateProvider(namespace: string): boolean {
    return this.stateProviders.has(namespace);
  }

  /** Lock the dispatcher — no further registrations allowed. */
  lock(): void {
    this.locked = true;
  }

  /** Check if the dispatcher is locked. */
  get isLocked(): boolean {
    return this.locked;
  }

  /** Check if a handler exists for the given message type. */
  hasHandler(messageType: string): boolean {
    return this.handlers.has(messageType);
  }

  /** Get the handler for the given message type. */
  getHandler(messageType: string): ExtensionHandler | undefined {
    return this.handlers.get(messageType);
  }

  /** Get all registered message types. */
  get registeredTypes(): readonly string[] {
    return [...this.handlers.keys()];
  }

  /** Get the number of registered handlers. */
  get size(): number {
    return this.handlers.size;
  }
}
