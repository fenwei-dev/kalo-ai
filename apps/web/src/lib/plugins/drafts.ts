import type {
	PluginDraft,
	PluginDraftDiagnostic,
	PluginDraftRevision,
} from "$lib/db/schema";
import { db } from "$lib/db/schema";
import {
	analyzePluginModuleSource,
	pluginModuleByteSize,
	sha256Text,
} from "./moduleSource";

export const MAX_AGENT_PLUGIN_DRAFT_BYTES = 256 * 1024;
export const MAX_PLUGIN_DRAFT_REVISIONS = 20;

const DRAFT_FILE_PATTERN = /^[^/\\\0]{1,200}\.(?:js|mjs)$/i;

const uid = (): string =>
	`draft_${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`}`;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function normalizedDraftFileName(fileName: string): string {
	const normalized = fileName.trim();
	if (!DRAFT_FILE_PATTERN.test(normalized)) {
		throw new Error("插件草稿文件名必须是安全的 .js 或 .mjs 文件名");
	}
	return normalized;
}

async function analyzeDraftSource(sourceInput: string): Promise<{
	source: string;
	size: number;
	sha256: string;
	status: PluginDraft["status"];
	diagnostics: PluginDraftDiagnostic[];
}> {
	const source = sourceInput.replace(/^\uFEFF/, "");
	const size = pluginModuleByteSize(source);
	if (size === 0) throw new Error("插件草稿源码不能为空");
	if (size > MAX_AGENT_PLUGIN_DRAFT_BYTES) {
		throw new Error("Agent 插件草稿不能超过 256 KiB");
	}
	const sha256 = await sha256Text(source);
	try {
		await analyzePluginModuleSource(source);
		return {
			source,
			size,
			sha256,
			status: "valid",
			diagnostics: [
				{
					level: "info",
					code: "static-valid",
					message: "Single-file ESM syntax and import checks passed.",
				},
			],
		};
	} catch (error) {
		return {
			source,
			size,
			sha256,
			status: "invalid",
			diagnostics: [
				{
					level: "error",
					code: "static-invalid",
					message: errorMessage(error),
				},
			],
		};
	}
}

async function assertDevelopmentSession(sessionId: string): Promise<void> {
	const session = await db.sessions.get(sessionId);
	if (!session) throw new Error("开发会话不存在或已被删除");
	if (session.mode !== "plugin_development") {
		throw new Error("只有插件开发模式会话可以管理插件草稿");
	}
}

async function scopedDraft(
	sessionId: string,
	draftId: string,
): Promise<PluginDraft> {
	await assertDevelopmentSession(sessionId);
	const draft = await db.pluginDrafts.get(draftId);
	if (!draft || draft.sessionId !== sessionId) {
		throw new Error("插件草稿不存在或不属于当前开发会话");
	}
	return draft;
}

async function pruneDraftRevisions(draftId: string): Promise<void> {
	const revisions = await db.pluginDraftRevisions
		.where("draftId")
		.equals(draftId)
		.sortBy("revision");
	const excess = revisions.length - MAX_PLUGIN_DRAFT_REVISIONS;
	if (excess <= 0) return;
	await db.pluginDraftRevisions.bulkDelete(
		revisions
			.slice(0, excess)
			.map((revision): [string, number] => [draftId, revision.revision]),
	);
}

export async function createPluginDraft(input: {
	sessionId: string;
	fileName: string;
	source: string;
}): Promise<PluginDraft> {
	await assertDevelopmentSession(input.sessionId);
	const analyzed = await analyzeDraftSource(input.source);
	const timestamp = Date.now();
	const draft: PluginDraft = {
		id: uid(),
		sessionId: input.sessionId,
		fileName: normalizedDraftFileName(input.fileName),
		...analyzed,
		revision: 1,
		createdAt: timestamp,
		updatedAt: timestamp,
	};
	const revision: PluginDraftRevision = {
		draftId: draft.id,
		revision: draft.revision,
		source: draft.source,
		size: draft.size,
		sha256: draft.sha256,
		createdAt: timestamp,
	};
	await db.transaction(
		"rw",
		[db.sessions, db.pluginDrafts, db.pluginDraftRevisions],
		async () => {
			await assertDevelopmentSession(input.sessionId);
			await db.pluginDrafts.add(draft);
			await db.pluginDraftRevisions.add(revision);
		},
	);
	return draft;
}

export async function getPluginDraft(
	sessionId: string,
	draftId: string,
): Promise<PluginDraft> {
	return scopedDraft(sessionId, draftId);
}

export async function listPluginDrafts(
	sessionId: string,
): Promise<PluginDraft[]> {
	await assertDevelopmentSession(sessionId);
	return db.pluginDrafts
		.where("sessionId")
		.equals(sessionId)
		.reverse()
		.sortBy("updatedAt");
}

export async function listPluginDraftRevisions(
	sessionId: string,
	draftId: string,
): Promise<PluginDraftRevision[]> {
	await scopedDraft(sessionId, draftId);
	return db.pluginDraftRevisions
		.where("draftId")
		.equals(draftId)
		.reverse()
		.sortBy("revision");
}

export async function replacePluginDraft(input: {
	sessionId: string;
	draftId: string;
	expectedRevision: number;
	source: string;
	fileName?: string;
}): Promise<PluginDraft> {
	const analyzed = await analyzeDraftSource(input.source);
	return db.transaction(
		"rw",
		[db.sessions, db.pluginDrafts, db.pluginDraftRevisions],
		async () => {
			const current = await scopedDraft(input.sessionId, input.draftId);
			if (current.revision !== input.expectedRevision) {
				throw new Error(
					`草稿版本冲突：当前 revision ${current.revision}，请先重新读取`,
				);
			}
			const timestamp = Date.now();
			const updated: PluginDraft = {
				...current,
				...analyzed,
				fileName: input.fileName
					? normalizedDraftFileName(input.fileName)
					: current.fileName,
				revision: current.revision + 1,
				updatedAt: timestamp,
			};
			await db.pluginDrafts.put(updated);
			await db.pluginDraftRevisions.add({
				draftId: updated.id,
				revision: updated.revision,
				source: updated.source,
				size: updated.size,
				sha256: updated.sha256,
				createdAt: timestamp,
			});
			await pruneDraftRevisions(updated.id);
			return updated;
		},
	);
}

export async function validatePluginDraft(
	sessionId: string,
	draftId: string,
): Promise<PluginDraft> {
	const current = await scopedDraft(sessionId, draftId);
	const analyzed = await analyzeDraftSource(current.source);
	const updated: PluginDraft = {
		...current,
		...analyzed,
		updatedAt: Date.now(),
	};
	await db.pluginDrafts.put(updated);
	return updated;
}

export async function restorePluginDraftRevision(input: {
	sessionId: string;
	draftId: string;
	revision: number;
	expectedRevision: number;
}): Promise<PluginDraft> {
	const current = await scopedDraft(input.sessionId, input.draftId);
	if (current.revision !== input.expectedRevision) {
		throw new Error(
			`草稿版本冲突：当前 revision ${current.revision}，请先重新读取`,
		);
	}
	const revision = await db.pluginDraftRevisions.get([
		input.draftId,
		input.revision,
	]);
	if (!revision) throw new Error("要恢复的草稿 revision 不存在");
	return replacePluginDraft({
		sessionId: input.sessionId,
		draftId: input.draftId,
		expectedRevision: input.expectedRevision,
		source: revision.source,
	});
}

export async function deletePluginDraft(
	sessionId: string,
	draftId: string,
): Promise<void> {
	await scopedDraft(sessionId, draftId);
	await db.transaction(
		"rw",
		[db.pluginDrafts, db.pluginDraftRevisions],
		async () => {
			await db.pluginDrafts.delete(draftId);
			await db.pluginDraftRevisions.where("draftId").equals(draftId).delete();
		},
	);
}
