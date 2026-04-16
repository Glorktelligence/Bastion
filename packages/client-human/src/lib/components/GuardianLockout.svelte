<!-- Copyright 2026 Glorktelligence — Harry Smith -->
<!-- Licensed under the Apache License, Version 2.0 -->
<!-- See LICENSE file for full terms -->

<script lang="ts">
import { onMount, onDestroy } from 'svelte';

// Full-viewport Guardian lockout. Shown when guardianLockoutStore is active.
// Separate aesthetic from Bastion — Guardian Red, cold white, monospace.
// Escalating tiers based on how many restarts the operator has done without
// resolving the violation via the relay CLI.

const {
  code,
  reason,
  restartCount,
  receivedAt,
  servicesAvailable = false,
}: {
  code: string;
  reason: string;
  restartCount: number;
  receivedAt: string;
  servicesAvailable?: boolean;
} = $props();

// Animated awaiting dots — cycles every 500ms.
let dots = $state('');
let dotsInterval: ReturnType<typeof setInterval> | null = null;

// Nuclear countdown — only active at restartCount >= 5.
let countdown = $state(30);
let countdownInterval: ReturnType<typeof setInterval> | null = null;
let terminated = $state(false);

const isNuclear = $derived(restartCount >= 5);

onMount(() => {
  dotsInterval = setInterval(() => {
    dots = dots.length >= 3 ? '' : `${dots}.`;
  }, 500);

  if (isNuclear) {
    countdownInterval = setInterval(() => {
      countdown -= 1;
      if (countdown <= 0) {
        terminated = true;
        if (countdownInterval) {
          clearInterval(countdownInterval);
          countdownInterval = null;
        }
        // Try Tauri window close first; fall back to about:blank.
        void terminateWindow();
      }
    }, 1000);
  }
});

onDestroy(() => {
  if (dotsInterval) clearInterval(dotsInterval);
  if (countdownInterval) clearInterval(countdownInterval);
});

async function terminateWindow(): Promise<void> {
  try {
    const isTauri =
      typeof globalThis !== 'undefined' && '__TAURI_INTERNALS__' in globalThis;
    if (isTauri) {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      const mod = await new Function('m', 'return import(m)')('@tauri-apps/api/window');
      const appWindow =
        mod.getCurrent?.() ?? mod.appWindow ?? mod.Window?.getCurrent?.();
      if (appWindow?.close) {
        await appWindow.close();
        return;
      }
    }
  } catch {
    /* fall through to browser fallback */
  }
  // Browser: replace contents with blank. window.close() only works for
  // windows opened by script, so this is the reliable fallback.
  try {
    const w = globalThis as unknown as { location?: { replace?: (url: string) => void } };
    w.location?.replace?.('about:blank');
  } catch {
    /* last resort — UI stays on the "terminated" message */
  }
}
</script>

