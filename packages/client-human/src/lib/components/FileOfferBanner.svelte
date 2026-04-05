<!-- Copyright 2026 Glorktelligence — Harry Smith -->
<!-- Licensed under the Apache License, Version 2.0 -->

<!--
  File Airlock Banner (Task 2.9)

  Displays incoming file offer/manifest metadata and presents
  accept/reject actions. Shows file details (name, size, MIME,
  hash, sender) without exposing file content.
-->
<script>
/** @type {import('../stores/file-transfers.js').PendingFileOffer} */
const { offer, onAccept, onReject } = $props();

let expanded = $state(false);

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function accept() {
  onAccept?.({ transferId: offer.transferId });
}

function reject() {
  onReject?.({ transferId: offer.transferId });
}
</script>

<div class="file-offer-banner" role="alert">
  <div class="banner-header">
    <div class="banner-icon">&#128230;</div>
    <div class="banner-title">
      <strong>Incoming File — {offer.direction === 'ai_to_human' ? 'From AI' : 'To AI'}</strong>
      <span class="sender">from {offer.senderName}</span>
    </div>
    <button class="toggle-btn" onclick={() => expanded = !expanded}>
      {expanded ? 'Less' : 'Details'}
    </button>
  </div>

  <div class="file-summary">
    <span class="filename">{offer.filename}</span>
    <span class="meta">{formatSize(offer.sizeBytes)} &middot; {offer.mimeType}</span>
  </div>

  {#if offer.purpose}
    <div class="purpose">{offer.purpose}</div>
  {/if}

  {#if expanded}
    <div class="details">
      <table>
        <tbody>
          <tr><td>Transfer ID</td><td class="mono">{offer.transferId}</td></tr>
          <tr><td>SHA-256</td><td class="mono hash">{offer.hash}</td></tr>
          <tr><td>MIME Type</td><td>{offer.mimeType}</td></tr>
          <tr><td>Size</td><td>{formatSize(offer.sizeBytes)} ({offer.sizeBytes.toLocaleString()} bytes)</td></tr>
          <tr><td>Sender</td><td>{offer.senderName} ({offer.senderType})</td></tr>
          <tr><td>Received</td><td>{new Date(offer.receivedAt).toLocaleString()}</td></tr>
          {#if offer.projectContext}
            <tr><td>Project</td><td>{offer.projectContext}</td></tr>
          {/if}
          {#if offer.taskId}
            <tr><td>Task ID</td><td class="mono">{offer.taskId}</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
  {/if}

  <div class="actions">
    <button class="btn-accept" onclick={accept}>Accept File</button>
    <button class="btn-reject" onclick={reject}>Reject</button>
  </div>
</div>

<style>
  .file-offer-banner {
    border: 1px solid #d4a843;
    border-left: 4px solid #d4a843;
    background: color-mix(in srgb, #d4a843 10%, var(--color-surface, #111128));
    border-radius: 6px;
    padding: 12px 16px;
    margin: 8px 0;
    font-size: 14px;
    color: var(--color-text);
  }
  .banner-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .banner-icon { font-size: 20px; }
  .banner-title { flex: 1; }
  .banner-title strong { display: block; color: var(--color-text); }
  .sender { font-size: 12px; color: var(--color-text-muted); }
  .toggle-btn {
    background: none;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 12px;
    color: var(--color-text-muted);
  }
  .toggle-btn:hover { background: var(--color-border); color: var(--color-text); }
  .file-summary {
    margin: 8px 0 4px;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .filename { font-weight: 600; color: var(--color-text); }
  .meta { font-size: 12px; color: var(--color-text-muted); }
  .purpose { font-size: 13px; color: var(--color-text-muted); margin-bottom: 8px; }
  .details {
    background: var(--color-bg, #0a0a1a);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 8px;
    margin: 8px 0;
  }
  .details table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .details td { padding: 3px 8px; vertical-align: top; color: var(--color-text); }
  .details td:first-child { font-weight: 500; width: 100px; color: var(--color-text-muted); }
  .mono { font-family: monospace; font-size: 12px; }
  .hash { word-break: break-all; }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .btn-accept {
    background: var(--color-success, #22c55e);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 6px 16px;
    cursor: pointer;
    font-weight: 500;
  }
  .btn-accept:hover { opacity: 0.9; }
  .btn-reject {
    background: none;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 6px 16px;
    cursor: pointer;
    color: var(--color-text-muted);
  }
  .btn-reject:hover { background: var(--color-border); color: var(--color-text); }
</style>
