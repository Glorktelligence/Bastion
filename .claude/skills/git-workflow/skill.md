# Git Workflow

**Read this before completing any task.**

---

## The Principle

Work isn't done until it's committed and pushed.

---

## Repository

```
Location: G:\Glorktelligence\Projects\Bastion
Remote: https://git.glorktelligence.co.uk/chaos-admiral/bastion.git
Branch: main
```

---

## Standard Workflow

### After completing work:

```bash
cd G:\Glorktelligence\Projects\Bastion
git add .
git commit -m "[type]: [description]"
git push origin main
```

---

## Commit Types (Conventional Commits)

| Type | When |
|------|------|
| `feat:` | New feature or message type |
| `fix:` | Bug fix |
| `security:` | Security-related change |
| `refactor:` | Restructure without behaviour change |
| `docs:` | Documentation only |
| `test:` | Adding or updating tests |
| `wip:` | Work in progress checkpoint |
| `chore:` | Build/config changes |

### Scope (optional)

Use package name as scope for clarity:

```
feat(protocol): Add budget_alert message type
fix(relay): Correct JWT refresh timing
security(safety): Enforce time-of-day floor minimum
test(safety): Add floor breach prevention tests
docs(spec): Update supplementary spec with session lifecycle
```

### Good Examples
```
feat(protocol): Define file-manifest message schema
feat(relay): Implement MaliClaw Clause at TLS handshake
feat(client-ai): Add Layer 2 contextual evaluation
fix(relay): Fix hash verification on outbound quarantine
security(relay): Prevent admin panel binding to public interface
test(safety): Verify safety floors cannot be lowered
docs: Add Architecture Decision Record for WebSocket choice
wip(client-human): Checkpoint — challenge UI in progress
```

---

## Before Reporting "Task Complete"

```
□ Feature works as expected
□ Tests pass
□ Code committed
□ Pushed to origin
□ Commit message follows conventions
```

**If any box is unchecked, task is not complete.**

---

## If Push Fails

1. Commits are saved locally
2. Tell Harry immediately
3. Note the commit hash
4. Push when resolved

```
⚠️ Git push failed (auth issue).

Committed locally:
- Hash: abc1234
- Changes: [brief list]

Ready to push when resolved.
```

---

## Protocol Version Bumps

Any breaking change to `@bastion/protocol` requires:
1. Version bump in `packages/protocol/package.json`
2. Architecture Decision Record in `docs/architecture/decisions/`
3. Changelog entry
4. Commit message: `feat(protocol)!: [breaking change description]`

---

## Quick Reference

```bash
git status
git log --oneline -5
git diff
git reset --soft HEAD~1    # Undo last commit, keep changes
```
