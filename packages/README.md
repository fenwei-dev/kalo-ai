# Shared and plugin packages

Reusable packages for the Kalo AI Bun monorepo belong here. Each package has its own `package.json` and is discovered by `packages/*`.

Current packages:

- `plugin-sdk` — typed plugin manifest, config fields, Agent tools, services, and System Prompt extension contract.
- `plugin-example` — disabled-by-default example proving all schema-driven setting types, tool injection, and prompt injection.
- `plugin-mcdonalds-sg` — bundled McDonald's Singapore nutrition lookup backed by an automatically refreshed static snapshot.
