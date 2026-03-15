// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Root application component with tab navigation.
 * Three main screens: Messages, Challenges, File Transfers.
 */

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { BastionHumanClient } from './lib/services/connection';
import { ChallengeScreen } from './screens/ChallengeScreen';
import { FileTransferScreen } from './screens/FileTransferScreen';
import { MessagesScreen } from './screens/MessagesScreen';

type RootStackParamList = {
  Messages: undefined;
  Challenges: undefined;
  FileTransfers: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const RELAY_URL = 'wss://localhost:3000';

export default function App() {
  const client = useMemo(
    () =>
      new BastionHumanClient({
        relayUrl: RELAY_URL,
        identity: { id: 'mobile-user', type: 'human', displayName: 'Mobile User' },
        maxReconnectAttempts: 10,
      }),
    [],
  );

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#1e1e2e' },
          headerTintColor: '#cdd6f4',
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: '#181825' },
        }}
      >
        <Stack.Screen name="Messages">{() => <MessagesScreen client={client} />}</Stack.Screen>
        <Stack.Screen name="Challenges">{() => <ChallengeScreen client={client} />}</Stack.Screen>
        <Stack.Screen name="FileTransfers" options={{ title: 'File Transfers' }}>
          {() => <FileTransferScreen client={client} />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
