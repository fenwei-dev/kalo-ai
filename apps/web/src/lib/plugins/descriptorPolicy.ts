import type {
	KaloPlugin,
	PluginJsonObject,
	PluginManifest,
} from "@kalo-ai/plugin-sdk";
import type {
	PluginDescriptorSnapshot,
	PluginInstallation,
} from "$lib/db/schema";
import { isPluginManifest, isPluginSettings } from "./contract";
import { sha256Text } from "./moduleSource";
import { assertSafePluginSchema } from "./safeSchema";

function canonicalValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, item]) => [key, canonicalValue(item)]),
		);
	}
	return value;
}

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function normalizedManifest(manifest: PluginManifest): PluginManifest {
	return {
		...cloneJson(manifest),
		permissions: manifest.permissions
			? [...manifest.permissions].sort()
			: undefined,
	};
}

export function canonicalDescriptorJson(value: unknown): string {
	return JSON.stringify(canonicalValue(value));
}

export async function createPluginDescriptorSnapshot(
	plugin: Pick<
		KaloPlugin,
		"manifest" | "configSchema" | "defaultConfig" | "settings"
	>,
): Promise<PluginDescriptorSnapshot> {
	if (!isPluginManifest(plugin.manifest)) throw new Error("插件 manifest 无效");
	assertSafePluginSchema(plugin.configSchema);
	if (!isPluginSettings(plugin.settings)) throw new Error("插件 settings 无效");
	const configSchema = cloneJson(plugin.configSchema) as PluginJsonObject;
	const defaultConfig = cloneJson(plugin.defaultConfig);
	const settings = plugin.settings ? cloneJson(plugin.settings) : undefined;
	const content = {
		manifest: normalizedManifest(plugin.manifest),
		configSchema,
		defaultConfig,
		settings,
	};
	return {
		configSchema,
		defaultConfig,
		settings,
		sha256: await sha256Text(canonicalDescriptorJson(content)),
	};
}

export async function descriptorSnapshotHash(
	manifest: PluginManifest,
	descriptor: Omit<PluginDescriptorSnapshot, "sha256">,
): Promise<string> {
	assertSafePluginSchema(descriptor.configSchema);
	if (!isPluginSettings(descriptor.settings)) {
		throw new Error("插件 descriptor settings 无效");
	}
	return sha256Text(
		canonicalDescriptorJson({
			manifest: normalizedManifest(manifest),
			configSchema: descriptor.configSchema,
			defaultConfig: descriptor.defaultConfig,
			settings: descriptor.settings,
		}),
	);
}

export async function assertInstalledDescriptorMatches(
	plugin: KaloPlugin,
	installation: PluginInstallation,
): Promise<void> {
	if (!installation.descriptor) {
		throw new Error("旧插件缺少安全 descriptor 快照，请移除后重新安装");
	}
	const current = await createPluginDescriptorSnapshot(plugin);
	const installedManifest = canonicalDescriptorJson(
		normalizedManifest(installation.manifest),
	);
	const currentManifest = canonicalDescriptorJson(
		normalizedManifest(plugin.manifest),
	);
	if (
		installedManifest !== currentManifest ||
		current.sha256 !== installation.descriptor.sha256
	) {
		throw new Error("插件 descriptor 与安装时授权快照不一致，已拒绝加载");
	}
}
