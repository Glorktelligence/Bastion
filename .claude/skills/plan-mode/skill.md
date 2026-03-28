# Plan Mode - Implementation Planning

**Read this BEFORE any implementation work.**

---

## Purpose

Planning prevents:
- Breaking the protocol package contract
- Missing safety implications
- Violating the five immutable boundaries
- Duplicating existing utilities
- Incomplete implementations (library code without startup script wiring)
- Wasted time fixing rushed security code

Planning takes 5 minutes. Fixing a security bug takes hours.

---

## When To Use

Before ANY implementation:
- New message types
- New safety evaluation rules
- New relay routing logic
- File transfer changes
- Authentication changes
- UI components
- Tool governance changes
- Budget or challenge configuration changes
- Anything touching `@bastion/protocol`

---

## The Process

### 1. Explore First

```
□ Read relevant spec section (docs/)
□ Check @bastion/protocol for existing types (57 message types, 45 error codes)
□ Find existing utilities in @bastion/crypto
□ Check for similar implementations in existing stores/handlers
□ Identify which packages are affected
□ Review safety implications against all 5 immutable boundaries
□ Check ChallengeManager integration (does this feature need governance?)
□ Check Budget Guard integration (does this feature have cost?)
```

### 2. Create Plan

```markdown
## Implementation Plan: [Feature Name]

### Packages Affected
- @bastion/protocol — [what changes]
- @bastion/relay — [what changes]
- @bastion/client-ai — [what changes]

### Startup Script Wiring
- start-relay.mjs — [handler to add]
- start-ai-client.mjs — [handler to add]
- session.ts — [handler to add, store to update]

### Protocol Changes (if any)
- New type: [interface definition]
- New schema: [Zod schema]
- New constant: [value]

### Safety Implications
- Layer affected: [1/2/3/none]
- Floor implications: [any]
- Immutable boundaries: [which of the 5 are relevant]
- Challenge required: [yes/no/conditional]
- ChallengeManager integration: [needed/not needed]
- Budget Guard integration: [needed/not needed]

### Files to Modify
- packages/protocol/src/types/messages.ts — add new type
- start-relay.mjs — add routing handler
- start-ai-client.mjs — add message handler
- packages/client-human/src/lib/session.ts — add store handler

### Files to Create
- packages/client-human/src/lib/stores/new-feature.ts

### Edge Cases
- What if X? → Handle by Y
- What if timeout? → Handle by Z

### Tests Required
1. Schema validation test
2. Routing test
3. Safety evaluation test
```

### 3. Verify

- Confirm file paths exist
- Confirm types match existing patterns
- Confirm no conflicts with protocol contract
- Confirm safety floors are respected
- Confirm immutable boundaries are not violated
- Confirm startup script wiring is planned (not just library code)

### 4. Get Approval

Present plan to Harry. Wait for approval.

### 5. Implement

Follow the plan. Protocol first, then startup scripts, then client UI.

---

## Plan Quality

Ready when:
- [ ] Packages identified in dependency order
- [ ] Protocol changes defined first
- [ ] Startup script wiring planned for all affected scripts
- [ ] Safety implications assessed against all 5 immutable boundaries
- [ ] ChallengeManager integration checked
- [ ] Code snippets are real (not pseudocode)
- [ ] Edge cases listed
- [ ] Tests defined

NOT ready if:
- Contains "TODO" or "TBD"
- Safety implications not assessed
- Protocol changes not leading
- Missing error code assignments
- Startup script wiring not planned

---

## Remember

**Explore → Plan → Verify → Approve → Implement**

Protocol first. Safety always. Wire in startup scripts. Never skip planning.
