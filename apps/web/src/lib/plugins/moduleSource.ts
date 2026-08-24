import type { KaloPlugin } from "@kalo-ai/plugin-sdk";
import { init, parse } from "es-module-lexer";
import { normalizePluginModule } from "./contract";

export const MAX_PLUGIN_MODULE_BYTES = 2 * 1024 * 1024;
const MODULE_IMPORT_TIMEOUT_MS = 30_000;

export interface AnalyzedPluginModuleSource {
	source: string;
	size: number;
	sha256: string;
}

export type PluginSourceImporter = (
	source: string,
	debugName: string,
) => Promise<unknown>;

export function pluginModuleByteSize(source: string): number {
	return new TextEncoder().encode(source).byteLength;
}

export async function sha256Text(source: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(source),
	);
	return [...new Uint8Array(digest)]
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("");
}

export async function analyzePluginModuleSource(
	input: string,
): Promise<AnalyzedPluginModuleSource> {
	const source = input.replace(/^\uFEFF/, "");
	const size = pluginModuleByteSize(source);
	if (size === 0) throw new Error("插件文件为空");
	if (size > MAX_PLUGIN_MODULE_BYTES) {
		throw new Error("插件文件不能超过 2 MiB");
	}
	await init;
	let imports: readonly { d: number; n?: string }[];
	try {
		[imports] = parse(source);
	} catch (error) {
		throw new Error("插件不是有效的 ESM JavaScript", { cause: error });
	}
	const moduleImports = imports.filter((entry) => entry.d !== -2);
	if (moduleImports.length > 0) {
		const names = moduleImports
			.map((entry) => entry.n ?? "dynamic import")
			.slice(0, 3)
			.join(", ");
		throw new Error(`插件必须是无 import 的单文件 bundle：${names}`);
	}
	return { source, size, sha256: await sha256Text(source) };
}

function safeDebugName(value: string): string {
	return value.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 120) || "plugin.js";
}

const browserSourceImporter: PluginSourceImporter = async (
	source,
	debugName,
) => {
	const annotated = `${source}\n//# sourceURL=kalo-local-plugin:${safeDebugName(debugName)}\n`;
	const url = URL.createObjectURL(
		new Blob([annotated], { type: "text/javascript" }),
	);
	try {
		return await import(/* @vite-ignore */ url);
	} finally {
		URL.revokeObjectURL(url);
	}
};

export async function importPluginModuleSource(
	source: string,
	debugName: string,
	importer: PluginSourceImporter = browserSourceImporter,
): Promise<{ plugin: KaloPlugin; analyzed: AnalyzedPluginModuleSource }> {
	const analyzed = await analyzePluginModuleSource(source);
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const module = await Promise.race([
			importer(analyzed.source, debugName),
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(
					() => reject(new Error("加载插件模块超时")),
					MODULE_IMPORT_TIMEOUT_MS,
				);
			}),
		]);
		return { plugin: normalizePluginModule(module), analyzed };
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}
