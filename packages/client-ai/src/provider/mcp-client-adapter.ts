// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * McpClientAdapter — connects to MCP servers via WebSocket.
 *
 * Speaks JSON-RPC 2.0 over WebSocket with X-API-Key header auth.
 * One adapter instance per configured MCP provider.
 *
 * Protocol details (from MCP wrapper analysis):
 * - Wire format: JSON-RPC 2.0 (JSON.stringify over WebSocket text frames)
 * - Auth: X-API-Key header in WebSocket handshake
 * - Subprotocol: "mcp" (for newer SDK versions)
 * - Methods: tools/list (ListTools), tools/call (CallTool)
 * - Reconnection: exponential backoff 1s→512s, max 10 attempts
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: Record<string, unknown>;
}

export interface McpCallResult {
  readonly content: readonly { type: string; text?: string }[];
  readonly isError?: boolean;
}

export interface McpClientConfig {
  readonly providerId: string;
  readonly endpoint: string;
  readonly apiKeyEnvVar: string;
  readonly subprotocol?: string;
  readonly timeoutMs?: number;
  readonly maxReconnectAttempts?: number;
  /** Injectable WebSocket class (for testing or Node.js ws module). */
  readonly WebSocketImpl?: unknown;
}

type JsonRpcMessage = {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 30_000;
const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_BACKOFF_MS = 1000;

// ---------------------------------------------------------------------------
// Parameter validation
// ---------------------------------------------------------------------------

const DANGEROUS_PATTERNS = [/\.\./, /\/\//, /^\//, /\\/, /[;|`]/, /&&/];

export function validateParameters(params: Record<string, unknown>): { valid: boolean; reason?: string } {
  const json = JSON.stringify(params);
  if (Buffer.byteLength(json) > 10240) {
    return { valid: false, reason: 'Parameters exceed 10KB limit' };
  }
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(value)) {
          return { valid: false, reason: `Rejected parameter "${key}": matches dangerous pattern ${pattern}` };
        }
      }
    }
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// McpClientAdapter
// ---------------------------------------------------------------------------

export class McpClientAdapter {
  private readonly config: McpClientConfig;
  private readonly apiKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ws: any | null = null;
  private nextId = 1;
  private pendingRequests: Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  > = new Map();
  private reconnectAttempt = 0;
  private intentionalClose = false;
  private _connected = false;

  constructor(config: McpClientConfig) {
    this.config = config;
    // Read API key from env var — NEVER log or transmit the value
    this.apiKey = process.env[config.apiKeyEnvVar] ?? '';
    if (!this.apiKey) {
      console.warn(`[!] MCP ${config.providerId}: API key env var ${config.apiKeyEnvVar} not set`);
    }
  }

  get connected(): boolean {
    return this._connected;
  }

  get providerId(): string {
    return this.config.providerId;
  }

  /** Connect to the MCP WebSocket endpoint. */
  async connect(): Promise<void> {
    this.intentionalClose = false;
    return this.doConnect();
  }

  /** Disconnect from the MCP endpoint. */
  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    this._connected = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Disconnected'));
    }
    this.pendingRequests.clear();
  }

  /** List available tools from the MCP server. */
  async listTools(): Promise<readonly McpTool[]> {
    const result = await this.sendRpc('tools/list', {});
    if (result && typeof result === 'object' && 'tools' in result) {
      return (result as { tools: McpTool[] }).tools;
    }
    return [];
  }

  /** Call a tool on the MCP server. */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const result = await this.sendRpc('tools/call', { name, arguments: args });
    if (result && typeof result === 'object' && 'content' in result) {
      return result as McpCallResult;
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const WsClass = (this.config.WebSocketImpl ?? (globalThis as Record<string, unknown>).WebSocket) as new (
          url: string,
          protocols?: string | string[],
          opts?: Record<string, unknown>,
        ) => {
          send: (data: string) => void;
          close: () => void;
          readyState: number;
          onopen: (() => void) | null;
          onmessage: ((ev: { data: string }) => void) | null;
          onerror: ((ev: unknown) => void) | null;
          onclose: ((ev: { code: number }) => void) | null;
        };

        const protocols = this.config.subprotocol ?? 'mcp';
        this.ws = new WsClass(this.config.endpoint, protocols, {
          headers: { 'X-API-Key': this.apiKey },
          rejectUnauthorized: false,
        });

        this.ws.onopen = () => {
          this._connected = true;
          this.reconnectAttempt = 0;
          console.log(`[✓] MCP ${this.config.providerId}: connected to ${this.config.endpoint}`);
          resolve();
        };

        this.ws.onmessage = (ev: { data: string }) => {
          this.handleMessage(String(ev.data));
        };

        this.ws.onerror = () => {
          if (!this._connected) reject(new Error(`MCP ${this.config.providerId}: connection failed`));
        };

        this.ws.onclose = () => {
          this._connected = false;
          if (!this.intentionalClose) {
            this.scheduleReconnect();
          }
        };
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private handleMessage(data: string): void {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (msg.id !== undefined) {
      const pending = this.pendingRequests.get(Number(msg.id));
      if (pending) {
        this.pendingRequests.delete(Number(msg.id));
        clearTimeout(pending.timer);
        if (msg.error) {
          pending.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
        } else {
          pending.resolve(msg.result);
        }
      }
    }
  }

  private sendRpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this._connected) {
        reject(new Error(`MCP ${this.config.providerId}: not connected`));
        return;
      }

      const id = this.nextId++;
      const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP ${this.config.providerId}: request timeout (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      const msg: JsonRpcMessage = { jsonrpc: '2.0', id, method, params };
      this.ws.send(JSON.stringify(msg));
    });
  }

  private scheduleReconnect(): void {
    const max = this.config.maxReconnectAttempts ?? MAX_RECONNECT_ATTEMPTS;
    if (this.reconnectAttempt >= max) {
      console.error(`[!] MCP ${this.config.providerId}: max reconnect attempts reached`);
      return;
    }
    this.reconnectAttempt++;
    const delay = Math.min(INITIAL_BACKOFF_MS * 2 ** (this.reconnectAttempt - 1), 512_000);
    console.log(`[~] MCP ${this.config.providerId}: reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    setTimeout(() => {
      this.doConnect().catch(() => {});
    }, delay);
  }
}
