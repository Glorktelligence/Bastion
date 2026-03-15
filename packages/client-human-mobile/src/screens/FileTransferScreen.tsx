// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * File transfer screen — shows pending offers with accept/reject,
 * active upload progress, and transfer history with custody chain.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { FileOfferCard } from '../components/FileOfferCard';
import { useStore } from '../hooks/useStore';
import type { BastionHumanClient } from '../lib/services/connection';
import { createFileTransferStore } from '../lib/stores/file-transfers';
import type { TransferHistoryEntry } from '../lib/stores/file-transfers';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

interface FileTransferScreenProps {
  client: BastionHumanClient;
}

export function FileTransferScreen({ client }: FileTransferScreenProps) {
  const ftApi = useMemo(() => createFileTransferStore(), []);
  const state = useStore(ftApi.store);

  // Listen for incoming file offer and manifest messages from the client
  useEffect(() => {
    const handler = (data: string) => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'file_offer' && parsed.payload) {
          ftApi.receiveOffer(parsed.id ?? crypto.randomUUID(), parsed.payload, parsed.sender?.displayName ?? 'Unknown');
        } else if (parsed.type === 'file_manifest' && parsed.payload) {
          ftApi.receiveManifest(
            parsed.id ?? crypto.randomUUID(),
            parsed.payload,
            parsed.sender?.displayName ?? 'Unknown',
          );
        }
      } catch {
        // Ignore non-JSON messages
      }
    };

    client.on('message', handler);
    return () => client.off('message', handler);
  }, [client, ftApi]);

  const handleAccept = useCallback(() => {
    ftApi.acceptOffer();
  }, [ftApi]);

  const handleReject = useCallback(() => {
    ftApi.rejectOffer();
  }, [ftApi]);

  const renderHistoryItem = useCallback(
    ({ item }: { item: TransferHistoryEntry }) => (
      <View style={styles.historyItem}>
        <View style={styles.historyHeader}>
          <Text style={styles.filename} numberOfLines={1}>
            {item.filename}
          </Text>
          <Text
            style={[
              styles.stateBadge,
              item.state === 'delivered' && styles.stateDelivered,
              item.state === 'rejected' && styles.stateRejected,
              item.state === 'hash_mismatch' && styles.stateError,
            ]}
          >
            {item.state}
          </Text>
        </View>
        <View style={styles.historyMeta}>
          <Text style={styles.metaText}>{item.direction === 'ai_to_human' ? 'From AI' : 'To AI'}</Text>
          <Text style={styles.metaText}>{formatBytes(item.sizeBytes)}</Text>
          <Text style={styles.metaText}>{item.mimeType}</Text>
        </View>
        {item.custodyEvents.length > 0 && (
          <View style={styles.custody}>
            <Text style={styles.custodyLabel}>Custody Chain</Text>
            {item.custodyEvents.map((ev, i) => (
              <View key={i} style={styles.custodyEvent}>
                <View style={styles.custodyDot} />
                <View style={styles.custodyContent}>
                  <Text style={styles.custodyEventName}>{ev.event}</Text>
                  <Text style={styles.custodyActor}>{ev.actor}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
        {item.hashVerifications.length > 0 && (
          <View style={styles.hashes}>
            {item.hashVerifications.map((h, i) => (
              <View key={i} style={styles.hashRow}>
                <Text style={[styles.hashStatus, h.verified ? styles.hashOk : styles.hashFail]}>
                  {h.verified ? 'OK' : 'FAIL'}
                </Text>
                <Text style={styles.hashStage}>{h.stage}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    ),
    [],
  );

  return (
    <View style={styles.container}>
      {state.pendingOffer && (
        <FileOfferCard
          offer={state.pendingOffer}
          queueLength={state.offerQueue.length}
          onAccept={handleAccept}
          onReject={handleReject}
        />
      )}

      {state.uploads.length > 0 && (
        <View style={styles.uploadsSection}>
          <Text style={styles.sectionTitle}>Active Uploads</Text>
          {state.uploads.map((u) => (
            <View key={u.transferId} style={styles.uploadItem}>
              <Text style={styles.uploadFilename}>{u.filename}</Text>
              <Text style={styles.uploadPhase}>{u.phase}</Text>
              {u.error && <Text style={styles.uploadError}>{u.error}</Text>}
            </View>
          ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>Transfer History</Text>
      {state.history.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No transfers yet</Text>
        </View>
      ) : (
        <FlatList
          data={state.history as TransferHistoryEntry[]}
          renderItem={renderHistoryItem}
          keyExtractor={(item) => item.transferId}
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
  sectionTitle: {
    color: '#cdd6f4',
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingVertical: 10,
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
  uploadsSection: {
    borderBottomWidth: 1,
    borderBottomColor: '#313244',
  },
  uploadItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  uploadFilename: {
    color: '#cdd6f4',
    fontSize: 13,
    flex: 1,
  },
  uploadPhase: {
    color: '#89b4fa',
    fontSize: 12,
    fontWeight: '500',
  },
  uploadError: {
    color: '#f38ba8',
    fontSize: 12,
  },
  historyItem: {
    backgroundColor: '#1e1e2e',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  filename: {
    color: '#cdd6f4',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    marginRight: 10,
  },
  stateBadge: {
    color: '#6c7086',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    backgroundColor: '#313244',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  stateDelivered: {
    color: '#a6e3a1',
    backgroundColor: 'rgba(166,227,161,0.15)',
  },
  stateRejected: {
    color: '#f38ba8',
    backgroundColor: 'rgba(243,139,168,0.15)',
  },
  stateError: {
    color: '#ef4444',
    backgroundColor: 'rgba(239,68,68,0.15)',
  },
  historyMeta: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  metaText: {
    color: '#6c7086',
    fontSize: 12,
  },
  custody: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#313244',
  },
  custodyLabel: {
    color: '#89b4fa',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  custodyEvent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 4,
    marginBottom: 4,
  },
  custodyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#45475a',
  },
  custodyContent: {
    flexDirection: 'row',
    gap: 8,
    flex: 1,
  },
  custodyEventName: {
    color: '#a6adc8',
    fontSize: 12,
    fontWeight: '500',
  },
  custodyActor: {
    color: '#6c7086',
    fontSize: 12,
  },
  hashes: {
    marginTop: 6,
    gap: 4,
  },
  hashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 4,
  },
  hashStatus: {
    fontSize: 10,
    fontWeight: '700',
    width: 32,
    textAlign: 'center',
  },
  hashOk: {
    color: '#a6e3a1',
  },
  hashFail: {
    color: '#f38ba8',
  },
  hashStage: {
    color: '#6c7086',
    fontSize: 12,
  },
});
