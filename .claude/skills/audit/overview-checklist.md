# Overview Audit Checklist

Quick health check — run this first to establish baseline.

## Build & Lint
- [ ] `pnpm build` succeeds without errors
- [ ] `pnpm lint` shows 0 issues
- [ ] All 14 test files pass (`pnpm test`)
- [ ] Note current test count for comparison

## Package Structure
- [ ] All packages listed in root package.json workspaces
- [ ] Each package has its own package.json with correct @bastion scope
- [ ] No circular dependencies between packages
- [ ] Protocol package has zero internal dependencies

## Sole Authorities
For each authority, verify:
- [ ] Class exists and is exported
- [ ] Instantiated in startup script
- [ ] lock() called after initialization (where applicable)
- [ ] No bypasses exist (grep for direct alternatives)

## Startup Scripts
- [ ] start-relay.mjs instantiates all required components
- [ ] start-ai-client.mjs instantiates all required components
- [ ] No "built but not wired" patterns (library code without startup wiring)

## Git Status
- [ ] Working tree clean (or note uncommitted changes)
- [ ] Main branch up to date with remote
- [ ] CI green on latest commit
