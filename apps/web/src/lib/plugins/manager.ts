import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
	type KaloPlugin,
	type PluginJsonObject,
	type PluginJsonValue,
	type PluginLocale,
	type PluginPermission,
	Type,
} from "@kalo-ai/plugin-sdk";
import {
	deletePluginConfig,
	deletePluginInstallation,
	getPluginConfig,
	getPluginInstallation,
	getPluginModule,
	listPluginInstallations,
	savePluginConfig,
	savePluginInstallationWithModule,
} from "$lib/db/repositories";
import type { PluginInstallation, PluginPackageRegistry } from "$lib/db/schema";
import { clonePluginManifest } from "./contract";
import {
	assertInstalledDescriptorMatches,
	createPluginDescriptorSnapshot,
} from "./descriptorPolicy";
import {
	type PreparedLocalPluginFile,
	verifyPreparedLocalPlugin,
} from "./local";
import { bundledPlugins, getPlugin } from "./registry";
import {
	type DownloadedRemotePluginModule,
	downloadRemotePluginModule,
	parsePluginPackageSpecifier,
	pluginInstallationSpecifier,
} from "./remote";
import { safeCheckPluginConfig } from "./safeSchema";
import { SandboxPluginClient } from "./sandbox";
import { createPluginServices } from "./services";

const TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const MAX_PLUGIN_PROMPT_LENGTH = 4_000;
const MAX_TOTAL_PLUGIN_PROMPT_LENGTH = 12_000;
const MAX_INSTALLED_PLUGIN_PACKAGES = 10;
const MAX_TOOLS_PER_PLUGIN = 32;
let installQueue: Promise<void> = Promise.resolve();

async function withPluginInstallLock<T>(
	operation: () => Promise<T>,
): Promise<T> {
	if (typeof navigator !== "undefined" && navigator.locks) {
		return navigator.locks.request("kalo-plugin-install", operation);
	}
	const previous = installQueue;
	let release: () => void = () => undefined;
	installQueue = new Promise<void>((resolve) => {
		release = resolve;
	});
	await previous;
	try {
		return await operation();
	} finally {
		release();
	}
}

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
	runtimeError?: string;
}

export type PluginModuleExecutor = (
	source: string,
	debugName: string,
) => Promise<KaloPlugin>;

const installedPluginCache = new Map<string, Promise<KaloPlugin>>();
const sandboxClientByPlugin = new WeakMap<KaloPlugin, SandboxPluginClient>();
const activeSandboxClients = new Map<string, SandboxPluginClient>();
const pluginRuntimeErrors = new Map<string, string>();

async function executeSandboxedModule(
	source: string,
	debugName: string,
	grantedPermissions: readonly PluginPermission[] = [],
): Promise<KaloPlugin> {
	const client = await SandboxPluginClient.create(
		source,
		debugName,
		grantedPermissions,
	);
	const plugin = client.proxyPlugin;
	sandboxClientByPlugin.set(plugin, client);
	return plugin;
}

function sandboxClient(plugin: KaloPlugin): SandboxPluginClient | undefined {
	return sandboxClientByPlugin.get(plugin);
}

function activateSandboxPlugin(plugin: KaloPlugin): void {
	const client = sandboxClient(plugin);
	if (!client) return;
	const previous = activeSandboxClients.get(plugin.manifest.id);
	if (previous !== client) previous?.dispose();
	activeSandboxClients.set(plugin.manifest.id, client);
}

