// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * File transfer store for the human client.
 *
 * Manages file airlock state (incoming offers, outbound uploads)
 * and transfer history with chain-of-custody tracking.
 *
 * Task 2.9: Active airlock UI — accept/reject incoming file offers,
 *           track upload progress for outbound files.
 * Task 2.10: Transfer history — complete custody chain per transfer.
 */

import type {
  FileManifestPayload,
  FileOfferPayload,
  FileTransferDirection,
  FileTransferId,
  FileTransferState,
} from '@bastion/protocol';
import type { Writable } from '../store.js';
import { writable } from '../store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A custody event displayed in the transfer history. */
export interface DisplayCustodyEvent {
  readonly event: string;
  readonly timestamp: string;
  readonly actor: string;
  readonly hash?: string;
  readonly detail?: string;
}

/** Hash verification status at a transfer stage. */
export interface HashStatus {
  readonly stage: 'submission' | 'quarantine' | 'delivery';
  readonly verified: boolean;
  readonly hash?: string;
  readonly timestamp: string;
}

/** An incoming file offer/manifest awaiting human review. */
export interface PendingFileOffer {
  readonly transferId: FileTransferId;
  readonly direction: FileTransferDirection;
  readonly messageId: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly hash: string;
  readonly purpose: string;
  readonly senderName: string;
  readonly senderType: 'human' | 'ai' | 'relay';
  readonly receivedAt: string;
  /** Only present on manifests (human→AI). */
  readonly projectContext?: string;
  /** Only present on offers (AI→human). */
  readonly taskId?: string;
}

/** Upload progress for an outbound file. */
export type UploadPhase =
  | 'encrypting'
  | 'uploading'
  | 'quarantined'
  | 'offered'
  | 'accepted'
  | 'delivered'
  | 'rejected'
  | 'failed';

export interface FileUploadProgress {
  readonly transferId: FileTransferId;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly phase: UploadPhase;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly error?: string;
}

/** A completed (or in-progress) transfer with full custody chain. */
export interface TransferHistoryEntry {
  readonly transferId: FileTransferId;
  readonly direction: FileTransferDirection;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly hash: string;
  readonly state: FileTransferState;
  readonly custodyEvents: readonly DisplayCustodyEvent[];
  readonly hashVerifications: readonly HashStatus[];
  readonly startedAt: string;
  readonly completedAt?: string;
}

