// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Admin API client for the relay admin server.
 *
 * Talks to the admin HTTPS server (default port 9444) using
 * Basic auth + TOTP headers. Designed for browser fetch API.
 */

import type { ApiResult, CapabilityMatrix } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Credentials for admin API authentication. */
export interface AdminCredentials {
  readonly username: string;
  readonly password: string;
  readonly totpCode: string;
}

/** Configuration for the admin API client. */
export interface AdminClientConfig {
  /** Base URL of the admin server (e.g. "https://127.0.0.1:9444"). */
  readonly baseUrl: string;
  /** Authentication credentials. */
  readonly credentials: AdminCredentials;
  /** Optional custom fetch implementation (for testing). */
  readonly fetchImpl?: typeof fetch;
}

// ---------------------------------------------------------------------------
// AdminApiClient
// ---------------------------------------------------------------------------

/**
 * HTTP client for the relay admin API.
 *
 * All methods return ApiResult with typed data. Errors are caught
 * and returned as `{ ok: false, error: ... }` rather than thrown.
 */
export class AdminApiClient {
  private readonly baseUrl: string;
  private readonly credentials: AdminCredentials;
  private readonly fetchFn: typeof fetch;

  constructor(config: AdminClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.credentials = config.credentials;
    this.fetchFn = config.fetchImpl ?? globalThis.fetch;
  }

  /** Update credentials (e.g. after TOTP refresh). */
  private authHeaders(): Record<string, string> {
    const basic = btoa(`${this.credentials.username}:${this.credentials.password}`);
    return {
      Authorization: `Basic ${basic}`,
      'X-TOTP': this.credentials.totpCode,
      'Content-Type': 'application/json',
    };
  }

  private async request<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: this.authHeaders(),
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = (await res.json()) as T;
      if (res.ok) {
        return { ok: true, status: res.status, data };
      }
      return {
        ok: false,
        status: res.status,
        data,
        error: ((data as Record<string, unknown>).error as string) ?? 'Request failed',
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        data: {} as T,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  /** Health check. */
  async getHealth(): Promise<ApiResult> {
    return this.request('GET', '/api/health');
  }

  // -------------------------------------------------------------------------
  // Provider CRUD
  // -------------------------------------------------------------------------

  /** List all providers. */
  async listProviders(includeInactive = true): Promise<ApiResult> {
    const qs = includeInactive ? '' : '?includeInactive=false';
    return this.request('GET', `/api/providers${qs}`);
  }

  /** Get a single provider by ID. */
  async getProvider(id: string): Promise<ApiResult> {
    return this.request('GET', `/api/providers/${encodeURIComponent(id)}`);
  }

  /** Approve a new provider. */
  async approveProvider(
    id: string,
    name: string,
    capabilities?: readonly string[],
    capabilityMatrix?: CapabilityMatrix,
  ): Promise<ApiResult> {
    return this.request('POST', '/api/providers', {
      id,
      name,
      capabilities,
      capabilityMatrix,
    });
  }

  /** Revoke (soft-delete) a provider. */
  async revokeProvider(id: string): Promise<ApiResult> {
    return this.request('PUT', `/api/providers/${encodeURIComponent(id)}/revoke`);
  }

  /** Reactivate a revoked provider. */
  async activateProvider(id: string): Promise<ApiResult> {
    return this.request('PUT', `/api/providers/${encodeURIComponent(id)}/activate`);
  }

  // -------------------------------------------------------------------------
  // Capability Matrix
  // -------------------------------------------------------------------------

  /** Get capability matrix for a provider. */
  async getCapabilities(providerId: string): Promise<ApiResult> {
    return this.request('GET', `/api/providers/${encodeURIComponent(providerId)}/capabilities`);
  }

  /** Set capability matrix for a provider. */
  async setCapabilities(providerId: string, matrix: CapabilityMatrix): Promise<ApiResult> {
    return this.request('PUT', `/api/providers/${encodeURIComponent(providerId)}/capabilities`, {
      matrix,
    });
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  /** Query audit events with optional filters. */
  async queryAudit(filters?: {
    startTime?: string;
    endTime?: string;
    eventType?: string;
    sessionId?: string;
    limit?: number;
    offset?: number;
  }): Promise<ApiResult> {
    const params = new URLSearchParams();
    if (filters?.startTime) params.set('startTime', filters.startTime);
    if (filters?.endTime) params.set('endTime', filters.endTime);
    if (filters?.eventType) params.set('eventType', filters.eventType);
    if (filters?.sessionId) params.set('sessionId', filters.sessionId);
    if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return this.request('GET', `/api/audit${qs ? `?${qs}` : ''}`);
  }

  /** Get chain integrity status. */
  async getChainIntegrity(): Promise<ApiResult> {
    return this.request('GET', '/api/audit/integrity');
  }

  // -------------------------------------------------------------------------
  // Live Status
  // -------------------------------------------------------------------------

  /** Get live relay status (connections, sessions, throughput, quarantine). */
  async getStatus(): Promise<ApiResult> {
    return this.request('GET', '/api/status');
  }

  /** Get all active connections with metadata. */
  async getConnections(): Promise<ApiResult> {
    return this.request('GET', '/api/connections');
  }
}
