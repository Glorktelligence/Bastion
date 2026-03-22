// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * All 27 message types in the Bastion protocol.
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
} as const;

/** Union type of all valid message type strings. */
export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

/** Ordered array of all message type values for iteration/validation. */
export const ALL_MESSAGE_TYPES: readonly MessageType[] = Object.values(MESSAGE_TYPES);
