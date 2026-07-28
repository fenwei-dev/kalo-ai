<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { app } from '$lib/context/appContext.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import { createSession } from '$lib/db/repositories';

	let creating = $state(false);

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

	function timeAgo(ts: number): string {
		const m = Math.floor((Date.now() - ts) / 60000);
		if (m < 1) return '刚刚';
		if (m < 60) return `${m} 分钟前`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h} 小时前`;
		return `${Math.floor(h / 24)} 天前`;
	}
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden pb-16">
	<AppHeader title="卡卡" subtitle="选择一个对话，或开始新的聊天" actionLabel="新对话" onaction={newSession} disabled={creating} />
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
	<div class="mx-auto max-w-md px-4 py-5">
		<ul class="space-y-2">
			{#each app.sessions as s (s.id)}
				<li>
					<button
						onclick={() => goto(`/chat/${s.id}`)}
						class="w-full rounded-2xl bg-white p-4 text-left shadow-sm"
					>
						<div class="flex items-center justify-between">
							<span class="font-medium">{s.title}</span>
							<span class="text-xs text-gray-400">{timeAgo(s.lastMessageAt)}</span>
						</div>
					</button>
				</li>
			{:else}
				<li class="rounded-2xl bg-white p-6 text-center text-sm text-gray-400 shadow-sm">
					还没有对话，点上面开始吧
				</li>
			{/each}
		</ul>
	</div>
	</div>
</div>
