<script lang="ts">
	import { tick } from 'svelte';
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
	import Markdown from '$lib/components/chat/Markdown.svelte';
	import SessionDrawer from '$lib/components/chat/SessionDrawer.svelte';
	import * as m from '$lib/paraglide/messages';

	let sessionId = $derived(page.params.sessionId ?? '');
	let session = $state<Session | null>(null);
	let messages = $state<DBMessage[]>([]);
	let input = $state('');
	let sending = $state(false);
	let streamText = $state('');
	let errorMsg = $state('');
	let drawerOpen = $state(false);
	let loadGeneration = 0;
	let creatingNew = false;
	const attemptedUserMessages = new Set<string>();

	let messagesEl: HTMLDivElement | undefined = $state();

	function blocksText(blocks: ContentBlock[]): string {
		return blocks.filter((b) => b.type === 'text').map((b) => (b as any).text).join('');
	}
	function toolCalls(blocks: ContentBlock[]) {
		return blocks.filter((b) => b.type === 'toolCall') as Extract<
			ContentBlock,
			{ type: 'toolCall' }
		>[];
	}
	function toolResult(callId: string): { failed: boolean; error: string } | null {
		const result = messages.find((m) => m.role === 'toolResult' && m.toolCallId === callId);
		if (!result) return null;
		let error = '';
		if (result.isError) {
			try {
				error = JSON.parse(blocksText(result.content));
			} catch {
				error = blocksText(result.content);
			}
		}
		return { failed: !!result.isError, error };
	}

	async function load(id = sessionId) {
		const generation = ++loadGeneration;
		if (id === 'new') {
			if (creatingNew) return;
			creatingNew = true;
			try {
				const s = await createSession();
				await app.refreshSessions();
				await goto(`/chat/${s.id}`, { replaceState: true });
			} finally {
				creatingNew = false;
			}
			return;
		}
		const found = (await getSession(id)) ?? null;
		if (generation !== loadGeneration || id !== sessionId) return;
		if (!found) {
			await goto('/chat', { replaceState: true });
			return;
		}
		session = found;
		const loaded = await listMessages(id);
		if (generation === loadGeneration) {
			messages = loaded;
			void triggerPendingTurn(id, loaded);
		}
	}

	/** 设置页等入口会预先写入 user 消息；进入会话后自动让卡卡回答。 */
	async function triggerPendingTurn(id: string, loaded: DBMessage[]) {
		if (sending || !app.aiConfig) return;
		const lastUserIndex = loaded.findLastIndex((message) => message.role === 'user');
		if (lastUserIndex < 0 || loaded.slice(lastUserIndex + 1).some((message) => message.role === 'assistant')) return;
		const userMessage = loaded[lastUserIndex];
		if (attemptedUserMessages.has(userMessage.id)) return;
		attemptedUserMessages.add(userMessage.id);
		await runAgent(id);
	}

	// 切换会话时重新加载；单一入口避免 /chat/new 重复创建。
	$effect(() => {
		const id = sessionId;
		if (page.url.pathname.startsWith('/chat/')) {
			void load(id).catch((error) => showError(error));
		}
	});

	// 只滚动消息容器。scrollIntoView 会连带滚动移动端 visual viewport，
	// 导致整个应用顶部永久移出屏幕。
	$effect(() => {
		messages.length;
		streamText;
		void scrollMessagesToBottom();
	});

	async function scrollMessagesToBottom() {
		await tick();
		if (!messagesEl) return;
		messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
	}

	function showError(error: unknown) {
		errorMsg = error instanceof Error ? error.message : String(error);
	}

	async function processAgent(id: string) {
		await runTurn(id, {
			onAssistantText: (delta) => (streamText += delta),
			onAssistantMessage: () => (streamText = ''),
			onError: (message) => (errorMsg = message)
		});
	}

	async function finishTurn(id: string) {
		sending = false;
		streamText = '';
		try {
			await load(id);
		} catch (error) {
			showError(error);
		}
	}

	async function runAgent(id: string) {
		if (sending) return;
		sending = true;
		errorMsg = '';
		streamText = '';
		try {
			await processAgent(id);
		} catch (error) {
			showError(error);
		} finally {
			await finishTurn(id);
		}
	}

	async function send() {
		const text = input.trim();
		const activeSession = session;
		const id = sessionId;
		if (!text || sending || !activeSession) return;

		// Claim the turn before any IndexedDB work so double taps cannot create an
		// unprocessed message and the thinking indicator appears immediately.
		sending = true;
		input = '';
		errorMsg = '';
		streamText = '';
		let persisted = false;
		try {
			const userMessage = await addMessage({ sessionId: id, role: 'user', content: [{ type: 'text', text }] });
			persisted = true;
			attemptedUserMessages.add(userMessage.id);
			await load(id);

			if (activeSession.title === '新对话' || activeSession.title === 'New chat') {
				const title = text.length > 16 ? text.slice(0, 16) + '…' : text;
				await renameSession(id, title);
				session = { ...activeSession, title };
				await app.refreshSessions();
			}

			await processAgent(id);
		} catch (error) {
			showError(error);
			if (!persisted) input = text;
		} finally {
			await finishTurn(id);
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}
</script>

<div class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden pb-16">
	<!-- header -->
	<header class="shrink-0 flex items-center gap-2 border-b border-black/5 bg-white px-3 py-2.5">
		<button
			class="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
			aria-label={m.chat_session_list()}
			onclick={() => (drawerOpen = true)}
		>
			<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round" />
			</svg>
		</button>
		<div class="min-w-0 flex-1">
			<p class="truncate text-sm font-semibold">{session?.title ?? m.chat_session_fallback()}</p>
			<p class="text-[11px] text-gray-400">{m.chat_list_title()} · {app.aiConfig?.model ?? m.chat_unconfigured()}</p>
		</div>
		<a href="/chat/new" class="block rounded-lg p-1.5 text-gray-400 hover:bg-gray-100" aria-label={m.chat_new()}>
			<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M12 5v14M5 12h14" stroke-linecap="round" />
			</svg>
		</a>
	</header>

	<!-- messages -->
	<div
		bind:this={messagesEl}
		class="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain bg-gray-50 px-3 py-4 [-webkit-overflow-scrolling:touch]"
	>
		<div class="mx-auto max-w-md space-y-3">
			{#if messages.length === 0 && !sending}
				<div class="mt-8 rounded-2xl bg-white p-6 text-center shadow-sm">
					<div class="mb-2 text-3xl">🌿</div>
					<p class="text-sm font-medium text-gray-700">{m.chat_empty_title()}</p>
					<p class="mt-1 text-xs text-gray-400">
						{m.chat_empty_body()}
					</p>
				</div>
			{/if}

			{#each messages as m (m.id)}
				{#if m.role === 'user'}
					<div class="flex justify-end">
						<div class="max-w-[80%] rounded-2xl rounded-br-md bg-emerald-500 px-3.5 py-2 text-sm text-white">
							<Markdown content={blocksText(m.content)} class="text-white" />
						</div>
					</div>
				{:else if m.role === 'assistant'}
					{@const text = blocksText(m.content)}
					{#if text}
						<div class="flex justify-start">
							<div class="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2 text-sm text-gray-800 shadow-sm">
								<Markdown content={text} />
							</div>
						</div>
					{/if}
					{#each toolCalls(m.content) as tc (tc.id)}
						{@const result = toolResult(tc.id)}
						{#if result}
							<div class="flex justify-start">
								<ToolChip tool={tc.name} args={tc.arguments} failed={result.failed} error={result.error} />
							</div>
						{/if}
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
							<Markdown content={streamText} /><span class="animate-pulse">▋</span>
						{:else}
							<span class="text-gray-400">{m.chat_thinking()}</span>
						{/if}
					</div>
				</div>
			{/if}

			{#if errorMsg}
				<div class="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">⚠️ {errorMsg}</div>
			{/if}

			<div aria-hidden="true"></div>
		</div>
	</div>

	<!-- input -->
	<div class="shrink-0 border-t border-black/5 bg-white px-2 py-2">
		<div class="mx-auto flex max-w-md items-end gap-2">
			<textarea
				rows="1"
				bind:value={input}
				onkeydown={onKeydown}
				placeholder={m.chat_placeholder()}
				class="max-h-32 flex-1 resize-none rounded-2xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-400"
			></textarea>
			<button
				onclick={send}
				disabled={!input.trim() || sending || !session}
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white disabled:opacity-40"
				aria-label={m.chat_send()}
			>
				<svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
					<path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.993.993 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
				</svg>
			</button>
		</div>
	</div>
</div>

<SessionDrawer bind:open={drawerOpen} currentId={sessionId} />
