// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Usage tracker — records all API token usage with SQLite persistence.
 *
 * Captures every Anthropic API call: adapter, role, purpose, token counts,
 * and computed cost. Provides summaries by time period, adapter, purpose,
 * and conversation for the Usage dashboard and BudgetGuard integration.
 */

import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly adapterId: string;
  readonly adapterRole: string;
  readonly purpose: string;
  readonly conversationId: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
}

export interface UsageSummary {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
}

export interface DailyUsage {
  readonly date: string;
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
}

export interface AdapterUsageSummary {
  readonly adapterId: string;
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
}

export interface UsageTrackerConfig {
  readonly path?: string;
}

// ---------------------------------------------------------------------------
// UsageTracker
// ---------------------------------------------------------------------------

const EMPTY_SUMMARY: UsageSummary = { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };

export class UsageTracker {
  private readonly db: DatabaseSync;

  constructor(config: UsageTrackerConfig = {}) {
    const dbPath = config.path ?? '/var/lib/bastion/usage.db';
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(`
			CREATE TABLE IF NOT EXISTS usage_records (
				id TEXT PRIMARY KEY,
				timestamp TEXT NOT NULL,
				adapter_id TEXT NOT NULL,
				adapter_role TEXT NOT NULL,
				purpose TEXT NOT NULL,
				conversation_id TEXT,
				input_tokens INTEGER NOT NULL,
				output_tokens INTEGER NOT NULL,
				cost_usd REAL NOT NULL,
				date TEXT NOT NULL,
				month TEXT NOT NULL
			)
		`);
    this.db.exec(`
			CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_records(date);
			CREATE INDEX IF NOT EXISTS idx_usage_month ON usage_records(month);
			CREATE INDEX IF NOT EXISTS idx_usage_adapter ON usage_records(adapter_id);
			CREATE INDEX IF NOT EXISTS idx_usage_conversation ON usage_records(conversation_id);
		`);
  }

  record(record: Omit<UsageRecord, 'id'>): string {
    const id = randomUUID();
    const ts = record.timestamp || new Date().toISOString();
    const date = ts.slice(0, 10); // YYYY-MM-DD
    const month = ts.slice(0, 7); // YYYY-MM

    this.db.exec(`
			INSERT INTO usage_records (id, timestamp, adapter_id, adapter_role, purpose, conversation_id, input_tokens, output_tokens, cost_usd, date, month)
			VALUES ('${id}', '${ts}', '${record.adapterId}', '${record.adapterRole}', '${record.purpose}', ${record.conversationId ? `'${record.conversationId}'` : 'NULL'}, ${record.inputTokens}, ${record.outputTokens}, ${record.costUsd}, '${date}', '${month}')
		`);
    return id;
  }

  getUsageToday(): UsageSummary {
    const today = new Date().toISOString().slice(0, 10);
    return this.querySummary(`date = '${today}'`);
  }

  getUsageThisWeek(): UsageSummary {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return this.querySummary(`date >= '${weekAgo}'`);
  }

  getUsageThisMonth(): UsageSummary {
    const month = new Date().toISOString().slice(0, 7);
    return this.querySummary(`month = '${month}'`);
  }

  getMonthlyTotalCostUsd(): number {
    return this.getUsageThisMonth().costUsd;
  }

  getUsageByAdapter(): AdapterUsageSummary[] {
    const month = new Date().toISOString().slice(0, 7);
    const stmt = this.db.prepare(`
			SELECT adapter_id, COUNT(*) as calls, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, SUM(cost_usd) as cost_usd
			FROM usage_records WHERE month = ?
			GROUP BY adapter_id ORDER BY cost_usd DESC
		`);
    const rows = stmt.all(month) as {
      adapter_id: string;
      calls: number;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
    }[];
    return rows.map((r) => ({
      adapterId: r.adapter_id,
      calls: r.calls,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      costUsd: r.cost_usd,
    }));
  }

  getUsageByConversation(conversationId: string): UsageSummary {
    return this.querySummary(`conversation_id = '${conversationId}'`);
  }

  getUsageByPurpose(): Map<string, UsageSummary> {
    const month = new Date().toISOString().slice(0, 7);
    const stmt = this.db.prepare(`
			SELECT purpose, COUNT(*) as calls, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, SUM(cost_usd) as cost_usd
			FROM usage_records WHERE month = ?
			GROUP BY purpose
		`);
    const rows = stmt.all(month) as {
      purpose: string;
      calls: number;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
    }[];
    const result = new Map<string, UsageSummary>();
    for (const r of rows) {
      result.set(r.purpose, {
        calls: r.calls,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        totalTokens: r.input_tokens + r.output_tokens,
        costUsd: r.cost_usd,
      });
    }
    return result;
  }

  getDailyBreakdown(days: number): DailyUsage[] {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const stmt = this.db.prepare(`
			SELECT date, COUNT(*) as calls, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, SUM(cost_usd) as cost_usd
			FROM usage_records WHERE date >= ?
			GROUP BY date ORDER BY date ASC
		`);
    const rows = stmt.all(cutoff) as {
      date: string;
      calls: number;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
    }[];
    return rows.map((r) => ({
      date: r.date,
      calls: r.calls,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      costUsd: r.cost_usd,
    }));
  }

  get totalRecords(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM usage_records').get() as { cnt: number };
    return row.cnt;
  }

  close(): void {
    this.db.close();
  }

  private querySummary(whereClause: string): UsageSummary {
    const row = this.db
      .prepare(`
			SELECT COUNT(*) as calls, COALESCE(SUM(input_tokens), 0) as input_tokens, COALESCE(SUM(output_tokens), 0) as output_tokens, COALESCE(SUM(cost_usd), 0) as cost_usd
			FROM usage_records WHERE ${whereClause}
		`)
      .get() as { calls: number; input_tokens: number; output_tokens: number; cost_usd: number } | undefined;
    if (!row) return EMPTY_SUMMARY;
    return {
      calls: row.calls,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      totalTokens: row.input_tokens + row.output_tokens,
      costUsd: row.cost_usd,
    };
  }
}
