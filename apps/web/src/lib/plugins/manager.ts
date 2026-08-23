import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
	definePlugin,
	type KaloPlugin,
	type PluginJsonObject,
	type PluginJsonValue,
	type PluginLocale,
	Type,
} from "@kalo-ai/plugin-sdk";
import {
	deletePluginConfig,
	deletePluginInstallation,
	getPluginConfig,
	getPluginInstallation,
	listPluginInstallations,
	savePluginConfig,
	savePluginInstallation,
} from "$lib/db/repositories";
import type { PluginInstallation, PluginPackageRegistry } from "$lib/db/schema";
import { bundledPlugins, getPlugin } from "./registry";
import {
	clonePluginManifest,
	importRemotePlugin,
	parsePluginPackageSpecifier,
	pluginInstallationSpecifier,
	type RemotePluginImporter,
} from "./remote";
import { createPluginServices } from "./services";

const TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const MAX_PLUGIN_PROMPT_LENGTH = 4_000;
const MAX_TOTAL_PLUGIN_PROMPT_LENGTH = 12_000;
const MAX_INSTALLED_PLUGIN_PACKAGES = 10;
const MAX_TOOLS_PER_PLUGIN = 32;

export type PluginStateStatus =
	| "ready"
	| "disabled"
	| "needs_config"
	| "invalid_config"
	| "incompatible"
	| "load_error";

export type PluginSource =
	| { type: "bundled" }
	| {
			type: PluginPackageRegistry;
			packageName: string;
			packageVersion: string;
	  };

export interface PluginState {
	plugin: KaloPlugin;
	source: PluginSource;
	installation?: PluginInstallation;
	enabled: boolean;
	config: PluginJsonObject;
	status: PluginStateStatus;
	updatedAt: number | null;
	loadError?: string;
}

const remotePluginCache = new Map<string, Promise<KaloPlugin>>();

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

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sourceForInstallation(installation: PluginInstallation): PluginSource {
	return {
		type: installation.registry,
		packageName: installation.packageName,
		packageVersion: installation.packageVersion,
	};
}

function installationCacheKey(
	installation: Pick<
		PluginInstallation,
		"registry" | "packageName" | "packageVersion"
	>,
): string {
	return `${installation.registry}:${installation.packageName}@${installation.packageVersion}`;
}

function rememberRemotePlugin(
	installation: Pick<
		PluginInstallation,
		"registry" | "packageName" | "packageVersion"
	>,
	plugin: KaloPlugin,
): void {
	remotePluginCache.set(
		installationCacheKey(installation),
		Promise.resolve(plugin),
	);
}

async function loadInstalledPlugin(
	installation: PluginInstallation,
): Promise<KaloPlugin> {
	const key = installationCacheKey(installation);
	let pending = remotePluginCache.get(key);
	if (!pending) {
		pending = importRemotePlugin(installation).catch((error) => {
			remotePluginCache.delete(key);
			throw error;
		});
		remotePluginCache.set(key, pending);
	}
	const plugin = await pending;
	if (plugin.manifest.id !== installation.pluginId) {
		throw new Error(
			`Package now exports plugin id ${plugin.manifest.id}, expected ${installation.pluginId}`,
		);
	}
	if (plugin.manifest.version !== installation.packageVersion) {
		throw new Error(
			`Package version ${installation.packageVersion} exports plugin version ${plugin.manifest.version}`,
		);
	}
	return plugin;
}

function unavailablePlugin(installation: PluginInstallation): KaloPlugin {
	return definePlugin({
		manifest: {
			...clonePluginManifest(installation.manifest),
			defaultEnabled: false,
		},
		configSchema: Type.Object({}),
		defaultConfig: {},
		createTools: () => [],
	});
}

async function loadErrorState(
	installation: PluginInstallation,
	error: unknown,
): Promise<PluginState> {
	const record = await getPluginConfig(installation.pluginId);
	return {
		plugin: unavailablePlugin(installation),
		source: sourceForInstallation(installation),
		installation,
		enabled: record?.enabled ?? false,
		config: record ? cloneConfig(record.config) : {},
		status: "load_error",
		updatedAt: record?.updatedAt ?? installation.updatedAt,
		loadError: errorMessage(error),
	};
}

