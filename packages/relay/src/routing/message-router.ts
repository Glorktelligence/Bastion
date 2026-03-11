// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Message routing for the Bastion relay.
 *
 * Routes EncryptedEnvelopes between paired human and AI clients.
 * The router never sees plaintext payloads — it uses only the
 * plaintext metadata fields (sender, type, id) for routing decisions.
 *
 * Routing rules:
 *   - Human messages → AI peer
 *   - AI messages → human peer
 *   - Relay-type senders are rejected (relay generates messages directly)
 *   - Sender identity must match registration (anti-spoofing)
 *   - All routed messages are logged via the log callback
 *
 * The router is decoupled from BastionRelay — it takes a `send`
 * function and can be tested independently.
 */

import type { ClientType, EncryptedEnvelope, SenderIdentity } from '@bastion/protocol';
import { RateLimiter, type RateLimiterConfig } from './rate-limiter.js';
import { parseAndValidate } from './schema-validator.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A registered client connection. */
export interface RegisteredClient {
  /** The WebSocket connection ID from BastionRelay. */
  readonly connectionId: string;
  /** The authenticated sender identity. */
  readonly identity: SenderIdentity;
  /** The paired peer's connection ID (if paired). */
  readonly peerId: string | undefined;
}

/** Log entry emitted for every routing decision. */
export interface RouteLogEntry {
  /** ISO 8601 timestamp of the routing decision. */
  readonly timestamp: string;
  /** Message ID from the envelope (if parsed successfully). */
  readonly messageId: string;
  /** Message type from the envelope (if parsed successfully). */
  readonly messageType: string;
  /** Sender's connection ID. */
  readonly senderConnectionId: string;
  /** Sender's client type. */
  readonly senderType: string;
  /** Recipient's connection ID (empty if not routed). */
  readonly recipientConnectionId: string;
  /** Routing outcome. */
  readonly status: RouteStatus;
  /** Error detail (for failed routes). */
  readonly detail: string;
}

/** Function signature for sending data to a connection. */
export type SendFn = (connectionId: string, data: string) => boolean;

/** Function signature for logging route decisions. */
export type RouteLogFn = (entry: RouteLogEntry) => void;

/**
 * Optional capability check callback for provider enforcement.
 *
 * Called during routing to verify the sender is allowed to send
 * the given message type. Used by AdminRoutes to enforce the
 * per-provider capability matrix.
 *
 * @param senderConnectionId — the sender's connection ID
 * @param messageType — the message type being sent
 * @returns allowed/denied with optional reason
 */
export type CapabilityCheckFn = (
  senderConnectionId: string,
  messageType: string,
) => { allowed: boolean; reason?: string };

/** All possible routing outcomes. */
export type RouteStatus =
  | 'routed'
  | 'validation_failed'
  | 'rate_limited'
  | 'unknown_sender'
  | 'sender_mismatch'
  | 'capability_denied'
  | 'no_peer'
  | 'send_failed';

/** Result of a routing attempt. */
export type RouteResult =
  | { readonly status: 'routed'; readonly recipientId: string; readonly messageId: string }
  | { readonly status: 'validation_failed'; readonly errors: readonly { path: string; message: string }[] }
  | { readonly status: 'rate_limited'; readonly connectionId: string }
  | { readonly status: 'unknown_sender'; readonly connectionId: string }
  | {
      readonly status: 'sender_mismatch';
      readonly connectionId: string;
      readonly expected: ClientType;
      readonly actual: ClientType;
    }
  | {
      readonly status: 'capability_denied';
      readonly connectionId: string;
      readonly messageType: string;
      readonly reason: string;
    }
  | { readonly status: 'no_peer'; readonly connectionId: string; readonly senderType: ClientType }
  | { readonly status: 'send_failed'; readonly recipientId: string };

