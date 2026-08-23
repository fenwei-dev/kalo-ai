import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
	KaloPlugin,
	PluginJsonObject,
	PluginJsonValue,
	PluginLocale,
} from "@kalo-ai/plugin-sdk";
import {
	deletePluginConfig,
	getPluginConfig,
	savePluginConfig,
} from "$lib/db/repositories";
import { bundledPlugins, getPlugin } from "./registry";
import { createPluginServices } from "./services";

const TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const MAX_PLUGIN_PROMPT_LENGTH = 4_000;
const MAX_TOTAL_PLUGIN_PROMPT_LENGTH = 12_000;

export type PluginStateStatus =
	| "ready"
	| "disabled"
	| "needs_config"
	| "invalid_config"
	| "incompatible";

export interface PluginState {
	plugin: KaloPlugin;
	enabled: boolean;
	config: PluginJsonObject;
	status: PluginStateStatus;
	updatedAt: number | null;
}

function cloneJsonValue(value: PluginJsonValue): PluginJsonValue {
	if (Array.isArray(value)) return value.map(cloneJsonValue);
	if (value !== null && typeof value === "object") {
		const cloned: PluginJsonObject = {};
		for (const [key, item] of Object.entries(value)) {
			cloned[key] = cloneJsonValue(item);
		}
		return cloned;
	}
	return value;
}

function cloneConfig(config: PluginJsonObject): PluginJsonObject {
	const cloned: PluginJsonObject = {};
	for (const [key, value] of Object.entries(config)) {
		cloned[key] = cloneJsonValue(value);
	}
	return cloned;
}

async function resolvePluginState(plugin: KaloPlugin): Promise<PluginState> {
	let record = await getPluginConfig(plugin.manifest.id);
	let config: PluginJsonObject = record
		? cloneConfig(record.config)
		: cloneConfig(plugin.defaultConfig);
	let configVersion = record?.configVersion ?? plugin.manifest.configVersion;

	if (configVersion > plugin.manifest.configVersion) {
		return {
			plugin,
			enabled: false,
			config,
			status: "incompatible",
			updatedAt: record?.updatedAt ?? null,
		};
	}
	if (configVersion < plugin.manifest.configVersion) {
		if (!plugin.migrateConfig) {
			return {
				plugin,
				enabled: false,
				config,
				status: "incompatible",
				updatedAt: record?.updatedAt ?? null,
			};
		}
		config = plugin.migrateConfig(config, configVersion);
		configVersion = plugin.manifest.configVersion;
		if (!plugin.validateConfig(config)) {
			return {
				plugin,
				enabled: false,
				config,
				status: "invalid_config",
				updatedAt: record?.updatedAt ?? null,
			};
		}
		record = await savePluginConfig({
			pluginId: plugin.manifest.id,
			enabled: record?.enabled ?? plugin.manifest.defaultEnabled ?? false,
			configVersion,
			config,
		});
	}

	const enabled = record?.enabled ?? plugin.manifest.defaultEnabled ?? false;
	if (!plugin.validateConfig(config)) {
		return {
			plugin,
			enabled: false,
			config,
			status: "invalid_config",
			updatedAt: record?.updatedAt ?? null,
		};
	}
	if (!plugin.isConfigured(config)) {
		return {
			plugin,
			enabled: false,
			config,
			status: "needs_config",
			updatedAt: record?.updatedAt ?? null,
		};
	}
	return {
		plugin,
		enabled,
		config,
		status: enabled ? "ready" : "disabled",
		updatedAt: record?.updatedAt ?? null,
	};
}

export async function getPluginStates(): Promise<PluginState[]> {
	return Promise.all(bundledPlugins.map(resolvePluginState));
}

export async function getPluginState(
	pluginId: string,
): Promise<PluginState | null> {
	const plugin = getPlugin(pluginId);
	return plugin ? resolvePluginState(plugin) : null;
}

export async function savePluginSettings(
	pluginId: string,
	config: PluginJsonObject,
	enabled: boolean,
): Promise<PluginState> {
	const plugin = getPlugin(pluginId);
	if (!plugin) throw new Error("插件不存在或未打包进当前应用");
	if (!plugin.validateConfig(config)) throw new Error("插件配置格式无效");
	if (enabled && !plugin.isConfigured(config))
		throw new Error("请先完成插件必填配置");
	await savePluginConfig({
		pluginId,
		enabled,
		configVersion: plugin.manifest.configVersion,
		config: cloneConfig(config),
	});
	return resolvePluginState(plugin);
}

export async function setPluginEnabled(
	pluginId: string,
	enabled: boolean,
): Promise<PluginState> {
	const state = await getPluginState(pluginId);
	if (!state) throw new Error("插件不存在或未打包进当前应用");
	return savePluginSettings(pluginId, state.config, enabled);
}

export async function resetPluginSettings(
	pluginId: string,
): Promise<PluginState> {
	const plugin = getPlugin(pluginId);
	if (!plugin) throw new Error("插件不存在或未打包进当前应用");
	await deletePluginConfig(pluginId);
	return resolvePluginState(plugin);
}

export interface PluginRuntime {
	tools: AgentTool[];
	promptSections: string[];
}

export async function loadPluginRuntime(
	locale: PluginLocale,
	reservedToolNames: readonly string[],
): Promise<PluginRuntime> {
	const tools: AgentTool[] = [];
	const promptSections: string[] = [];
	const toolNames = new Set(reservedToolNames);
	let promptLength = 0;

	for (const state of await getPluginStates()) {
		if (!state.enabled || state.status !== "ready") continue;
		const plugin = state.plugin;
		try {
			const context = {
				config: state.config,
				locale,
				services: createPluginServices(plugin.manifest.id),
			};
			const pluginTools = plugin.createTools(context);
			const localToolNames = new Set<string>();
			for (const tool of pluginTools) {
				if (!TOOL_NAME_PATTERN.test(tool.name)) {
					throw new Error(`Invalid tool name: ${tool.name}`);
				}
				if (!tool.name.startsWith(`${plugin.manifest.id}_`)) {
					throw new Error(
						`Plugin tool ${tool.name} must start with ${plugin.manifest.id}_`,
					);
				}
				if (toolNames.has(tool.name) || localToolNames.has(tool.name)) {
					throw new Error(`Duplicate tool name: ${tool.name}`);
				}
				localToolNames.add(tool.name);
			}

			const prompt = plugin.systemPrompt(context).trim();
			let section = "";
			if (prompt) {
				if (prompt.length > MAX_PLUGIN_PROMPT_LENGTH) {
					throw new Error(`Plugin prompt is too long: ${plugin.manifest.id}`);
				}
				section = `### Plugin: ${plugin.manifest.id}\n${prompt}`;
				if (promptLength + section.length > MAX_TOTAL_PLUGIN_PROMPT_LENGTH) {
					throw new Error("Total plugin prompt length exceeded");
				}
			}

			for (const name of localToolNames) toolNames.add(name);
			tools.push(...pluginTools);
			if (section) {
				promptSections.push(section);
				promptLength += section.length;
			}
		} catch (error) {
			console.error(`Failed to initialize plugin ${plugin.manifest.id}`, error);
		}
	}
	return { tools, promptSections };
}