/** Full file transfer store state. */
export interface FileTransferStoreState {
  /** The currently displayed incoming offer (airlock prompt). */
  readonly pendingOffer: PendingFileOffer | null;
  /** Queue of offers not yet presented. */
  readonly offerQueue: readonly PendingFileOffer[];
  /** Active outbound uploads. */
  readonly uploads: readonly FileUploadProgress[];
  /** Complete transfer history (newest first). */
  readonly history: readonly TransferHistoryEntry[];
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export interface FileTransferStore {
  readonly store: Writable<FileTransferStoreState>;
  /** Receive an incoming file offer from the relay (AI→human direction). */
  receiveOffer(messageId: string, payload: FileOfferPayload, senderName: string): void;
  /** Receive an incoming file manifest from the relay (human→AI direction, echoed back). */
  receiveManifest(messageId: string, payload: FileManifestPayload, senderName: string): void;
  /** Accept the currently pending offer. Returns the offer for building a file_request. */
  acceptOffer(): PendingFileOffer | null;
  /** Reject the currently pending offer. Returns the offer for logging. */
  rejectOffer(): PendingFileOffer | null;
  /** Start tracking an outbound file upload. */
  startUpload(transferId: FileTransferId, filename: string, sizeBytes: number): void;
  /** Update the phase of an outbound upload. */
  updateUploadPhase(transferId: FileTransferId, phase: UploadPhase, error?: string): void;
  /** Add or update a transfer history entry. */
  addHistoryEntry(entry: TransferHistoryEntry): void;
  /** Append a custody event to an existing history entry. */
  appendCustodyEvent(transferId: FileTransferId, event: DisplayCustodyEvent): void;
  /** Append a hash verification to an existing history entry. */
  appendHashVerification(transferId: FileTransferId, status: HashStatus): void;
  /** Update the state of a history entry. */
  updateHistoryState(transferId: FileTransferId, state: FileTransferState, completedAt?: string): void;
  /** Get a specific history entry. */
  getHistoryEntry(transferId: FileTransferId): TransferHistoryEntry | undefined;
  /** Clear all state. */
  clear(): void;
}

export function createFileTransferStore(): FileTransferStore {
  const store = writable<FileTransferStoreState>({
    pendingOffer: null,
    offerQueue: [],
    uploads: [],
    history: [],
  });

  // -------------------------------------------------------------------------
  // Incoming offers (airlock)
  // -------------------------------------------------------------------------

  function enqueueOffer(offer: PendingFileOffer): void {
    store.update((s) => {
      if (s.pendingOffer === null) {
        // No active offer — present immediately
        return { ...s, pendingOffer: offer };
      }
      // Already presenting an offer — queue this one
      return { ...s, offerQueue: [...s.offerQueue, offer] };
    });
  }

  function advanceQueue(): void {
    store.update((s) => {
      if (s.offerQueue.length === 0) {
        return { ...s, pendingOffer: null };
      }
      const next = s.offerQueue[0]!;
      const rest = s.offerQueue.slice(1);
      return { ...s, pendingOffer: next, offerQueue: rest };
    });
  }

  function receiveOffer(messageId: string, payload: FileOfferPayload, senderName: string): void {
    const offer: PendingFileOffer = {
      transferId: payload.transferId,
      direction: 'ai_to_human',
      messageId,
      filename: payload.filename,
      sizeBytes: payload.sizeBytes,
      mimeType: payload.mimeType,
      hash: payload.hash,
      purpose: payload.purpose,
      senderName,
      senderType: 'ai',
      receivedAt: new Date().toISOString(),
      taskId: payload.taskId,
    };

    enqueueOffer(offer);

    // Also add to history
    addHistoryEntry({
      transferId: payload.transferId,
      direction: 'ai_to_human',
      filename: payload.filename,
      sizeBytes: payload.sizeBytes,
      mimeType: payload.mimeType,
      hash: payload.hash,
      state: 'offered',
      custodyEvents: [
        {
          event: 'offered',
          timestamp: new Date().toISOString(),
          actor: senderName,
          detail: `File offer received: "${payload.filename}"`,
        },
      ],
      hashVerifications: [],
      startedAt: new Date().toISOString(),
    });
  }

  function receiveManifest(messageId: string, payload: FileManifestPayload, senderName: string): void {
    const offer: PendingFileOffer = {
      transferId: payload.transferId,
      direction: 'human_to_ai',
      messageId,
      filename: payload.filename,
      sizeBytes: payload.sizeBytes,
      mimeType: payload.mimeType,
      hash: payload.hash,
      purpose: payload.purpose,
      senderName,
      senderType: 'human',
      receivedAt: new Date().toISOString(),
      projectContext: payload.projectContext,
    };

    enqueueOffer(offer);

    addHistoryEntry({
      transferId: payload.transferId,
      direction: 'human_to_ai',
      filename: payload.filename,
      sizeBytes: payload.sizeBytes,
      mimeType: payload.mimeType,
      hash: payload.hash,
      state: 'offered',
      custodyEvents: [
        {
          event: 'manifest_sent',
          timestamp: new Date().toISOString(),
          actor: senderName,
          detail: `File manifest for "${payload.filename}"`,
        },
      ],
      hashVerifications: [],
      startedAt: new Date().toISOString(),
    });
  }

  function acceptOffer(): PendingFileOffer | null {
    const current = store.get();
    const accepted = current.pendingOffer;

    if (accepted) {
      appendCustodyEvent(accepted.transferId, {
        event: 'accepted',
        timestamp: new Date().toISOString(),
        actor: 'human',
        detail: 'Human accepted file transfer',
      });
      updateHistoryState(accepted.transferId, 'accepted');
    }

    advanceQueue();
    return accepted;
  }

  function rejectOffer(): PendingFileOffer | null {
    const current = store.get();
    const rejected = current.pendingOffer;

    if (rejected) {
      appendCustodyEvent(rejected.transferId, {
        event: 'rejected',
        timestamp: new Date().toISOString(),
        actor: 'human',
        detail: 'Human rejected file transfer',
      });
      updateHistoryState(rejected.transferId, 'rejected', new Date().toISOString());
    }

    advanceQueue();
    return rejected;
  }

  // -------------------------------------------------------------------------
  // Outbound uploads
  // -------------------------------------------------------------------------

  function startUpload(transferId: FileTransferId, filename: string, sizeBytes: number): void {
    const now = new Date().toISOString();
    const upload: FileUploadProgress = {
      transferId,
      filename,
      sizeBytes,
      phase: 'encrypting',
      startedAt: now,
      updatedAt: now,
    };

    store.update((s) => ({
      ...s,
      uploads: [...s.uploads, upload],
    }));
  }

  function updateUploadPhase(transferId: FileTransferId, phase: UploadPhase, error?: string): void {
    store.update((s) => ({
      ...s,
      uploads: s.uploads.map((u) =>
        u.transferId === transferId ? { ...u, phase, updatedAt: new Date().toISOString(), error } : u,
      ),
    }));

    // Remove from active uploads when terminal
    if (phase === 'delivered' || phase === 'rejected' || phase === 'failed') {
      store.update((s) => ({
        ...s,
        uploads: s.uploads.filter((u) => u.transferId !== transferId),
      }));
    }
  }

  // -------------------------------------------------------------------------
  // Transfer history
  // -------------------------------------------------------------------------

  function addHistoryEntry(entry: TransferHistoryEntry): void {
    store.update((s) => {
      // Check for existing entry (update if exists)
      const existing = s.history.findIndex((h) => h.transferId === entry.transferId);
      if (existing >= 0) {
        const updated = [...s.history];
        updated[existing] = entry;
        return { ...s, history: updated };
      }
      // Newest first
      return { ...s, history: [entry, ...s.history] };
    });
  }

  function appendCustodyEvent(transferId: FileTransferId, event: DisplayCustodyEvent): void {
    store.update((s) => ({
      ...s,
      history: s.history.map((h) =>
        h.transferId === transferId ? { ...h, custodyEvents: [...h.custodyEvents, event] } : h,
      ),
    }));
  }

  function appendHashVerification(transferId: FileTransferId, status: HashStatus): void {
    store.update((s) => ({
      ...s,
      history: s.history.map((h) =>
        h.transferId === transferId ? { ...h, hashVerifications: [...h.hashVerifications, status] } : h,
      ),
    }));
  }

  function updateHistoryState(transferId: FileTransferId, state: FileTransferState, completedAt?: string): void {
    store.update((s) => ({
      ...s,
      history: s.history.map((h) =>
        h.transferId === transferId ? { ...h, state, ...(completedAt ? { completedAt } : {}) } : h,
      ),
    }));
  }

  function getHistoryEntry(transferId: FileTransferId): TransferHistoryEntry | undefined {
    return store.get().history.find((h) => h.transferId === transferId);
  }

  function clear(): void {
    store.set({
      pendingOffer: null,
      offerQueue: [],
      uploads: [],
      history: [],
    });
  }

  return {
    store,
    receiveOffer,
    receiveManifest,
    acceptOffer,
    rejectOffer,
    startUpload,
    updateUploadPhase,
    addHistoryEntry,
    appendCustodyEvent,
    appendHashVerification,
    updateHistoryState,
    getHistoryEntry,
    clear,
  };
}