async function resolvePluginState(
	plugin: KaloPlugin,
	source: PluginSource,
	installation?: PluginInstallation,
): Promise<PluginState> {
	let record = await getPluginConfig(plugin.manifest.id);
	let config: PluginJsonObject = record
		? cloneConfig(record.config)
		: cloneConfig(plugin.defaultConfig);
	let configVersion = record?.configVersion ?? plugin.manifest.configVersion;
	const defaultEnabled =
		source.type === "bundled"
			? (plugin.manifest.defaultEnabled ?? false)
			: false;

	if (configVersion > plugin.manifest.configVersion) {
		return {
			plugin,
			source,
			installation,
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
				source,
				installation,
				enabled: false,
				config,
				status: "incompatible",
				updatedAt: record?.updatedAt ?? null,
			};
		}
		try {
			config = plugin.migrateConfig(config, configVersion);
			configVersion = plugin.manifest.configVersion;
		} catch {
			return {
				plugin,
				source,
				installation,
				enabled: false,
				config,
				status: "invalid_config",
				updatedAt: record?.updatedAt ?? null,
			};
		}
		if (!plugin.validateConfig(config)) {
			return {
				plugin,
				source,
				installation,
				enabled: false,
				config,
				status: "invalid_config",
				updatedAt: record?.updatedAt ?? null,
			};
		}
		record = await savePluginConfig({
			pluginId: plugin.manifest.id,
			enabled: record?.enabled ?? defaultEnabled,
			configVersion,
			config,
		});
	}

	let validConfig = false;
	let configured = false;
	try {
		validConfig = plugin.validateConfig(config);
		configured = validConfig && plugin.isConfigured(config);
	} catch {
		validConfig = false;
	}
	if (!validConfig) {
		return {
			plugin,
			source,
			installation,
			enabled: false,
			config,
			status: "invalid_config",
			updatedAt: record?.updatedAt ?? null,
		};
	}
	if (!configured) {
		return {
			plugin,
			source,
			installation,
			enabled: false,
			config,
			status: "needs_config",
			updatedAt: record?.updatedAt ?? null,
		};
	}
	const enabled = record?.enabled ?? defaultEnabled;
	return {
		plugin,
		source,
		installation,
		enabled,
		config,
		status: enabled ? "ready" : "disabled",
		updatedAt: record?.updatedAt ?? null,
	};
}

async function summarizeInstalledState(
	installation: PluginInstallation,
): Promise<PluginState> {
	const record = await getPluginConfig(installation.pluginId);
	if (record?.enabled) return resolveInstalledState(installation);
	return {
		plugin: unavailablePlugin(installation),
		source: sourceForInstallation(installation),
		installation,
		enabled: false,
		config: record ? cloneConfig(record.config) : {},
		status: "disabled",
		updatedAt: record?.updatedAt ?? installation.updatedAt,
	};
}

async function resolveInstalledState(
	installation: PluginInstallation,
): Promise<PluginState> {
	if (getPlugin(installation.pluginId)) {
		return loadErrorState(
			installation,
			new Error("Plugin id conflicts with a bundled plugin"),
		);
	}
	try {
		const plugin = await loadInstalledPlugin(installation);
		const state = await resolvePluginState(
			plugin,
			sourceForInstallation(installation),
			installation,
		);
		return state;
	} catch (error) {
		return loadErrorState(installation, error);
	}
}

export async function getPluginStates(): Promise<PluginState[]> {
	const bundledStates = await Promise.all(
		bundledPlugins.map((plugin) =>
			resolvePluginState(plugin, { type: "bundled" }),
		),
	);
	const installations = await listPluginInstallations();
	const installedStates = await Promise.all(
		installations.map(summarizeInstalledState),
	);
	return [...bundledStates, ...installedStates];
}

export async function getPluginState(
	pluginId: string,
): Promise<PluginState | null> {
	const bundled = getPlugin(pluginId);
	if (bundled) return resolvePluginState(bundled, { type: "bundled" });
	const installation = await getPluginInstallation(pluginId);
	return installation ? resolveInstalledState(installation) : null;
}

async function getLoadablePluginState(pluginId: string): Promise<PluginState> {
	const state = await getPluginState(pluginId);
	if (!state) throw new Error("插件不存在");
	if (state.status === "load_error") {
		throw new Error(`插件加载失败：${state.loadError ?? "未知错误"}`);
	}
	return state;
}

export async function savePluginSettings(
	pluginId: string,
	config: PluginJsonObject,
	enabled: boolean,
): Promise<PluginState> {
	const state = await getLoadablePluginState(pluginId);
	const plugin = state.plugin;
	if (!plugin.validateConfig(config)) throw new Error("插件配置格式无效");
	if (enabled && !plugin.isConfigured(config))
		throw new Error("请先完成插件必填配置");
	await savePluginConfig({
		pluginId,
		enabled,
		configVersion: plugin.manifest.configVersion,
		config: cloneConfig(config),
	});
	return resolvePluginState(plugin, state.source, state.installation);
}

export async function setPluginEnabled(
	pluginId: string,
	enabled: boolean,
): Promise<PluginState> {
	const state = await getLoadablePluginState(pluginId);
	return savePluginSettings(pluginId, state.config, enabled);
}

export async function resetPluginSettings(
	pluginId: string,
): Promise<PluginState> {
	const state = await getLoadablePluginState(pluginId);
	await deletePluginConfig(pluginId);
	return resolvePluginState(state.plugin, state.source, state.installation);
}