/** Configuration for the message router. */
export interface RouterConfig {
  /** Function to send data to a connection (e.g., relay.send.bind(relay)). */
  readonly send: SendFn;
  /** Optional logging callback for every routing decision. */
  readonly log?: RouteLogFn;
  /** Optional capability check for provider enforcement. */
  readonly capabilityCheck?: CapabilityCheckFn;
  /** Optional rate limiter configuration. */
  readonly rateLimit?: RateLimiterConfig;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface ClientEntry {
  identity: SenderIdentity;
  peerId: string | undefined;
}

// ---------------------------------------------------------------------------
// MessageRouter
// ---------------------------------------------------------------------------

/**
 * Routes encrypted messages between paired human and AI clients.
 *
 * Usage:
 *   1. Create: `const router = new MessageRouter(config)`
 *   2. Register clients: `router.registerClient(connId, identity)`
 *   3. Pair clients: `router.pairClients(humanConnId, aiConnId)`
 *   4. Route messages: `const result = router.route(data, senderConnId)`
 *   5. On disconnect: `router.unregisterClient(connId)`
 *   6. Cleanup: `router.destroy()`
 */
export class MessageRouter {
  private readonly sendFn: SendFn;
  private readonly logFn: RouteLogFn | undefined;
  private readonly capabilityCheckFn: CapabilityCheckFn | undefined;
  private readonly rateLimiter: RateLimiter | null;
  private readonly clients: Map<string, ClientEntry>;
  private destroyed: boolean;

  constructor(config: RouterConfig) {
    this.sendFn = config.send;
    this.logFn = config.log;
    this.capabilityCheckFn = config.capabilityCheck;
    this.rateLimiter = config.rateLimit ? new RateLimiter(config.rateLimit) : null;
    this.clients = new Map();
    this.destroyed = false;
  }

  /** Number of registered clients. */
  get clientCount(): number {
    return this.clients.size;
  }

  /** Whether the router has been destroyed. */
  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * Register a client connection with its authenticated identity.
   *
   * @param connectionId — the connection ID from BastionRelay
   * @param identity — the authenticated sender identity (from JWT)
   */
  registerClient(connectionId: string, identity: SenderIdentity): void {
    if (this.destroyed) return;

    // Clean up any existing registration for this ID
    this.unregisterClient(connectionId);

    this.clients.set(connectionId, {
      identity,
      peerId: undefined,
    });
  }

  /**
   * Unregister a client connection.
   *
   * Also unpairs the client from its peer (the peer's peerId is cleared).
   *
   * @param connectionId — the connection to unregister
   */
  unregisterClient(connectionId: string): void {
    const entry = this.clients.get(connectionId);
    if (!entry) return;

    // Clear the peer's reference to this client
    if (entry.peerId) {
      const peer = this.clients.get(entry.peerId);
      if (peer) {
        peer.peerId = undefined;
      }
    }

    this.clients.delete(connectionId);
    this.rateLimiter?.reset(connectionId);
  }

  /**
   * Pair a human and AI client for message routing.
   *
   * Messages from the human will be routed to the AI, and vice versa.
   * Both clients must be registered before pairing.
   *
   * @param humanConnectionId — the human client's connection ID
   * @param aiConnectionId — the AI client's connection ID
   * @throws Error if either client is not registered or types don't match
   */
  pairClients(humanConnectionId: string, aiConnectionId: string): void {
    const human = this.clients.get(humanConnectionId);
    const ai = this.clients.get(aiConnectionId);

    if (!human) {
      throw new RouterError(`Client not registered: ${humanConnectionId}`);
    }
    if (!ai) {
      throw new RouterError(`Client not registered: ${aiConnectionId}`);
    }
    if (human.identity.type !== 'human') {
      throw new RouterError(`Expected human client, got ${human.identity.type}: ${humanConnectionId}`);
    }
    if (ai.identity.type !== 'ai') {
      throw new RouterError(`Expected AI client, got ${ai.identity.type}: ${aiConnectionId}`);
    }

    // Unpair existing peers first
    if (human.peerId) {
      const oldPeer = this.clients.get(human.peerId);
      if (oldPeer) oldPeer.peerId = undefined;
    }
    if (ai.peerId) {
      const oldPeer = this.clients.get(ai.peerId);
      if (oldPeer) oldPeer.peerId = undefined;
    }

    human.peerId = aiConnectionId;
    ai.peerId = humanConnectionId;
  }

  /**
   * Get information about a registered client.
   *
   * @param connectionId — the connection to look up
   * @returns client info or undefined if not registered
   */
  getClient(connectionId: string): RegisteredClient | undefined {
    const entry = this.clients.get(connectionId);
    if (!entry) return undefined;
    return {
      connectionId,
      identity: entry.identity,
      peerId: entry.peerId,
    };
  }

  /**
   * Get the peer connection ID for a given client.
   *
   * @param connectionId — the client to look up
   * @returns peer's connection ID or undefined
   */
  getPeer(connectionId: string): string | undefined {
    return this.clients.get(connectionId)?.peerId;
  }

