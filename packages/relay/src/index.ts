// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * @bastion/relay — WebSocket relay server for Project Bastion.
 *
 * The relay is the central routing hub that accepts WSS connections
 * from human and AI clients, terminates TLS, and routes encrypted
 * messages. It never sees plaintext payloads (zero-knowledge relay).
 */

// ---------------------------------------------------------------------------
// Server: WebSocket relay
// ---------------------------------------------------------------------------
export { BastionRelay } from './server/websocket.js';
export type {
  RelayConfig,
  ConnectionInfo,
  RelayEvents,
} from './server/websocket.js';

// ---------------------------------------------------------------------------
// Server: TLS configuration
// ---------------------------------------------------------------------------
export {
  loadTlsMaterial,
  buildSecureContext,
  generateSelfSigned,
  TlsError,
} from './server/tls.js';
export type {
  TlsConfig,
  TlsMaterial,
  SelfSignedResult,
} from './server/tls.js';

// ---------------------------------------------------------------------------
// Server: Heartbeat monitoring
// ---------------------------------------------------------------------------
export { HeartbeatMonitor } from './server/heartbeat.js';
export type {
  HeartbeatConfig,
  HeartbeatTimeoutCallback,
} from './server/heartbeat.js';

// ---------------------------------------------------------------------------
// Routing: Message router
// ---------------------------------------------------------------------------
export { MessageRouter, RouterError } from './routing/message-router.js';
export type {
  RegisteredClient,
  RouteLogEntry,
  RouteResult,
  RouteStatus,
  RouterConfig,
  SendFn,
  RouteLogFn,
  CapabilityCheckFn,
} from './routing/message-router.js';

// ---------------------------------------------------------------------------
// Routing: Schema validation
// ---------------------------------------------------------------------------
export {
  parseAndValidate,
  validateEncryptedEnvelope,
} from './routing/schema-validator.js';
export type {
  EnvelopeValidationResult,
  SchemaValidationError,
} from './routing/schema-validator.js';

// ---------------------------------------------------------------------------
// Routing: Rate limiting
// ---------------------------------------------------------------------------
export { RateLimiter } from './routing/rate-limiter.js';
export type { RateLimiterConfig } from './routing/rate-limiter.js';

// ---------------------------------------------------------------------------
// Auth: JWT service
// ---------------------------------------------------------------------------
export { JwtService, AuthError } from './auth/jwt.js';
export type {
  JwtConfig,
  TokenIssuanceClaims,
  TokenIssuanceResult,
  JwtValidationResult,
  JwtRefreshResult,
  JwtErrorCode,
} from './auth/jwt.js';

// ---------------------------------------------------------------------------
// Auth: Provider registry
// ---------------------------------------------------------------------------
export { ProviderRegistry } from './auth/provider-registry.js';
export type {
  ProviderCheckResult,
  ProviderRejectionReason,
} from './auth/provider-registry.js';

// ---------------------------------------------------------------------------
// Auth: Client allowlist
// ---------------------------------------------------------------------------
export { Allowlist } from './auth/allowlist.js';
export type {
  AllowlistEntry,
  AllowlistCheckResult,
  AllowlistRejectionReason,
  MaliClawMatchResult,
} from './auth/allowlist.js';

// ---------------------------------------------------------------------------
// Audit: Logger with hash chain
// ---------------------------------------------------------------------------
export { AuditLogger, AuditLoggerError, AUDIT_EVENT_TYPES } from './audit/audit-logger.js';
export type {
  AuditLoggerConfig,
  AuditEventType,
} from './audit/audit-logger.js';

// ---------------------------------------------------------------------------
// Audit: SQLite store
// ---------------------------------------------------------------------------
export { AuditStore, AuditStoreError } from './audit/audit-store.js';
export type {
  AuditStoreConfig,
  AuditQuery,
} from './audit/audit-store.js';

// ---------------------------------------------------------------------------
// Audit: Chain integrity verification
// ---------------------------------------------------------------------------
export { ChainIntegrityMonitor } from './audit/chain-integrity.js';
export type {
  ChainIntegrityConfig,
  IntegrityCheckResult,
  IntegrityCallback,
} from './audit/chain-integrity.js';

// ---------------------------------------------------------------------------
// Quarantine: File quarantine store
// ---------------------------------------------------------------------------
export { FileQuarantine, QuarantineError } from './quarantine/file-quarantine.js';
export type {
  QuarantineConfig,
  QuarantineSubmission,
  QuarantineResult,
  ReleaseResult,
  PurgeResult,
} from './quarantine/file-quarantine.js';

// ---------------------------------------------------------------------------
// Quarantine: Hash verification
// ---------------------------------------------------------------------------
export { HashVerifier } from './quarantine/hash-verifier.js';
export type {
  HashVerifierConfig,
  HashVerificationResult,
  VerificationStage,
} from './quarantine/hash-verifier.js';

// ---------------------------------------------------------------------------
// Quarantine: Purge scheduler
// ---------------------------------------------------------------------------
export { PurgeScheduler } from './quarantine/purge-scheduler.js';
export type {
  PurgeSchedulerConfig,
  PurgeCycleResult,
} from './quarantine/purge-scheduler.js';

// ---------------------------------------------------------------------------
// Quarantine: File transfer routing (manifest/offer/request workflow)
// ---------------------------------------------------------------------------
export { FileTransferRouter } from './quarantine/file-transfer-router.js';
export type {
  FileTransferRouterConfig,
  FileSubmission,
  FileSubmitResult,
  FileRequestResult,
  FileRejectResult,
} from './quarantine/file-transfer-router.js';

// ---------------------------------------------------------------------------
// Admin: Authentication
// ---------------------------------------------------------------------------
export { AdminAuth, AdminAuthError } from './admin/admin-auth.js';
export type {
  AdminAccount,
  AdminAuthConfig,
  AdminAuthResult,
  AdminAuthSuccess,
  AdminAuthFailure,
  AdminAuthFailureReason,
} from './admin/admin-auth.js';

// ---------------------------------------------------------------------------
// Admin: API routes
// ---------------------------------------------------------------------------
export { AdminRoutes, defaultCapabilityMatrix } from './admin/admin-routes.js';
export type {
  AdminRoutesConfig,
  CapabilityMatrix,
  DisclosureConfig,
  FileTransferCapabilities,
  ApiResponse,
  RelayStatusProvider,
  LiveConnectionInfo,
} from './admin/admin-routes.js';

// ---------------------------------------------------------------------------
// Admin: HTTPS server
// ---------------------------------------------------------------------------
export { AdminServer, AdminServerError, isPrivateHost } from './admin/admin-server.js';
export type { AdminServerConfig } from './admin/admin-server.js';

// ---------------------------------------------------------------------------
// Session: Reconnection manager (grace period + message queue)
// ---------------------------------------------------------------------------
export { ReconnectionManager } from './session/reconnection-manager.js';
export type {
  ReconnectionConfig,
  GraceSession,
  GraceExpiryCallback,
} from './session/reconnection-manager.js';

// ---------------------------------------------------------------------------
// Extensions (types re-exported from @bastion/protocol — Protocol First)
// ---------------------------------------------------------------------------
export { ExtensionRegistry } from './extensions/extension-registry.js';
export type {
  ExtensionDefinition,
  ExtensionMessageType,
  ExtensionSafetyLevel,
  ExtensionLoadResult,
  ExtensionUI,
  ExtensionUIPage,
  ExtensionUIComponent,
  ExtensionUISize,
  ExtensionUIAudit,
} from './extensions/extension-registry.js';
