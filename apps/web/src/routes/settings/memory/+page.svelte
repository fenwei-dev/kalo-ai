<script lang="ts">
	import { Block, BlockTitle, Button } from "konsta/svelte";
	import { onMount } from "svelte";
	import AppDialog from "$lib/components/AppDialog.svelte";
	import AppHeader from "$lib/components/AppHeader.svelte";
	import Markdown from "$lib/components/chat/Markdown.svelte";
	import {
		getUserMemory,
		MAX_USER_MEMORY_LENGTH,
		type UserMemorySnapshot,
		updateUserMemory,
	} from "$lib/db/repositories";
	import * as m from "$lib/paraglide/messages";

	let memory = $state<UserMemorySnapshot>({
		content: "",
		version: 0,
		updatedAt: null,
	});
	let content = $state("");
	let loading = $state(true);
	let saving = $state(false);
	let saved = $state(false);
	let error = $state("");
	let confirmingClear = $state(false);
	let overLimit = $derived(content.length > MAX_USER_MEMORY_LENGTH);
	let changed = $derived(content !== memory.content);

	onMount(() => void load());

	async function load() {
		loading = true;
		try {
			memory = await getUserMemory();
			content = memory.content;
			error = "";
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			loading = false;
		}
	}

	async function save(nextContent = content) {
		if (saving || nextContent.length > MAX_USER_MEMORY_LENGTH) return;
		saving = true;
		saved = false;
		error = "";
		try {
			memory = await updateUserMemory(nextContent, memory.version);
			content = memory.content;
			saved = true;
			setTimeout(() => (saved = false), 1500);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			saving = false;
		}
	}

	async function clearMemory() {
		confirmingClear = false;
		await save("");
	}
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden pb-16">
	<AppHeader title={m.settings_memory()} subtitle={m.memory_subtitle()} backHref="/settings" />
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<div class="mx-auto max-w-md py-2">
			<BlockTitle>{m.memory_editor_title()}</BlockTitle>
			<Block inset strong>
				<p class="mb-3 text-xs leading-relaxed text-gray-500">{m.memory_editor_body()}</p>
				<textarea
					bind:value={content}
					disabled={loading || saving}
					rows="12"
					placeholder={m.memory_placeholder()}
					class="w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-mono text-sm leading-relaxed outline-none focus:border-violet-400 disabled:opacity-50"
				></textarea>
				<div class="mt-1 flex items-center justify-between text-[11px]">
					<span class={overLimit ? 'text-red-500' : 'text-gray-400'}>{content.length} / {MAX_USER_MEMORY_LENGTH}</span>
					{#if memory.updatedAt}<span class="text-gray-400">{m.memory_version({ version: memory.version })}</span>{/if}
				</div>
				{#if error}<p class="mt-2 text-xs text-red-500">{error}</p>{/if}
				<Button class="mt-4" rounded disabled={loading || saving || overLimit || !changed} onclick={() => save()}>
					{saving ? m.common_saving() : saved ? m.common_saved() : m.common_save()}
				</Button>
				{#if memory.content}
					<button class="mt-3 w-full text-center text-xs text-red-500" onclick={() => (confirmingClear = true)}>{m.memory_clear()}</button>
				{/if}
			</Block>

			{#if content.trim()}
				<BlockTitle>{m.memory_preview()}</BlockTitle>
				<Block inset strong>
					<Markdown content={content} class="text-sm text-gray-700" />
				</Block>
			{/if}

			<BlockTitle>{m.memory_privacy_title()}</BlockTitle>
			<Block inset strong>
				<p class="text-sm leading-relaxed text-gray-600">{m.memory_privacy_body()}</p>
			</Block>
		</div>
	</div>
</div>

<AppDialog
	bind:open={confirmingClear}
	title={m.memory_clear_title()}
	message={m.memory_clear_message()}
	kind="confirm"
	onconfirm={clearMemory}
/>
