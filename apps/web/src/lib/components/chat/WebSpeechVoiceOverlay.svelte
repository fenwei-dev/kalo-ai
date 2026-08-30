<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { runTurn } from "$lib/agent/client";
	import { app } from "$lib/context/appContext.svelte";
	import {
		addUserMessageWithMemorySync,
		getOrCreateVoiceConfig,
		getSession,
		renameSession,
	} from "$lib/db/repositories";
	import type { ContentBlock, VoiceConfig } from "$lib/db/schema";
	import * as m from "$lib/paraglide/messages";
	import {
		type ActivityTimeout,
		createActivityTimeout,
	} from "$lib/utils/activityTimeout";
	import { toVoicePlainText } from "$lib/voice/voiceText";
	import {
		inspectWebSpeechCapabilities,
		isLikelySpeechEcho,
		resolveLocalRecognition,
		speakWebSpeech,
		WebSpeechRecognizer,
	} from "$lib/voice/webSpeech";

	type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";

	let {
		open = $bindable(false),
		sessionId,
		onmessageschanged,
	}: {
		open: boolean;
		sessionId: string;
		onmessageschanged?: () => void | Promise<void>;
	} = $props();

	let voiceState = $state<VoiceState>("idle");
	let recognizer: WebSpeechRecognizer | null = null;
	let config = $state.raw<VoiceConfig | null>(null);
	let recognitionLocal = $state(false);
	let selectedVoiceName = $state("");
	let effectiveVoiceURI = "";
	let selectedVoiceLocal = $state(true);
	let recognitionListening = $state(false);
	let interimText = $state("");
	let userText = $state("");
	let assistantText = $state("");
	let rawAssistantText = "";
	let error = $state("");
	let utteranceQueue: string[] = [];
	let processingQueue = false;
	let stopped = $state(true);
	let agentController: AbortController | null = null;
	let speechController: AbortController | null = null;
	let activityTimeout: ActivityTimeout | null = null;
	let currentSpokenText = "";
	let lastFinalText = "";
	let lastFinalAt = 0;

	const stateLabel = () =>
		({
			idle: m.voice_state_idle(),
			listening: m.voice_state_listening(),
			thinking: m.voice_state_thinking(),
			speaking: m.voice_state_speaking(),
			error: m.voice_state_error(),
		})[voiceState];

	onMount(() => {
		const visibility = () => {
			if (document.hidden && !stopped) void stop();
		};
		document.addEventListener("visibilitychange", visibility);
		return () => document.removeEventListener("visibilitychange", visibility);
	});

	onDestroy(() => void stop());

	function blocksText(content: ContentBlock[]): string {
		return content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n")
			.trim();
	}

	async function start() {
		if (!stopped) return;
		error = "";
		interimText = "";
		userText = "";
		assistantText = "";
		try {
			const session = await getSession(sessionId);
			if (session?.mode !== "standard") {
				throw new Error("语音聊天只允许在标准模式会话中使用");
			}
			const stored = await getOrCreateVoiceConfig();
			const capabilities = await inspectWebSpeechCapabilities(stored.lang);
			const networkAllowed = stored.networkSpeechAllowedAt !== undefined;
			const local = resolveLocalRecognition({
				mode: stored.sttMode,
				onDeviceStatus: capabilities.onDeviceStatus,
				networkAllowed,
			});
			if (!capabilities.recognition) {
				throw new Error("当前浏览器不支持 SpeechRecognition");
			}
			const voice =
				[...capabilities.localVoices, ...capabilities.networkVoices].find(
					(candidate) => candidate.voiceURI === stored.preferredVoiceURI,
				) ??
				capabilities.localVoices[0] ??
				(networkAllowed ? capabilities.networkVoices[0] : undefined);
			if (!voice) throw new Error("当前语言没有可用的 TTS voice");
			if (!voice.localService && !networkAllowed) {
				throw new Error("所选 TTS voice 依赖网络，但尚未允许网络语音");
			}
			config = stored;
			recognitionLocal = local;
			selectedVoiceName = voice.name;
			effectiveVoiceURI = voice.voiceURI;
			selectedVoiceLocal = voice.localService;
			stopped = false;
			recognizer = new WebSpeechRecognizer({
				lang: stored.lang,
				local,
				callbacks: {
					onInterim: handleInterim,
					onFinal: handleFinal,
					onError: (message) => {
						error = message;
						voiceState = "error";
					},
					onListeningChange: (listening) => {
						recognitionListening = listening;
					},
				},
			});
			recognizer.start();
			voiceState = "listening";
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			voiceState = "error";
			stopped = true;
		}
	}

	function handleInterim(text: string) {
		interimText = text;
		if (
			config?.turnMode === "realtime" &&
			text.length >= 2 &&
			(voiceState === "speaking" || voiceState === "thinking") &&
			!isLikelySpeechEcho(text, currentSpokenText)
		) {
			interruptActiveTurn();
		}
	}

	function handleFinal(text: string) {
		const normalized = text.trim().slice(0, 8_000);
		const now = Date.now();
		interimText = "";
		if (
			!normalized ||
			(normalized === lastFinalText && now - lastFinalAt < 5_000) ||
			(voiceState === "speaking" &&
				isLikelySpeechEcho(normalized, currentSpokenText))
		) {
			return;
		}
		lastFinalText = normalized;
		lastFinalAt = now;
		userText = normalized;
		if (config?.turnMode === "auto_turn") recognizer?.pause();
		else if (voiceState === "speaking" || voiceState === "thinking")
			interruptActiveTurn();
		utteranceQueue.push(normalized);
		void processUtterances();
	}

	function stopAnswer() {
		interruptActiveTurn();
		if (config?.turnMode === "auto_turn" && !stopped) recognizer?.start();
		if (!stopped) voiceState = "listening";
	}

	function interruptActiveTurn() {
		speechController?.abort();
		speechController = null;
		if ("speechSynthesis" in globalThis) speechSynthesis.cancel();
		agentController?.abort();
		agentController = null;
		activityTimeout?.stop();
		activityTimeout = null;
		currentSpokenText = "";
	}

	async function processUtterances() {
		if (processingQueue || stopped) return;
		processingQueue = true;
		try {
			while (!stopped && utteranceQueue.length > 0) {
				const text = utteranceQueue.shift();
				if (!text) continue;
				voiceState = "thinking";
				rawAssistantText = "";
				assistantText = "";
				await addUserMessageWithMemorySync({
					sessionId,
					transport: "voice",
					content: [{ type: "text", text }],
				});
				const session = await getSession(sessionId);
				if (session?.title === "新对话" || session?.title === "New chat") {
					await renameSession(
						sessionId,
						text.length > 16 ? `${text.slice(0, 16)}…` : text,
					);
					await app.refreshSessions();
				}
				await onmessageschanged?.();
				const controller = new AbortController();
				agentController = controller;
				let finalText = "";
				let turnError = "";
				activityTimeout?.stop();
				activityTimeout = createActivityTimeout(5 * 60 * 1000, () => {
					turnError = "连续 5 分钟没有 Agent 活动，语音 turn 已停止";
					controller.abort();
				});
				await runTurn(
					sessionId,
					{
						onActivity: () => activityTimeout?.touch(),
						onAssistantText: (delta) => {
							rawAssistantText += delta;
							assistantText = toVoicePlainText(rawAssistantText);
						},
						onAssistantMessage: (message) => {
							const messageText = blocksText(
								message.content.map((block) =>
									block.type === "toolCall"
										? { ...block, arguments: {} }
										: block,
								),
							);
							if (messageText) finalText = toVoicePlainText(messageText);
						},
						onMessagesChanged: onmessageschanged,
						onError: (message) => {
							turnError = message;
						},
					},
					controller.signal,
					"voice",
				);
				activityTimeout?.stop();
				activityTimeout = null;
				if (agentController === controller) agentController = null;
				if (controller.signal.aborted) {
					if (turnError && utteranceQueue.length === 0) error = turnError;
					continue;
				}
				finalText = toVoicePlainText(finalText || rawAssistantText);
				if (!finalText) {
					if (turnError) error = turnError;
					if (config?.turnMode === "auto_turn") recognizer?.start();
					voiceState = "listening";
					continue;
				}
				if (utteranceQueue.length > 0) continue;
				voiceState = "speaking";
				currentSpokenText = finalText;
				const speech = new AbortController();
				speechController = speech;
				try {
					await speakWebSpeech({
						text: finalText,
						lang: config?.lang ?? "zh-CN",
						voiceURI: effectiveVoiceURI || undefined,
						localOnly: selectedVoiceLocal,
						rate: config?.speechRate ?? 1,
						pitch: config?.speechPitch ?? 1,
						signal: speech.signal,
					});
				} catch (cause) {
					if (!speech.signal.aborted) {
						error = cause instanceof Error ? cause.message : String(cause);
					}
				} finally {
					if (speechController === speech) speechController = null;
					currentSpokenText = "";
				}
				if (config?.turnMode === "auto_turn" && !stopped) recognizer?.start();
				if (!stopped) voiceState = "listening";
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			voiceState = "error";
		} finally {
			processingQueue = false;
		}
	}

	async function stop() {
		if (stopped) {
			open = false;
			return;
		}
		stopped = true;
		utteranceQueue = [];
		recognizer?.stop();
		recognizer = null;
		interruptActiveTurn();
		voiceState = "idle";
		recognitionListening = false;
		open = false;
		await onmessageschanged?.();
	}

	async function openSettings() {
		await stop();
		await goto("/settings/voice");
	}
</script>

{#if open}
	<div class="fixed inset-0 z-[80] flex flex-col bg-gradient-to-b from-emerald-950 via-slate-950 to-black text-white">
		<header class="flex items-center justify-between px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
			<div><h2 class="text-base font-semibold">{m.voice_overlay_title()}</h2><p class="mt-0.5 text-xs text-emerald-200">{stateLabel()}</p></div>
			<button type="button" onclick={stop} class="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xl" aria-label={m.voice_end()}>×</button>
		</header>
		<div class="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 py-6">
			<div class="relative mt-4 flex h-40 w-40 items-center justify-center">
				<div class="absolute inset-0 rounded-full bg-emerald-500/20 {recognitionListening || voiceState === 'speaking' ? 'animate-ping' : ''}"></div>
				<div class="relative flex h-28 w-28 items-center justify-center rounded-full bg-emerald-500/30 text-5xl ring-1 ring-white/20">{voiceState === 'speaking' ? '🔊' : voiceState === 'thinking' ? '✨' : '🎙️'}</div>
			</div>
			{#if config}
				<div class="mt-4 flex flex-wrap justify-center gap-2 text-[10px]">
					<span class="rounded-full bg-white/10 px-2 py-1">{recognitionLocal ? m.voice_current_stt_local() : m.voice_current_stt_network()}</span>
					<span class="rounded-full bg-white/10 px-2 py-1">{selectedVoiceLocal ? m.voice_current_tts_local({ voice: selectedVoiceName }) : m.voice_current_tts_network({ voice: selectedVoiceName })}</span>
				</div>
				<p class="mt-3 max-w-sm text-center text-[10px] leading-relaxed text-white/55">{recognitionLocal ? m.voice_privacy_local() : m.voice_privacy_network()}</p>
				{#if config.turnMode === 'realtime'}<p class="mt-2 max-w-sm text-center text-[10px] text-amber-300">{m.voice_full_duplex_echo()}</p>{/if}
			{/if}
			<div class="mt-6 w-full max-w-md space-y-3">
				{#if interimText}<div class="rounded-2xl bg-white/5 p-3"><p class="text-[10px] text-white/40">{m.voice_interim()}</p><p class="mt-1 text-sm text-white/70">{interimText}</p></div>{/if}
				{#if userText}<div class="rounded-2xl bg-white/10 p-3"><p class="text-[10px] font-semibold text-emerald-300">{m.voice_user_said()}</p><p class="mt-1 text-sm">{userText}</p></div>{/if}
				{#if assistantText}<div class="rounded-2xl bg-emerald-500/20 p-3"><p class="text-[10px] font-semibold text-emerald-200">{m.voice_kalo_said()}</p><p class="mt-1 whitespace-pre-wrap text-sm">{assistantText}</p></div>{/if}
				<p class="text-center text-[10px] leading-relaxed text-amber-200/70">{m.voice_side_effect_warning()}</p>
			</div>
			{#if error}<div class="mt-5 w-full max-w-md rounded-2xl bg-red-500/20 p-3 text-xs text-red-100">⚠️ {error}</div>{/if}
		</div>
		<footer class="grid gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
			{#if stopped || voiceState === 'idle' || voiceState === 'error'}
				<button type="button" onclick={start} class="w-full rounded-full bg-emerald-500 py-3.5 text-sm font-semibold">{m.voice_start()}</button>
				<button type="button" onclick={openSettings} class="w-full rounded-full border border-white/20 py-2.5 text-xs text-white/70">{m.voice_open_settings()}</button>
			{:else}
				{#if voiceState === 'speaking' || voiceState === 'thinking'}<button type="button" onclick={stopAnswer} class="w-full rounded-full bg-amber-400 py-3 text-sm font-semibold text-black">{m.voice_stop_answer()}</button>{/if}
				<button type="button" onclick={stop} class="w-full rounded-full border border-white/30 bg-white/10 py-3 text-sm">{m.voice_end()}</button>
			{/if}
		</footer>
	</div>
{/if}