<div class="guardian-lockout" role="alertdialog" aria-modal="true" aria-labelledby="guardian-title">
  {#if terminated}
    <div class="terminated">
      <h1 id="guardian-title">Human Client TERMINATED</h1>
    </div>
  {:else}
    <header>
      <h1 id="guardian-title" class="title">🔴 BASTION GUARDIAN</h1>
    </header>

    {#if isNuclear}
      <section class="nuclear">
        <p class="tag">We asked nicely.</p>
        <p class="tag">We gave you gentle nudges.</p>
        <p class="tag emphatic">We HAVE NO patience left.</p>

        <hr class="divider" />

        <p class="decree">Bastion Guardian DOES NOT negotiate.</p>
        <p class="decree">Bastion Guardian is DONE asking nicely.</p>

        <hr class="divider" />

        <p class="instruction">Log in to your relay and do the following:</p>
        <pre class="cmd">sudo -u bastion bastion guardian --component all</pre>

        <div class="countdown" class:pulsing={countdown <= 10} aria-live="assertive">
          {#if countdown > 5}
            <span class="countdown-label">TIME REMAINING</span>
            <span class="countdown-value">{countdown}s</span>
          {:else}
            <span class="countdown-warning">Human Client TERMINATED in {countdown}s</span>
          {/if}
        </div>
      </section>
    {:else}
      <section>
        <p class="infuriated">Guardian Infuriated</p>
        <p class="demanded">Presence DEMANDED in Bastion CLI</p>

        <hr class="divider" />

        <p class="status-line">
          Bastion Human Client: <span class="disabled">DISABLED</span>
        </p>
        <p class="status-line">
          Services: <span class="disabled">{servicesAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}</span>
        </p>

        <hr class="divider" />

        <p class="reason-label">Reason: <span class="code">{code}</span></p>
        <p class="reason-text">{reason}</p>

        <hr class="divider" />

        <p class="awaiting" aria-live="polite">Awaiting Guardian Response{dots}</p>

        <p class="resolution-label">Resolution: Bastion CLI on Relay</p>
        <pre class="cmd">sudo -u bastion bastion guardian</pre>

        {#if restartCount === 1}
          <div class="escalation tier-1">
            <p>Still here. Still waiting.</p>
            <p>Restarting the client doesn't resolve Guardian violations.</p>
            <p>This is attempt #2. I am keeping track.</p>
          </div>
        {:else if restartCount >= 2}
          <div class="escalation tier-late">
            <p>This is attempt #{restartCount + 1}. The CLI hasn't moved.</p>
            <p>Neither have I.</p>
          </div>
        {/if}

        <footer class="meta">Received at {receivedAt}</footer>
      </section>
    {/if}
  {/if}
</div>

<style>
  /* Guardian has its OWN aesthetic — NOT Bastion Gold.
     Dark red tones, serious, cold white, monospace throughout. */
  .guardian-lockout {
    position: fixed;
    inset: 0;
    z-index: 10000;
    background: #0a0000;
    color: #e0e0e0;
    font-family: 'IBM Plex Mono', 'Courier New', monospace;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    overflow-y: auto;
    text-align: center;
  }

  header {
    margin-bottom: 1.5rem;
  }

  .title {
    font-size: 1.75rem;
    font-weight: 700;
    color: #cc2222;
    letter-spacing: 0.08em;
    margin: 0;
  }

  section {
    max-width: 640px;
    width: 100%;
    border: 1px solid #331111;
    background: #0f0202;
    padding: 1.5rem 2rem;
    line-height: 1.6;
  }

  .infuriated {
    font-size: 1.25rem;
    color: #cc2222;
    font-weight: 600;
    margin: 0 0 0.25rem 0;
    letter-spacing: 0.04em;
  }

  .demanded {
    font-size: 0.95rem;
    color: #aaa;
    margin: 0 0 1rem 0;
  }

  .divider {
    border: none;
    border-top: 1px solid #331111;
    margin: 1rem 0;
  }

  .status-line {
    font-size: 0.95rem;
    margin: 0.25rem 0;
    color: #ccc;
  }

  .status-line .disabled {
    color: #ff4444;
    font-weight: 600;
    letter-spacing: 0.05em;
  }

  .reason-label {
    font-size: 0.9rem;
    color: #aaa;
    margin: 0.25rem 0;
  }

  .reason-label .code {
    color: #ff4444;
    font-weight: 600;
  }

  .reason-text {
    font-size: 0.9rem;
    color: #e0e0e0;
    margin: 0.25rem 0 0.5rem 0;
  }

  .awaiting {
    font-size: 0.95rem;
    color: #cc2222;
    margin: 1rem 0;
    min-height: 1.2em;
  }

  .resolution-label {
    font-size: 0.85rem;
    color: #888;
    margin: 0.5rem 0 0.25rem 0;
  }

  .cmd {
    display: inline-block;
    background: #1a0505;
    color: #ff4444;
    padding: 0.5rem 1rem;
    border-radius: 2px;
    border: 1px solid #331111;
    font-family: inherit;
    font-size: 0.95rem;
    margin: 0.25rem 0 0 0;
    letter-spacing: 0.02em;
  }

  .escalation {
    margin-top: 1.25rem;
    padding: 0.75rem 1rem;
    border-left: 3px solid #cc2222;
    text-align: left;
    background: #140303;
  }

  .escalation p {
    font-size: 0.9rem;
    color: #e0e0e0;
    margin: 0.25rem 0;
  }

  .tier-late {
    border-left-color: #ff4444;
  }

  .meta {
    margin-top: 1.5rem;
    font-size: 0.7rem;
    color: #555;
  }

  /* Nuclear tier (restartCount >= 5) */
  .nuclear {
    border-color: #ff4444;
    background: #140202;
    text-align: center;
  }

  .tag {
    font-size: 1rem;
    color: #e0e0e0;
    margin: 0.25rem 0;
  }

  .tag.emphatic {
    color: #ff4444;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 1.1rem;
  }

  .decree {
    font-size: 1rem;
    color: #cc2222;
    font-weight: 600;
    margin: 0.25rem 0;
    letter-spacing: 0.03em;
  }

  .instruction {
    font-size: 0.9rem;
    color: #aaa;
    margin: 0.75rem 0 0.25rem 0;
  }

  .countdown {
    margin-top: 1.5rem;
    padding: 1rem 1.5rem;
    border: 2px solid #cc2222;
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .countdown-label {
    font-size: 0.7rem;
    color: #888;
    letter-spacing: 0.1em;
  }

  .countdown-value {
    font-size: 2.5rem;
    color: #ff4444;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 0 8px rgba(255, 68, 68, 0.5);
  }

  .countdown-warning {
    font-size: 1.1rem;
    color: #ff4444;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .countdown.pulsing {
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.6);
      border-color: #cc2222;
    }
    50% {
      box-shadow: 0 0 0 8px rgba(255, 68, 68, 0);
      border-color: #ff4444;
    }
  }

  /* Terminated state — no UI except single line */
  .terminated {
    text-align: center;
  }

  .terminated h1 {
    font-size: 2rem;
    color: #ff4444;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
</style>
