// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Challenge screen — displays active safety challenge for review
 * with approve/modify/cancel actions, or shows challenge history.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { ChallengeCard } from '../components/ChallengeCard';
import { useStore } from '../hooks/useStore';
import type { BastionHumanClient } from '../lib/services/connection';
import { createChallengesStore } from '../lib/stores/challenges';
import type { ActiveChallenge } from '../lib/stores/challenges';

interface ChallengeScreenProps {
  client: BastionHumanClient;
}

export function ChallengeScreen({ client }: ChallengeScreenProps) {
  const challengesApi = useMemo(() => createChallengesStore(), []);
  const state = useStore(challengesApi.store);

  // Listen for incoming challenge messages from the client
  useEffect(() => {
    const handler = (data: string) => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'challenge' && parsed.payload) {
          challengesApi.receiveChallenge(parsed.id ?? crypto.randomUUID(), parsed.payload.taskId ?? '', parsed.payload);
        }
      } catch {
        // Ignore non-JSON messages
      }
    };

    client.on('message', handler);
    return () => client.off('message', handler);
  }, [client, challengesApi]);

  const handleApprove = useCallback(() => {
    const resolved = challengesApi.resolve('approve');
    if (resolved) {
      client.send(
        JSON.stringify({
          type: 'confirmation',
          payload: {
            challengeMessageId: resolved.messageId,
            decision: 'approve',
          },
        }),
      );
    }
  }, [challengesApi, client]);

  const handleModify = useCallback(() => {
    const resolved = challengesApi.resolve('modify');
    if (resolved) {
      client.send(
        JSON.stringify({
          type: 'confirmation',
          payload: {
            challengeMessageId: resolved.messageId,
            decision: 'modify',
          },
        }),
      );
    }
  }, [challengesApi, client]);

  const handleCancel = useCallback(() => {
    const resolved = challengesApi.resolve('cancel');
    if (resolved) {
      client.send(
        JSON.stringify({
          type: 'confirmation',
          payload: {
            challengeMessageId: resolved.messageId,
            decision: 'cancel',
          },
        }),
      );
    }
  }, [challengesApi, client]);

  const renderHistoryItem = useCallback(
    ({ item }: { item: ActiveChallenge }) => (
      <View style={styles.historyItem}>
        <View style={styles.historyHeader}>
          <Text style={styles.historyLayer}>Layer {item.payload.layer}</Text>
          <Text
            style={[
              styles.historyDecision,
              item.decision === 'approve' && styles.decisionApprove,
              item.decision === 'modify' && styles.decisionModify,
              item.decision === 'cancel' && styles.decisionCancel,
            ]}
          >
            {item.decision ?? 'pending'}
          </Text>
        </View>
        <Text style={styles.historyReason} numberOfLines={2}>
          {item.payload.reason}
        </Text>
        <Text style={styles.historyTime}>{new Date(item.receivedAt).toLocaleString()}</Text>
      </View>
    ),
    [],
  );

  if (state.active) {
    return (
      <ChallengeCard
        challenge={state.active}
        onApprove={handleApprove}
        onModify={handleModify}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Challenge History</Text>
      {state.history.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No challenges yet</Text>
        </View>
      ) : (
        <FlatList
          data={state.history as ActiveChallenge[]}
          renderItem={renderHistoryItem}
          keyExtractor={(item) => item.messageId}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#181825',
  },
  title: {
    color: '#cdd6f4',
    fontSize: 18,
    fontWeight: '700',
    padding: 16,
    paddingBottom: 8,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#6c7086',
    fontSize: 15,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  historyItem: {
    backgroundColor: '#1e1e2e',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#f9e2af',
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  historyLayer: {
    color: '#f9e2af',
    fontSize: 13,
    fontWeight: '600',
  },
  historyDecision: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    color: '#6c7086',
  },
  decisionApprove: {
    color: '#a6e3a1',
  },
  decisionModify: {
    color: '#89b4fa',
  },
  decisionCancel: {
    color: '#f38ba8',
  },
  historyReason: {
    color: '#cdd6f4',
    fontSize: 13,
    lineHeight: 18,
  },
  historyTime: {
    color: '#6c7086',
    fontSize: 11,
    marginTop: 6,
  },
});
