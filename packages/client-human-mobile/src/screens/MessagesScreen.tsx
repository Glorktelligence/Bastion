// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Messages screen — main conversation view with connection status,
 * message list, and input bar.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { InputBar } from '../components/InputBar';
import { MessageBubble } from '../components/MessageBubble';
import { StatusBar } from '../components/StatusBar';
import { useStore } from '../hooks/useStore';
import type { BastionHumanClient } from '../lib/services/connection';
import { createConnectionStore } from '../lib/stores/connection';
import { createMessagesStore } from '../lib/stores/messages';
import type { DisplayMessage } from '../lib/stores/messages';

interface MessagesScreenProps {
  client: BastionHumanClient;
}

export function MessagesScreen({ client }: MessagesScreenProps) {
  const connectionStore = useMemo(() => createConnectionStore(client), [client]);
  const messagesApi = useMemo(() => createMessagesStore(), []);
  const flatListRef = useRef<FlatList<DisplayMessage>>(null);

  const connState = useStore(connectionStore);
  const msgState = useStore(messagesApi.store);

  // Auto-scroll on new messages
  useEffect(() => {
    if (msgState.messages.length > 0) {
      flatListRef.current?.scrollToEnd({ animated: true });
    }
  }, [msgState.messages.length]);

  // Listen for incoming messages from the client
  useEffect(() => {
    const handler = (data: string) => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.type && parsed.payload) {
          messagesApi.addIncoming(
            parsed.type,
            parsed.payload,
            parsed.sender ?? { type: 'system', displayName: 'Relay' },
            parsed.id ?? crypto.randomUUID(),
            parsed.timestamp ?? new Date().toISOString(),
          );
        }
      } catch {
        // Ignore non-JSON messages
      }
    };

    client.on('message', handler);
    return () => client.off('message', handler);
  }, [client, messagesApi]);

  const handleSendConversation = useCallback(
    (content: string) => {
      const msg: DisplayMessage = {
        id: crypto.randomUUID(),
        type: 'conversation',
        timestamp: new Date().toISOString(),
        senderType: 'human',
        senderName: 'You',
        content,
        payload: { content },
        direction: 'outgoing',
      };
      messagesApi.addMessage(msg);
      client.send(JSON.stringify({ type: 'conversation', payload: { content } }));
    },
    [client, messagesApi],
  );

  const renderMessage = useCallback(({ item }: { item: DisplayMessage }) => <MessageBubble message={item} />, []);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar
        status={connState.status}
        peerStatus={connState.peerStatus}
        reconnectAttempt={connState.reconnectAttempt}
      />
      <FlatList
        ref={flatListRef}
        style={styles.list}
        data={msgState.messages as DisplayMessage[]}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
      />
      <InputBar disabled={connState.status !== 'authenticated'} onSendConversation={handleSendConversation} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#181825',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 8,
  },
});
