# Kalo AI

**English** | [简体中文](./README_zh.md)

**An agent-native, local-first companion for healthy weight loss.**

Express what you need in natural language, and Kalo uses tools to help query, log, revise, and delete food, exercise, weight, and goal data while providing ongoing guidance based on your personal records.

## Highlights

- **Agent-native**: The agent understands natural-language intent and uses tools to help users operate their data.
- **Local first**: Health records and the API key are stored in browser IndexedDB.
- **No application backend**: The app runs entirely in the frontend, and AI requests go directly from the browser to the model service configured by the user.
- **Bring your own model**: Supports OpenAI Completions, OpenAI Responses, and Anthropic Messages protocols.
- **Complete tracking**: Food, exercise, weight, goals, daily summaries, and trend analysis.
- **Installable PWA**: Statically deployable, with offline access to the application shell and local data.
- **Bilingual**: Supports Simplified Chinese and English.
- **Plugin system**: Reviewed bundled packages and exact-version npm/JSR Kalo plugins can add Agent tools, bounded System Prompt sections, and schema-driven settings.
- **Singapore restaurant nutrition**: Bundled, offline Agent tools cover McDonald's, Subway, and KFC Singapore using reviewable static snapshots.

## Monorepo layout

This repository is a Bun workspace:

```text
apps/
  web/       SvelteKit PWA
packages/
  plugin-sdk/             Stable plugin contract
  plugin-example/         Disabled-by-default integration example
  plugin-mcdonalds-sg/    McDonald's Singapore nutrition snapshot tools
  plugin-subway-sg/       Subway Singapore nutrition snapshot tools
  plugin-kfc-sg/          KFC Singapore nutrition and allergen snapshot tools
  ...                     Additional shared and plugin packages
```

The root scripts proxy the web workspace, so the usual commands remain unchanged.

## npm / JSR plugin packages

From **Settings → Plugins**, users can import Kalo plugin packages pinned to exact versions:

```text
npm:package@1.2.3
npm:@scope/package@1.2.3
jsr:@scope/package@1.2.3
```

Kalo rejects tags, ranges, unversioned references, and arbitrary URLs. Browser modules are resolved through esm.sh, installed packages start disabled, and restored packages must be explicitly re-enabled. See [`packages/plugin-sdk/README.md`](./packages/plugin-sdk/README.md) for the package export contract and security boundary.

### Releasing `@kalo-ai/plugin-sdk`

After the initial registry bootstrap, do not publish npm or JSR versions manually. `packages/plugin-sdk/package.json` is the single version source; bump it, validate the repository, commit and push, then create a version tag that triggers the dual-registry GitHub Actions workflow:

```sh
cd packages/plugin-sdk
npm version patch --no-git-tag-version
cd ../..
bun install --ignore-scripts
bun run check
bun test
bun run build

VERSION="$(node -p "require('./packages/plugin-sdk/package.json').version")"
git add packages/plugin-sdk/package.json bun.lock
git commit -m "chore(plugin-sdk): release $VERSION"
git push origin main
git tag -a "plugin-sdk-v$VERSION" -m "plugin-sdk v$VERSION"
git push origin "plugin-sdk-v$VERSION"
```

The tag publishes the same version to npm and JSR through GitHub OIDC. Full bootstrap, recovery, Passkey, and dry-run instructions are in [`packages/plugin-sdk/README.md`](./packages/plugin-sdk/README.md#publishing-this-sdk).

## Development

```sh
bun install
bun run dev
```

Check, test, format, and build:

```sh
bun run check
bun test
bun run fmt
bun run build
```

To run the web package directly:

```sh
bun run --filter @kalo-ai/web dev
```

## Deployment

The web package uses SvelteKit adapter-static. Production assets are written to `apps/web/build/`.

The root `wrangler.jsonc` serves that directory with SPA fallback. Deploy to Cloudflare from the repository root:

```sh
bun run deploy
```

## Privacy and disclaimer

The app has no application backend. Health data and the API key stay in the current browser, while AI requests are sent directly to the user-configured service. The API key is stored in plain text in IndexedDB and is included in full backup exports.

User-installed npm/JSR plugins are fetched through esm.sh and execute as unsandboxed third-party JavaScript in the same browser context as Kalo. They may directly access local health data, chats, and the AI API key regardless of declared permissions. Install only exact versions of code you have independently reviewed and trust.

Large language models may provide inaccurate information because their knowledge can be wrong, outdated, or hallucinated. This project does not provide medical, nutritional, or other professional advice.

## License

This project is licensed under the [MIT License](./LICENSE).
