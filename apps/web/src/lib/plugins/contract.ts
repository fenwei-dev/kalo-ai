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

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const SETTING_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;
const MAX_CONFIG_SCHEMA_LENGTH = 100_000;
const MAX_SETTING_FIELDS = 50;
const PERMISSIONS: readonly PluginPermission[] = [
	"network",
	"profile.read",
	"logs.read",
	"logs.write",
	"storage",
];

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

export function isPluginSettings(
	value: unknown,
): value is { fields: PluginSettingField<PluginJsonObject>[] } | undefined {
	if (value === undefined) return true;
	if (!isRecord(value) || !Array.isArray(value.fields)) return false;
	return (
		value.fields.length <= MAX_SETTING_FIELDS &&
		value.fields.every(isSettingField) &&
		new Set(value.fields.map((field) => field.key)).size === value.fields.length
	);
}

function hasValidSettings(plugin: KaloPlugin): boolean {
	return isPluginSettings(plugin.settings);
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

export function normalizePluginModule(module: unknown): KaloPlugin {
	if (!isRecord(module)) throw new Error("插件模块没有有效的 ESM 导出");
	const candidate = module.kaloPlugin ?? module.default;
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
