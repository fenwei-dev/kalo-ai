import {
	definePlugin,
	type KaloPlugin,
	type KaloPluginDefinition,
	type LocalizedText,
	type PluginJsonObject,
	type PluginJsonValue,
	type PluginManifest,
	type PluginPermission,
	type PluginSettingField,
	type TSchema,
} from "@kalo-ai/plugin-sdk";
import type { PluginInstallation, PluginPackageRegistry } from "$lib/db/schema";

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const NPM_PACKAGE_PATTERN =
	/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const JSR_PACKAGE_PATTERN = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const EXACT_VERSION_PATTERN =
	/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SETTING_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;
const REMOTE_IMPORT_TIMEOUT_MS = 30_000;
const MAX_CONFIG_SCHEMA_LENGTH = 100_000;
const MAX_SETTING_FIELDS = 50;
const PERMISSIONS: readonly PluginPermission[] = [
	"network",
	"profile.read",
	"logs.read",
	"logs.write",
	"storage",
];

export interface ParsedPluginPackageSpecifier {
	registry: PluginPackageRegistry;
	packageName: string;
	packageVersion: string;
	canonicalSpecifier: string;
}

export type RemotePluginImporter = (url: string) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is PluginJsonValue {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	) {
		return true;
	}
	if (Array.isArray(value)) return value.every(isJsonValue);
	return isJsonObject(value);
}

function isJsonObject(value: unknown): value is PluginJsonObject {
	return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isLocalizedText(value: unknown): value is LocalizedText {
	return (
		isRecord(value) &&
		typeof value["zh-cn"] === "string" &&
		value["zh-cn"].trim().length > 0 &&
		value["zh-cn"].length <= 200 &&
		typeof value["en-us"] === "string" &&
		value["en-us"].trim().length > 0 &&
		value["en-us"].length <= 200
	);
}

function isPermission(value: unknown): value is PluginPermission {
	return (
		typeof value === "string" &&
		PERMISSIONS.some((permission) => permission === value)
	);
}

export function isPluginManifest(value: unknown): value is PluginManifest {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		value.id.length > 64 ||
		!PLUGIN_ID_PATTERN.test(value.id) ||
		value.apiVersion !== 1 ||
		typeof value.version !== "string" ||
		value.version.trim().length === 0 ||
		value.version.length > 100 ||
		typeof value.configVersion !== "number" ||
		!Number.isInteger(value.configVersion) ||
		value.configVersion < 1 ||
		!isLocalizedText(value.name) ||
		!isLocalizedText(value.description) ||
		(value.defaultEnabled !== undefined &&
			typeof value.defaultEnabled !== "boolean") ||
		(value.permissions !== undefined &&
			(!Array.isArray(value.permissions) ||
				!value.permissions.every(isPermission)))
	) {
		return false;
	}
	return (
		value.permissions === undefined ||
		new Set(value.permissions).size === value.permissions.length
	);
}

function isSettingField(
	value: unknown,
): value is PluginSettingField<PluginJsonObject> {
	if (
		!isRecord(value) ||
		typeof value.key !== "string" ||
		!SETTING_KEY_PATTERN.test(value.key) ||
		["__proto__", "prototype", "constructor"].includes(value.key) ||
		!isLocalizedText(value.label) ||
		(value.description !== undefined && !isLocalizedText(value.description)) ||
		typeof value.type !== "string"
	) {
		return false;
	}
	if (value.type === "text" || value.type === "password") {
		return (
			(value.placeholder === undefined || isLocalizedText(value.placeholder)) &&
			(value.secret === undefined || typeof value.secret === "boolean")
		);
	}
	if (value.type === "number") {
		return [value.min, value.max, value.step].every(
			(item) =>
				item === undefined ||
				(typeof item === "number" && Number.isFinite(item)),
		);
	}
	if (value.type === "toggle") return true;
	if (value.type !== "select" || !Array.isArray(value.options)) return false;
	return value.options.every(
		(option) =>
			isRecord(option) &&
			typeof option.value === "string" &&
			isLocalizedText(option.label),
	);
}

function hasValidSettings(plugin: KaloPlugin): boolean {
	return (
		plugin.settings === undefined ||
		(Array.isArray(plugin.settings.fields) &&
			plugin.settings.fields.length <= MAX_SETTING_FIELDS &&
			plugin.settings.fields.every(isSettingField) &&
			new Set(plugin.settings.fields.map((field) => field.key)).size ===
				plugin.settings.fields.length)
	);
}

function isPluginDefinition(
	value: unknown,
): value is KaloPluginDefinition<TSchema, PluginJsonObject> {
	return (
		isRecord(value) &&
		isPluginManifest(value.manifest) &&
		isRecord(value.configSchema) &&
		isJsonObject(value.defaultConfig) &&
		typeof value.createTools === "function" &&
		(value.systemPrompt === undefined ||
			typeof value.systemPrompt === "function") &&
		(value.isConfigured === undefined ||
			typeof value.isConfigured === "function") &&
		(value.migrateConfig === undefined ||
			typeof value.migrateConfig === "function")
	);
}