  /**
   * Route a message from a sender to its peer.
   *
   * Pipeline:
   *   1. Parse JSON and validate against EncryptedEnvelopeSchema
   *   2. Look up sender by connection ID
   *   3. Verify sender type matches registration (anti-spoofing)
   *   4. Rate limit check
   *   5. Find recipient (paired peer)
   *   6. Send to recipient
   *   7. Log the routing decision
   *
   * @param data — raw JSON string from the WebSocket
   * @param senderConnectionId — the sender's connection ID
   * @returns routing result indicating outcome
   */
  route(data: string, senderConnectionId: string): RouteResult {
    // Step 1: Validate schema
    const validation = parseAndValidate(data);
    if (!validation.valid) {
      const result: RouteResult = {
        status: 'validation_failed',
        errors: validation.errors,
      };
      this.log(result, senderConnectionId);
      return result;
    }

    const envelope = validation.envelope;

    // Step 2: Look up sender
    const sender = this.clients.get(senderConnectionId);
    if (!sender) {
      const result: RouteResult = {
        status: 'unknown_sender',
        connectionId: senderConnectionId,
      };
      this.log(result, senderConnectionId, envelope);
      return result;
    }

    // Step 3: Verify sender type matches registration (anti-spoofing)
    if (envelope.sender.type !== sender.identity.type) {
      const result: RouteResult = {
        status: 'sender_mismatch',
        connectionId: senderConnectionId,
        expected: sender.identity.type,
        actual: envelope.sender.type,
      };
      this.log(result, senderConnectionId, envelope);
      return result;
    }

    // Step 3b: Capability check (provider enforcement)
    if (this.capabilityCheckFn) {
      const capCheck = this.capabilityCheckFn(senderConnectionId, envelope.type);
      if (!capCheck.allowed) {
        const result: RouteResult = {
          status: 'capability_denied',
          connectionId: senderConnectionId,
          messageType: envelope.type,
          reason: capCheck.reason ?? 'capability_check_failed',
        };
        this.log(result, senderConnectionId, envelope);
        return result;
      }
    }

    // Step 4: Rate limit
    if (this.rateLimiter && !this.rateLimiter.check(senderConnectionId)) {
      const result: RouteResult = {
        status: 'rate_limited',
        connectionId: senderConnectionId,
      };
      this.log(result, senderConnectionId, envelope);
      return result;
    }

    // Step 5: Find recipient (peer)
    if (!sender.peerId) {
      const result: RouteResult = {
        status: 'no_peer',
        connectionId: senderConnectionId,
        senderType: sender.identity.type,
      };
      this.log(result, senderConnectionId, envelope);
      return result;
    }

    // Step 6: Send to recipient
    const sent = this.sendFn(sender.peerId, data);
    if (!sent) {
      const result: RouteResult = {
        status: 'send_failed',
        recipientId: sender.peerId,
      };
      this.log(result, senderConnectionId, envelope);
      return result;
    }

    // Step 7: Success
    const result: RouteResult = {
      status: 'routed',
      recipientId: sender.peerId,
      messageId: envelope.id,
    };
    this.log(result, senderConnectionId, envelope);
    return result;
  }

  /** Stop the router and release all resources. */
  destroy(): void {
    if (this.destroyed) return;
    this.clients.clear();
    this.rateLimiter?.destroy();
    this.destroyed = true;
  }

  // -------------------------------------------------------------------------
  // Internal: Logging
  // -------------------------------------------------------------------------

  private log(result: RouteResult, senderConnectionId: string, envelope?: EncryptedEnvelope): void {
    if (!this.logFn) return;

    let detail = '';
    switch (result.status) {
      case 'validation_failed':
        detail = result.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
        break;
      case 'sender_mismatch':
        detail = `Expected ${result.expected}, got ${result.actual}`;
        break;
      case 'unknown_sender':
        detail = `Connection ${result.connectionId} not registered`;
        break;
      case 'capability_denied':
        detail = `Capability denied: ${result.reason} (type: ${result.messageType})`;
        break;
      case 'no_peer':
        detail = `No peer paired for ${result.senderType} client`;
        break;
      case 'send_failed':
        detail = `Failed to send to ${result.recipientId}`;
        break;
      case 'rate_limited':
        detail = `Rate limit exceeded for ${result.connectionId}`;
        break;
    }

    this.logFn({
      timestamp: new Date().toISOString(),
      messageId: envelope?.id ?? '',
      messageType: envelope?.type ?? '',
      senderConnectionId,
      senderType: envelope?.sender.type ?? 'unknown',
      recipientConnectionId: result.status === 'routed' ? result.recipientId : '',
      status: result.status,
      detail,
    });
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class RouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouterError';
  }
}