function disposeSandboxCandidate(plugin: KaloPlugin): void {
	const client = sandboxClient(plugin);
	if (client && activeSandboxClients.get(plugin.manifest.id) !== client) {
		client.dispose();
	}
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

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function withRuntimeError(state: PluginState): PluginState {
	const runtimeError = pluginRuntimeErrors.get(state.plugin.manifest.id);
	return runtimeError ? { ...state, runtimeError } : state;
}

function sourceForInstallation(installation: PluginInstallation): PluginSource {
	return {
		type: installation.registry,
		packageName: installation.packageName,
		packageVersion: installation.packageVersion,
	};
}

function installedPluginCacheKey(pluginId: string, sha256: string): string {
	return `${pluginId}:${sha256}`;
}

function evictInstalledPlugin(pluginId: string): void {
	activeSandboxClients.get(pluginId)?.dispose();
	activeSandboxClients.delete(pluginId);
	for (const key of installedPluginCache.keys()) {
		if (key.startsWith(`${pluginId}:`)) installedPluginCache.delete(key);
	}
}

function rememberInstalledPlugin(
	pluginId: string,
	sha256: string,
	plugin: KaloPlugin,
): void {
	pluginRuntimeErrors.delete(pluginId);
	activateSandboxPlugin(plugin);
	installedPluginCache.set(
		installedPluginCacheKey(pluginId, sha256),
		Promise.resolve(plugin),
	);
}

async function loadInstalledPlugin(
	installation: PluginInstallation,
): Promise<KaloPlugin> {
	const storedModule = await getPluginModule(installation.pluginId);
	const cacheKey = storedModule
		? installedPluginCacheKey(installation.pluginId, storedModule.sha256)
		: `${installation.pluginId}:source:${installation.registry}:${installation.packageVersion}`;
	let pending = installedPluginCache.get(cacheKey);
	if (!pending) {
		pending = (async () => {
			if (storedModule) {
				if (
					(installation.moduleSha256 &&
						installation.moduleSha256 !== storedModule.sha256) ||
					(installation.moduleSize &&
						installation.moduleSize !== storedModule.size)
				) {
					throw new Error("插件模块与安装记录的 hash 或大小不一致");
				}
				return executeSandboxedModule(
					storedModule.source,
					storedModule.fileName,
					installation.manifest.permissions,
				);
			}
			if (installation.registry === "local") {
				throw new Error("本地插件源码不存在，请重新上传插件文件");
			}
			const source = {
				registry: installation.registry,
				packageName: installation.packageName,
				packageVersion: installation.packageVersion,
				canonicalSpecifier: `${installation.registry}:${installation.packageName}@${installation.packageVersion}`,
			};
			const downloaded = await downloadRemotePluginModule(source);
			const plugin = await executeSandboxedModule(
				downloaded.source,
				`${installation.pluginId}-${installation.packageVersion}.js`,
				installation.manifest.permissions,
			);
			await savePluginInstallationWithModule(
				{
					...installation,
					moduleSha256: downloaded.sha256,
					moduleSize: downloaded.size,
				},
				{
					pluginId: installation.pluginId,
					source: downloaded.source,
					sha256: downloaded.sha256,
					size: downloaded.size,
					fileName: `${installation.pluginId}-${installation.packageVersion}.js`,
					sourceUrl: downloaded.sourceUrl,
				},
			);
			return plugin;
		})().catch((error) => {
			installedPluginCache.delete(cacheKey);
			throw error;
		});
		installedPluginCache.set(cacheKey, pending);
	}
	const plugin = await pending;
	const client = sandboxClient(plugin);
	if (
		client?.disposed ||
		(client &&
			!client.permissionsMatch(installation.manifest.permissions ?? []))
	) {
		evictInstalledPlugin(installation.pluginId);
		return loadInstalledPlugin(installation);
	}
	try {
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
		await assertInstalledDescriptorMatches(plugin, installation);
	} catch (error) {
		disposeSandboxCandidate(plugin);
		installedPluginCache.delete(cacheKey);
		const config = await getPluginConfig(installation.pluginId);
		if (config?.enabled) {
			await savePluginConfig({ ...config, enabled: false });
		}
		throw error;
	}
	activateSandboxPlugin(plugin);
	const currentModule =
		storedModule ?? (await getPluginModule(installation.pluginId));
	if (currentModule) {
		installedPluginCache.set(
			installedPluginCacheKey(installation.pluginId, currentModule.sha256),
			Promise.resolve(plugin),
		);
	}
	return plugin;
}

function unavailablePlugin(installation: PluginInstallation): KaloPlugin {
	const configSchema = installation.descriptor?.configSchema ?? Type.Object({});
	return {
		manifest: {
			...clonePluginManifest(installation.manifest),
			defaultEnabled: false,
		},
		configSchema,
		defaultConfig: installation.descriptor?.defaultConfig ?? {},
		settings: installation.descriptor?.settings,
		validateConfig: (config) => safeCheckPluginConfig(configSchema, config),
		isConfigured: () => true,
		createTools: () => [],
		systemPrompt: () => "",
	};
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

async function isPluginConfigured(
	plugin: KaloPlugin,
	config: PluginJsonObject,
): Promise<boolean> {
	const client = sandboxClient(plugin);
	return client ? client.isConfigured(config) : plugin.isConfigured(config);
}

async function migratePluginConfig(
	plugin: KaloPlugin,
	config: PluginJsonObject,
	fromVersion: number,
): Promise<PluginJsonObject> {
	const client = sandboxClient(plugin);
	if (client) return client.migrateConfig(config, fromVersion);
	if (!plugin.migrateConfig)
		throw new Error("Plugin does not support migration");
	return plugin.migrateConfig(config, fromVersion);
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
			config = await migratePluginConfig(plugin, config, configVersion);
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
		configured = validConfig && (await isPluginConfigured(plugin, config));
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
	return [...bundledStates, ...installedStates].map(withRuntimeError);
}

export async function getPluginState(
	pluginId: string,
): Promise<PluginState | null> {
	const bundled = getPlugin(pluginId);
	if (bundled) {
		return withRuntimeError(
			await resolvePluginState(bundled, { type: "bundled" }),
		);
	}
	const installation = await getPluginInstallation(pluginId);
	return installation
		? withRuntimeError(await summarizeInstalledState(installation))
		: null;
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
	let state = await getLoadablePluginState(pluginId);
	if (enabled && state.installation && !sandboxClient(state.plugin)) {
		state = await resolveInstalledState(state.installation);
		if (state.status === "load_error") {
			throw new Error(`插件加载失败：${state.loadError ?? "未知错误"}`);
		}
	}
	const plugin = state.plugin;
	if (!plugin.validateConfig(config)) throw new Error("插件配置格式无效");
	if (enabled && !(await isPluginConfigured(plugin, config)))
		throw new Error("请先完成插件必填配置");
	await savePluginConfig({
		pluginId,
		enabled,
		configVersion: plugin.manifest.configVersion,
		config: cloneConfig(config),
	});
	const resolved = await resolvePluginState(
		plugin,
		state.source,
		state.installation,
	);
	if (!enabled && state.installation) evictInstalledPlugin(pluginId);
	return resolved;
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
	const resolved = await resolvePluginState(
		state.plugin,
		state.source,
		state.installation,
	);
	if (state.installation) evictInstalledPlugin(pluginId);
	return resolved;
}

export async function installPluginPackage(
	packageSpecifier: string,
	downloader: (
		source: ReturnType<typeof parsePluginPackageSpecifier>,
	) => Promise<DownloadedRemotePluginModule> = downloadRemotePluginModule,
	executor: PluginModuleExecutor = executeSandboxedModule,
): Promise<PluginState> {
	return withPluginInstallLock(() =>
		installPluginPackageUnlocked(packageSpecifier, downloader, executor),
	);
}

async function installPluginPackageUnlocked(
	packageSpecifier: string,
	downloader: (
		source: ReturnType<typeof parsePluginPackageSpecifier>,
	) => Promise<DownloadedRemotePluginModule> = downloadRemotePluginModule,
	executor: PluginModuleExecutor = executeSandboxedModule,
): Promise<PluginState> {
	const source = parsePluginPackageSpecifier(packageSpecifier);
	const installations = await listPluginInstallations();
	const samePackage = installations.find(
		(record) =>
			record.registry === source.registry &&
			record.packageName === source.packageName,
	);
	if (!samePackage && installations.length >= MAX_INSTALLED_PLUGIN_PACKAGES) {
		throw new Error(`最多只能安装 ${MAX_INSTALLED_PLUGIN_PACKAGES} 个插件`);
	}

	let downloaded: DownloadedRemotePluginModule;
	let plugin: KaloPlugin;
	try {
		downloaded = await downloader(source);
		plugin = await executor(
			downloaded.source,
			`${source.packageName}@${source.packageVersion}.js`,
		);
	} catch (error) {
		throw new Error(
			`无法加载 ${source.canonicalSpecifier}：${errorMessage(error)}`,
		);
	}
	if (plugin.manifest.version !== source.packageVersion) {
		disposeSandboxCandidate(plugin);
		throw new Error(
			`插件 manifest 版本 ${plugin.manifest.version} 与 package 版本 ${source.packageVersion} 不一致`,
		);
	}
	if (getPlugin(plugin.manifest.id)) {
		disposeSandboxCandidate(plugin);
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
		disposeSandboxCandidate(plugin);
		throw new Error(`插件 ID ${plugin.manifest.id} 已由其他来源使用`);
	}
	if (samePackage && samePackage.pluginId !== plugin.manifest.id) {
		disposeSandboxCandidate(plugin);
		throw new Error(
			`该 package 已安装为插件 ${samePackage.pluginId}，新版本导出了不同 ID`,
		);
	}
	let descriptor: Awaited<ReturnType<typeof createPluginDescriptorSnapshot>>;
	try {
		descriptor = await createPluginDescriptorSnapshot(plugin);
	} catch (error) {
		disposeSandboxCandidate(plugin);
		throw error;
	}

	// Every install or update revokes activation until the user reviews the new
	// descriptor and explicitly enables it again.
	const existingConfig = await getPluginConfig(plugin.manifest.id);
	await savePluginConfig({
		pluginId: plugin.manifest.id,
		enabled: false,
		configVersion:
			existingConfig?.configVersion ?? plugin.manifest.configVersion,
		config: existingConfig
			? cloneConfig(existingConfig.config)
			: cloneConfig(plugin.defaultConfig),
	});
	let saved: Awaited<ReturnType<typeof savePluginInstallationWithModule>>;
	try {
		saved = await savePluginInstallationWithModule(
			{
				pluginId: plugin.manifest.id,
				registry: source.registry,
				packageName: source.packageName,
				packageVersion: source.packageVersion,
				moduleSha256: downloaded.sha256,
				moduleSize: downloaded.size,
				manifest: clonePluginManifest(plugin.manifest),
				descriptor,
			},
			{
				pluginId: plugin.manifest.id,
				source: downloaded.source,
				sha256: downloaded.sha256,
				size: downloaded.size,
				fileName: `${plugin.manifest.id}-${source.packageVersion}.js`,
				sourceUrl: downloaded.sourceUrl,
			},
		);
	} catch (error) {
		disposeSandboxCandidate(plugin);
		if (!sameId) await deletePluginConfig(plugin.manifest.id);
		throw error;
	}
	if (sameId) evictInstalledPlugin(sameId.pluginId);
	rememberInstalledPlugin(plugin.manifest.id, downloaded.sha256, plugin);
	return resolvePluginState(
		plugin,
		sourceForInstallation(saved.installation),
		saved.installation,
	);
}

const LOCAL_PLUGIN_VERSION_PATTERN =
	/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export async function installLocalPlugin(
	prepared: PreparedLocalPluginFile,
	executor: PluginModuleExecutor = executeSandboxedModule,
): Promise<PluginState> {
	return withPluginInstallLock(() =>
		installLocalPluginUnlocked(prepared, executor),
	);
}

async function installLocalPluginUnlocked(
	prepared: PreparedLocalPluginFile,
	executor: PluginModuleExecutor,
): Promise<PluginState> {
	await verifyPreparedLocalPlugin(prepared);
	const plugin = await executor(prepared.source, prepared.fileName);
	if (!LOCAL_PLUGIN_VERSION_PATTERN.test(plugin.manifest.version)) {
		disposeSandboxCandidate(plugin);
		throw new Error("本地插件 manifest.version 必须是有效的 SemVer");
	}
	if (getPlugin(plugin.manifest.id)) {
		disposeSandboxCandidate(plugin);
		throw new Error(`插件 ID ${plugin.manifest.id} 与内置插件冲突`);
	}
	const installations = await listPluginInstallations();
	const sameId = installations.find(
		(record) => record.pluginId === plugin.manifest.id,
	);
	if (sameId && sameId.registry !== "local") {
		disposeSandboxCandidate(plugin);
		throw new Error(`插件 ID ${plugin.manifest.id} 已由 registry package 使用`);
	}
	if (!sameId && installations.length >= MAX_INSTALLED_PLUGIN_PACKAGES) {
		disposeSandboxCandidate(plugin);
		throw new Error(`最多只能安装 ${MAX_INSTALLED_PLUGIN_PACKAGES} 个插件`);
	}
	if (
		sameId &&
		sameId.moduleSha256 !== prepared.sha256 &&
		sameId.packageVersion === plugin.manifest.version
	) {
		disposeSandboxCandidate(plugin);
		throw new Error("替换本地插件文件时必须更新 manifest.version");
	}
	let descriptor: Awaited<ReturnType<typeof createPluginDescriptorSnapshot>>;
	try {
		descriptor = await createPluginDescriptorSnapshot(plugin);
	} catch (error) {
		disposeSandboxCandidate(plugin);
		throw error;
	}

	const existingConfig = await getPluginConfig(plugin.manifest.id);
	await savePluginConfig({
		pluginId: plugin.manifest.id,
		enabled: false,
		configVersion:
			existingConfig?.configVersion ?? plugin.manifest.configVersion,
		config: existingConfig
			? cloneConfig(existingConfig.config)
			: cloneConfig(plugin.defaultConfig),
	});
	let saved: Awaited<ReturnType<typeof savePluginInstallationWithModule>>;
	try {
		saved = await savePluginInstallationWithModule(
			{
				pluginId: plugin.manifest.id,
				registry: "local",
				packageName: prepared.fileName,
				packageVersion: plugin.manifest.version,
				moduleSha256: prepared.sha256,
				moduleSize: prepared.size,
				manifest: clonePluginManifest(plugin.manifest),
				descriptor,
			},
			{
				pluginId: plugin.manifest.id,
				source: prepared.source,
				sha256: prepared.sha256,
				size: prepared.size,
				fileName: prepared.fileName,
			},
		);
	} catch (error) {
		disposeSandboxCandidate(plugin);
		if (!sameId) await deletePluginConfig(plugin.manifest.id);
		throw error;
	}
	if (sameId) evictInstalledPlugin(sameId.pluginId);
	rememberInstalledPlugin(plugin.manifest.id, prepared.sha256, plugin);
	return resolvePluginState(
		plugin,
		sourceForInstallation(saved.installation),
		saved.installation,
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
	evictInstalledPlugin(pluginId);
	return summarizeInstalledState(installation);
}

export async function removePluginPackage(pluginId: string): Promise<void> {
	if (getPlugin(pluginId)) throw new Error("内置插件不能移除");
	const installation = await getPluginInstallation(pluginId);
	if (!installation) throw new Error("未找到已安装的插件");
	await deletePluginInstallation(pluginId);
	evictInstalledPlugin(pluginId);
	pluginRuntimeErrors.delete(pluginId);
}

export function pluginSourceLabel(state: PluginState): string {
	return state.installation
		? pluginInstallationSpecifier(state.installation)
		: "bundled";
}

export async function getInstalledPluginSource(pluginId: string) {
	return (await getPluginModule(pluginId)) ?? null;
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
			const client = sandboxClient(plugin);
			let pluginTools: AgentTool[];
			let prompt: string;
			if (client) {
				const runtime = await client.runtime(state.config, locale);
				pluginRuntimeErrors.delete(plugin.manifest.id);
				pluginTools = runtime.tools.map((tool) =>
					client.createToolProxy(tool, (error) => {
						pluginRuntimeErrors.set(plugin.manifest.id, errorMessage(error));
					}),
				);
				prompt = runtime.prompt.trim();
			} else {
				const context = {
					config: state.config,
					locale,
					services: createPluginServices(plugin.manifest.id),
				};
				pluginTools = plugin.createTools(context);
				prompt = plugin.systemPrompt(context).trim();
			}
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
			if (sandboxClient(plugin)) {
				pluginRuntimeErrors.set(plugin.manifest.id, errorMessage(error));
				evictInstalledPlugin(plugin.manifest.id);
			}
			console.error(`Failed to initialize plugin ${plugin.manifest.id}`, error);
		}
	}
	return { tools, promptSections };
}
