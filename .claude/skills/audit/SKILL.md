---
name: audit
description: Run pixel-level audits on Bastion packages. Covers security, wiring, UI/UX, and end-to-end verification. Use when asked to audit, review, inspect, or verify any Bastion package or the full codebase. Supports per-package, cross-package, and byte-level inspection.
argument-hint: "[level] [scope]"
disable-model-invocation: true
allowed-tools: Bash(git status *) Bash(git diff *) Bash(git log *) Bash(grep *) Bash(find *) Bash(wc *) Bash(cat *) Bash(head *) Bash(tail *) Read Glob Grep
effort: high
---

# Bastion Audit System

Run systematic audits of Bastion packages. Every feature gets three questions:
1. **Does it exist?** (code written, exported, imported)
2. **Is it wired?** (connected to the components that need it)
3. **Does it work end-to-end?** (tested, deployed, functional)

## Audit Levels

Parse `$ARGUMENTS` to determine audit level and scope:

| Level | Trigger | What It Does |
|-------|---------|-------------|
| `overview` | `/audit overview` | High-level health check — test count, lint status, package structure, sole authority status |
| `package [name]` | `/audit package relay` | Deep audit of a single package — wiring, handlers, exports, missing tests |
| `e2e` | `/audit e2e` | End-to-end flow verification — trace message paths from human→relay→AI and back |
| `security` | `/audit security` | Security-focused — auth, encryption, injection, traversal, plaintext leaks |
| `pixel` | `/audit pixel [name]` | Byte-level inspection — every line, every export, every wire in a package |
| `ui` | `/audit ui [human\|admin]` | UI/UX audit — component wiring, store consistency, route functionality, visual bugs |
| `authority` | `/audit authority [name]` | Verify a sole authority — is it truly sole? Any bypasses? All consumers wired? |
| `full` | `/audit full` | All levels combined across all packages (EXPENSIVE — warn the user) |

## Dynamic Context

Current git status for audit context:
```!
cd G:\Glorktelligence\Projects\Bastion && git log --oneline -10
```

Current test baseline:
```!
cd G:\Glorktelligence\Projects\Bastion && node -e "const fs=require('fs');const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));console.log('Version:',pkg.version)"
```

## Audit Output

**ALWAYS produce a PIXEL-AUDIT.md file** in the audited package directory (or repo root for cross-package audits).

Structure every finding as:

```markdown
| # | Audit Area | Findings | Top Severity |
|---|-----------|----------|-------------|
| 1 | [Area] | [Summary] | CRITICAL/HIGH/MEDIUM/LOW |
```

For each finding include:
- **Severity**: CRITICAL (broken/security), HIGH (should fix), MEDIUM (improvement), LOW (cosmetic)
- **Current state**: what exists now
- **Expected state**: what should exist
- **Fix suggestion**: one-line description
- **Evidence**: file path, line number, code snippet

## Level Details

See supporting files for detailed checklists per audit level:
- [overview-checklist.md](overview-checklist.md) — health check items
- [security-checklist.md](security-checklist.md) — security audit items
- [ui-checklist.md](ui-checklist.md) — UI/UX audit items

## Package Map

| Package | Startup Script | Key Files |
|---------|---------------|-----------|
| protocol | N/A (library) | src/types/, src/schemas/, src/constants/ |
| crypto | N/A (library) | src/index.ts |
| relay | start-relay.mjs | src/auth/, src/audit/, src/session/ |
| client-ai | start-ai-client.mjs | src/provider/, src/safety/, src/files/ |
| client-human | N/A (Tauri app) | src/lib/session.ts, src/lib/components/, src/lib/extensions/ |
| relay-admin-ui | N/A (SvelteKit) | src/lib/stores/, src/routes/ |

## Sole Authorities to Verify

```
🕐 DateTimeManager   — sole TIME authority       (injected into 15 managers)
🗑️ PurgeManager      — sole DELETE authority
🔧 ToolManager       — sole TOOL authority
📋 SkillsManager     — sole SKILL authority
⚡ BastionBash       — sole EXECUTION authority
📜 AuditLogger       — sole AUDIT authority
```

## Rules

1. **Audit only — no code changes** unless explicitly asked
2. **Evidence-based** — every finding has a file path and line number
3. **No false positives** — if you're not sure, mark it as "needs investigation"
4. **Build before audit** — run `pnpm build` first to ensure compiled output is current
5. **Test before audit** — run `pnpm test` to establish the baseline
6. **Check git status** — note any uncommitted changes that might affect findings
