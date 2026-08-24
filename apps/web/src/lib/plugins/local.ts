import {
	analyzePluginModuleSource,
	importPluginModuleSource,
	MAX_PLUGIN_MODULE_BYTES,
	type PluginSourceImporter,
} from "./moduleSource";

const LOCAL_PLUGIN_FILE_PATTERN = /^[^/\\\0]{1,200}\.(?:js|mjs)$/i;

export interface PreparedLocalPluginFile {
	fileName: string;
	source: string;
	size: number;
	sha256: string;
}

export async function prepareLocalPluginFile(
	file: Pick<File, "name" | "size" | "text">,
): Promise<PreparedLocalPluginFile> {
	if (!LOCAL_PLUGIN_FILE_PATTERN.test(file.name)) {
		throw new Error("请选择扩展名为 .js 或 .mjs 的单文件插件");
	}
	if (file.size <= 0) throw new Error("插件文件为空");
	if (file.size > MAX_PLUGIN_MODULE_BYTES) {
		throw new Error("插件文件不能超过 2 MiB");
	}
	const analyzed = await analyzePluginModuleSource(await file.text());
	return { fileName: file.name, ...analyzed };
}

export async function importPreparedLocalPlugin(
	prepared: PreparedLocalPluginFile,
	importer?: PluginSourceImporter,
) {
	const loaded = await importPluginModuleSource(
		prepared.source,
		prepared.fileName,
		importer,
	);
	if (
		loaded.analyzed.sha256 !== prepared.sha256 ||
		loaded.analyzed.size !== prepared.size
	) {
		throw new Error("本地插件文件在安装前发生了变化");
	}
	return loaded;
}
