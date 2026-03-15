// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

import { StyleSheet, Text, View } from 'react-native';
import type { DisplayMessage } from '../lib/stores/messages';

interface MessageBubbleProps {
  message: DisplayMessage;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isOutgoing = message.direction === 'outgoing';
  const isDenial = message.type === 'denial';
  const isError = message.type === 'error';
  const isStatus = message.type === 'status';

  return (
    <View style={[styles.container, isOutgoing ? styles.outgoing : styles.incoming]}>
      <View
        style={[
          styles.bubble,
          isOutgoing ? styles.bubbleOutgoing : styles.bubbleIncoming,
          isDenial && styles.bubbleDenial,
          isError && styles.bubbleError,
          isStatus && styles.bubbleStatus,
        ]}
      >
        <View style={styles.header}>
          <Text style={[styles.sender, isOutgoing && styles.senderOutgoing]}>{message.senderName}</Text>
          <Text style={styles.time}>{formatTime(message.timestamp)}</Text>
        </View>
        {isDenial && <Text style={styles.typeLabel}>SAFETY DENIAL</Text>}
        {isError && <Text style={styles.typeLabelError}>ERROR</Text>}
        <Text style={[styles.content, isOutgoing && styles.contentOutgoing]}>{message.content}</Text>
        {message.type === 'result' && message.payload && typeof message.payload === 'object' && (
          <View style={styles.meta}>
            {(message.payload as Record<string, unknown>).actionsTaken &&
              Array.isArray((message.payload as Record<string, unknown>).actionsTaken) && (
                <Text style={styles.metaText}>
                  Actions: {((message.payload as Record<string, unknown>).actionsTaken as string[]).length}
                </Text>
              )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 3,
  },
  incoming: {
    alignItems: 'flex-start',
  },
  outgoing: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleIncoming: {
    backgroundColor: '#313244',
  },
  bubbleOutgoing: {
    backgroundColor: '#45475a',
  },
  bubbleDenial: {
    borderLeftWidth: 3,
    borderLeftColor: '#f38ba8',
  },
  bubbleError: {
    borderLeftWidth: 3,
    borderLeftColor: '#ef4444',
  },
  bubbleStatus: {
    backgroundColor: '#1e1e2e',
    borderWidth: 1,
    borderColor: '#313244',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
    gap: 12,
  },
  sender: {
    color: '#89b4fa',
    fontSize: 12,
    fontWeight: '600',
  },
  senderOutgoing: {
    color: '#a6e3a1',
  },
  time: {
    color: '#6c7086',
    fontSize: 11,
  },
  typeLabel: {
    color: '#f38ba8',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
  },
  typeLabelError: {
    color: '#ef4444',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
  },
  content: {
    color: '#cdd6f4',
    fontSize: 14,
    lineHeight: 20,
  },
  contentOutgoing: {
    color: '#cdd6f4',
  },
  meta: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#45475a',
  },
  metaText: {
    color: '#6c7086',
    fontSize: 11,
  },
});
