// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * ConversationManager — maintains a conversation buffer for the active session.
 *
 * Stores {role, content} pairs and provides the messages array for Anthropic
 * API calls. Handles token budget enforcement by trimming oldest messages
 * while preserving the system prompt and the most recent 3 exchanges.
 */

import { readFileSync, writeFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface ConversationManagerConfig {
  /** Maximum token budget for the messages array. Default: 100,000. */
  readonly tokenBudget?: number;
  /** Path to user-context.md file. Default: '/var/lib/bastion-ai/user-context.md'. */
  readonly userContextPath?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TOKEN_BUDGET = 100_000;
const DEFAULT_USER_CONTEXT_PATH = '/var/lib/bastion-ai/user-context.md';
const CHARS_PER_TOKEN = 4;

/** Minimum exchanges to preserve when trimming (3 exchanges = 6 messages). */
const MIN_PRESERVED_EXCHANGES = 3;
const MIN_PRESERVED_MESSAGES = MIN_PRESERVED_EXCHANGES * 2;

/** Immutable role context — never removed or modified. */
const ROLE_CONTEXT =
  'You are an AI assistant operating within the Bastion secure messaging protocol. ' +
  'A human operator communicates with you through an encrypted relay. ' +
  'You may be asked to perform tasks that will be evaluated for safety. ' +
  'If a task seems dangerous, ambiguous, or irreversible, say so.';

// ---------------------------------------------------------------------------
// ConversationManager
// ---------------------------------------------------------------------------

export class ConversationManager {
  private readonly tokenBudget: number;
  private readonly userContextPath: string;
  private messages: ConversationMessage[];
  private userContext: string;

  constructor(config?: ConversationManagerConfig) {
    this.tokenBudget = config?.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
    this.userContextPath = config?.userContextPath ?? DEFAULT_USER_CONTEXT_PATH;
    this.messages = [];
    this.userContext = '';
    this.loadUserContext();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Add a user message to the buffer. */
  addUserMessage(content: string): void {
    this.messages.push({ role: 'user', content });
    this.enforceTokenBudget();
  }

  /** Add an assistant response to the buffer. */
  addAssistantMessage(content: string): void {
    this.messages.push({ role: 'assistant', content });
    this.enforceTokenBudget();
  }

  /** Get the assembled system prompt (role context + user context). */
  getSystemPrompt(): string {
    if (this.userContext.trim().length === 0) {
      return ROLE_CONTEXT;
    }
    return `${ROLE_CONTEXT}\n\n--- User Context ---\n${this.userContext}`;
  }

  /** Get the conversation messages for the API call. */
  getMessages(): readonly ConversationMessage[] {
    return this.messages;
  }

  /** Get the current message count. */
  get messageCount(): number {
    return this.messages.length;
  }

  /** Get the current user context content. */
  getUserContext(): string {
    return this.userContext;
  }

  /** Estimate total token count for the current buffer. */
  estimateTokenCount(): number {
    let chars = this.getSystemPrompt().length;
    for (const msg of this.messages) {
      chars += msg.content.length;
    }
    return Math.ceil(chars / CHARS_PER_TOKEN);
  }

  /** Update user context (writes to file and reloads). */
  updateUserContext(content: string): void {
    this.userContext = content;
    try {
      writeFileSync(this.userContextPath, content, 'utf-8');
    } catch {
      // Write failure is non-fatal — context is still in memory
    }
  }

  /** Reload user context from file. */
  loadUserContext(): void {
    try {
      this.userContext = readFileSync(this.userContextPath, 'utf-8');
    } catch {
      this.userContext = '';
    }
  }

  /** Clear the conversation buffer (keeps user context). */
  clear(): void {
    this.messages = [];
  }

  /** Get the role context (immutable). */
  static getRoleContext(): string {
    return ROLE_CONTEXT;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private enforceTokenBudget(): void {
    while (this.estimateTokenCount() > this.tokenBudget && this.messages.length > MIN_PRESERVED_MESSAGES) {
      // Remove oldest message (index 0) but preserve the most recent MIN_PRESERVED_MESSAGES
      this.messages.splice(0, 1);
    }
  }
}
