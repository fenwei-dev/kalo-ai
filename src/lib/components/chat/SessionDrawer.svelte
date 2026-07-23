<script lang="ts">
	import { goto } from '$app/navigation';
	import { app } from '$lib/context/appContext.svelte';
	import { createSession, deleteSession } from '$lib/db/repositories';

	let { open = $bindable(), currentId = '' }: { open: boolean; currentId: string } = $props();

	let creating = $state(false);

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
		await app.refreshSessions();
		if (id === currentId) goto('/chat');
	}

	function pick(id: string) {
		open = false;
		goto(`/chat/${id}`);
	}

	function timeAgo(ts: number): string {
		const m = Math.floor((Date.now() - ts) / 60000);
		if (m < 1) return '刚刚';
		if (m < 60) return `${m} 分钟前`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h} 小时前`;
		const d = Math.floor(h / 24);
		return `${d} 天前`;
	}
</script>

{#if open}
	<!-- 遮罩 -->
	<button
		class="fixed inset-0 z-40 bg-black/30"
		aria-label="关闭"
		onclick={() => (open = false)}
	></button>
	<!-- 抽屉 -->
	<div class="fixed inset-x-0 top-0 z-50 max-h-[80vh] overflow-y-auto rounded-b-2xl bg-white shadow-xl">
		<div class="flex items-center justify-between px-4 py-3">
			<h2 class="text-base font-semibold">对话</h2>
			<button class="text-sm text-gray-400" onclick={() => (open = false)}>关闭</button>
		</div>
		<div class="px-4 pb-2">
			<button
				onclick={newSession}
				disabled={creating}
				class="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-medium text-white disabled:opacity-50"
			>
				+ 开始新对话
			</button>
		</div>
		<ul class="px-2 pb-4">
			{#each app.sessions as s (s.id)}
				<li>
					<button
						onclick={() => pick(s.id)}
						class="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left hover:bg-gray-50
							{s.id === currentId ? 'bg-emerald-50' : ''}"
					>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm font-medium">{s.title}</span>
							<span class="block text-xs text-gray-400">{timeAgo(s.lastMessageAt)}</span>
						</span>
						<span
							role="button"
							tabindex="0"
							class="ml-2 shrink-0 text-gray-300 hover:text-red-400"
							onclick={async (e) => {
								e.stopPropagation();
								await remove(s.id);
							}}
							onkeydown={(e) => e.key === 'Enter' && remove(s.id)}
						>
							✕
						</span>
					</button>
				</li>
			{:else}
				<li class="px-3 py-6 text-center text-sm text-gray-400">还没有对话</li>
			{/each}
		</ul>
	</div>
{/if}
