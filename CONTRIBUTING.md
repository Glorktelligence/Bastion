# Contributing to Project Bastion

Thank you for your interest in contributing to Bastion. This document covers the process for contributing, from opening an issue to getting your code merged.

## Before You Start

1. **Read the spec.** The [supplementary specification](docs/spec/bastion-supplementary-spec.md) documents architectural decisions, security properties, and design rationale. Understanding *why* things are the way they are will save time in review.
2. **Check existing issues.** Someone may already be working on what you have in mind.
3. **For significant changes, open an issue first.** Discuss the approach before writing code. This is especially important for protocol changes, security-related work, and new message types.

## Development Setup

### Prerequisites

- **Node.js** >= 20.0.0
- **PNPM** >= 9.0.0

### Getting Started

```bash
git clone https://github.com/Glorktelligence/Bastion.git
cd Bastion
pnpm install
pnpm build
pnpm test
```

### Project Structure

Bastion is a PNPM monorepo. All packages live in `packages/`:

- `protocol` — Shared types, Zod schemas, constants (the foundation — everything depends on this)
- `crypto` — E2E encryption, key management, file encryption
- `relay` — WebSocket server, routing, auth, audit, file quarantine
- `client-human` — Tauri + SvelteKit desktop app
- `client-human-mobile` — React Native mobile app
- `client-ai` — Headless AI client for isolated VM
- `relay-admin-ui` — SvelteKit admin panel
- `adapter-template` — Community adapter reference template
- `tests` — Cross-package integration and round-trip tests
- `infrastructure` — Proxmox VM/LXC templates, systemd units, firewall/AppArmor profiles, setup scripts

### Running Tests

```bash
# All tests
pnpm test

# Specific package
node packages/relay/trace-test.mjs
node packages/tests/integration-test.mjs
```

### Typechecking and Linting

```bash
pnpm -r typecheck    # TypeScript across all packages
pnpm lint            # Biome linter
```

## Pull Request Workflow

### 1. Branch Naming

Use descriptive branch names with a prefix:

- `feat/short-description` — New features
- `fix/short-description` — Bug fixes
- `docs/short-description` — Documentation
- `refactor/short-description` — Code restructuring
- `security/short-description` — Security fixes (see below for special process)

### 2. Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/) with package scope:

```
feat(protocol): add session_conflict message type
fix(relay): handle race condition in reconnection handshake
docs(readme): update architecture diagram
refactor(client-human): extract store primitives to shared module
test(crypto): add KDF chain rotation coverage
```

The scope should be the package name without the `@bastion/` prefix. For cross-package changes, use the primary package or `project` for repo-wide changes.

**AI co-contributor attribution**: When work is produced with Claude (Anthropic), include the co-author trailer after a blank line following the commit body:

```
Co-authored-by: Claude <noreply@anthropic.com>
```

This is standard Git co-author attribution. GitHub recognises it and lists both contributors.

### 3. Code Standards

- **TypeScript** with strict mode. Check `tsconfig.base.json` for compiler options.
- **Apache 2.0 header** on every source file:
  ```typescript
  // Copyright 2026 Glorktelligence — Harry Smith
  // Licensed under the Apache License, Version 2.0
  // See LICENSE file for full terms
  ```
- **Protocol types live in `@bastion/protocol` only.** Other packages consume them — they never define their own message structures.
- **Tests are required** for logic layer changes. We use trace-test patterns (lightweight, no framework dependency).
- **No GPLv2 dependencies.** Apache 2.0 is incompatible with GPLv2. MIT, BSD, ISC, and GPLv3 are fine. If you're unsure about a dependency's licence, ask.

### 4. What Gets Reviewed

Every PR is reviewed for:

- **Correctness**: Does it do what it claims?
- **Security**: Does it maintain or strengthen security properties? Does it introduce new attack surface?
- **Protocol consistency**: Do message types, schemas, and error codes follow established patterns?
- **Test coverage**: Are new code paths tested? Are edge cases covered?
- **Type safety**: Does it maintain strict TypeScript typing?

### 5. Merge Requirements

- All CI checks pass (tests, typecheck, lint)
- At least one maintainer approval
- No unresolved security concerns
- Conventional commit message on the merge commit

## Security-Sensitive Changes

Changes that touch security properties have a **cooling-off period**:

### What Qualifies as Security-Sensitive

- Changes to `@bastion/crypto` (encryption, key management, hashing)
- Changes to safety engine logic (Layer 1/2/3 evaluation, safety floors)
- Changes to authentication or authorisation (JWT, admin auth, provider allowlist)
- Changes to file quarantine or hash verification
- Changes to the MaliClaw Clause (note: removal or weakening PRs will be closed)
- Changes to relay message routing that affect trust boundaries
- New message types that carry credentials, keys, or configuration

### Cooling-Off Process

1. **PR is opened** with the `security` label.
2. **Review period**: Minimum 7 days before merge, regardless of approval status. This gives the community time to review security implications.
3. **Explicit sign-off**: The PR must include a security impact statement describing what trust boundaries are affected and why the change is safe.
4. **No force-merge**: Security PRs are never merged early, even for "obvious" fixes. Obvious-looking security fixes are a common social engineering vector.

### Exceptions

- Critical vulnerability patches (reported via [SECURITY.md](SECURITY.md)) may bypass the cooling-off period at the maintainer's discretion, with a post-merge retrospective.

## Protocol Changes

Changes to `@bastion/protocol` affect every other package. The process:

1. **Open an issue** describing the proposed change and its rationale.
2. **Document the decision.** Architecture decisions for Bastion are currently captured through project conversations and vault notes maintained by the core team, and reflected in per-version spec sheets in `docs/protocol/` and audit reports in `docs/audits/`. The `docs/architecture/decisions/` directory is reserved for potential future formalisation of lightweight ADRs — treat it as aspirational rather than required today.
3. **Implement in `@bastion/protocol` first**, including schema changes, type updates, and constant additions.
4. **Update all consuming packages** in the same PR or a linked PR chain. A protocol change is not complete until all packages that consume the changed types are updated.
5. **Bump the protocol version** if the change is not backwards-compatible.

## Apache 2.0 Patent Grant

By contributing to Bastion, you agree to the terms of the [Apache License 2.0](LICENSE). This includes Section 3 — Grant of Patent License:

> Each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable patent license to make, have made, use, offer to sell, sell, import, and otherwise transfer the Work, where such license applies only to those patent claims licensable by such Contributor that are necessarily infringed by their Contribution(s) alone or by combination of their Contribution(s) with the Work to which such Contribution(s) was submitted.

**In plain terms**: If you contribute code that implements a technique covered by a patent you hold, you grant all Bastion users an automatic licence to use that technique. This prevents the scenario where someone contributes to Bastion, patents an approach, and then sues users of the project. This is a feature of Apache 2.0, not a bug — it's why we chose this licence.

If you or your employer hold patents that might be relevant, consult your legal team before contributing. This is not a trap — it's transparency.

## Questions?

Open an issue or email **contribute@glorktelligence.co.uk**.
