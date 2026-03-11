<!-- Copyright 2026 Glorktelligence — Harry Smith -->
<!-- Licensed under the Apache License, Version 2.0 -->

<!--
  Transfer History with Chain of Custody (Task 2.10)

  Displays all file transfers with their complete custody chain
  and hash verification status at each stage.
-->
<script>
/** @type {import('../stores/file-transfers.js').TransferHistoryEntry[]} */
const { entries = [] } = $props();

let expandedId = $state(null);

function toggle(transferId) {
  expandedId = expandedId === transferId ? null : transferId;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function stateLabel(state) {
  const labels = {
    pending_manifest: 'Pending',
    quarantined: 'Quarantined',
    offered: 'Offered',
    accepted: 'Accepted',
    rejected: 'Rejected',
    delivering: 'Delivering',
    delivered: 'Delivered',
    hash_mismatch: 'Hash Mismatch',
    purged: 'Purged',
    timed_out: 'Timed Out',
  };
  return labels[state] || state;
}

function stateColor(state) {
  if (state === 'delivered') return '#4CAF50';
  if (state === 'accepted' || state === 'offered') return '#FF9800';
  if (state === 'rejected' || state === 'hash_mismatch' || state === 'purged' || state === 'timed_out')
    return '#f44336';
  return '#2196F3';
}

function directionLabel(dir) {
  return dir === 'human_to_ai' ? 'Human to AI' : 'AI to Human';
}
</script>

<div class="transfer-history">
  {#if entries.length === 0}
    <div class="empty">No file transfers yet.</div>
  {:else}
    {#each entries as entry (entry.transferId)}
      <div class="entry" class:expanded={expandedId === entry.transferId}>
        <button class="entry-header" onclick={() => toggle(entry.transferId)}>
          <span class="state-badge" style="background: {stateColor(entry.state)}">
            {stateLabel(entry.state)}
          </span>
          <span class="entry-filename">{entry.filename}</span>
          <span class="entry-meta">
            {formatSize(entry.sizeBytes)} &middot; {directionLabel(entry.direction)}
          </span>
          <span class="chevron">{expandedId === entry.transferId ? '&#9660;' : '&#9654;'}</span>
        </button>

        {#if expandedId === entry.transferId}
          <div class="entry-details">
            <table class="metadata-table">
              <tr><td>Transfer ID</td><td class="mono">{entry.transferId}</td></tr>
              <tr><td>Direction</td><td>{directionLabel(entry.direction)}</td></tr>
              <tr><td>MIME Type</td><td>{entry.mimeType}</td></tr>
              <tr><td>SHA-256</td><td class="mono hash">{entry.hash}</td></tr>
              <tr><td>Started</td><td>{new Date(entry.startedAt).toLocaleString()}</td></tr>
              {#if entry.completedAt}
                <tr><td>Completed</td><td>{new Date(entry.completedAt).toLocaleString()}</td></tr>
              {/if}
            </table>

            {#if entry.hashVerifications.length > 0}
              <div class="section-title">Hash Verification</div>
              <div class="verifications">
                {#each entry.hashVerifications as v}
                  <div class="verification" class:verified={v.verified} class:failed={!v.verified}>
                    <span class="v-icon">{v.verified ? '&#10003;' : '&#10007;'}</span>
                    <span class="v-stage">{v.stage}</span>
                    {#if v.hash}<span class="mono v-hash">{v.hash}</span>{/if}
                  </div>
                {/each}
              </div>
            {/if}

            <div class="section-title">Chain of Custody</div>
            <div class="custody-chain">
              {#each entry.custodyEvents as evt, i}
                <div class="custody-event">
                  <div class="timeline-dot" class:first={i === 0} class:last={i === entry.custodyEvents.length - 1}></div>
                  <div class="event-content">
                    <div class="event-header">
                      <strong>{evt.event}</strong>
                      <span class="event-actor">by {evt.actor}</span>
                    </div>
                    {#if evt.detail}
                      <div class="event-detail">{evt.detail}</div>
                    {/if}
                    <div class="event-time">{new Date(evt.timestamp).toLocaleString()}</div>
                    {#if evt.hash}
                      <div class="event-hash mono">{evt.hash}</div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .transfer-history {
    font-family: system-ui, sans-serif;
    font-size: 14px;
  }
  .empty { color: #888; padding: 16px; text-align: center; }
  .entry {
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    margin: 6px 0;
    overflow: hidden;
  }
  .entry.expanded { border-color: #bbb; }
  .entry-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: #fafafa;
    border: none;
    width: 100%;
    cursor: pointer;
    text-align: left;
    font-size: 14px;
  }
  .entry-header:hover { background: #f0f0f0; }
  .state-badge {
    font-size: 11px;
    color: white;
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 500;
    white-space: nowrap;
  }
  .entry-filename { font-weight: 500; flex: 1; }
  .entry-meta { font-size: 12px; color: #888; }
  .chevron { font-size: 10px; color: #999; }
  .entry-details { padding: 12px; border-top: 1px solid #e0e0e0; }
  .metadata-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 12px; }
  .metadata-table td { padding: 3px 8px; vertical-align: top; }
  .metadata-table td:first-child { font-weight: 500; width: 100px; color: #555; }
  .mono { font-family: monospace; font-size: 12px; }
  .hash { word-break: break-all; }
  .section-title { font-weight: 600; font-size: 13px; margin: 12px 0 6px; color: #333; }
  .verifications { display: flex; flex-direction: column; gap: 4px; }
  .verification { display: flex; align-items: center; gap: 6px; font-size: 13px; }
  .verification.verified .v-icon { color: #4CAF50; }
  .verification.failed .v-icon { color: #f44336; }
  .v-stage { text-transform: capitalize; }
  .v-hash { font-size: 11px; color: #888; }
  .custody-chain { padding-left: 8px; }
  .custody-event {
    display: flex;
    gap: 12px;
    position: relative;
    padding-bottom: 12px;
  }
  .custody-event:last-child { padding-bottom: 0; }
  .timeline-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #2196F3;
    margin-top: 4px;
    flex-shrink: 0;
    position: relative;
  }
  .custody-event:not(:last-child) .timeline-dot::after {
    content: '';
    position: absolute;
    left: 4px;
    top: 12px;
    width: 2px;
    height: calc(100% + 4px);
    background: #ddd;
  }
  .event-content { flex: 1; }
  .event-header { display: flex; gap: 8px; align-items: baseline; }
  .event-actor { font-size: 12px; color: #888; }
  .event-detail { font-size: 13px; color: #555; margin-top: 2px; }
  .event-time { font-size: 11px; color: #aaa; margin-top: 2px; }
  .event-hash { font-size: 11px; color: #999; margin-top: 1px; }
</style>
