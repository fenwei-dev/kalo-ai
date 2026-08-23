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

## Monorepo layout

This repository is a Bun workspace:

```text
apps/
  web/       SvelteKit PWA
packages/    Shared packages added over time
```

The root scripts proxy the web workspace, so the usual commands remain unchanged.

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

Large language models may provide inaccurate information because their knowledge can be wrong, outdated, or hallucinated. This project does not provide medical, nutritional, or other professional advice.

## License

This project is licensed under the [MIT License](./LICENSE).
