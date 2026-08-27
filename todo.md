# Agent Plugin Development Roadmap

## Invariants

- New chats always start in `standard` mode; choosing a mode never adds a mandatory step.
- The mode selector is visible only before the first persisted conversation message.
- Persisting the first message atomically locks the selected mode. Reverting messages never unlocks it.
- Existing chats migrate to locked `standard` mode; existing genuinely empty chats migrate to unlocked `standard` mode.
- Model-generated plugin source is untrusted and never executes in the Kalo Window.
- Draft inspection and tool tests run in the existing opaque-origin iframe Worker with no host-service permissions.
- Agent tools may create, revise, validate, and test drafts, but installation and enabling always require explicit user actions.
- Draft installation starts disabled and continues to use descriptor snapshots, safe schema checks, source hashing, RPC bounds, timeouts, and capability lockdown.
- Opening a shared link never executes its source. Shared plugins are decoded, bounded, hash-checked, statically validated, and reviewed before an explicit install action.
- Generated share links use a URL fragment rather than a query parameter so executable source is not sent to Cloudflare, logs, or referrers.
- Safari and iOS WebKit remain fail-closed for user plugin execution.

## Phase 1 — Session mode and local draft workspace

- [x] Add persisted `Session.mode` (`standard` / `plugin_development`) and `modeLockedAt`.
- [x] Upgrade Dexie and backup parsing/export while preserving v1–v6 compatibility.
- [x] Add atomic repository guards for changing and locking a session mode.
- [x] Add the empty-chat mode selector, defaulting every new chat to Standard.
- [x] Hide and permanently lock the selector after the first persisted message.
- [x] Show a compact, read-only development-mode badge after locking.
- [x] Add `PluginDraft` and bounded revision persistence scoped to a development session.
- [x] Add Agent draft tools for create, read, list, replace, validate, and restore.
- [x] Give development sessions a dedicated prompt/tool set without health write tools or enabled-plugin prompts.
- [x] Add a lightweight draft panel with source, hash, revision, and diagnostics.
- [x] Add repository, migration, backup, mode-locking, and draft-tool tests.
- [x] Validate formatting, TypeScript, Svelte, tests, production build, and Wrangler dry run.
- [x] Commit Phase 1.

## Phase 2 — Zero-permission sandbox testing and explicit installation

- [x] Inspect a draft descriptor/runtime in a disposable zero-permission sandbox.
- [x] Validate manifest, safe config/tool schemas, namespaced tools, prompt bounds, and default config.
- [x] Execute a selected draft tool with bounded JSON arguments and strict result validation.
- [x] Always dispose draft test iframe/Worker clients and surface structured diagnostics.
- [x] Add Agent tools for sandbox inspection and tool tests.
- [x] Extend the draft panel with runtime metadata, test output, source revisions, and download.
- [x] Add an explicit review dialog showing source hash, manifest, permissions, tools, and prompt risk.
- [x] Install reviewed drafts through the existing local-plugin path and leave them disabled.
- [x] Add sandbox-test, failed-load cleanup, denied-service, install-confirmation, and version-replacement tests.
- [x] Validate formatting, TypeScript, Svelte, tests, production build, Wrangler dry run, and Chromium smoke coverage.
- [x] Commit Phase 2.

## Phase 3 — Inline plugin sharing and reviewed import

- [ ] Add a versioned, compressed, base64url share envelope containing file name, source, size, and SHA-256.
- [ ] Enforce a small inline-source/token limit and reject malformed, oversized, or hash-mismatched payloads.
- [ ] Add `/plugins/import` with fragment decoding and immediate URL cleanup.
- [ ] Never execute shared source during route load or static preview.
- [ ] Show source, hash, diagnostics, and risk confirmation before explicit installation.
- [ ] Add a Share action to valid drafts using Web Share or clipboard fallback.
- [ ] Install accepted shares through the existing local-plugin path, disabled by default.
- [ ] Add round-trip, Unicode, tamper, size-limit, no-auto-execution, and import-flow tests.
- [ ] Document URL-size/privacy limits and the npm/JSR path for larger plugins.
- [ ] Validate formatting, TypeScript, Svelte, tests, production build, Wrangler dry run, and browser smoke coverage.
- [ ] Commit Phase 3.

## Completion

- [ ] Remove temporary fixtures and verify a clean worktree.
- [ ] Report commits, validation results, remaining platform limitations, and any deferred follow-ups.
