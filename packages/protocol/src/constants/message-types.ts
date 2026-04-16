// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * All 102 message types in the Bastion protocol.
 *
 * Core spec (11): task, conversation, challenge, confirmation, denial,
 *   status, result, error, file_manifest, file_offer, file_request, heartbeat
 *
 * Supplementary spec (9): session_end, session_conflict, session_superseded,
 *   reconnect, config_ack, config_nack, token_refresh,
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
  FILE_MANIFEST: 'file_manifest',
  FILE_OFFER: 'file_offer',
  FILE_REQUEST: 'file_request',
  HEARTBEAT: 'heartbeat',

  // --- Supplementary message types (Section 13) ---
  SESSION_END: 'session_end',
  SESSION_CONFLICT: 'session_conflict',
  SESSION_SUPERSEDED: 'session_superseded',
  RECONNECT: 'reconnect',
  SESSION_RESTORED: 'session_restored',
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
  CONTEXT_REQUEST: 'context_request',
  CONTEXT_RESPONSE: 'context_response',

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
  EXTENSION_STATE_UPDATE: 'extension_state_update',
  EXTENSION_STATE_REQUEST: 'extension_state_request',
  EXTENSION_STATE_RESPONSE: 'extension_state_response',

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
  TOOL_REGISTER: 'tool_register',

  // --- Challenge Me More (Temporal Governance) ---
  CHALLENGE_STATUS: 'challenge_status',
  CHALLENGE_CONFIG: 'challenge_config',
  CHALLENGE_CONFIG_ACK: 'challenge_config_ack',

  // --- Budget Guard (Immutable Enforcement) ---
  BUDGET_STATUS: 'budget_status',
  BUDGET_CONFIG: 'budget_config',
  USAGE_STATUS: 'usage_status',

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

  // --- Skills System (Layer 5) ---
  SKILL_LIST_RESPONSE: 'skill_list_response',
  SKILL_SCAN_RESULT: 'skill_scan_result',

  // --- AI Disclosure (regulatory transparency) ---
  AI_DISCLOSURE: 'ai_disclosure',

  // --- Data Portability (GDPR Article 20) ---
  DATA_EXPORT_REQUEST: 'data_export_request',
  DATA_EXPORT_PROGRESS: 'data_export_progress',
  DATA_EXPORT_READY: 'data_export_ready',
  DATA_IMPORT_VALIDATE: 'data_import_validate',
  DATA_IMPORT_CONFIRM: 'data_import_confirm',
  DATA_IMPORT_COMPLETE: 'data_import_complete',

  // --- Data Erasure (GDPR Article 17 — Right to Erasure) ---
  DATA_ERASURE_REQUEST: 'data_erasure_request',
  DATA_ERASURE_PREVIEW: 'data_erasure_preview',
  DATA_ERASURE_CONFIRM: 'data_erasure_confirm',
  DATA_ERASURE_COMPLETE: 'data_erasure_complete',
  DATA_ERASURE_CANCEL: 'data_erasure_cancel',

  // --- AI Native Actions ---
  AI_CHALLENGE: 'ai_challenge',
  AI_CHALLENGE_RESPONSE: 'ai_challenge_response',
  AI_MEMORY_PROPOSAL: 'ai_memory_proposal',
  AI_MEMORY_PROPOSAL_BATCH: 'ai_memory_proposal_batch',
  MEMORY_BATCH_DECISION: 'memory_batch_decision',

  // --- Dream Cycle (Layer 6) ---
  DREAM_CYCLE_REQUEST: 'dream_cycle_request',
  DREAM_CYCLE_COMPLETE: 'dream_cycle_complete',

  // --- BastionGuardian (7th Sole Authority) ---
  GUARDIAN_ALERT: 'guardian_alert',
  GUARDIAN_SHUTDOWN: 'guardian_shutdown',
  GUARDIAN_STATUS: 'guardian_status',
  GUARDIAN_STATUS_REQUEST: 'guardian_status_request',
  GUARDIAN_CLEAR: 'guardian_clear',
} as const;

/** Union type of all valid message type strings. */
export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

/** Ordered array of all message type values for iteration/validation. */
export const ALL_MESSAGE_TYPES: readonly MessageType[] = Object.values(MESSAGE_TYPES);
