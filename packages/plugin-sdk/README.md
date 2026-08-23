# @kalo-ai/plugin-sdk

Typed contract for Kalo plugins. A plugin can contribute Agent tools, a bounded System Prompt section, schema-driven settings, and scoped services.

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

Tool names must start with `${pluginId}_`, be provider-compatible, and remain globally unique.

## Installing from a registry

Kalo accepts only exact package versions:

```text
npm:package@1.2.3
npm:@scope/package@1.2.3
jsr:@scope/package@1.2.3
```

Tags such as `latest`, semver ranges, arbitrary URLs, and unversioned packages are rejected. Browser modules are resolved through `https://esm.sh` and therefore need network access after a fresh application load. At most 10 remote packages can be installed. Newly installed and backup-restored packages are disabled until the user explicitly enables them.

## Security boundary

Runtime-installed packages are **not sandboxed**. Importing the package immediately executes third-party JavaScript in Kalo's browser context. It can potentially access IndexedDB, local health data, chats, plugin secrets, and the AI API key directly, regardless of declared permissions. Permission declarations are informational, not a security control. Install only independently reviewed code from a trusted publisher and exact version.
