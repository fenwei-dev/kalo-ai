# Shared and plugin packages

Reusable packages for the Kalo AI Bun monorepo belong here. Each package has its own `package.json` and is discovered by `packages/*`.

All plugin packages use the same module entry contract: the plugin object is available as both the default export and the named `kaloPlugin` export. Bundled packages may retain an additional descriptive alias for source compatibility.

Current packages:

- `plugin-sdk` — typed plugin manifest, config fields, Agent tools, services, System Prompt extension contract, and npm/JSR package export documentation.
- `plugin-example` — publishable npm/JSR reference plugin proving schema-driven settings, tool injection, prompt injection, and migration.
- `plugin-mcdonalds-sg` — bundled McDonald's Singapore nutrition lookup backed by an automatically refreshed static snapshot.
- `plugin-subway-sg` — bundled Subway Singapore nutrition lookup backed by an automatically refreshed static snapshot.
- `plugin-kfc-sg` — bundled KFC Singapore nutrition and allergen lookup backed by an automatically refreshed static snapshot.