export async function installPluginPackage(
	packageSpecifier: string,
	importer?: RemotePluginImporter,
): Promise<PluginState> {
	const source = parsePluginPackageSpecifier(packageSpecifier);
	const installations = await listPluginInstallations();
	const samePackage = installations.find(
		(record) =>
			record.registry === source.registry &&
			record.packageName === source.packageName,
	);
	if (!samePackage && installations.length >= MAX_INSTALLED_PLUGIN_PACKAGES) {
		throw new Error(`最多只能安装 ${MAX_INSTALLED_PLUGIN_PACKAGES} 个远程插件`);
	}

	let plugin: KaloPlugin;
	try {
		plugin = await importRemotePlugin(source, importer);
	} catch (error) {
		throw new Error(
			`无法加载 ${source.canonicalSpecifier}：${errorMessage(error)}`,
		);
	}
	if (plugin.manifest.version !== source.packageVersion) {
		throw new Error(
			`插件 manifest 版本 ${plugin.manifest.version} 与 package 版本 ${source.packageVersion} 不一致`,
		);
	}
	if (getPlugin(plugin.manifest.id)) {
		throw new Error(`插件 ID ${plugin.manifest.id} 与内置插件冲突`);
	}
	const sameId = installations.find(
		(record) => record.pluginId === plugin.manifest.id,
	);
	if (
		sameId &&
		(sameId.registry !== source.registry ||
			sameId.packageName !== source.packageName)
	) {
		throw new Error(`插件 ID ${plugin.manifest.id} 已由其他 package 使用`);
	}
	if (samePackage && samePackage.pluginId !== plugin.manifest.id) {
		throw new Error(
			`该 package 已安装为插件 ${samePackage.pluginId}，新版本导出了不同 ID`,
		);
	}

	const installation = await savePluginInstallation({
		pluginId: plugin.manifest.id,
		registry: source.registry,
		packageName: source.packageName,
		packageVersion: source.packageVersion,
		manifest: clonePluginManifest(plugin.manifest),
	});
	if (!sameId) {
		// Importing code is already sensitive; activation always requires a second,
		// explicit user action even when the package requests defaultEnabled.
		await savePluginConfig({
			pluginId: plugin.manifest.id,
			enabled: false,
			configVersion: plugin.manifest.configVersion,
			config: cloneConfig(plugin.defaultConfig),
		});
	}
	if (sameId) remotePluginCache.delete(installationCacheKey(sameId));
	rememberRemotePlugin(installation, plugin);
	return resolvePluginState(
		plugin,
		sourceForInstallation(installation),
		installation,
	);
}

export async function disableInstalledPlugin(
	pluginId: string,
): Promise<PluginState> {
	const installation = await getPluginInstallation(pluginId);
	if (!installation) throw new Error("未找到已安装的插件");
	const record = await getPluginConfig(pluginId);
	await savePluginConfig({
		pluginId,
		enabled: false,
		configVersion: record?.configVersion ?? installation.manifest.configVersion,
		config: record ? cloneConfig(record.config) : {},
	});
	return summarizeInstalledState(installation);
}

export async function removePluginPackage(pluginId: string): Promise<void> {
	if (getPlugin(pluginId)) throw new Error("内置插件不能移除");
	const installation = await getPluginInstallation(pluginId);
	if (!installation) throw new Error("未找到已安装的插件");
	await deletePluginInstallation(pluginId);
	remotePluginCache.delete(installationCacheKey(installation));
}

export function pluginSourceLabel(state: PluginState): string {
	return state.installation
		? pluginInstallationSpecifier(state.installation)
		: "bundled";
}

export interface PluginRuntime {
	tools: AgentTool[];
	promptSections: string[];
}

async function getRuntimePluginStates(): Promise<PluginState[]> {
	const bundledStates = await Promise.all(
		bundledPlugins.map((plugin) =>
			resolvePluginState(plugin, { type: "bundled" }),
		),
	);
	const installations = await listPluginInstallations();
	const enabledInstallations = (
		await Promise.all(
			installations.map(async (installation) => ({
				installation,
				config: await getPluginConfig(installation.pluginId),
			})),
		)
	).filter((entry) => entry.config?.enabled === true);
	const installedStates = await Promise.all(
		enabledInstallations.map((entry) =>
			resolveInstalledState(entry.installation),
		),
	);
	return [...bundledStates, ...installedStates];
}

export async function loadPluginRuntime(
	locale: PluginLocale,
	reservedToolNames: readonly string[],
): Promise<PluginRuntime> {
	const tools: AgentTool[] = [];
	const promptSections: string[] = [];
	const toolNames = new Set(reservedToolNames);
	let promptLength = 0;

	for (const state of await getRuntimePluginStates()) {
		if (!state.enabled || state.status !== "ready") continue;
		const plugin = state.plugin;
		try {
			const context = {
				config: state.config,
				locale,
				services: createPluginServices(plugin.manifest.id),
			};
			const pluginTools = plugin.createTools(context);
			if (
				!Array.isArray(pluginTools) ||
				pluginTools.length > MAX_TOOLS_PER_PLUGIN
			) {
				throw new Error(
					`Plugin ${plugin.manifest.id} returned too many tools or a non-array value`,
				);
			}
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
