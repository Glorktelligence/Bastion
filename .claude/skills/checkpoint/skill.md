---
name: checkpoint
description: Save work progress with commit, checkpoint note, and resume instructions. Use when context is filling up or before complex work.
disable-model-invocation: true
allowed-tools: Bash(git add *) Bash(git commit *) Bash(git push *) Bash(git status *) Bash(git log *)
---

# Checkpoint - Context Management

**Read this when context is filling up or before starting complex work.**

---

## Purpose

Checkpoints preserve work and enable seamless continuation.
A good checkpoint means Harry doesn't have to re-explain anything.

---

## When To Checkpoint

Watch for:
- Context usage showing high
- Responses getting shorter or less detailed
- About to start complex multi-package work
- Working 30+ minutes on intensive implementation
- Crossing package boundaries (protocol → relay → client)

**If task is almost done (<5 min):** Finish it, then checkpoint.

---

## Checkpoint Process

### 1. Commit Current Work

```bash
cd G:\Glorktelligence\Projects\Bastion
git add .
git commit -m "wip: [what completed so far]"
git push origin main
```

### 2. Create Checkpoint Note

Write a checkpoint note to Harry describing:

```markdown
# Checkpoint: [Task] — [Date] — #N

**Status**: In Progress
**Reason**: Context approaching limit

## Completed ✅
- [x] Subtask 1
  - Package: @bastion/protocol
  - Files: packages/protocol/src/types/messages.ts
  - Commit: abc1234

## In Progress ⏳
- [ ] Subtask 2
  - Package: @bastion/relay
  - File: packages/relay/src/routing/message-router.ts (line 145)
  - Status: [exactly where stopped]
  - Next: [specific next action]

## Remaining ⭐
- [ ] Subtask 3
- [ ] Subtask 4

## Key Context
- Protocol changes: [what was added/changed]
- Safety implications: [any decisions made]
- Patterns followed: [which skill applied]

## Resume Instructions
1. Open packages/relay/src/routing/message-router.ts
2. Go to line X
3. Continue implementing [specific thing]
4. Then update packages/client-ai/src/...
```

### 3. Notify Harry

```
⚠️ Context approaching limit.

Progress saved:
- Commit: [hash]
- Packages touched: [list]

Resume: [brief description of where to pick up]

Options:
A) /compact to continue here
B) New session — checkpoint saved
```

---

## Resuming From Checkpoint

1. **Read** the checkpoint note first
2. **Check** last commit
3. **Continue** from exactly where documented
4. **Do not** restart or redo completed work

---

## Quality

### Good Checkpoint
- Specific file paths and line numbers
- Package dependency order noted
- Safety decisions documented
- Commit hash referenced
- Explicit next steps

### Bad Checkpoint
- "Was working on stuff"
- No file paths
- Missing context
- Unclear next steps

---

## Remember

Good checkpoint = 5 minute resume.
Bad checkpoint = 30 minute re-explanation.