function isKaloPlugin(value: unknown): value is KaloPlugin {
	return (
		isRecord(value) &&
		isPluginManifest(value.manifest) &&
		isRecord(value.configSchema) &&
		isJsonObject(value.defaultConfig) &&
		typeof value.validateConfig === "function" &&
		typeof value.isConfigured === "function" &&
		typeof value.createTools === "function" &&
		typeof value.systemPrompt === "function" &&
		(value.migrateConfig === undefined ||
			typeof value.migrateConfig === "function")
	);
}

function normalizePlugin(candidate: unknown): KaloPlugin {
	const plugin = isKaloPlugin(candidate)
		? candidate
		: isPluginDefinition(candidate)
			? definePlugin(candidate)
			: null;
	if (!plugin) {
		throw new Error(
			"Package must default-export a Kalo plugin or export it as kaloPlugin",
		);
	}
	if (!hasValidSettings(plugin))
		throw new Error("Plugin settings schema is invalid");
	let serializedSchema = "";
	try {
		serializedSchema = JSON.stringify(plugin.configSchema);
	} catch (error) {
		throw new Error("Plugin configuration schema is not serializable", {
			cause: error,
		});
	}
	if (!serializedSchema || serializedSchema.length > MAX_CONFIG_SCHEMA_LENGTH) {
		throw new Error("Plugin configuration schema is empty or too large");
	}
	let defaultConfigValid = false;
	try {
		defaultConfigValid = plugin.validateConfig(plugin.defaultConfig);
	} catch (error) {
		throw new Error("Plugin default configuration validation failed", {
			cause: error,
		});
	}
	if (!defaultConfigValid)
		throw new Error("Plugin default configuration is invalid");
	return plugin;
}

export function parsePluginPackageSpecifier(
	input: string,
): ParsedPluginPackageSpecifier {
	const specifier = input.trim();
	const prefix = /^(npm|jsr):/.exec(specifier)?.[1];
	if (prefix !== "npm" && prefix !== "jsr") {
		throw new Error('插件地址必须以 "npm:" 或 "jsr:" 开头');
	}
	const packageAndVersion = specifier.slice(prefix.length + 1);
	const versionSeparator = packageAndVersion.lastIndexOf("@");
	if (versionSeparator <= 0) {
		throw new Error("必须提供精确版本，例如 npm:@scope/plugin@1.2.3");
	}
	const packageName = packageAndVersion.slice(0, versionSeparator);
	const packageVersion = packageAndVersion.slice(versionSeparator + 1);
	const packagePattern =
		prefix === "npm" ? NPM_PACKAGE_PATTERN : JSR_PACKAGE_PATTERN;
	if (packageName.length > 214 || !packagePattern.test(packageName)) {
		throw new Error(`无效的 ${prefix} package 名称`);
	}
	if (!EXACT_VERSION_PATTERN.test(packageVersion)) {
		throw new Error(
			"插件必须固定到精确语义化版本，不支持 latest、tag 或版本范围",
		);
	}
	return {
		registry: prefix,
		packageName,
		packageVersion,
		canonicalSpecifier: `${prefix}:${packageName}@${packageVersion}`,
	};
}

export function remotePluginModuleUrl(
	source: Pick<
		ParsedPluginPackageSpecifier,
		"registry" | "packageName" | "packageVersion"
	>,
): string {
	const packagePath = `${source.packageName}@${source.packageVersion}`;
	const registryPath =
		source.registry === "jsr" ? `jsr/${packagePath}` : packagePath;
	return `https://esm.sh/${registryPath}?bundle&target=es2022`;
}

export function pluginInstallationSpecifier(
	installation: Pick<
		PluginInstallation,
		"registry" | "packageName" | "packageVersion"
	>,
): string {
	return `${installation.registry}:${installation.packageName}@${installation.packageVersion}`;
}

const browserImporter: RemotePluginImporter = (url) =>
	import(/* @vite-ignore */ url) as Promise<unknown>;

export async function importRemotePlugin(
	source: Pick<
		ParsedPluginPackageSpecifier,
		"registry" | "packageName" | "packageVersion"
	>,
	importer: RemotePluginImporter = browserImporter,
): Promise<KaloPlugin> {
	const url = remotePluginModuleUrl(source);
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const module = await Promise.race([
			importer(url),
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(
					() => reject(new Error("加载远程插件超时")),
					REMOTE_IMPORT_TIMEOUT_MS,
				);
			}),
		]);
		if (!isRecord(module)) throw new Error("插件 package 没有有效的 ESM 导出");
		return normalizePlugin(module.kaloPlugin ?? module.default);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

export function clonePluginManifest(manifest: PluginManifest): PluginManifest {
	return {
		id: manifest.id,
		apiVersion: manifest.apiVersion,
		version: manifest.version,
		configVersion: manifest.configVersion,
		name: { ...manifest.name },
		description: { ...manifest.description },
		permissions: manifest.permissions ? [...manifest.permissions] : undefined,
		defaultEnabled: manifest.defaultEnabled,
	};
}
