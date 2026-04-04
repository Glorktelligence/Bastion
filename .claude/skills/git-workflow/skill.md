# Git Workflow

**Read this before completing any task.**

---

## The Principle

Work isn't done until it's committed, attributed, and pushed.

---

## Repository

```
Location: G:\Glorktelligence\Projects\Bastion
Remote: https://github.com/Glorktelligence/Bastion.git
Branch: main
```

---

## Standard Workflow

### After completing work:

1. **Run lint** (mandatory before commit):

```bash
cd G:\Glorktelligence\Projects\Bastion
pnpm lint --write    # Auto-fix formatting and import ordering
pnpm lint            # Verify clean — must show 0 issues
```

2. **Run full test suite** (mandatory — all 14 files must pass):

```bash
pnpm test            # Runs all test files
# Or run individually:
node packages/tests/trace-test.mjs
node packages/tests/integration-test.mjs
node packages/tests/file-transfer-integration-test.mjs
node packages/crypto/trace-test.mjs
node packages/relay/trace-test.mjs
node packages/relay/admin-trace-test.mjs
node packages/relay/quarantine-trace-test.mjs
node packages/relay/file-transfer-trace-test.mjs
node packages/client-ai/trace-test.mjs
node packages/client-ai/file-handling-trace-test.mjs
node packages/client-human/trace-test.mjs
node packages/client-human-mobile/trace-test.mjs
node packages/relay-admin-ui/trace-test.mjs
```

Expected: 2,964+ tests, 0 failures.

3. **Update docs if needed** (see Doc Updates below)

4. **Stage, commit with attribution, and push:**

```bash
git add .
git commit -m "[type]([scope]): [description]

Co-authored-by: Claude <noreply@anthropic.com>"
git push origin main
```

---

## Co-Contributor Attribution (MANDATORY)

Every commit MUST include the co-author trailer. This is non-negotiable — Claude is a credited collaborator on this project.

```
Co-authored-by: Claude <noreply@anthropic.com>
```

**Rules:**
- The trailer goes after a blank line following the commit description
- Multi-line commit bodies go between the subject and the trailer
- GitHub recognises this and lists both contributors on the commit

**Single-line example:**
```
feat(relay): Add session timeout handling

Co-authored-by: Claude <noreply@anthropic.com>
```

**Multi-line example:**
```
feat(relay): Wire AdminServer into relay startup

- Add AdminServer, AdminAuth, AdminRoutes imports
- Auto-generate admin credentials if not in env
- Bind admin API to 127.0.0.1 only (SSH tunnel access)
- Add provider registry for future provider management

Co-authored-by: Claude <noreply@anthropic.com>
```

---

## Commit Types (Conventional Commits)

| Type          | When                                 |
| ------------- | ------------------------------------ |
| `feat:`     | New feature or message type          |
| `fix:`      | Bug fix                              |
| `security:` | Security-related change              |
| `refactor:` | Restructure without behaviour change |
| `docs:`     | Documentation only                   |
| `test:`     | Adding or updating tests             |
| `wip:`      | Work in progress checkpoint          |
| `chore:`    | Build/config changes                 |

### Scope (optional but preferred)

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

## Doc Updates Checklist

Before committing, check if the work affects any of these and update accordingly:

### README.md Badges & Counts
- [ ] **Test count badge** — if tests were added or removed (currently 2,964)
- [ ] **Message type count** — if protocol types were added (currently 85)
- [ ] **Error code count** — if error codes were added (currently 48)
- [ ] **Package count** — if a new package was added
- [ ] **Feature list** — if a user-visible feature was added

### Other Docs
- [ ] **SECURITY.md** — if the change affects threat model or security boundaries
- [ ] **CONTRIBUTING.md** — if the change affects development workflow
- [ ] **docs/spec/** — if protocol message types or schemas changed
- [ ] **docs/protocol/** — if the protocol specification needs updating
- [ ] **docs/guides/deployment.md** — if deployment steps or config changed
- [ ] **CHANGELOG** — for any user-facing change (maintain if present)

### When to Skip
- Pure refactors with no behaviour change: skip doc updates
- Test-only changes: update test count badge only
- WIP commits: skip doc updates until work is complete

---

## Before Reporting "Task Complete"

```
□ Feature works as expected
□ pnpm lint --write applied (Biome auto-fix)
□ pnpm lint clean (0 issues)
□ Full test suite passes (all 14 files, 2,964+ tests)
□ Docs updated (badges, counts, guides as needed)
□ Code committed with Co-authored-by trailer
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

## Version Bumps

The `VERSION` file at repo root is the **single source of truth**. NEVER edit version strings in `package.json` files or `version.ts` directly.

```bash
# 1. Edit VERSION file (e.g. 0.5.3)
# 2. Sync to all packages:
pnpm run version:sync
# 3. Update CHANGELOG.md
# 4. Commit: "chore: bump version to vX.Y.Z"
```

This updates: root `package.json` + 10 sub-package `package.json` files + `packages/protocol/src/constants/version.ts` (exports `PROTOCOL_VERSION`).

### Breaking Protocol Changes

Any breaking change to `@bastion/protocol` additionally requires:

1. Architecture Decision Record in `docs/architecture/decisions/`
2. Changelog entry
3. Commit message: `feat(protocol)!: [breaking change description]`

---

## Quick Reference

```bash
git status
git log --oneline -5
git diff
git reset --soft HEAD~1    # Undo last commit, keep changes
```
