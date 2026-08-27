<script lang="ts">
	import { localize } from "@kalo-ai/plugin-sdk";
	import type { PluginDraft, PluginDraftRevision } from "$lib/db/schema";
	import * as m from "$lib/paraglide/messages";
	import { getLocale } from "$lib/paraglide/runtime";
	import { inspectPluginDraftInSandbox } from "$lib/plugins/draftSandbox";
	import {
		getPluginDraft,
		listPluginDraftRevisions,
		listPluginDrafts,
		restorePluginDraftRevision,
	} from "$lib/plugins/drafts";
	import { installLocalPlugin } from "$lib/plugins/manager";

	let {
		sessionId,
		refreshKey = 0,
	}: { sessionId: string; refreshKey?: number } = $props();

	let drafts = $state<PluginDraft[]>([]);
	let revisions = $state<Record<string, PluginDraftRevision[]>>({});
	let error = $state("");
	let busyDraftId = $state<string | null>(null);
	let generation = 0;
	let reviewDraft = $state<PluginDraft | null>(null);
	let reviewAccepted = $state(false);
	let installing = $state(false);
	let installedMessage = $state("");

	async function load(id: string) {
		const current = ++generation;
		try {
			const loaded = await listPluginDrafts(id);
			const loadedRevisions = await Promise.all(
				loaded.map(
					async (draft) =>
						[draft.id, await listPluginDraftRevisions(id, draft.id)] as const,
				),
			);
			if (current !== generation || id !== sessionId) return;
			drafts = loaded;
			revisions = Object.fromEntries(loadedRevisions);
			error = "";
			if (reviewDraft) {
				reviewDraft =
					loaded.find((draft) => draft.id === reviewDraft?.id) ?? null;
			}
		} catch (cause) {
			if (current !== generation || id !== sessionId) return;
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	$effect(() => {
		const id = sessionId;
		refreshKey;
		void load(id);
	});

	async function inspect(draft: PluginDraft) {
		if (busyDraftId) return;
		busyDraftId = draft.id;
		error = "";
		try {
			await inspectPluginDraftInSandbox({
				sessionId,
				draftId: draft.id,
				locale: getLocale(),
			});
			await load(sessionId);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			await load(sessionId);
		} finally {
			busyDraftId = null;
		}
	}

	async function restore(draft: PluginDraft, revision: number) {
		if (busyDraftId || revision === draft.revision) return;
		busyDraftId = draft.id;
		error = "";
		try {
			await restorePluginDraftRevision({
				sessionId,
				draftId: draft.id,
				revision,
				expectedRevision: draft.revision,
			});
			await load(sessionId);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busyDraftId = null;
		}
	}

	function download(draft: PluginDraft) {
		const url = URL.createObjectURL(
			new Blob([draft.source], { type: "text/javascript" }),
		);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = draft.fileName;
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}

	function openReview(draft: PluginDraft) {
		if (draft.inspection?.revision !== draft.revision) return;
		reviewDraft = draft;
		reviewAccepted = false;
		installedMessage = "";
	}

	function closeReview() {
		if (installing) return;
		reviewDraft = null;
		reviewAccepted = false;
	}

	async function installReviewedDraft() {
		const draft = reviewDraft;
		if (
			!draft ||
			!reviewAccepted ||
			draft.inspection?.revision !== draft.revision ||
			installing
		) {
			return;
		}
		installing = true;
		error = "";
		try {
			const current = await getPluginDraft(sessionId, draft.id);
			if (
				current.revision !== draft.revision ||
				current.sha256 !== draft.sha256 ||
				current.inspection?.revision !== current.revision
			) {
				throw new Error(
					"Draft changed after review; inspect and review it again.",
				);
			}
			const state = await installLocalPlugin({
				fileName: draft.fileName,
				source: draft.source,
				size: draft.size,
				sha256: draft.sha256,
			});
			installedMessage = m.chat_draft_installed({
				pluginId: state.plugin.manifest.id,
			});
			reviewDraft = null;
			reviewAccepted = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			installing = false;
		}
	}
</script>

<section class="rounded-2xl border border-violet-100 bg-violet-50/70 p-3">
	<div class="flex items-center justify-between gap-3">
		<h2 class="text-sm font-semibold text-violet-900">{m.chat_drafts_title()}</h2>
		<span class="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
			{drafts.length}
		</span>
	</div>

	{#if error}
		<p class="mt-2 rounded-lg bg-red-50 p-2 text-xs leading-relaxed text-red-600">{error}</p>
	{/if}
	{#if installedMessage}
		<p class="mt-2 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-700">{installedMessage}</p>
	{/if}
	{#if drafts.length === 0}
		<p class="mt-2 text-xs leading-relaxed text-violet-600">{m.chat_drafts_empty()}</p>
	{:else}
		<div class="mt-2 space-y-2">
			{#each drafts as draft (draft.id)}
				<details class="overflow-hidden rounded-xl border border-violet-100 bg-white">
					<summary class="cursor-pointer list-none px-3 py-2">
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<p class="truncate text-xs font-medium text-gray-800">{draft.fileName}</p>
								<p class="mt-0.5 font-mono text-[9px] text-gray-400">sha256:{draft.sha256.slice(0, 12)}</p>
							</div>
							<div class="shrink-0 text-right">
								<p class="text-[10px] text-gray-500">{m.chat_draft_revision({ revision: draft.revision })}</p>
								<p class="mt-0.5 text-[10px] {draft.status === 'valid' ? 'text-emerald-600' : 'text-red-600'}">
									{draft.status === 'valid' ? m.chat_draft_valid() : m.chat_draft_invalid()}
								</p>
							</div>
						</div>
					</summary>
					<div class="space-y-3 border-t border-violet-50 px-3 py-3">
						<div>
							{#each draft.diagnostics as diagnostic}
								<p class="mb-1 text-[10px] leading-relaxed {diagnostic.level === 'error' ? 'text-red-600' : diagnostic.level === 'warning' ? 'text-amber-600' : 'text-emerald-600'}">
									{diagnostic.message}
								</p>
							{/each}
						</div>

						{#if draft.inspection?.revision === draft.revision}
							<div class="rounded-lg bg-violet-50 p-2 text-[10px] text-violet-800">
								<p class="font-semibold">{m.chat_draft_manifest()}</p>
								<p class="mt-1">{localize(draft.inspection.manifest.name, getLocale())} · v{draft.inspection.manifest.version}</p>
								<p class="mt-1 font-mono">{draft.inspection.manifest.id}</p>
								<p class="mt-2 font-semibold">{m.chat_draft_tools()}</p>
								{#each draft.inspection.tools as tool}
									<p class="mt-1 font-mono">{tool.name}</p>
								{/each}
								<p class="mt-2 font-semibold">{m.chat_draft_prompt()}</p>
								<p class="mt-1 whitespace-pre-wrap break-words">{draft.inspection.prompt || m.chat_draft_no_prompt()}</p>
							</div>
						{:else}
							<p class="text-[10px] text-amber-600">{m.chat_draft_not_inspected()}</p>
						{/if}

						{#if draft.lastTest}
							<div class="rounded-lg bg-gray-50 p-2 text-[10px] text-gray-600">
								<p class="font-semibold">{m.chat_draft_latest_tool_run()} · {draft.lastTest.toolName}</p>
								<p class="mt-1 {draft.lastTest.ok ? 'text-emerald-600' : 'text-red-600'}">
									{draft.lastTest.ok ? 'OK' : draft.lastTest.error}
								</p>
								{#each draft.lastTest.content as block}
									<p class="mt-1 whitespace-pre-wrap break-words font-mono">{block.type === 'text' ? block.text : `${block.mimeType} · ${block.bytes} B`}</p>
								{/each}
							</div>
						{/if}

						<div>
							<p class="text-[10px] font-medium uppercase tracking-wide text-gray-400">{m.chat_draft_revisions()}</p>
							<div class="mt-1 flex flex-wrap gap-1">
								{#each revisions[draft.id] ?? [] as revision}
									<button
										type="button"
										disabled={busyDraftId !== null || revision.revision === draft.revision}
										onclick={() => restore(draft, revision.revision)}
										class="rounded-full border border-gray-200 px-2 py-1 text-[9px] text-gray-600 disabled:bg-gray-100 disabled:text-gray-400"
									>
										r{revision.revision}{revision.revision === draft.revision ? '' : ` · ${m.chat_draft_restore()}`}
									</button>
								{/each}
							</div>
						</div>

						<div>
							<p class="text-[10px] font-medium uppercase tracking-wide text-gray-400">{m.chat_draft_source()}</p>
							<pre class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-950 p-2 font-mono text-[9px] leading-relaxed text-gray-100 select-text">{draft.source}</pre>
						</div>

						<div class="grid grid-cols-2 gap-2">
							<button type="button" onclick={() => inspect(draft)} disabled={busyDraftId !== null} class="rounded-full border border-violet-300 py-2 text-[10px] font-medium text-violet-700 disabled:opacity-40">
								{busyDraftId === draft.id ? m.chat_draft_inspecting() : m.chat_draft_inspect()}
							</button>
							<button type="button" onclick={() => download(draft)} class="rounded-full border border-gray-300 py-2 text-[10px] font-medium text-gray-600">
								{m.chat_draft_download()}
							</button>
							<button type="button" onclick={() => openReview(draft)} disabled={draft.inspection?.revision !== draft.revision || busyDraftId !== null} class="col-span-2 rounded-full bg-violet-600 py-2 text-[10px] font-medium text-white disabled:opacity-40">
								{m.chat_draft_review()}
							</button>
						</div>
					</div>
				</details>
			{/each}
		</div>
	{/if}
</section>

{#if reviewDraft?.inspection}
	<div class="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center" role="presentation" onclick={(event) => { if (event.currentTarget === event.target) closeReview(); }}>
		<div role="dialog" aria-modal="true" aria-label={m.chat_draft_review_title()} class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl">
			<div class="flex items-start justify-between gap-3">
				<div>
					<h2 class="text-base font-semibold text-gray-900">{m.chat_draft_review_title()}</h2>
					<p class="mt-1 text-xs text-gray-500">{localize(reviewDraft.inspection.manifest.name, getLocale())} · v{reviewDraft.inspection.manifest.version}</p>
				</div>
				<button type="button" onclick={closeReview} disabled={installing} class="rounded-full px-2 py-1 text-sm text-gray-400">×</button>
			</div>
			<div class="mt-3 space-y-3 text-xs">
				<div class="rounded-xl bg-gray-50 p-3">
					<p class="font-mono break-all">sha256:{reviewDraft.sha256}</p>
					<p class="mt-1 font-mono">id: {reviewDraft.inspection.manifest.id}</p>
					<p class="mt-2 font-medium">{m.plugins_permissions()}</p>
					<p class="mt-1">{reviewDraft.inspection.manifest.permissions?.join(', ') || m.plugins_no_permissions()}</p>
					<p class="mt-2 font-medium">{m.chat_draft_tools()}</p>
					<p class="mt-1 font-mono">{reviewDraft.inspection.tools.map((tool) => tool.name).join(', ') || '—'}</p>
					<p class="mt-2 font-medium">{m.chat_draft_prompt()}</p>
					<p class="mt-1 whitespace-pre-wrap break-words">{reviewDraft.inspection.prompt || m.chat_draft_no_prompt()}</p>
				</div>
				<p class="rounded-xl border border-red-200 bg-red-50 p-3 leading-relaxed text-red-700">{m.chat_draft_review_warning()}</p>
				<details class="rounded-xl border border-gray-200">
					<summary class="cursor-pointer px-3 py-2 font-medium">{m.chat_draft_source()}</summary>
					<pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-gray-100 bg-gray-950 p-3 font-mono text-[9px] text-gray-100 select-text">{reviewDraft.source}</pre>
				</details>
				<label class="flex items-start gap-2 leading-relaxed text-gray-600">
					<input type="checkbox" bind:checked={reviewAccepted} disabled={installing} class="mt-0.5 h-4 w-4 rounded border-gray-300 text-violet-600" />
					<span>{m.chat_draft_review_confirm()}</span>
				</label>
			</div>
			<div class="mt-4 grid grid-cols-2 gap-2">
				<button type="button" onclick={closeReview} disabled={installing} class="rounded-full border border-gray-300 py-2.5 text-sm text-gray-600 disabled:opacity-40">{m.chat_draft_close_review()}</button>
				<button type="button" onclick={installReviewedDraft} disabled={!reviewAccepted || installing} class="rounded-full bg-violet-600 py-2.5 text-sm font-medium text-white disabled:opacity-40">{installing ? m.chat_draft_installing() : m.chat_draft_install()}</button>
			</div>
		</div>
	</div>
{/if}
