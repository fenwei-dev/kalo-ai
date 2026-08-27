# Agent-Assisted Plugin Development

Kalo can create and test local user-plugin drafts inside a dedicated conversation mode. This workflow is local-first and preserves the same security boundary as manually imported plugins.

## Conversation mode

Every new conversation starts in **Standard** mode. Before the first persisted message, the empty chat shows two choices:

- **Standard** — health coaching, logs, goals, and enabled plugins.
- **Plugin development** — a specialized Agent prompt and draft tools.

Choosing a mode is optional because Standard is already selected. Persisting the first conversation message atomically locks the mode and hides the selector. Reverting all messages does not unlock it. Existing conversations migrate to locked Standard mode; genuinely empty existing conversations migrate to unlocked Standard mode.

Development sessions do not expose health write tools or prompts from enabled plugins. They expose only draft-development tools.

## Draft lifecycle

A development Agent can:

1. Create one self-contained `.js` / `.mjs` draft.
2. Read and replace complete source with optimistic revision checks.
3. Run syntax and no-import validation.
4. Restore a bounded historical revision as a new revision.
5. Inspect the descriptor and runtime in a disposable sandbox.
6. Execute a selected tool with synthetic JSON arguments.

Draft source, SHA-256, diagnostics, inspection metadata, test output, and up to 20 source revisions stay in IndexedDB and full backups. Model-generated drafts are capped at 256 KiB even though manual local plugin upload retains the broader 2 MiB limit.

Restoring a full backup discards saved inspection/test approval metadata and requires every draft to pass zero-permission sandbox inspection again.

## Sandbox testing

Static validation does not execute source. It checks:

- valid ESM syntax
- one self-contained file
- no static or dynamic imports
- source-size bounds
- SHA-256

Sandbox inspection is a separate step. It starts an opaque-origin iframe Worker with **no host-service permissions**, then validates:

- manifest and exact SemVer
- safe configuration/default schema
- settings metadata
- no more than 32 runtime tools
- provider-compatible, plugin-namespaced, unique tool names
- safe tool parameter schemas
- a System Prompt no longer than 4,000 characters

Tool tests use a fresh zero-permission sandbox and the normal bounded RPC and strict result validator. `profile.read`, `logs.read`, `storage`, and `network` are denied even if the draft manifest declares them. A tool that requires those services can be fully exercised only after reviewed installation and explicit enabling.

Every inspection/test success or failure disposes its iframe, Worker, ports, and client. Safari and iOS WebKit remain fail-closed.

## Installation

The Agent cannot install or enable a draft.

The user must open the review UI and inspect:

- complete source
- exact SHA-256
- manifest and version
- permissions
- runtime tools
- System Prompt

A separate checkbox confirms the reviewed revision. Installation then uses the existing local-plugin path, re-executes and revalidates the exact source, persists a descriptor snapshot, and leaves the plugin **disabled**. Enabling remains a separate action in Plugin Settings.

## Inline sharing

A sandbox-inspected draft up to 48 KiB can produce an inline share URL:

```text
https://<kalo-origin>/plugins/import#plugin=<gzip-base64url-envelope>
```

The versioned envelope contains:

```json
{
  "format": "kalo-plugin-share",
  "version": 1,
  "fileName": "example.js",
  "source": "...",
  "size": 1234,
  "sha256": "..."
}
```

Kalo-generated links use a URL **fragment**, not a query parameter. Fragments are not sent to Cloudflare, server logs, or referrers. The importer also accepts `?plugin=` for compatibility, but query payloads have already reached the hosting server and should not be used for private source.

Opening a link:

1. Captures and immediately removes the payload from the visible address.
2. Performs bounded gzip decompression.
3. Validates envelope fields, source size, SHA-256, ESM syntax, and imports.
4. Displays complete source without executing it.

Only an explicit **Inspect in zero-permission sandbox** action executes source. Installation requires another review checkbox and remains disabled.

Inline tokens are capped at 96 KiB and source at 48 KiB. Browser/OS sharing limits can still be lower. Larger plugins should be published as exact-version npm or JSR packages.

## Security limitations

- Model-generated source is untrusted.
- Sandbox isolation cannot make tool semantics or System Prompt content trustworthy.
- A plugin can receive model-selected arguments after it is enabled.
- Granted network/service permissions can expose their documented data.
- Never hard-code API keys, passwords, tokens, health data, or other secrets.
- Shared URL source can be copied into history, chats, screenshots, or third-party apps.
- Opening or inspecting a draft does not grant permission; enabling an installed plugin is the permission boundary.

See also:

- [`packages/plugin-sdk/README.md`](../packages/plugin-sdk/README.md)
- [`webkit-plugin-sandbox-validation.md`](./webkit-plugin-sandbox-validation.md)
