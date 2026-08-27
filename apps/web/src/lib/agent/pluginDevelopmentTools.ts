import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import type { JsonObject, JsonValue, PluginDraft } from "$lib/db/schema";
import { getLocale } from "$lib/paraglide/runtime";
import {
	inspectPluginDraftInSandbox,
	testPluginDraftTool,
} from "$lib/plugins/draftSandbox";
import {
	createPluginDraft,
	deletePluginDraft,
	getPluginDraft,
	listPluginDraftRevisions,
	listPluginDrafts,
	MAX_AGENT_PLUGIN_DRAFT_BYTES,
	replacePluginDraft,
	restorePluginDraftRevision,
	validatePluginDraft,
} from "$lib/plugins/drafts";
import type { ToolOutcome } from "./tools";

const createParameters = Type.Object({
	fileName: Type.String({ minLength: 1, maxLength: 200 }),
	source: Type.String({
		minLength: 1,
		maxLength: MAX_AGENT_PLUGIN_DRAFT_BYTES,
	}),
});
const listParameters = Type.Object({});
const readParameters = Type.Object({ draftId: Type.String({ minLength: 1 }) });
const replaceParameters = Type.Object({
	draftId: Type.String({ minLength: 1 }),
	expectedRevision: Type.Integer({ minimum: 1 }),
	source: Type.String({
		minLength: 1,
		maxLength: MAX_AGENT_PLUGIN_DRAFT_BYTES,
	}),
	fileName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});
const validateParameters = Type.Object({
	draftId: Type.String({ minLength: 1 }),
});
const restoreParameters = Type.Object({
	draftId: Type.String({ minLength: 1 }),
	revision: Type.Integer({ minimum: 1 }),
	expectedRevision: Type.Integer({ minimum: 1 }),
});
const inspectParameters = Type.Object({
	draftId: Type.String({ minLength: 1 }),
});
const testParameters = Type.Object({
	draftId: Type.String({ minLength: 1 }),
	toolName: Type.String({ minLength: 1, maxLength: 128 }),
	arguments: Type.Object({}, { additionalProperties: true }),
});
const deleteParameters = Type.Object({
	draftId: Type.String({ minLength: 1 }),
});

function draftResult(draft: PluginDraft, includeSource = false) {
	return {
		id: draft.id,
		fileName: draft.fileName,
		size: draft.size,
		sha256: draft.sha256,
		status: draft.status,
		revision: draft.revision,
		diagnostics: draft.diagnostics,
		updatedAt: draft.updatedAt,
		inspection: draft.inspection,
		lastTest: draft.lastTest,
		...(includeSource ? { source: draft.source } : {}),
	};
}

function toJsonValue(value: unknown): JsonValue | undefined {
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return value;
	if (typeof value === "number")
		return Number.isFinite(value) ? value : undefined;
	if (Array.isArray(value))
		return value.map((item) => toJsonValue(item) ?? null);
	if (typeof value === "object" && value !== null) {
		const converted: JsonObject = {};
		for (const [key, item] of Object.entries(value)) {
			const child = toJsonValue(item);
			if (child !== undefined) converted[key] = child;
		}
		return converted;
	}
	return undefined;
}

function toJsonObject(value: unknown): JsonObject {
	const converted = toJsonValue(value);
	return converted !== null &&
		typeof converted === "object" &&
		!Array.isArray(converted)
		? converted
		: {};
}

function success(data: object | string | null): {
	content: { type: "text"; text: string }[];
	details: ToolOutcome;
} {
	const details: ToolOutcome = { ok: true, data };
	return {
		content: [{ type: "text", text: JSON.stringify(data) }],
		details,
	};
}

