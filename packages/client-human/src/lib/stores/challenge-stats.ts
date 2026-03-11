// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Challenge statistics derived store.
 * Computes aggregate stats from the challenges store history:
 * totals, time-bucketed counts, layer breakdown, decision breakdown,
 * most common trigger factors, and trend analysis.
 */

import type { Readable, Writable } from '../store.js';
import { derived } from '../store.js';
import type { ActiveChallenge, ChallengesStoreState } from './challenges.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FactorFrequency {
  readonly name: string;
  readonly count: number;
  readonly avgWeight: number;
}

export interface ChallengeStats {
  readonly totalChallenges: number;
  readonly resolvedCount: number;
  readonly pendingCount: number;
  readonly thisWeek: number;
  readonly thisMonth: number;
  readonly byLayer: Record<number, number>;
  readonly byDecision: Record<string, number>;
  readonly topTriggerFactors: readonly FactorFrequency[];
  readonly averageFactorsPerChallenge: number;
  readonly recentTrend: 'increasing' | 'stable' | 'decreasing';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isWithinDays(timestamp: string, days: number, now: Date): boolean {
  const t = new Date(timestamp).getTime();
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return t >= cutoff;
}

function computeTrend(history: readonly ActiveChallenge[], now: Date): 'increasing' | 'stable' | 'decreasing' {
  // Compare challenges in last 7 days vs previous 7 days
  const oneWeekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const twoWeeksAgo = now.getTime() - 14 * 24 * 60 * 60 * 1000;

  let thisWeek = 0;
  let lastWeek = 0;

  for (const c of history) {
    const t = new Date(c.receivedAt).getTime();
    if (t >= oneWeekAgo) thisWeek++;
    else if (t >= twoWeeksAgo) lastWeek++;
  }

  if (thisWeek > lastWeek + 1) return 'increasing';
  if (thisWeek < lastWeek - 1) return 'decreasing';
  return 'stable';
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export function createChallengeStatsStore(challengeStore: Writable<ChallengesStoreState>): Readable<ChallengeStats> {
  return derived([challengeStore], ([state]) => {
    const history = state.history;
    const now = new Date();

    // Time-bucketed counts
    let thisWeek = 0;
    let thisMonth = 0;
    for (const c of history) {
      if (isWithinDays(c.receivedAt, 7, now)) thisWeek++;
      if (isWithinDays(c.receivedAt, 30, now)) thisMonth++;
    }

    // Layer breakdown
    const byLayer: Record<number, number> = {};
    for (const c of history) {
      const layer = c.payload?.layer ?? 0;
      byLayer[layer] = (byLayer[layer] ?? 0) + 1;
    }

    // Decision breakdown
    const byDecision: Record<string, number> = {};
    let resolvedCount = 0;
    for (const c of history) {
      if (c.decision) {
        byDecision[c.decision] = (byDecision[c.decision] ?? 0) + 1;
        resolvedCount++;
      }
    }

    // Factor frequency analysis
    const factorMap = new Map<string, { count: number; totalWeight: number }>();
    let totalFactors = 0;
    for (const c of history) {
      const factors = c.payload?.factors ?? [];
      totalFactors += factors.length;
      for (const f of factors) {
        const existing = factorMap.get(f.name);
        if (existing) {
          existing.count++;
          existing.totalWeight += f.weight;
        } else {
          factorMap.set(f.name, { count: 1, totalWeight: f.weight });
        }
      }
    }

    const topTriggerFactors: FactorFrequency[] = Array.from(factorMap.entries())
      .map(([name, { count, totalWeight }]) => ({
        name,
        count,
        avgWeight: count > 0 ? totalWeight / count : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalChallenges: history.length,
      resolvedCount,
      pendingCount: state.active ? 1 : 0,
      thisWeek,
      thisMonth,
      byLayer,
      byDecision,
      topTriggerFactors,
      averageFactorsPerChallenge: history.length > 0 ? totalFactors / history.length : 0,
      recentTrend: computeTrend(history, now),
    };
  });
}
