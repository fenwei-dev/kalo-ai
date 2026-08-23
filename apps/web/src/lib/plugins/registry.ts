import { examplePlugin } from "@kalo-ai/plugin-example";
import { mcdonaldsSGPlugin } from "@kalo-ai/plugin-mcdonalds-sg";
import type { KaloPlugin } from "@kalo-ai/plugin-sdk";

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

export const bundledPlugins: readonly KaloPlugin[] = [
	mcdonaldsSGPlugin,
	examplePlugin,
];

const pluginsById = new Map<string, KaloPlugin>();
for (const plugin of bundledPlugins) {
	if (!PLUGIN_ID_PATTERN.test(plugin.manifest.id)) {
		throw new Error(`Invalid plugin id: ${plugin.manifest.id}`);
	}
	if (plugin.manifest.apiVersion !== 1) {
		throw new Error(`Unsupported plugin API version for ${plugin.manifest.id}`);
	}
	if (pluginsById.has(plugin.manifest.id)) {
		throw new Error(`Duplicate plugin id: ${plugin.manifest.id}`);
	}
	pluginsById.set(plugin.manifest.id, plugin);
}

export function getPlugin(pluginId: string): KaloPlugin | undefined {
	return pluginsById.get(pluginId);
}
