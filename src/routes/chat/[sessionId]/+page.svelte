<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { app } from '$lib/context/appContext.svelte';
	import {
		addUserMessageWithMemorySync,
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
	import {
		ImagePreparationError,
		prepareImage,
		type PreparedImage
	} from '$lib/utils/image';

	let sessionId = $derived(page.params.sessionId ?? '');
	let session = $state<Session | null>(null);
	let messages = $state<DBMessage[]>([]);
	let input = $state('');
	let sending = $state(false);
	let streamText = $state('');
	let errorMsg = $state('');
	let drawerOpen = $state(false);
	let selectedImage = $state<PreparedImage | null>(null);
	let preparingImage = $state(false);
	let imageInput: HTMLInputElement | undefined = $state();
	let turnController = $state<AbortController | null>(null);
	let turnSessionId: string | null = null;
	let turnTimer: ReturnType<typeof setTimeout> | undefined;
	let turnAbortReason: 'cancelled' | 'timeout' | null = null;
	let loadGeneration = 0;
	let creatingNew = false;
	let destroyed = false;
	const attemptedUserMessages = new Set<string>();

	onDestroy(() => {
		destroyed = true;
		if (turnTimer) clearTimeout(turnTimer);
		turnAbortReason = 'cancelled';
		turnController?.abort();
		turnController = null;
	});

	let messagesEl: HTMLDivElement | undefined = $state();

	function blocksText(blocks: ContentBlock[]): string {
		return blocks.filter((b) => b.type === 'text').map((b) => (b as any).text).join('');
	}
	function imageBlocks(blocks: ContentBlock[]) {
		return blocks.filter((block) => block.type === 'image') as Extract<
			ContentBlock,
			{ type: 'image' }
		>[];
	}
	function imageSource(image: Extract<ContentBlock, { type: 'image' }> | PreparedImage) {
		return `data:${image.mimeType};base64,${image.data}`;
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
		// A completed turn from a previous route must not invalidate the current
		// session's in-flight load generation.
		if (id !== 'new' && id !== sessionId) return;
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
		if (
			lastUserIndex < 0 ||
			loaded.slice(lastUserIndex + 1).some((message) => message.role === 'assistant' && !message.synthetic)
		) return;
		const userMessage = loaded[lastUserIndex];
		if (attemptedUserMessages.has(userMessage.id)) return;
		attemptedUserMessages.add(userMessage.id);
		await runAgent(id);
	}

	// 切换会话时重新加载；单一入口避免 /chat/new 重复创建。
	$effect(() => {
		const id = sessionId;
		if (turnController && turnSessionId && turnSessionId !== id && !turnController.signal.aborted) {
			turnAbortReason = 'cancelled';
			turnController.abort();
		}
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

	function beginTurn(id: string): AbortController {
		const controller = new AbortController();
		turnController = controller;
		turnSessionId = id;
		turnAbortReason = null;
		turnTimer = setTimeout(() => {
			if (turnController !== controller) return;
			turnAbortReason = 'timeout';
			controller.abort();
		}, 5 * 60 * 1000);
		return controller;
	}

	function endTurn(controller: AbortController) {
		if (turnController !== controller) return;
		if (turnTimer) clearTimeout(turnTimer);
		turnTimer = undefined;
		turnController = null;
		turnSessionId = null;
	}

	function cancelTurn() {
		if (!turnController || turnController.signal.aborted) return;
		turnAbortReason = 'cancelled';
		turnController.abort();
	}

	async function processAgent(id: string, signal: AbortSignal) {
		await runTurn(
			id,
			{
				onAssistantText: (delta) => {
					if (id === sessionId) streamText += delta;
				},
				// UI refreshes must not block the agent lifecycle or tool execution.
				onMessagesChanged: () => {
					void load(id).catch((error) => {
						if (id === sessionId) showError(error);
					});
				},
				onAssistantMessage: () => {
					if (id === sessionId) streamText = '';
				},
				onError: (message) => {
					if (id !== sessionId) return;
					errorMsg =
						turnAbortReason === 'timeout'
							? m.chat_request_timeout()
							: turnAbortReason === 'cancelled'
								? m.chat_request_cancelled()
								: message;
				}
			},
			signal
		);
	}

	async function finishTurn(id: string) {
		// Release the composer before refreshing messages. A failed or stalled
		// refresh must never leave this session permanently locked.
		sending = false;
		streamText = '';
		if (destroyed) return;
		const refreshId = id === sessionId ? id : sessionId;
		try {
			await load(refreshId);
		} catch (error) {
			if (refreshId === sessionId) showError(error);
		}
	}

	async function runAgent(id: string) {
		if (sending) return;
		sending = true;
		errorMsg = '';
		streamText = '';
		const controller = beginTurn(id);
		try {
			await processAgent(id, controller.signal);
		} catch (error) {
			if (id === sessionId) {
				if (turnAbortReason === 'timeout') errorMsg = m.chat_request_timeout();
				else if (turnAbortReason === 'cancelled') errorMsg = m.chat_request_cancelled();
				else showError(error);
			}
		} finally {
			endTurn(controller);
			await finishTurn(id);
		}
	}

	function imageErrorMessage(error: unknown): string {
		if (!(error instanceof ImagePreparationError)) return m.chat_image_failed();
		if (error.code === 'unsupported') return m.chat_image_unsupported();
		if (error.code === 'too-large') return m.chat_image_too_large();
		return m.chat_image_failed();
	}

	async function selectImage(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		const file = target.files?.[0];
		target.value = '';
		if (!file || sending || preparingImage) return;
		preparingImage = true;
		errorMsg = '';
		try {
			selectedImage = await prepareImage(file);
		} catch (error) {
			errorMsg = imageErrorMessage(error);
		} finally {
			preparingImage = false;
		}
	}

	async function send() {
		const text = input.trim();
		const image = selectedImage;
		const activeSession = session;
		const id = sessionId;
		if ((!text && !image) || sending || preparingImage || !activeSession) return;

		// Claim the turn before any IndexedDB work so double taps cannot create an
		// unprocessed message and the thinking indicator appears immediately.
		sending = true;
		const controller = beginTurn(id);
		input = '';
		selectedImage = null;
		errorMsg = '';
		streamText = '';
		let persisted = false;
		try {
			const content: ContentBlock[] = [];
			if (text) content.push({ type: 'text', text });
			if (image) content.push({ type: 'image', data: image.data, mimeType: image.mimeType });
			const userMessage = await addUserMessageWithMemorySync({ sessionId: id, content });
			persisted = true;
			attemptedUserMessages.add(userMessage.id);
			await load(id);
			controller.signal.throwIfAborted();

			if (activeSession.title === '新对话' || activeSession.title === 'New chat') {
				const title = text ? (text.length > 16 ? text.slice(0, 16) + '…' : text) : m.chat_image_title();
				await renameSession(id, title);
				controller.signal.throwIfAborted();
				session = { ...activeSession, title };
				await app.refreshSessions();
			}

			await processAgent(id, controller.signal);
		} catch (error) {
			if (id === sessionId) {
				if (turnAbortReason === 'timeout') errorMsg = m.chat_request_timeout();
				else if (turnAbortReason === 'cancelled') errorMsg = m.chat_request_cancelled();
				else showError(error);
				if (!persisted) {
					input = text;
					selectedImage = image;
				}
			}
		} finally {
			endTurn(controller);
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

			{#each messages as message (message.id)}
				{#if message.role === 'user'}
					{@const text = blocksText(message.content)}
					{@const images = imageBlocks(message.content)}
					<div class="flex justify-end">
						<div class="max-w-[80%] overflow-hidden rounded-2xl rounded-br-md bg-emerald-500 text-sm text-white">
							{#each images as image}
								<img
									src={imageSource(image)}
									alt={m.chat_image_alt()}
									class="max-h-72 w-full object-contain"
								/>
							{/each}
							{#if text}
								<div class="px-3.5 py-2"><Markdown content={text} class="text-white" /></div>
							{/if}
						</div>
					</div>
				{:else if message.role === 'assistant'}
					{@const text = blocksText(message.content)}
					{#if text}
						<div class="flex justify-start">
							<div class="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2 text-sm text-gray-800 shadow-sm">
								<Markdown content={text} />
							</div>
						</div>
					{/if}
					{#each toolCalls(message.content) as tc (tc.id)}
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
		<div class="mx-auto max-w-md space-y-2">
			{#if selectedImage}
				<div class="relative inline-block overflow-hidden rounded-xl border border-gray-200 bg-gray-50 p-1">
					<img src={imageSource(selectedImage)} alt={m.chat_image_preview()} class="h-16 w-16 rounded-lg object-cover" />
					<button
						type="button"
						onclick={() => (selectedImage = null)}
						class="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-xs text-white"
						aria-label={m.chat_image_remove()}
					>×</button
					>
				</div>
			{/if}
			<div class="flex items-end gap-2">
				<input
					bind:this={imageInput}
					type="file"
					accept="image/jpeg,image/png,image/webp,image/gif"
					class="hidden"
					onchange={selectImage}
				/>
				<button
					type="button"
					onclick={() => imageInput?.click()}
					disabled={sending || preparingImage || !session}
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-500 disabled:opacity-40"
					aria-label={preparingImage ? m.chat_image_processing() : m.chat_image_add()}
				>
					{#if preparingImage}
						<span class="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-emerald-500"></span>
					{:else}
						<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<rect x="3" y="4" width="18" height="16" rx="2" />
							<circle cx="8.5" cy="9" r="1.5" />
							<path d="m4 17 4-4 3 3 3-3 6 5" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					{/if}
				</button>
				<textarea
					rows="1"
					bind:value={input}
					onkeydown={onKeydown}
					placeholder={m.chat_placeholder()}
					class="max-h-32 flex-1 resize-none rounded-2xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-400"
				></textarea>
				<button
					onclick={sending ? cancelTurn : send}
					disabled={sending ? !turnController || turnController.signal.aborted : (!input.trim() && !selectedImage) || preparingImage || !session}
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-40 {sending ? 'bg-red-500' : 'bg-emerald-500'}"
					aria-label={sending ? m.chat_stop() : m.chat_send()}
				>
					{#if sending}
						<span class="h-3.5 w-3.5 rounded-sm bg-white"></span>
					{:else}
						<svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
							<path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.993.993 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
						</svg>
					{/if}
				</button>
			</div>
		</div>
	</div>
</div>

<SessionDrawer bind:open={drawerOpen} currentId={sessionId} />
