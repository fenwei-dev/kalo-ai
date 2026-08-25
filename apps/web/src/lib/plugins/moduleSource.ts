import { init, parse } from "es-module-lexer";

export const MAX_PLUGIN_MODULE_BYTES = 2 * 1024 * 1024;

export interface AnalyzedPluginModuleSource {
	source: string;
	size: number;
	sha256: string;
}

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
