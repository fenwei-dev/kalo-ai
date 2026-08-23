<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import AppHeader from "$lib/components/AppHeader.svelte";
	import SwipeListItem from "$lib/components/SwipeListItem.svelte";
	import { app } from "$lib/context/appContext.svelte";
	import { createSession, deleteSession } from "$lib/db/repositories";
	import * as m from "$lib/paraglide/messages";

	let creating = $state(false);
	let revealedId = $state<string | null>(null);

	onMount(() => {
		app.refreshSessions();
	});

	async function newSession() {
		creating = true;
		const s = await createSession();
		await app.refreshSessions();
		creating = false;
		goto(`/chat/${s.id}`);
	}

	async function removeSession(id: string) {
		await deleteSession(id);
		revealedId = null;
		await app.refreshSessions();
	}

	function timeAgo(ts: number): string {
		const minutes = Math.floor((Date.now() - ts) / 60000);
		if (minutes < 1) return m.common_just_now();
		if (minutes < 60) return m.common_minutes_ago({ value: minutes });
		const h = Math.floor(minutes / 60);
		if (h < 24) return m.common_hours_ago({ value: h });
		return m.common_days_ago({ value: Math.floor(h / 24) });
	}
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden pb-16">
	<AppHeader title={m.chat_list_title()} subtitle={m.chat_list_subtitle()} actionLabel={m.chat_new()} onaction={newSession} disabled={creating} />
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
	<div class="mx-auto max-w-md px-4 py-5">
		<ul class="space-y-2">
			{#each app.sessions as s (s.id)}
				<li>
					<SwipeListItem
						id={s.id}
						title={s.title}
						subtitle={timeAgo(s.lastMessageAt)}
						deleteAriaLabel={m.chat_delete_session({ title: s.title })}
						deletingLabel={m.chat_deleting_session()}
						revealed={revealedId === s.id}
						onreveal={(id) => (revealedId = id)}
						onselect={(id) => goto(`/chat/${id}`)}
						ondelete={removeSession}
					/>
				</li>
			{:else}
				<li class="rounded-2xl bg-white p-6 text-center text-sm text-gray-400 shadow-sm">
					{m.chat_no_sessions()}
				</li>
			{/each}
		</ul>
	</div>
	</div>
</div>
