// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Input bar for sending messages. Supports chat mode (text) and task mode (structured).
 */

import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

type InputMode = 'chat' | 'task';

export interface TaskFields {
  action: string;
  target: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  parameters: Record<string, string>;
  constraints: string[];
}

interface InputBarProps {
  disabled?: boolean;
  providerAvailable?: boolean;
  onSendConversation?: (content: string) => void;
  onSendTask?: (task: TaskFields) => void;
}

export function InputBar({
  disabled = false,
  providerAvailable = true,
  onSendConversation,
  onSendTask,
}: InputBarProps) {
  const [mode, setMode] = useState<InputMode>('chat');
  const [text, setText] = useState('');
  const [action, setAction] = useState('');
  const [target, setTarget] = useState('');
  const [priority, setPriority] = useState<TaskFields['priority']>('normal');

  const handleSendChat = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSendConversation?.(trimmed);
    setText('');
  }, [text, disabled, onSendConversation]);

  const handleSendTask = useCallback(() => {
    if (!action.trim() || !target.trim() || disabled || !providerAvailable) return;
    onSendTask?.({
      action: action.trim(),
      target: target.trim(),
      priority,
      parameters: {},
      constraints: [],
    });
    setAction('');
    setTarget('');
    setPriority('normal');
  }, [action, target, priority, disabled, providerAvailable, onSendTask]);

  return (
    <View style={styles.container}>
      <View style={styles.modeToggle}>
        <TouchableOpacity
          style={[styles.modeButton, mode === 'chat' && styles.modeActive]}
          onPress={() => setMode('chat')}
        >
          <Text style={[styles.modeText, mode === 'chat' && styles.modeTextActive]}>Chat</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeButton, mode === 'task' && styles.modeActive]}
          onPress={() => setMode('task')}
        >
          <Text style={[styles.modeText, mode === 'task' && styles.modeTextActive]}>Task</Text>
        </TouchableOpacity>
      </View>

      {mode === 'chat' ? (
        <View style={styles.chatRow}>
          <TextInput
            style={styles.chatInput}
            value={text}
            onChangeText={setText}
            placeholder="Type a message..."
            placeholderTextColor="#6c7086"
            multiline
            editable={!disabled}
            onSubmitEditing={handleSendChat}
            returnKeyType="send"
          />
          <TouchableOpacity
            style={[styles.sendButton, (!text.trim() || disabled) && styles.sendDisabled]}
            onPress={handleSendChat}
            disabled={!text.trim() || disabled}
          >
            <Text style={styles.sendText}>Send</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={styles.taskForm}>
          {!providerAvailable && <Text style={styles.unavailable}>AI provider unavailable</Text>}
          <TextInput
            style={styles.taskInput}
            value={action}
            onChangeText={setAction}
            placeholder="Action"
            placeholderTextColor="#6c7086"
            editable={!disabled && providerAvailable}
          />
          <TextInput
            style={styles.taskInput}
            value={target}
            onChangeText={setTarget}
            placeholder="Target"
            placeholderTextColor="#6c7086"
            editable={!disabled && providerAvailable}
          />
          <View style={styles.priorityRow}>
            {(['low', 'normal', 'high', 'critical'] as const).map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.priorityButton, priority === p && styles.priorityActive]}
                onPress={() => setPriority(p)}
              >
                <Text style={[styles.priorityText, priority === p && styles.priorityTextActive]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[
              styles.sendButton,
              styles.taskSendButton,
              (!action.trim() || !target.trim() || disabled || !providerAvailable) && styles.sendDisabled,
            ]}
            onPress={handleSendTask}
            disabled={!action.trim() || !target.trim() || disabled || !providerAvailable}
          >
            <Text style={styles.sendText}>Submit Task</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1e1e2e',
    borderTopWidth: 1,
    borderTopColor: '#313244',
    padding: 8,
  },
  modeToggle: {
    flexDirection: 'row',
    marginBottom: 8,
    gap: 4,
  },
  modeButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#313244',
  },
  modeActive: {
    backgroundColor: '#45475a',
  },
  modeText: {
    color: '#6c7086',
    fontSize: 13,
    fontWeight: '500',
  },
  modeTextActive: {
    color: '#cdd6f4',
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  chatInput: {
    flex: 1,
    backgroundColor: '#313244',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#cdd6f4',
    fontSize: 14,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: '#89b4fa',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendDisabled: {
    opacity: 0.4,
  },
  sendText: {
    color: '#1e1e2e',
    fontWeight: '600',
    fontSize: 14,
  },
  taskForm: {
    maxHeight: 200,
  },
  taskInput: {
    backgroundColor: '#313244',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#cdd6f4',
    fontSize: 14,
    marginBottom: 8,
  },
  priorityRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  priorityButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#313244',
  },
  priorityActive: {
    backgroundColor: '#89b4fa',
  },
  priorityText: {
    color: '#6c7086',
    fontSize: 12,
  },
  priorityTextActive: {
    color: '#1e1e2e',
    fontWeight: '600',
  },
  taskSendButton: {
    alignSelf: 'flex-end',
  },
  unavailable: {
    color: '#f38ba8',
    fontSize: 12,
    marginBottom: 8,
  },
});
