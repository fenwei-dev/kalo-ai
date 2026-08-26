# @kalo-ai/plugin-sdk

[![npm version](https://img.shields.io/npm/v/@kalo-ai/plugin-sdk?logo=npm)](https://www.npmjs.com/package/@kalo-ai/plugin-sdk)
[![JSR version](https://img.shields.io/jsr/v/@kalo-ai/plugin-sdk?logo=jsr)](https://jsr.io/@kalo-ai/plugin-sdk)

Typed contract for Kalo plugins. A plugin can contribute Agent tools, a bounded System Prompt section, schema-driven settings, and scoped services.

## Install the SDK

npm:

```bash
npm install @kalo-ai/plugin-sdk
```

JSR / Deno:

```bash
deno add jsr:@kalo-ai/plugin-sdk
```

The npm package is ESM-only and publishes compiled JavaScript plus declarations from `dist/`. CommonJS callers must use dynamic `import()`. The JSR package publishes the TypeScript source entry directly.

## Package export contract

A Kalo plugin package installed at runtime must be an ESM package and either:

- default-export a `KaloPlugin`; or
- export a `KaloPlugin` named `kaloPlugin`.

A package may export either the object returned by `definePlugin()` or a compatible raw plugin definition. The manifest version must equal the exact npm/JSR package version. Runtime dependencies, including this SDK when used, must be resolvable from the published package.

```ts
import { definePlugin, Type } from "@kalo-ai/plugin-sdk";

export default definePlugin({
	manifest: {
		id: "example_remote",
		apiVersion: 1,
		version: "1.0.0",
		configVersion: 1,
		name: { "zh-cn": "远程示例", "en-us": "Remote example" },
		description: { "zh-cn": "示例插件", "en-us": "Example plugin" },
		defaultEnabled: false,
	},
	configSchema: Type.Object({}),
	defaultConfig: {},
	createTools: () => [],
});
```

Tool names must start with `${pluginId}_`, be provider-compatible, and remain globally unique. User-installed tool descriptors cross a JSON RPC boundary; `name`, `label`, `description`, `parameters`, `executionMode`, `constrainedSampling`, and `execute` are supported. Additional function-valued hooks such as a custom `prepareArguments` cannot cross the sandbox boundary and should not be used by registry or local plugins.

## Importing one local JavaScript file

Kalo can import one self-contained browser ESM `.js` or `.mjs` file up to 2 MiB. The final file must contain no static imports, dynamic imports, relative imports, bare package imports, or URL imports. Bundle this SDK and every other dependency into one output before selecting the file:

```bash
bun build src/plugin.ts \
  --outfile dist/plugin.js \
  --format esm \
  --target browser
```

The local file uses the same default / `kaloPlugin` export contract. Kalo shows its size and SHA-256 before executing it, stores the exact source in IndexedDB for offline use, and includes it in full backups. Replacing a local plugin with different source requires a new `manifest.version` and forces the plugin back to disabled.

## Installing from a registry

Kalo accepts only exact package versions:

```text
npm:package@1.2.3
npm:@scope/package@1.2.3
jsr:@scope/package@1.2.3
```

Tags such as `latest`, semver ranges, arbitrary URLs, and unversioned packages are rejected. Kalo resolves the package through `https://esm.sh`, follows `X-ESM-Path` to the final self-contained bundle, rejects any remaining imports, and stores the exact JavaScript plus SHA-256 in IndexedDB. Network access is needed for installation, not for later use. At most 10 user-installed registry and local plugins can be stored. Newly installed and backup-restored plugins are disabled until the user explicitly enables them.

## Publishing this SDK

Maintainers can validate both artifacts locally:

```bash
bun run --filter @kalo-ai/plugin-sdk build
bun run --filter @kalo-ai/plugin-sdk pack:check
cd packages/plugin-sdk
VERSION="$(node -p "require('./package.json').version")"
deno publish --dry-run --set-version "$VERSION"
cd ../..
```

`package.json` is the single version source. The standard `jsr.json` deliberately has no version; Deno discovers it from the SDK directory and receives the npm package version through `--set-version`.

### Initial registry bootstrap only

Publishing requires ownership of the `@kalo-ai` scope in each registry. The first npm version must be published interactively because Trusted Publisher settings live on an existing package. Run npm directly so Passkey/WebAuthn can use the terminal and browser challenge; `bun run --filter` may capture the child process and suppress that flow:

```bash
cd packages/plugin-sdk
npm publish --access public
VERSION="$(node -p "require('./package.json').version")"
deno publish --set-version "$VERSION"
cd ../..
```

After the first npm publish, configure the package's Trusted Publisher with GitHub owner `fenwei-dev`, repository `kalo-ai`, workflow filename `publish-plugin-sdk.yml`, no environment, and the `npm publish` allowed action. For JSR, create `@kalo-ai/plugin-sdk` and link it to `fenwei-dev/kalo-ai`.

Except for this initial bootstrap, **do not publish npm or JSR releases manually**. Local publishing bypasses the normal GitHub OIDC release path, can leave the two registries on different versions, and may omit or complicate provenance. Reserve it for exceptional recovery only.

### Subsequent releases through GitHub Actions

Bump the single npm version source, regenerate the workspace lockfile, and validate both artifacts:

```bash
cd packages/plugin-sdk
npm version patch --no-git-tag-version
cd ../..
bun install --ignore-scripts
bun run check
bun test
bun run build
```

Commit and push the release change before tagging it. Then derive the tag from `package.json` so the version is never typed a second time:

```bash
VERSION="$(node -p "require('./packages/plugin-sdk/package.json').version")"
git add packages/plugin-sdk/package.json bun.lock
git commit -m "chore(plugin-sdk): release $VERSION"
git push origin main
git tag -a "plugin-sdk-v$VERSION" -m "plugin-sdk v$VERSION"
git push origin "plugin-sdk-v$VERSION"
```

The `plugin-sdk-v<version>` tag triggers `.github/workflows/publish-plugin-sdk.yml`, which validates and publishes the same version to npm and JSR with GitHub OIDC and no long-lived registry token. The workflow is safe to dispatch again for recovery: an existing npm version is skipped, while JSR treats an existing version as a no-op. A manual workflow dispatch is available for recovery, but version tags are the recommended, auditable release path.

## Security boundary

Runtime-installed registry packages and local files execute inside an opaque-origin sandboxed iframe and dedicated Worker. A deny-by-default CSP blocks direct DOM, IndexedDB, Cache Storage, localStorage, fetch, WebSocket, navigation, and same-origin access. `context.services` calls cross a size- and timeout-bounded MessageChannel; the host enforces declared permissions, scopes storage by plugin ID, limits values, and restricts network requests to public HTTPS without credentials. Tool calls receive a longer timeout than service calls; timeout first sends AbortSignal cancellation, then recycles an unresponsive Worker after a grace period. Public-HTTPS URL checks block local, private, link-local, mapped, multicast, and reserved IP literals, but browser-side policy cannot completely prevent DNS rebinding.

The installation-time manifest, permissions, config schema, defaults, and settings are canonicalized and pinned by a descriptor SHA-256. Runtime descriptor drift forces the plugin off and requires reinstalling it; service authorization always uses the installed permission snapshot rather than a newly returned manifest.

This boundary protects Kalo's browser origin, but it cannot eliminate browser-engine vulnerabilities or all CPU/memory denial-of-service risks, and it does not make plugin semantics trustworthy. User-installed plugins remain fail-closed on Safari and iOS WebKit; see [`docs/webkit-plugin-sandbox-validation.md`](../../docs/webkit-plugin-sandbox-validation.md). The `logs.write` permission is reserved for a future audited write API and currently exposes no service. Agent-selected tool arguments may contain conversation or health data, an approved service can expose its documented snapshot, network-capable plugins can transmit data they legitimately receive, and System Prompt text can influence model behavior. Install only independently reviewed code from a trusted publisher and exact version.
