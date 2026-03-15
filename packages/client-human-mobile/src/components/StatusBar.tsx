// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

import { StyleSheet, Text, View } from 'react-native';
import type { HumanClientState } from '../lib/services/connection';

interface StatusBarProps {
  status: HumanClientState;
  peerStatus: string;
  reconnectAttempt: number;
}

function getStatusColor(status: HumanClientState): string {
  switch (status) {
    case 'authenticated':
      return '#22c55e';
    case 'connected':
    case 'connecting':
    case 'reconnecting':
      return '#eab308';
    case 'closing':
    case 'disconnected':
      return '#ef4444';
    default:
      return '#6b7280';
  }
}

function getStatusLabel(status: HumanClientState, reconnectAttempt: number): string {
  switch (status) {
    case 'authenticated':
      return 'Connected';
    case 'connected':
      return 'Authenticating...';
    case 'connecting':
      return 'Connecting...';
    case 'reconnecting':
      return `Reconnecting (attempt ${reconnectAttempt})...`;
    case 'closing':
      return 'Disconnecting...';
    case 'disconnected':
      return 'Disconnected';
    default:
      return status;
  }
}

export function StatusBar({ status, peerStatus, reconnectAttempt }: StatusBarProps) {
  const color = getStatusColor(status);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={styles.statusText}>{getStatusLabel(status, reconnectAttempt)}</Text>
      </View>
      {status === 'authenticated' && (
        <Text style={styles.peerText}>AI: {peerStatus === 'active' ? 'connected' : peerStatus}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1e1e2e',
    borderBottomWidth: 1,
    borderBottomColor: '#313244',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    color: '#cdd6f4',
    fontSize: 13,
  },
  peerText: {
    color: '#6c7086',
    fontSize: 12,
  },
});
