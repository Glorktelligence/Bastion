// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * @bastion/protocol — Shared protocol definitions for Project Bastion.
 *
 * This is the foundation package. All other packages consume these types,
 * schemas, and constants. No other package should define its own message
 * structures.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type {
  MessageId,
  SessionId,
  TaskId,
  FileTransferId,
  Timestamp,
  CorrelationId,
  SenderIdentity,
  ClientType,
  Priority,
  SessionState,
  ProviderStatus,
  ConnectionQuality,
} from './types/common.js';

export type {
  TaskPayload,
  ConversationPayload,
  ChallengePayload,
  ChallengeFactor,
  ConfirmationPayload,
  ConfirmationDecision,
  DenialPayload,
  StatusPayload,
  ResultPayload,
  CostMetadata,
  TransparencyMetadata,
  ConfidenceLevel,
  ErrorPayload,
  AuditPayload,
  HeartbeatPayload,
  HeartbeatMetrics,
  FileManifestPayload,
  FileOfferPayload,
  FileRequestPayload,
  SessionEndPayload,
  SessionConflictPayload,
  SessionSupersededPayload,
  ReconnectPayload,
  ConfigUpdatePayload,
  ConfigUpdateType,
  ConfigAckPayload,
  ConfigNackPayload,
  TokenRefreshPayload,
  ProviderStatusPayload,
  BudgetAlertPayload,
  MessagePayload,
} from './types/messages.js';

export type {
  MessageEnvelope,
  EncryptedEnvelope,
} from './types/envelope.js';

export type {
  SafetyEvaluation,
  SafetyLayerResults,
  Layer1Result,
  Layer1DenialCategory,
  Layer2Result,
  Layer2Factor,
  Layer2FactorName,
  Layer3Result,
  CompletenessIssue,
  CompletenessIssueType,
  SafetyConfig,
} from './types/safety.js';

export type {
  BastionJwtClaims,
  ApprovedProvider,
  SessionInitiation,
  SessionEstablished,
} from './types/auth.js';

export type {
  FileTransferState,
  FileTransferDirection,
  FileChainOfCustody,
  CustodyEvent,
  CustodyEventType,
  QuarantineEntry,
} from './types/file-transfer.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export { PROTOCOL_VERSION } from './constants/version.js';
export { MESSAGE_TYPES, ALL_MESSAGE_TYPES } from './constants/message-types.js';
export type { MessageType } from './constants/message-types.js';
export { ERROR_CODES } from './constants/error-codes.js';
export type { ErrorCode } from './constants/error-codes.js';
export {
  SAFETY_LAYERS,
  SAFETY_OUTCOMES,
  SAFETY_FLOORS,
  PATTERN_SENSITIVITY,
} from './constants/safety-levels.js';
export type {
  SafetyLayer,
  SafetyOutcome,
  PatternSensitivity,
} from './constants/safety-levels.js';

// ---------------------------------------------------------------------------
// Schemas (Zod runtime validation)
// ---------------------------------------------------------------------------
export {
  MessageIdSchema,
  SessionIdSchema,
  TaskIdSchema,
  FileTransferIdSchema,
  CorrelationIdSchema,
  TimestampSchema,
  ClientTypeSchema,
  SenderIdentitySchema,
  PrioritySchema,
  SessionStateSchema,
  ProviderStatusSchema,
  ConnectionQualitySchema,
} from './schemas/common.schema.js';

export {
  TaskPayloadSchema,
  ConversationPayloadSchema,
  ChallengePayloadSchema,
  ChallengeFactorSchema,
  ConfirmationPayloadSchema,
  ConfirmationDecisionSchema,
  DenialPayloadSchema,
  StatusPayloadSchema,
  CostMetadataSchema,
  ConfidenceLevelSchema,
  SafetyOutcomeSchema,
  TransparencyMetadataSchema,
  ResultPayloadSchema,
  ErrorCodeSchema,
  ErrorPayloadSchema,
  AuditPayloadSchema,
  HeartbeatPayloadSchema,
  HeartbeatMetricsSchema,
  FileManifestPayloadSchema,
  FileOfferPayloadSchema,
  FileRequestPayloadSchema,
  SessionEndPayloadSchema,
  SessionConflictPayloadSchema,
  SessionSupersededPayloadSchema,
  ReconnectPayloadSchema,
  ConfigUpdateTypeSchema,
  ConfigUpdatePayloadSchema,
  ConfigAckPayloadSchema,
  ConfigNackPayloadSchema,
  TokenRefreshPayloadSchema,
  ProviderStatusPayloadSchema,
  BudgetAlertPayloadSchema,
  PAYLOAD_SCHEMAS,
} from './schemas/message.schema.js';

export {
  MessageTypeFieldSchema,
  MessageEnvelopeSchema,
  EncryptedEnvelopeSchema,
} from './schemas/envelope.schema.js';

export {
  FileTransferStateSchema,
  FileTransferDirectionSchema,
  CustodyEventTypeSchema,
  CustodyEventSchema,
  FileChainOfCustodySchema,
  QuarantineEntrySchema,
} from './schemas/file.schema.js';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
export {
  validateMessage,
  validatePayload,
} from './utils/validation.js';
export type {
  ValidationResult,
  ValidationError,
} from './utils/validation.js';

export { sha256, sha256Bytes } from './utils/hash.js';

export {
  canonicalise,
  serialise,
  deserialise,
  SerialisationError,
} from './utils/serialisation.js';
export type {
  SerialisedMessage,
  DeserialisationResult,
  DeserialisationSuccess,
  DeserialisationFailure,
} from './utils/serialisation.js';
