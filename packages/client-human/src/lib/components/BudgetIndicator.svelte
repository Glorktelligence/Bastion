<script lang="ts">
import type { BudgetStatusData, BudgetAlert } from '../stores/budget.js';

const {
  status,
  lastAlert,
  onDismissAlert,
}: {
  status: BudgetStatusData | null;
  lastAlert: BudgetAlert | null;
  onDismissAlert?: () => void;
} = $props();

function alertClass(level: string): string {
  if (level === 'monthly_exhausted' || level === 'exhausted') return 'alert-exhausted';
  if (level === 'urgent_80' || level === 'urgent' || level === 'session_limit' || level === 'daily_limit') return 'alert-urgent';
  return 'alert-warning';
}
</script>

{#if status}
  <div class="budget-bar">
    <span class="budget-icon">&#128269;</span>
    <span class="budget-text">
      {status.searchesThisSession}/{status.searchesThisMonth} month | ${status.budgetRemaining.toFixed(2)} left
    </span>
    {#if status.alertLevel === 'exhausted'}
      <span class="budget-badge exhausted">exhausted</span>
    {:else if status.alertLevel === 'urgent'}
      <span class="budget-badge urgent">{status.percentUsed.toFixed(0)}%</span>
    {:else if status.alertLevel === 'warning'}
      <span class="budget-badge warning">{status.percentUsed.toFixed(0)}%</span>
    {/if}
  </div>
{/if}

{#if lastAlert}
  <div class="budget-alert {alertClass(lastAlert.alertLevel)}">
    <span>{lastAlert.message}</span>
    {#if lastAlert.alertLevel !== 'monthly_exhausted'}
      <button class="dismiss-btn" onclick={onDismissAlert}>&#10005;</button>
    {/if}
  </div>
{/if}

<style>
  .budget-bar {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.125rem 0.5rem;
    font-size: 0.7rem;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  .budget-icon { font-size: 0.75rem; }
  .budget-text { font-family: monospace; }
  .budget-badge {
    padding: 0.0625rem 0.25rem;
    border-radius: 3px;
    font-size: 0.625rem;
    font-weight: 600;
  }
  .budget-badge.warning { background: #f59e0b20; color: #f59e0b; }
  .budget-badge.urgent { background: #ef444420; color: #ef4444; }
  .budget-badge.exhausted { background: #ef4444; color: white; }

  .budget-alert {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.375rem 0.75rem;
    font-size: 0.75rem;
  }
  .alert-warning { background: #f59e0b20; color: #f59e0b; }
  .alert-urgent { background: #ef444420; color: #ef4444; }
  .alert-exhausted { background: #ef4444; color: white; }
  .dismiss-btn {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 0.75rem;
    opacity: 0.7;
  }
  .dismiss-btn:hover { opacity: 1; }
</style>
