# @kalo-ai/plugin-example

[![npm version](https://img.shields.io/npm/v/@kalo-ai/plugin-example?logo=npm)](https://www.npmjs.com/package/@kalo-ai/plugin-example)
[![JSR version](https://img.shields.io/jsr/v/@kalo-ai/plugin-example?logo=jsr)](https://jsr.io/@kalo-ai/plugin-example)

Reference Kalo plugin demonstrating the standard `default` / `kaloPlugin` export contract, schema-driven settings, an Agent tool, a bounded System Prompt extension, configuration migration, and secret-field warnings.

## Install in Kalo

After this package is published, open **Settings → Plugins** and use one exact reference:

```text
npm:@kalo-ai/plugin-example@0.1.0
jsr:@kalo-ai/plugin-example@0.1.0
```

Kalo downloads the final self-contained esm.sh bundle once, stores the JavaScript and SHA-256 in IndexedDB, and loads it offline afterward. Newly installed plugins remain disabled until explicitly enabled.

## Tool

```text
example_echo
```

The tool is only intended for explicit testing. It applies the configured prefix, output mode, repeat count, and uppercase option.

## Settings demonstrated

- text
- password / secret warning
- number
- toggle
- select
- config migration from version 1 to 2

The example password value is stored locally for UI testing and is not returned by the tool.

## Package exports

```ts
export const examplePlugin = definePlugin({ /* ... */ });
export const kaloPlugin = examplePlugin;
export default kaloPlugin;
```

## Publishing

`package.json` is the only version source. Validate both artifacts before a release:

```bash
bun run --filter @kalo-ai/plugin-example build
bun run --filter @kalo-ai/plugin-example pack:check
cd packages/plugin-example
bun run prepare:jsr
VERSION="$(node -p "require('./package.json').version")"
cd .jsr-publish
deno publish --dry-run --set-version "$VERSION"
cd ../../..
```

### Initial registry bootstrap only

The first npm version must be published interactively because Trusted Publisher settings live on an existing package. Run npm directly so Passkey/WebAuthn can use the terminal:

```bash
npm login --auth-type=web
cd packages/plugin-example
npm publish --access public --auth-type=web
```

Create `@kalo-ai/plugin-example` on JSR, link it to `fenwei-dev/kalo-ai`, then publish the same version from the isolated JSR staging directory. The staging step rewrites the workspace SDK import to the explicit constraint `jsr:@kalo-ai/plugin-sdk@^0.1.1`, preventing an unversioned workspace dependency from reaching JSR:

```bash
bun run prepare:jsr
VERSION="$(node -p "require('./package.json').version")"
cd .jsr-publish
deno publish --set-version "$VERSION"
cd ../../..
```

Deno applies a 24-hour minimum dependency age by default. If the newly published SDK is still too recent, wait until `@kalo-ai/plugin-sdk@0.1.1` is at least 24 hours old instead of disabling the policy.

After npm bootstrap, configure its Trusted Publisher with GitHub owner `fenwei-dev`, repository `kalo-ai`, workflow filename `publish-plugin-example.yml`, no environment, and the `npm publish` allowed action.

Except for this initial bootstrap, do not publish npm or JSR versions manually. Use the GitHub OIDC workflow for subsequent releases.

### Subsequent releases through GitHub Actions

```bash
cd packages/plugin-example
npm version patch --no-git-tag-version
cd ../..
bun install --ignore-scripts
bun run check
bun test
bun run build

VERSION="$(node -p "require('./packages/plugin-example/package.json').version")"
git add packages/plugin-example/package.json bun.lock
git commit -m "chore(plugin-example): release $VERSION"
git push origin main
git tag -a "plugin-example-v$VERSION" -m "plugin-example v$VERSION"
git push origin "plugin-example-v$VERSION"
```

The workflow publishes npm and JSR with GitHub OIDC. Existing versions are skipped safely during recovery runs.

## Security

Kalo executes this plugin in an opaque-origin iframe Worker sandbox. It declares no host-service permissions; direct DOM, IndexedDB, browser-storage, and network access are blocked. Its tools and System Prompt still influence Agent behavior, so review the exact package version before enabling it.
