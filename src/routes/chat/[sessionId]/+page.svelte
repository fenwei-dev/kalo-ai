<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { app } from '$lib/context/appContext.svelte';
	import {
		addMessage,
		createSession,
		getSession,
		listMessages,
		renameSession
	} from '$lib/db/repositories';
	import type { ContentBlock, Message as DBMessage, Session } from '$lib/db/schema';
	import { runTurn } from '$lib/agent/client';
	import ToolChip from '$lib/components/chat/ToolChip.svelte';
	import SessionDrawer from '$lib/components/chat/SessionDrawer.svelte';

	let sessionId = $derived(page.params.sessionId ?? '');
	let session = $state<Session | null>(null);
	let messages = $state<DBMessage[]>([]);
	let input = $state('');
	let sending = $state(false);
	let streamText = $state('');
	let errorMsg = $state('');
	let drawerOpen = $state(false);

	let bottomEl: HTMLDivElement | undefined = $state();

	function blocksText(blocks: ContentBlock[]): string {
		return blocks.filter((b) => b.type === 'text').map((b) => (b as any).text).join('');
	}
	function toolCalls(blocks: ContentBlock[]) {
		return blocks.filter((b) => b.type === 'toolCall') as Extract<
			ContentBlock,
			{ type: 'toolCall' }
		>[];
	}

	async function load() {
		if (sessionId === 'new') {
			const s = await createSession();
			await app.refreshSessions();
			goto(`/chat/${s.id}`, { replaceState: true });
			return;
		}
		session = (await getSession(sessionId)) ?? null;
		messages = await listMessages(sessionId);
	}

	onMount(load);
	// 切换会话时重新加载
	$effect(() => {
		sessionId;
		if (page.url.pathname.startsWith('/chat/')) load();
	});

	// 自动滚到底
	$effect(() => {
		messages.length;
		streamText;
		bottomEl?.scrollIntoView({ behavior: 'smooth' });
	});

	async function send() {
		const text = input.trim();
		if (!text || sending) return;
		input = '';
		errorMsg = '';
		await addMessage({ sessionId, role: 'user', content: [{ type: 'text', text }] });
		await load();

		// 首条消息自动起标题
		if (session && session.title === '新对话') {
			const title = text.length > 16 ? text.slice(0, 16) + '…' : text;
			await renameSession(sessionId, title);
			session = { ...session, title };
			await app.refreshSessions();
		}

		sending = true;
		streamText = '';
		await runTurn(sessionId, {
			onAssistantText: (d) => (streamText += d),
			onAssistantMessage: async () => {
				streamText = '';
				await load();
			},
			onError: (m) => (errorMsg = m)
		});
		sending = false;
		streamText = '';
		await load();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}
</script>

<div class="flex h-full flex-col pb-16">
	<!-- header -->
	<header class="flex items-center gap-2 border-b border-black/5 bg-white px-3 py-2.5">
		<button
			class="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
			aria-label="对话列表"
			onclick={() => (drawerOpen = true)}
		>
			<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round" />
			</svg>
		</button>
		<div class="min-w-0 flex-1">
			<p class="truncate text-sm font-semibold">{session?.title ?? '对话'}</p>
			<p class="text-[11px] text-gray-400">卡卡 · {app.aiConfig?.model ?? '未配置 AI'}</p>
		</div>
		<a href="/chat/new" class="block rounded-lg p-1.5 text-gray-400 hover:bg-gray-100" aria-label="新对话">
			<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M12 5v14M5 12h14" stroke-linecap="round" />
			</svg>
		</a>
	</header>

	<!-- messages -->
	<div class="flex-1 overflow-y-auto bg-gray-50 px-3 py-4">
		<div class="mx-auto max-w-md space-y-3">
			{#if messages.length === 0 && !sending}
				<div class="mt-8 rounded-2xl bg-white p-6 text-center shadow-sm">
					<div class="mb-2 text-3xl">🌿</div>
					<p class="text-sm font-medium text-gray-700">和卡卡聊聊</p>
					<p class="mt-1 text-xs text-gray-400">
						告诉我你吃了什么、运动了没，或者想聊目标都可以。
					</p>
				</div>
			{/if}

			{#each messages as m (m.id)}
				{#if m.role === 'user'}
					<div class="flex justify-end">
						<div class="max-w-[80%] rounded-2xl rounded-br-md bg-emerald-500 px-3.5 py-2 text-sm text-white">
							{blocksText(m.content)}
						</div>
					</div>
				{:else if m.role === 'assistant'}
					{@const text = blocksText(m.content)}
					{#if text}
						<div class="flex justify-start">
							<div class="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2 text-sm text-gray-800 shadow-sm">
								{text}
							</div>
						</div>
					{/if}
					{#each toolCalls(m.content) as tc (tc.id)}
						<div class="flex justify-start">
							<ToolChip tool={tc.name} args={tc.arguments} />
						</div>
					{/each}
				{/if}
			{/each}

			<!-- 流式回复 -->
			{#if sending}
				<div class="flex justify-start">
					<div
						class="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2 text-sm text-gray-800 shadow-sm"
					>
						{#if streamText}
							{streamText}<span class="animate-pulse">▋</span>
						{:else}
							<span class="text-gray-400">卡卡正在思考…</span>
						{/if}
					</div>
				</div>
			{/if}

			{#if errorMsg}
				<div class="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">⚠️ {errorMsg}</div>
			{/if}

			<div bind:this={bottomEl}></div>
		</div>
	</div>

	<!-- input -->
	<div class="border-t border-black/5 bg-white px-2 py-2">
		<div class="mx-auto flex max-w-md items-end gap-2">
			<textarea
				rows="1"
				bind:value={input}
				onkeydown={onKeydown}
				placeholder="和卡卡说点什么…"
				class="max-h-32 flex-1 resize-none rounded-2xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-400"
			></textarea>
			<button
				onclick={send}
				disabled={!input.trim() || sending}
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white disabled:opacity-40"
				aria-label="发送"
			>
				<svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
					<path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.993.993 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
				</svg>
			</button>
		</div>
	</div>
</div>

<SessionDrawer bind:open={drawerOpen} currentId={sessionId} />
