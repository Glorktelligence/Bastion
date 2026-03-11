import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { PendingFileOffer } from '../lib/stores/file-transfers';

interface FileOfferCardProps {
  offer: PendingFileOffer;
  queueLength: number;
  onAccept?: () => void;
  onReject?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function FileOfferCard({ offer, queueLength, onAccept, onReject }: FileOfferCardProps) {
  const isIncoming = offer.direction === 'ai_to_human';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>{isIncoming ? 'Incoming File' : 'Outgoing File'}</Text>
        {queueLength > 0 && <Text style={styles.queueBadge}>+{queueLength} queued</Text>}
      </View>

      <View style={styles.info}>
        <View style={styles.row}>
          <Text style={styles.label}>File</Text>
          <Text style={styles.value}>{offer.filename}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Size</Text>
          <Text style={styles.value}>{formatBytes(offer.sizeBytes)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Type</Text>
          <Text style={styles.value}>{offer.mimeType}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>From</Text>
          <Text style={styles.value}>{offer.senderName}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Purpose</Text>
          <Text style={styles.value}>{offer.purpose}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Hash</Text>
          <Text style={styles.hash}>{offer.hash.slice(0, 16)}...</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.rejectButton} onPress={onReject}>
          <Text style={styles.rejectText}>Reject</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.acceptButton} onPress={onAccept}>
          <Text style={styles.acceptText}>Accept</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1e1e2e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#89b4fa',
    margin: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(137,180,250,0.1)',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerText: {
    color: '#89b4fa',
    fontSize: 14,
    fontWeight: '700',
  },
  queueBadge: {
    color: '#6c7086',
    fontSize: 12,
    backgroundColor: '#313244',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  info: {
    padding: 16,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  label: {
    color: '#6c7086',
    fontSize: 13,
    width: 60,
  },
  value: {
    color: '#cdd6f4',
    fontSize: 13,
    flex: 1,
  },
  hash: {
    color: '#a6adc8',
    fontSize: 12,
    fontFamily: 'monospace',
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#313244',
  },
  rejectButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#313244',
  },
  rejectText: {
    color: '#f38ba8',
    fontWeight: '600',
  },
  acceptButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#a6e3a1',
  },
  acceptText: {
    color: '#1e1e2e',
    fontWeight: '700',
  },
});
