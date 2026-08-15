<script lang="ts">
	import { goto } from "$app/navigation";
	import SwipeSessionItem from "$lib/components/chat/SwipeSessionItem.svelte";
	import { app } from "$lib/context/appContext.svelte";
	import { createSession, deleteSession } from "$lib/db/repositories";
	import * as m from "$lib/paraglide/messages";

	let {
		open = $bindable(),
		currentId = "",
	}: { open: boolean; currentId: string } = $props();

	let creating = $state(false);
	let revealedId = $state<string | null>(null);

	$effect(() => {
		if (!open) revealedId = null;
	});

	async function newSession() {
		creating = true;
		const s = await createSession();
		await app.refreshSessions();
		open = false;
		creating = false;
		goto(`/chat/${s.id}`);
	}

	async function remove(id: string) {
		await deleteSession(id);
		revealedId = null;
		await app.refreshSessions();
		if (id === currentId) goto("/chat");
	}

	function pick(id: string) {
		open = false;
		goto(`/chat/${id}`);
	}

	function timeAgo(ts: number): string {
		const minutes = Math.floor((Date.now() - ts) / 60000);
		if (minutes < 1) return m.common_just_now();
		if (minutes < 60) return m.common_minutes_ago({ value: minutes });
		const h = Math.floor(minutes / 60);
		if (h < 24) return m.common_hours_ago({ value: h });
		const d = Math.floor(h / 24);
		return m.common_days_ago({ value: d });
	}
</script>

{#if open}
	<!-- 遮罩 -->
	<button
		class="fixed inset-0 z-40 bg-black/30"
		aria-label={m.common_close()}
		onclick={() => (open = false)}
	></button>
	<!-- 抽屉 -->
	<div class="fixed inset-x-0 top-0 z-50 max-h-[80vh] overflow-y-auto rounded-b-2xl bg-white shadow-xl">
		<div class="flex items-center justify-between px-4 py-3">
			<h2 class="text-base font-semibold">{m.chat_drawer_title()}</h2>
			<button class="text-sm text-gray-400" onclick={() => (open = false)}>{m.common_close()}</button>
		</div>
		<div class="px-4 pb-2">
			<button
				onclick={newSession}
				disabled={creating}
				class="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-medium text-white disabled:opacity-50"
			>
				{m.chat_start_new()}
			</button>
		</div>
		<ul class="space-y-0.5 px-2 pb-4">
			{#each app.sessions as s (s.id)}
				<li>
					<SwipeSessionItem
						session={s}
						timeLabel={timeAgo(s.lastMessageAt)}
						active={s.id === currentId}
						compact
						revealed={revealedId === s.id}
						onreveal={(id) => (revealedId = id)}
						onselect={pick}
						ondelete={remove}
					/>
				</li>
			{:else}
				<li class="px-3 py-6 text-center text-sm text-gray-400">{m.chat_no_sessions()}</li>
			{/each}
		</ul>
	</div>
{/if}
