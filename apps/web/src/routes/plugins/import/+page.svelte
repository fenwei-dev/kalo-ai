<script lang="ts">
	import { localize } from "@kalo-ai/plugin-sdk";
	import { onMount } from "svelte";
	import AppHeader from "$lib/components/AppHeader.svelte";
	import type { PluginDraftInspection } from "$lib/db/schema";
	import * as m from "$lib/paraglide/messages";
	import { getLocale } from "$lib/paraglide/runtime";
	import { inspectPluginSourceInSandbox } from "$lib/plugins/draftSandbox";
	import type { PreparedLocalPluginFile } from "$lib/plugins/local";
	import { installLocalPlugin } from "$lib/plugins/manager";
	import {
		decodePluginShare,
		pluginShareTokenFromUrl,
	} from "$lib/plugins/share";

	let decoding = $state(true);
	let prepared = $state<PreparedLocalPluginFile | null>(null);
	let inspection = $state<PluginDraftInspection | null>(null);
	let error = $state("");
	let inspecting = $state(false);
	let installing = $state(false);
	let accepted = $state(false);
	let installedPluginId = $state("");

	onMount(() => void decodeLocation());

	function removePayloadFromAddress() {
		const clean = new URL(location.href);
		clean.searchParams.delete("plugin");
		const fragment = new URLSearchParams(clean.hash.replace(/^#/u, ""));
		fragment.delete("plugin");
		clean.hash = fragment.toString();
		history.replaceState(
			history.state,
			"",
			`${clean.pathname}${clean.search}${clean.hash}`,
		);
	}

	async function decodeLocation() {
		decoding = true;
		error = "";
		const current = new URL(location.href);
		const token = pluginShareTokenFromUrl(current);
		removePayloadFromAddress();
		if (!token) {
			error = m.plugins_import_missing();
			decoding = false;
			return;
		}
		try {
			prepared = await decodePluginShare(token);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			decoding = false;
		}
	}

	async function inspect() {
		const source = prepared;
		if (!source || inspecting) return;
		inspecting = true;
		error = "";
		accepted = false;
		inspection = null;
		try {
			inspection = await inspectPluginSourceInSandbox({
				source: source.source,
				fileName: source.fileName,
				locale: getLocale(),
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			inspecting = false;
		}
	}

	async function install() {
		const source = prepared;
		const reviewed = inspection;
		if (!source || !reviewed || !accepted || installing) return;
		installing = true;
		error = "";
		try {
			const state = await installLocalPlugin(source);
			installedPluginId = state.plugin.manifest.id;
			accepted = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			installing = false;
		}
	}
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden pb-16">
	<AppHeader title={m.plugins_import_title()} subtitle={m.plugins_import_subtitle()} backHref="/settings/plugins" />
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<div class="mx-auto max-w-md space-y-4 px-4 py-5">
			{#if decoding}
				<div class="rounded-2xl bg-white p-6 text-center text-sm text-gray-400 shadow-sm">
					{m.plugins_import_decoding()}
				</div>
			{:else if !prepared}
				<div class="rounded-2xl border border-red-100 bg-red-50 p-4">
					<p class="text-sm font-semibold text-red-800">{m.plugins_import_invalid()}</p>
					<p class="mt-2 break-words text-xs leading-relaxed text-red-600">{error}</p>
				</div>
			{:else}
				<section class="rounded-2xl bg-white p-4 shadow-sm">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<h1 class="truncate text-base font-semibold text-gray-900">{prepared.fileName}</h1>
							<p class="mt-1 text-xs text-gray-400">{prepared.size} B</p>
						</div>
						<span class="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700">
							Static valid
						</span>
					</div>
					<p class="mt-3 break-all font-mono text-[10px] text-gray-500">sha256:{prepared.sha256}</p>
					<p class="mt-3 rounded-xl bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-700">{m.plugins_import_static_valid()}</p>
				</section>

				<section class="rounded-2xl border border-red-200 bg-red-50 p-4">
					<p class="text-xs leading-relaxed text-red-700">{m.plugins_import_source_warning()}</p>
					<p class="mt-2 text-[10px] leading-relaxed text-red-500">{m.plugins_import_inline_limit()}</p>
				</section>

				<details open class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
					<summary class="cursor-pointer px-4 py-3 text-sm font-medium text-gray-800">{m.chat_draft_source()}</summary>
					<pre class="max-h-[45vh] overflow-auto whitespace-pre-wrap break-words border-t border-gray-100 bg-gray-950 p-3 font-mono text-[10px] leading-relaxed text-gray-100 select-text">{prepared.source}</pre>
				</details>

				<section class="rounded-2xl bg-white p-4 shadow-sm">
					<p class="text-xs leading-relaxed text-amber-700">{m.plugins_import_inspection_warning()}</p>
					<button type="button" onclick={inspect} disabled={inspecting || installing} class="mt-3 w-full rounded-full border border-violet-400 py-2.5 text-sm font-medium text-violet-700 disabled:opacity-40">
						{inspecting ? m.plugins_import_inspecting() : m.plugins_import_inspect()}
					</button>
				</section>

				{#if inspection}
					<section class="rounded-2xl border border-violet-100 bg-violet-50 p-4 text-xs text-violet-900">
						<h2 class="text-sm font-semibold">{localize(inspection.manifest.name, getLocale())}</h2>
						<p class="mt-1">{localize(inspection.manifest.description, getLocale())}</p>
						<p class="mt-2 font-mono">{inspection.manifest.id} · v{inspection.manifest.version}</p>
						<p class="mt-3 font-semibold">{m.plugins_permissions()}</p>
						<p class="mt-1">{inspection.manifest.permissions?.join(', ') || m.plugins_no_permissions()}</p>
						<p class="mt-3 font-semibold">{m.chat_draft_tools()}</p>
						{#each inspection.tools as tool}
							<p class="mt-1 font-mono">{tool.name}</p>
						{/each}
						{#if inspection.tools.length === 0}<p class="mt-1">—</p>{/if}
						<p class="mt-3 font-semibold">{m.chat_draft_prompt()}</p>
						<p class="mt-1 whitespace-pre-wrap break-words">{inspection.prompt || m.chat_draft_no_prompt()}</p>
					</section>

					{#if installedPluginId}
						<section class="rounded-2xl bg-emerald-50 p-4 text-xs text-emerald-800">
							<p>{m.plugins_import_installed()}</p>
							<a href={`/settings/plugins/${installedPluginId}`} class="mt-3 block rounded-full bg-emerald-600 py-2.5 text-center text-sm font-medium text-white">{m.plugins_import_open_settings()}</a>
						</section>
					{:else}
						<section class="rounded-2xl bg-white p-4 shadow-sm">
							<label class="flex items-start gap-2 text-xs leading-relaxed text-gray-600">
								<input type="checkbox" bind:checked={accepted} disabled={installing} class="mt-0.5 h-4 w-4 rounded border-gray-300 text-violet-600" />
								<span>{m.plugins_import_review_confirm()}</span>
							</label>
							<button type="button" onclick={install} disabled={!accepted || installing} class="mt-3 w-full rounded-full bg-violet-600 py-2.5 text-sm font-medium text-white disabled:opacity-40">
								{installing ? m.chat_draft_installing() : m.plugins_import_install()}
							</button>
						</section>
					{/if}
				{/if}

				{#if error}
					<div class="rounded-xl bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-600">⚠️ {error}</div>
				{/if}
			{/if}
		</div>
	</div>
</div>
