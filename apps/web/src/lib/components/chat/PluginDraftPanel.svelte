<script lang="ts">
	import type { PluginDraft } from "$lib/db/schema";
	import * as m from "$lib/paraglide/messages";
	import { listPluginDrafts } from "$lib/plugins/drafts";

	let {
		sessionId,
		refreshKey = 0,
	}: { sessionId: string; refreshKey?: number } = $props();

	let drafts = $state<PluginDraft[]>([]);
	let error = $state("");
	let generation = 0;

	async function load(id: string) {
		const current = ++generation;
		try {
			const loaded = await listPluginDrafts(id);
			if (current !== generation || id !== sessionId) return;
			drafts = loaded;
			error = "";
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
</script>

<section class="rounded-2xl border border-violet-100 bg-violet-50/70 p-3">
	<div class="flex items-center justify-between gap-3">
		<h2 class="text-sm font-semibold text-violet-900">{m.chat_drafts_title()}</h2>
		<span class="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
			{drafts.length}
		</span>
	</div>

	{#if error}
		<p class="mt-2 text-xs text-red-600">{error}</p>
	{:else if drafts.length === 0}
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
					<div class="border-t border-violet-50 px-3 py-2">
						{#each draft.diagnostics as diagnostic}
							<p class="mb-1 text-[10px] leading-relaxed {diagnostic.level === 'error' ? 'text-red-600' : diagnostic.level === 'warning' ? 'text-amber-600' : 'text-emerald-600'}">
								{diagnostic.message}
							</p>
						{/each}
						<p class="mt-2 text-[10px] font-medium uppercase tracking-wide text-gray-400">{m.chat_draft_source()}</p>
						<pre class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-950 p-2 font-mono text-[9px] leading-relaxed text-gray-100 select-text">{draft.source}</pre>
					</div>
				</details>
			{/each}
		</div>
	{/if}
</section>
