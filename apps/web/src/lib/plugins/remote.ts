import type { KaloPlugin } from "@kalo-ai/plugin-sdk";
import type { PluginInstallation, PluginPackageRegistry } from "$lib/db/schema";
import {
	type AnalyzedPluginModuleSource,
	analyzePluginModuleSource,
	importPluginModuleSource,
	type PluginSourceImporter,
} from "./moduleSource";

const NPM_PACKAGE_PATTERN =
	/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const JSR_PACKAGE_PATTERN = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const EXACT_VERSION_PATTERN =
	/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ESM_SH_ORIGIN = "https://esm.sh";
const REMOTE_FETCH_TIMEOUT_MS = 30_000;

export interface ParsedPluginPackageSpecifier {
	registry: PluginPackageRegistry;
	packageName: string;
	packageVersion: string;
	canonicalSpecifier: string;
}

export interface DownloadedRemotePluginModule
	extends AnalyzedPluginModuleSource {
	sourceUrl: string;
}

export interface LoadedRemotePlugin {
	plugin: KaloPlugin;
	module: DownloadedRemotePluginModule;
}

export type RemotePluginFetcher = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;
export type RemotePluginLoader = (
	source: ParsedPluginPackageSpecifier,
) => Promise<LoadedRemotePlugin>;

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
	return `${ESM_SH_ORIGIN}/${registryPath}?bundle&target=es2022`;
}

export function pluginInstallationSpecifier(
	installation: Pick<
		PluginInstallation,
		"registry" | "packageName" | "packageVersion" | "moduleSha256"
	>,
): string {
	const hash = installation.moduleSha256?.slice(0, 12) ?? "uncached";
	if (installation.registry === "local") {
		return `local:${installation.packageName} · sha256:${hash}`;
	}
	return `${installation.registry}:${installation.packageName}@${installation.packageVersion} · sha256:${hash}`;
}

async function fetchJavaScript(
	url: string,
	fetcher: RemotePluginFetcher,
): Promise<Response> {
	const response = await fetcher(url, {
		headers: { accept: "application/javascript, text/javascript" },
		signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
	if (new URL(response.url || url).origin !== ESM_SH_ORIGIN) {
		throw new Error("esm.sh 将插件重定向到了不受信任的来源");
	}
	return response;
}

export async function downloadRemotePluginModule(
	source: ParsedPluginPackageSpecifier,
	fetcher: RemotePluginFetcher = globalThis.fetch,
): Promise<DownloadedRemotePluginModule> {
	const entryUrl = remotePluginModuleUrl(source);
	const entryResponse = await fetchJavaScript(entryUrl, fetcher);
	const esmPath = entryResponse.headers.get("x-esm-path");
	if (!esmPath?.startsWith("/")) {
		throw new Error("esm.sh 响应缺少有效的 X-ESM-Path bundle 地址");
	}
	const bundleUrl = new URL(esmPath, ESM_SH_ORIGIN);
	if (bundleUrl.origin !== ESM_SH_ORIGIN) {
		throw new Error("esm.sh bundle 地址来源无效");
	}
	const bundleResponse = await fetchJavaScript(bundleUrl.href, fetcher);
	const analyzed = await analyzePluginModuleSource(await bundleResponse.text());
	return {
		...analyzed,
		sourceUrl: bundleResponse.url || bundleUrl.href,
	};
}

export async function loadRemotePlugin(
	source: ParsedPluginPackageSpecifier,
	options: {
		fetcher?: RemotePluginFetcher;
		importer?: PluginSourceImporter;
	} = {},
): Promise<LoadedRemotePlugin> {
	const downloaded = await downloadRemotePluginModule(source, options.fetcher);
	const loaded = await importPluginModuleSource(
		downloaded.source,
		`${source.packageName}@${source.packageVersion}.js`,
		options.importer,
	);
	return {
		plugin: loaded.plugin,
		module: { ...downloaded, ...loaded.analyzed },
	};
}
