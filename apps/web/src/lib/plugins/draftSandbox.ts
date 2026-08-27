import type {
	JsonObject,
	JsonValue,
	PluginDraft,
	PluginDraftInspection,
	PluginDraftInspectionTool,
	PluginDraftToolTest,
} from "$lib/db/schema";
import { createPluginDescriptorSnapshot } from "./descriptorPolicy";
import {
	getPluginDraft,
	recordPluginDraftInspection,
	recordPluginDraftInspectionError,
	recordPluginDraftToolTest,
	validatePluginDraft,
} from "./drafts";
import { analyzePluginModuleSource } from "./moduleSource";
import { safeCheckPluginConfig } from "./safeSchema";
import { SandboxPluginClient } from "./sandbox";

const TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const EXACT_VERSION_PATTERN =
	/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MAX_TOOLS_PER_PLUGIN = 32;
const MAX_PLUGIN_PROMPT_LENGTH = 4_000;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function cloneJsonObject(value: unknown): JsonObject {
	return structuredClone(value) as JsonObject;
}

function jsonValue(value: unknown): JsonValue | undefined {
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return value;
	if (typeof value === "number")
		return Number.isFinite(value) ? value : undefined;
	if (Array.isArray(value)) {
		return value.map((item) => jsonValue(item) ?? null);
	}
	if (typeof value === "object" && value !== null) {
		const object: JsonObject = {};
		for (const [key, item] of Object.entries(value)) {
			const converted = jsonValue(item);
			if (converted !== undefined) object[key] = converted;
		}
		return object;
	}
	return undefined;
}

function imageBytes(data: string): number {
	const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
	return Math.max(0, (data.length / 4) * 3 - padding);
}

function assertRuntimeTools(
	pluginId: string,
	tools: Awaited<ReturnType<SandboxPluginClient["runtime"]>>["tools"],
): PluginDraftInspectionTool[] {
	if (tools.length > MAX_TOOLS_PER_PLUGIN) {
		throw new Error(`插件最多只能声明 ${MAX_TOOLS_PER_PLUGIN} 个工具`);
	}
	const names = new Set<string>();
	return tools.map((tool) => {
		if (!TOOL_NAME_PATTERN.test(tool.name)) {
			throw new Error(`工具名不兼容 provider：${tool.name}`);
		}
		if (!tool.name.startsWith(`${pluginId}_`)) {
			throw new Error(`工具名 ${tool.name} 必须以 ${pluginId}_ 开头`);
		}
		if (names.has(tool.name)) throw new Error(`工具名重复：${tool.name}`);
		names.add(tool.name);
		return {
			name: tool.name,
			label: tool.label,
			description: tool.description,
			parameters: cloneJsonObject(tool.parameters),
			executionMode: tool.executionMode,
		};
	});
}

async function inspectWithClient(
	draft: Pick<PluginDraft, "source" | "fileName" | "revision">,
	locale: "zh-cn" | "en-us",
): Promise<{
	client: SandboxPluginClient;
	inspection: PluginDraftInspection;
	runtime: Awaited<ReturnType<SandboxPluginClient["runtime"]>>;
}> {
	const client = await SandboxPluginClient.create(
		draft.source,
		draft.fileName,
		[],
	);
	try {
		const plugin = client.proxyPlugin;
		if (!EXACT_VERSION_PATTERN.test(plugin.manifest.version)) {
			throw new Error("manifest.version 必须是有效的精确 SemVer");
		}
		const snapshot = await createPluginDescriptorSnapshot(plugin);
		const configured = await client.isConfigured(plugin.defaultConfig);
		const runtime = await client.runtime(plugin.defaultConfig, locale);
		const tools = assertRuntimeTools(plugin.manifest.id, runtime.tools);
		const prompt = runtime.prompt.trim();
		if (prompt.length > MAX_PLUGIN_PROMPT_LENGTH) {
			throw new Error(
				`插件 System Prompt 超过 ${MAX_PLUGIN_PROMPT_LENGTH} 字符限制`,
			);
		}
		return {
			client,
			runtime,
			inspection: {
				revision: draft.revision,
				inspectedAt: Date.now(),
				descriptorSha256: snapshot.sha256,
				manifest: structuredClone(plugin.manifest),
				configured,
				tools,
				prompt,
			},
		};
	} catch (error) {
		client.dispose();
		throw error;
	}
}

