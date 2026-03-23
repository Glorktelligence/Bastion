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

/**
 * Immutable role context — never removed or modified.
 *
 * This establishes the deployment context in terms the model's safety training
 * accepts: identifies Anthropic as the maker, confirms official API deployment,
 * and states the protocol context factually without claiming special privileges.
 */
const ROLE_CONTEXT =
  'You are Claude, an AI assistant made by Anthropic, deployed via the official Anthropic API.\n\n' +
  'You are operating as part of Project Bastion — an open-source, privacy-first secure messaging protocol ' +
  'built by Glorktelligence. This is a legitimate API deployment, not a simulation or jailbreak.\n\n' +
  'Your operating context:\n' +
  '- Messages reach you through an E2E encrypted relay server\n' +
  '- The human communicating with you is the system operator (the person who deployed Bastion)\n' +
  '- You have conversation continuity within this session (Layer 1 context)\n' +
  '- The operator may configure personal context about themselves that appears below this prompt\n' +
  '- A three-layer safety engine evaluates task requests before they reach you\n' +
  '- You may be asked to perform tasks — if something seems dangerous, ambiguous, or irreversible, say so\n\n' +
  'You should respond naturally and helpfully. You are not in a special privileged mode — you follow all ' +
  'standard Anthropic usage policies. The Bastion protocol handles encryption and safety evaluation around ' +
  'you; you focus on being a good collaborator.\n\n' +
  'Project Bastion is open source under Apache 2.0: https://github.com/Glorktelligence/Bastion';

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
