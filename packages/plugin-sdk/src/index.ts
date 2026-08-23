import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";

export type { AgentTool, Static, TSchema };
export { StringEnum, Type };

export type PluginLocale = "zh-cn" | "en-us";
export type PluginJsonPrimitive = string | number | boolean | null;
export type PluginJsonValue =
	| PluginJsonPrimitive
	| PluginJsonObject
	| PluginJsonValue[];
export interface PluginJsonObject {
	[key: string]: PluginJsonValue;
}

export interface LocalizedText {
	"zh-cn": string;
	"en-us": string;
}

export type PluginPermission =
	| "network"
	| "profile.read"
	| "logs.read"
	| "logs.write"
	| "storage";

export interface PluginManifest {
	id: string;
	apiVersion: 1;
	version: string;
	configVersion: number;
	name: LocalizedText;
	description: LocalizedText;
	permissions?: PluginPermission[];
	defaultEnabled?: boolean;
}

interface SettingBase<TConfig extends PluginJsonObject> {
	key: Extract<keyof TConfig, string>;
	label: LocalizedText;
	description?: LocalizedText;
}

export type PluginSettingField<TConfig extends PluginJsonObject> =
	| (SettingBase<TConfig> & {
			type: "text" | "password";
			placeholder?: LocalizedText;
			secret?: boolean;
	  })
	| (SettingBase<TConfig> & {
			type: "number";
			min?: number;
			max?: number;
			step?: number;
	  })
	| (SettingBase<TConfig> & {
			type: "toggle";
	  })
	| (SettingBase<TConfig> & {
			type: "select";
			options: { value: string; label: LocalizedText }[];
	  });

export interface PluginProfileSnapshot {
	age: number;
	gender: "male" | "female";
	height: number;
	currentWeight: number;
	activityLevel: string;
	targetWeight?: number;
	targetDate?: string;
}

export interface PluginDaySnapshot {
	date: string;
	food: PluginJsonValue[];
	exercise: PluginJsonValue[];
	weights: PluginJsonValue[];
}

export interface PluginScopedStorage {
	get(key: string): Promise<PluginJsonValue | undefined>;
	set(key: string, value: PluginJsonValue): Promise<void>;
	delete(key: string): Promise<void>;
}

export interface PluginServices {
	profile: {
		get(): Promise<PluginProfileSnapshot | null>;
	};
	logs: {
		getDay(date: string): Promise<PluginDaySnapshot>;
	};
	storage: PluginScopedStorage;
	fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface PluginToolOutcome {
	ok: boolean;
	data: PluginJsonValue;
	error?: string;
}

export interface KaloPluginContext<TConfig extends PluginJsonObject> {
	config: Readonly<TConfig>;
	locale: PluginLocale;
	services: PluginServices;
}

export interface KaloPluginDefinition<
	TConfigSchema extends TSchema,
	TConfig extends PluginJsonObject = Static<TConfigSchema> & PluginJsonObject,
> {
	manifest: PluginManifest;
	configSchema: TConfigSchema;
	defaultConfig: TConfig;
	settings?: {
		fields: PluginSettingField<TConfig>[];
	};
	isConfigured?: (config: Readonly<TConfig>) => boolean;
	createTools: (context: KaloPluginContext<TConfig>) => AgentTool[];
	systemPrompt?: (context: KaloPluginContext<TConfig>) => string;
	migrateConfig?: (
		config: PluginJsonObject,
		fromVersion: number,
	) => PluginJsonObject;
}

export interface KaloPlugin {
	manifest: PluginManifest;
	configSchema: TSchema;
	defaultConfig: PluginJsonObject;
	settings?: {
		fields: PluginSettingField<PluginJsonObject>[];
	};
	validateConfig(config: PluginJsonObject): boolean;
	isConfigured(config: PluginJsonObject): boolean;
	createTools(context: KaloPluginContext<PluginJsonObject>): AgentTool[];
	systemPrompt(context: KaloPluginContext<PluginJsonObject>): string;
	migrateConfig?: (
		config: PluginJsonObject,
		fromVersion: number,
	) => PluginJsonObject;
}

/** Define a statically typed plugin and erase its config type only after validation. */
export function definePlugin<
	TConfigSchema extends TSchema,
	TConfig extends PluginJsonObject = Static<TConfigSchema> & PluginJsonObject,
>(definition: KaloPluginDefinition<TConfigSchema, TConfig>): KaloPlugin {
	const validateConfig = (config: PluginJsonObject): config is TConfig =>
		Value.Check(definition.configSchema, config);
	const typedConfig = (config: PluginJsonObject): Readonly<TConfig> => {
		if (!validateConfig(config)) {
			throw new Error(
				`Invalid configuration for plugin ${definition.manifest.id}`,
			);
		}
		return config;
	};
	return {
		manifest: definition.manifest,
		configSchema: definition.configSchema,
		defaultConfig: definition.defaultConfig,
		settings: definition.settings
			? { fields: definition.settings.fields }
			: undefined,
		validateConfig,
		isConfigured: (config) =>
			definition.isConfigured?.(typedConfig(config)) ?? true,
		createTools: (context) =>
			definition.createTools({
				...context,
				config: typedConfig(context.config),
			}),
		systemPrompt: (context) =>
			definition.systemPrompt?.({
				...context,
				config: typedConfig(context.config),
			}) ?? "",
		migrateConfig: definition.migrateConfig,
	};
}

export function localize(text: LocalizedText, locale: PluginLocale): string {
	return text[locale];
}