export function createPluginDevelopmentTools(sessionId: string): AgentTool[] {
	const createTool: AgentTool<typeof createParameters, ToolOutcome> = {
		name: "createPluginDraft",
		label: "Create plugin draft",
		description:
			"Create one session-scoped Kalo plugin JavaScript draft. Source must be a self-contained ESM file with default and kaloPlugin exports and no imports. This saves a draft only; it does not install or execute it.",
		parameters: createParameters,
		executionMode: "sequential",
		execute: async (_toolCallId, params, signal) => {
			if (signal?.aborted) throw new Error("Request cancelled");
			return success(
				draftResult(
					await createPluginDraft({
						sessionId,
						fileName: params.fileName,
						source: params.source,
					}),
				),
			);
		},
	};

	const listTool: AgentTool<typeof listParameters, ToolOutcome> = {
		name: "listPluginDrafts",
		label: "List plugin drafts",
		description:
			"List plugin drafts owned by this development session, including ids, revisions, hashes, and validation status.",
		parameters: listParameters,
		executionMode: "parallel",
		execute: async (_toolCallId, _params, signal) => {
			if (signal?.aborted) throw new Error("Request cancelled");
			return success({
				drafts: (await listPluginDrafts(sessionId)).map((draft) =>
					draftResult(draft),
				),
			});
		},
	};

	const readTool: AgentTool<typeof readParameters, ToolOutcome> = {
		name: "readPluginDraft",
		label: "Read plugin draft",
		description:
			"Read the current complete source and diagnostics of one draft before revising it. Always use its current revision for optimistic replacement.",
		parameters: readParameters,
		executionMode: "parallel",
		execute: async (_toolCallId, params, signal) => {
			if (signal?.aborted) throw new Error("Request cancelled");
			const draft = await getPluginDraft(sessionId, params.draftId);
			const revisions = await listPluginDraftRevisions(
				sessionId,
				params.draftId,
			);
			return success({
				...draftResult(draft, true),
				availableRevisions: revisions.map((revision) => revision.revision),
			});
		},
	};

	const replaceTool: AgentTool<typeof replaceParameters, ToolOutcome> = {
		name: "replacePluginDraft",
		label: "Replace plugin draft",
		description:
			"Replace the complete source of a draft using its latest expectedRevision. Never send a partial patch. Static validation runs automatically and the previous revision remains restorable.",
		parameters: replaceParameters,
		executionMode: "sequential",
		execute: async (_toolCallId, params, signal) => {
			if (signal?.aborted) throw new Error("Request cancelled");
			return success(
				draftResult(
					await replacePluginDraft({
						sessionId,
						draftId: params.draftId,
						expectedRevision: params.expectedRevision,
						source: params.source,
						fileName: params.fileName,
					}),
				),
			);
		},
	};

	const validateTool: AgentTool<typeof validateParameters, ToolOutcome> = {
		name: "validatePluginDraft",
		label: "Validate plugin draft",
		description:
			"Repeat the bounded static ESM and no-import validation for a draft. This does not execute source or prove its plugin descriptor is valid.",
		parameters: validateParameters,
		executionMode: "parallel",
		execute: async (_toolCallId, params, signal) => {
			if (signal?.aborted) throw new Error("Request cancelled");
			return success(
				draftResult(await validatePluginDraft(sessionId, params.draftId)),
			);
		},
	};

	const restoreTool: AgentTool<typeof restoreParameters, ToolOutcome> = {
		name: "restorePluginDraftRevision",
		label: "Restore plugin draft revision",
		description:
			"Restore an available historical revision as a new latest revision. This never rewinds revision numbers and requires the current expectedRevision.",
		parameters: restoreParameters,
		executionMode: "sequential",
		execute: async (_toolCallId, params, signal) => {
			if (signal?.aborted) throw new Error("Request cancelled");
			return success(
				draftResult(
					await restorePluginDraftRevision({
						sessionId,
						draftId: params.draftId,
						revision: params.revision,
						expectedRevision: params.expectedRevision,
					}),
				),
			);
		},
	};

	const inspectTool: AgentTool<typeof inspectParameters, ToolOutcome> = {
		name: "inspectPluginDraft",
		label: "Inspect plugin draft in sandbox",
		description:
			"Load a statically valid draft in a disposable zero-permission sandbox, validate its descriptor and runtime tools, and record manifest, permissions, tool metadata, and bounded System Prompt. This does not install the plugin.",
		parameters: inspectParameters,
		executionMode: "sequential",
		execute: async (_toolCallId, params, signal) => {
			if (signal?.aborted) throw new Error("Request cancelled");
			const draft = await inspectPluginDraftInSandbox({
				sessionId,
				draftId: params.draftId,
				locale: getLocale(),
			});
			return success(draftResult(draft));
		},
	};

	const testTool: AgentTool<typeof testParameters, ToolOutcome> = {
		name: "testPluginDraftTool",
		label: "Test plugin draft tool",
		description:
			"Execute one inspected draft tool with bounded JSON arguments in a fresh zero-permission sandbox. Real profile, logs, storage, and network services are denied. Use representative synthetic arguments and report any denied permission instead of requesting real data.",
		parameters: testParameters,
		executionMode: "sequential",
		execute: async (_toolCallId, params, signal) => {
			if (signal?.aborted) throw new Error("Request cancelled");
			const draft = await testPluginDraftTool({
				sessionId,
				draftId: params.draftId,
				locale: getLocale(),
				toolName: params.toolName,
				arguments: toJsonObject(params.arguments),
				signal,
			});
			return success(draftResult(draft));
		},
	};

	const deleteTool: AgentTool<typeof deleteParameters, ToolOutcome> = {
		name: "deletePluginDraft",
		label: "Delete plugin draft",
		description:
			"Permanently delete a development draft and its revision history only when the user explicitly asks to discard it.",
		parameters: deleteParameters,
		executionMode: "sequential",
		execute: async (_toolCallId, params, signal) => {
			if (signal?.aborted) throw new Error("Request cancelled");
			await deletePluginDraft(sessionId, params.draftId);
			return success({ deleted: params.draftId });
		},
	};

	return [
		createTool,
		listTool,
		readTool,
		replaceTool,
		validateTool,
		restoreTool,
		inspectTool,
		testTool,
		deleteTool,
	];
}

export type CreatePluginDraftParameters = Static<typeof createParameters>;
