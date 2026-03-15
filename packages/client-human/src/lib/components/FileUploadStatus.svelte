<!-- Copyright 2026 Glorktelligence — Harry Smith -->
<!-- Licensed under the Apache License, Version 2.0 -->

<!--
  File Upload Status (Task 2.9)

  Displays upload progress for outbound files: encrypting,
  uploading, quarantine status, and final outcome.
-->
<script>
/** @type {import('../stores/file-transfers.js').FileUploadProgress} */
const { upload } = $props();

const phaseLabels = {
  encrypting: 'Encrypting...',
  uploading: 'Uploading to relay...',
  quarantined: 'In quarantine',
  offered: 'Offer sent to recipient',
  accepted: 'Recipient accepted',
  delivered: 'Delivered',
  rejected: 'Rejected by recipient',
  failed: 'Failed',
};

const phaseColors = {
  encrypting: '#2196F3',
  uploading: '#2196F3',
  quarantined: '#FF9800',
  offered: '#FF9800',
  accepted: '#4CAF50',
  delivered: '#4CAF50',
  rejected: '#f44336',
  failed: '#f44336',
};

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

$effect(() => {
  // Reactive: phase changes update display
});
</script>

<div class="upload-status" style="border-left-color: {phaseColors[upload.phase] || '#999'}">
  <div class="upload-header">
    <span class="filename">{upload.filename}</span>
    <span class="size">{formatSize(upload.sizeBytes)}</span>
  </div>
  <div class="phase" style="color: {phaseColors[upload.phase] || '#999'}">
    <span class="dot" style="background: {phaseColors[upload.phase] || '#999'}"></span>
    {phaseLabels[upload.phase] || upload.phase}
  </div>
  {#if upload.error}
    <div class="error">{upload.error}</div>
  {/if}
</div>

<style>
  .upload-status {
    border: 1px solid #e0e0e0;
    border-left: 3px solid #999;
    border-radius: 4px;
    padding: 8px 12px;
    margin: 4px 0;
    font-family: system-ui, sans-serif;
    font-size: 13px;
  }
  .upload-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .filename { font-weight: 500; }
  .size { font-size: 12px; color: #888; }
  .phase {
    margin-top: 4px;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }
  .error {
    margin-top: 4px;
    font-size: 12px;
    color: #c62828;
  }
</style>
