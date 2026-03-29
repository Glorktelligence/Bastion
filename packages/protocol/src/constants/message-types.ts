// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * All 70 message types in the Bastion protocol.
 *
 * Core spec (13): task, conversation, challenge, confirmation, denial,
 *   status, result, error, audit, file_manifest, file_offer, file_request, heartbeat
 *
 * Supplementary spec (10): session_end, session_conflict, session_superseded,
 *   reconnect, config_update, config_ack, config_nack, token_refresh,
 *   provider_status, budget_alert
 *
 * Audit query/response (2): audit_query, audit_response
 * Provider/context (2): provider_register, context_update
 * Budget Guard (2): budget_status, budget_config
 */
export const MESSAGE_TYPES = {
  // --- Core message types (Section 5.2) ---
  TASK: 'task',
  CONVERSATION: 'conversation',
  CHALLENGE: 'challenge',
  CONFIRMATION: 'confirmation',
  DENIAL: 'denial',
  STATUS: 'status',
  RESULT: 'result',
  ERROR: 'error',
  AUDIT: 'audit',
  FILE_MANIFEST: 'file_manifest',
  FILE_OFFER: 'file_offer',
  FILE_REQUEST: 'file_request',
  HEARTBEAT: 'heartbeat',

  // --- Supplementary message types (Section 13) ---
  SESSION_END: 'session_end',
  SESSION_CONFLICT: 'session_conflict',
  SESSION_SUPERSEDED: 'session_superseded',
  RECONNECT: 'reconnect',
  CONFIG_UPDATE: 'config_update',
  CONFIG_ACK: 'config_ack',
  CONFIG_NACK: 'config_nack',
  TOKEN_REFRESH: 'token_refresh',
  PROVIDER_STATUS: 'provider_status',
  BUDGET_ALERT: 'budget_alert',

  // --- Audit query/response ---
  AUDIT_QUERY: 'audit_query',
  AUDIT_RESPONSE: 'audit_response',

  // --- Provider/context ---
  PROVIDER_REGISTER: 'provider_register',
  CONTEXT_UPDATE: 'context_update',

  // --- Memory ---
  MEMORY_PROPOSAL: 'memory_proposal',
  MEMORY_DECISION: 'memory_decision',
  MEMORY_LIST: 'memory_list',
  MEMORY_LIST_RESPONSE: 'memory_list_response',
  MEMORY_UPDATE: 'memory_update',
  MEMORY_DELETE: 'memory_delete',

  // --- Extensions ---
  EXTENSION_QUERY: 'extension_query',
  EXTENSION_LIST_RESPONSE: 'extension_list_response',

  // --- Project Context (Layer 3) ---
  PROJECT_SYNC: 'project_sync',
  PROJECT_SYNC_ACK: 'project_sync_ack',
  PROJECT_LIST: 'project_list',
  PROJECT_LIST_RESPONSE: 'project_list_response',
  PROJECT_DELETE: 'project_delete',
  PROJECT_CONFIG: 'project_config',
  PROJECT_CONFIG_ACK: 'project_config_ack',

  // --- Tool Integration (Layer 4) ---
  TOOL_REGISTRY_SYNC: 'tool_registry_sync',
  TOOL_REGISTRY_ACK: 'tool_registry_ack',
  TOOL_REQUEST: 'tool_request',
  TOOL_APPROVED: 'tool_approved',
  TOOL_DENIED: 'tool_denied',
  TOOL_RESULT: 'tool_result',
  TOOL_REVOKE: 'tool_revoke',
  TOOL_ALERT: 'tool_alert',
  TOOL_ALERT_RESPONSE: 'tool_alert_response',

  // --- Challenge Me More (Temporal Governance) ---
  CHALLENGE_STATUS: 'challenge_status',
  CHALLENGE_CONFIG: 'challenge_config',
  CHALLENGE_CONFIG_ACK: 'challenge_config_ack',

  // --- Budget Guard (Immutable Enforcement) ---
  BUDGET_STATUS: 'budget_status',
  BUDGET_CONFIG: 'budget_config',

  // --- E2E Key Exchange ---
  KEY_EXCHANGE: 'key_exchange',

  // --- Multi-Conversation Persistence ---
  CONVERSATION_LIST: 'conversation_list',
  CONVERSATION_LIST_RESPONSE: 'conversation_list_response',
  CONVERSATION_CREATE: 'conversation_create',
  CONVERSATION_CREATE_ACK: 'conversation_create_ack',
  CONVERSATION_SWITCH: 'conversation_switch',
  CONVERSATION_SWITCH_ACK: 'conversation_switch_ack',
  CONVERSATION_HISTORY: 'conversation_history',
  CONVERSATION_HISTORY_RESPONSE: 'conversation_history_response',
  CONVERSATION_ARCHIVE: 'conversation_archive',
  CONVERSATION_DELETE: 'conversation_delete',
  CONVERSATION_COMPACT: 'conversation_compact',
  CONVERSATION_COMPACT_ACK: 'conversation_compact_ack',

  // --- Streaming ---
  CONVERSATION_STREAM: 'conversation_stream',

  // --- AI Disclosure (regulatory transparency) ---
  AI_DISCLOSURE: 'ai_disclosure',
} as const;

/** Union type of all valid message type strings. */
export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

/** Ordered array of all message type values for iteration/validation. */
export const ALL_MESSAGE_TYPES: readonly MessageType[] = Object.values(MESSAGE_TYPES);
