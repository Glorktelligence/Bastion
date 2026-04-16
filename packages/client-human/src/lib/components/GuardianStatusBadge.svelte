<!-- Copyright 2026 Glorktelligence — Harry Smith -->
<!-- Licensed under the Apache License, Version 2.0 -->
<!-- See LICENSE file for full terms -->

<script lang="ts">
import type { GuardianStatusSummary } from '../stores/guardian-lockout.js';

// Subtle Guardian status indicator — shown in sidebar footer when not in lockout.
// Three states:
//   Healthy   → active, no violations    — green dot, muted text
//   Concerned → alert, warnings present  — amber dot, slightly more prominent
//   Action    → shutdown                  — red dot (rare — usually lockout takes over)

const { status }: { status: GuardianStatusSummary | null } = $props();

const tone = $derived(
  !status
    ? 'unknown'
    : status.status === 'shutdown'
      ? 'danger'
      : status.status === 'alert'
        ? 'warning'
        : status.environmentClean && status.violationCount === 0
          ? 'healthy'
          : 'warning',
);

const label = $derived(
  !status
    ? 'Guardian: Unknown'
    : tone === 'danger'
      ? 'Guardian: Action Required'
      : tone === 'warning'
        ? 'Guardian: Concerned'
        : 'Guardian: Healthy',
);
</script>

<div class="guardian-badge" class:tone-healthy={tone === 'healthy'} class:tone-warning={tone === 'warning'} class:tone-danger={tone === 'danger'} class:tone-unknown={tone === 'unknown'} title={label}>
  <span class="dot" aria-hidden="true"></span>
  <span class="label">{label}</span>
</div>

<style>
  .guardian-badge {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.7rem;
    color: var(--color-text-muted);
    padding: 0.125rem 0;
    margin-bottom: 0.25rem;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    display: inline-block;
    background: #555;
  }

  .tone-healthy .dot {
    background: #10b981;
  }

  .tone-warning .dot {
    background: #e5a100;
  }

  .tone-danger .dot {
    background: #ef4444;
    box-shadow: 0 0 6px rgba(239, 68, 68, 0.5);
  }

  .tone-unknown .dot {
    background: #555;
  }

  .label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tone-warning .label {
    color: #e5a100;
  }

  .tone-danger .label {
    color: #ef4444;
    font-weight: 600;
  }
</style>
