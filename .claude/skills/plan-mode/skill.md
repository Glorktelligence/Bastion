# Plan Mode - Implementation Planning

**Read this BEFORE any implementation work.**

---

## Purpose

Planning prevents:
- Breaking the protocol package contract
- Missing safety implications
- Duplicating existing utilities
- Incomplete implementations
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
- Anything touching `@bastion/protocol`

---

## The Process

### 1. Explore First

```
□ Read relevant spec section (docs/)
□ Check @bastion/protocol for existing types
□ Find existing utilities in @bastion/crypto
□ Check for similar implementations
□ Identify which packages are affected
□ Review safety implications
```

### 2. Create Plan

```markdown
## Implementation Plan: [Feature Name]

### Packages Affected
- @bastion/protocol — [what changes]
- @bastion/relay — [what changes]
- @bastion/client-ai — [what changes]

### Protocol Changes (if any)
- New type: [interface definition]
- New schema: [Zod schema]
- New constant: [value]

### Safety Implications
- Layer affected: [1/2/3/none]
- Floor implications: [any]
- Challenge required: [yes/no/conditional]

### Files to Modify
- packages/protocol/src/types/messages.ts — add new type
- packages/relay/src/routing/message-router.ts — add routing case

### Files to Create
- packages/protocol/src/schemas/new-type.schema.ts

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

### 4. Get Approval

Present plan to Harry. Wait for approval.

### 5. Implement

Follow the plan. Protocol first, then relay, then clients.

---

## Plan Quality

Ready when:
- [ ] Packages identified in dependency order
- [ ] Protocol changes defined first
- [ ] Safety implications assessed
- [ ] Code snippets are real (not pseudocode)
- [ ] Edge cases listed
- [ ] Tests defined

NOT ready if:
- Contains "TODO" or "TBD"
- Safety implications not assessed
- Protocol changes not leading
- Missing error code assignments

---

## Remember

**Explore → Plan → Verify → Approve → Implement**

Protocol first. Safety always. Never skip planning.