export async function inspectPluginSourceInSandbox(input: {
	source: string;
	fileName: string;
	locale: "zh-cn" | "en-us";
}): Promise<PluginDraftInspection> {
	await analyzePluginModuleSource(input.source);
	const { client, inspection } = await inspectWithClient(
		{
			source: input.source,
			fileName: input.fileName,
			revision: 1,
		},
		input.locale,
	);
	client.dispose();
	return inspection;
}

export async function inspectPluginDraftInSandbox(input: {
	sessionId: string;
	draftId: string;
	locale: "zh-cn" | "en-us";
}): Promise<PluginDraft> {
	let draft = await validatePluginDraft(input.sessionId, input.draftId);
	if (draft.status !== "valid") {
		throw new Error(draft.diagnostics[0]?.message ?? "插件草稿静态检查失败");
	}
	try {
		const { client, inspection } = await inspectWithClient(draft, input.locale);
		client.dispose();
		draft = await recordPluginDraftInspection({
			sessionId: input.sessionId,
			draftId: input.draftId,
			expectedRevision: draft.revision,
			inspection,
		});
		return draft;
	} catch (error) {
		await recordPluginDraftInspectionError({
			sessionId: input.sessionId,
			draftId: input.draftId,
			expectedRevision: draft.revision,
			message: errorMessage(error),
		});
		throw error;
	}
}

export async function testPluginDraftTool(input: {
	sessionId: string;
	draftId: string;
	locale: "zh-cn" | "en-us";
	toolName: string;
	arguments: JsonObject;
	signal?: AbortSignal;
}): Promise<PluginDraft> {
	let draft = await getPluginDraft(input.sessionId, input.draftId);
	if (draft.status === "invalid") {
		draft = await validatePluginDraft(input.sessionId, input.draftId);
	}
	if (draft.status !== "valid") {
		throw new Error(draft.diagnostics[0]?.message ?? "插件草稿静态检查失败");
	}
	let client: SandboxPluginClient | undefined;
	try {
		const inspected = await inspectWithClient(draft, input.locale);
		client = inspected.client;
		const descriptor = inspected.runtime.tools.find(
			(tool) => tool.name === input.toolName,
		);
		if (!descriptor) throw new Error(`草稿没有工具：${input.toolName}`);
		if (!safeCheckPluginConfig(descriptor.parameters, input.arguments)) {
			throw new Error(`工具参数不符合 ${input.toolName} 的安全 schema`);
		}
		const result = await client
			.createToolProxy(descriptor)
			.execute(
				`draft_test_${crypto.randomUUID()}`,
				input.arguments,
				input.signal,
			);
		const test: PluginDraftToolTest = {
			revision: draft.revision,
			testedAt: Date.now(),
			toolName: input.toolName,
			arguments: structuredClone(input.arguments),
			ok: true,
			content: result.content.map((block) =>
				block.type === "text"
					? { type: "text", text: block.text }
					: {
							type: "image",
							mimeType: block.mimeType,
							bytes: imageBytes(block.data),
						},
			),
			details: jsonValue(result.details),
		};
		client.dispose();
		client = undefined;
		await recordPluginDraftInspection({
			sessionId: input.sessionId,
			draftId: input.draftId,
			expectedRevision: draft.revision,
			inspection: inspected.inspection,
		});
		return recordPluginDraftToolTest({
			sessionId: input.sessionId,
			draftId: input.draftId,
			expectedRevision: draft.revision,
			test,
		});
	} catch (error) {
		client?.dispose();
		const test: PluginDraftToolTest = {
			revision: draft.revision,
			testedAt: Date.now(),
			toolName: input.toolName,
			arguments: structuredClone(input.arguments),
			ok: false,
			content: [],
			error: errorMessage(error),
		};
		await recordPluginDraftToolTest({
			sessionId: input.sessionId,
			draftId: input.draftId,
			expectedRevision: draft.revision,
			test,
		}).catch(() => undefined);
		throw error;
	}
}
