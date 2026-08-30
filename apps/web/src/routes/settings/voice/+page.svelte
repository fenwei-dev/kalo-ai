<script lang="ts">
	import { Block, BlockTitle } from "konsta/svelte";
	import { onDestroy, onMount } from "svelte";
	import AppHeader from "$lib/components/AppHeader.svelte";
	import {
		getOrCreateVoiceConfig,
		saveVoiceConfig,
	} from "$lib/db/repositories";
	import type {
		VoiceConfig,
		VoiceTurnMode,
		WebSpeechSttMode,
	} from "$lib/db/schema";
	import * as m from "$lib/paraglide/messages";
	import { getLocale } from "$lib/paraglide/runtime";
	import {
		inspectWebSpeechCapabilities,
		installOnDeviceSpeechLanguage,
		speakWebSpeech,
		testSpeechRecognition,
		type WebSpeechCapabilities,
	} from "$lib/voice/webSpeech";

	let config = $state<VoiceConfig | null>(null);
	let lang = $state<VoiceConfig["lang"]>(
		getLocale() === "en-us" ? "en-US" : "zh-CN",
	);
	let sttMode = $state<WebSpeechSttMode>("local_preferred");
	let turnMode = $state<VoiceTurnMode>("auto_turn");
	let speechRate = $state(1);
	let speechPitch = $state(1);
	let capabilities = $state<WebSpeechCapabilities | null>(null);
	let loading = $state(true);
	let installing = $state(false);
	let testing: "local" | "network" | null = $state(null);
	let speaking = $state(false);
	let networkAllowed = $state(false);
	let transcript = $state("");
	let selectedVoiceURI = $state("");
	let phrase = $state(
		getLocale() === "en-us"
			? "Hello, this is Kalo's local voice test."
			: "你好，这是卡卡的本地语音测试。",
	);
	let error = $state("");
	let saving = $state(false);
	let saved = $state(false);
	let operationController: AbortController | null = null;

	onMount(() => void load());
	onDestroy(() => {
		operationController?.abort();
		if ("speechSynthesis" in globalThis) speechSynthesis.cancel();
	});

	const allVoices = () => [
		...(capabilities?.localVoices ?? []),
		...(capabilities?.networkVoices ?? []),
	];
	const selectedVoice = () =>
		allVoices().find((voice) => voice.voiceURI === selectedVoiceURI);

	async function load() {
		loading = true;
		error = "";
		try {
			const stored = await getOrCreateVoiceConfig();
			config = stored;
			lang = stored.lang;
			sttMode = stored.sttMode;
			turnMode = stored.turnMode;
			speechRate = stored.speechRate;
			speechPitch = stored.speechPitch;
			selectedVoiceURI = stored.preferredVoiceURI ?? "";
			networkAllowed = stored.networkSpeechAllowedAt !== undefined;
			await inspect();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			loading = false;
		}
	}

	function statusLabel(
		status: WebSpeechCapabilities["onDeviceStatus"],
	): string {
		if (getLocale() === "en-us") return status;
		return {
			available: "已安装可用",
			downloadable: "可以下载",
			downloading: "正在下载",
			unavailable: "不可用",
			unsupported: "浏览器不支持",
		}[status];
	}

	async function inspect() {
		loading = true;
		error = "";
		try {
			capabilities = await inspectWebSpeechCapabilities(lang);
			const preferred =
				capabilities.localVoices[0] ?? capabilities.networkVoices[0];
			if (
				!selectedVoiceURI ||
				!allVoices().some((voice) => voice.voiceURI === selectedVoiceURI)
			) {
				selectedVoiceURI = preferred?.voiceURI ?? "";
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			loading = false;
		}
	}

	async function save() {
		if (saving || testing || speaking) return;
		saving = true;
		error = "";
		try {
			config = await saveVoiceConfig({
				lang,
				sttMode,
				turnMode,
				speechRate,
				speechPitch,
				preferredVoiceURI: selectedVoiceURI || undefined,
				networkSpeechAllowedAt: networkAllowed
					? (config?.networkSpeechAllowedAt ?? Date.now())
					: undefined,
			});
			saved = true;
			setTimeout(() => (saved = false), 1_500);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			saving = false;
		}
	}

	async function chooseLanguage(value: VoiceConfig["lang"]) {
		if (testing || speaking || installing) return;
		lang = value;
		saved = false;
		selectedVoiceURI = "";
		transcript = "";
		await inspect();
	}

	async function installLocalPack() {
		if (installing) return;
		installing = true;
		error = "";
		try {
			const installed = await installOnDeviceSpeechLanguage(lang);
			if (!installed) throw new Error("本地语音语言包安装失败");
			await inspect();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			installing = false;
		}
	}

	async function testStt(local: boolean) {
		if (testing || speaking || (local ? false : !networkAllowed)) return;
		testing = local ? "local" : "network";
		transcript = "";
		error = "";
		const controller = new AbortController();
		operationController = controller;
		try {
			transcript = await testSpeechRecognition({
				lang,
				local,
				signal: controller.signal,
				onInterim: (text) => (transcript = text),
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (operationController === controller) operationController = null;
			testing = null;
		}
	}

	function cancelOperation() {
		operationController?.abort();
		if ("speechSynthesis" in globalThis) speechSynthesis.cancel();
	}

	async function testTts() {
		if (speaking || testing || !phrase.trim()) return;
		const voice = selectedVoice();
		if (voice && !voice.localService && !networkAllowed) {
			error = m.web_speech_network_body();
			return;
		}
		speaking = true;
		error = "";
		const controller = new AbortController();
		operationController = controller;
		try {
			await speakWebSpeech({
				text: phrase,
				lang,
				voiceURI: voice?.voiceURI,
				localOnly: voice?.localService ?? true,
				rate: speechRate,
				pitch: speechPitch,
				signal: controller.signal,
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (operationController === controller) operationController = null;
			speaking = false;
		}
	}
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden pb-16">
	<AppHeader title={m.web_speech_title()} subtitle={m.web_speech_subtitle()} backHref="/settings" />
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<div class="mx-auto max-w-md py-3">
			<Block inset strong><p class="text-xs leading-relaxed text-gray-600">{m.web_speech_intro()}</p></Block>

			<BlockTitle>{m.web_speech_language()}</BlockTitle>
			<Block inset strong>
				<div class="grid grid-cols-2 gap-2">
					<button type="button" onclick={() => chooseLanguage('zh-CN')} class="rounded-xl border py-2.5 text-sm {lang === 'zh-CN' ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-gray-200 text-gray-600'}">中文</button>
					<button type="button" onclick={() => chooseLanguage('en-US')} class="rounded-xl border py-2.5 text-sm {lang === 'en-US' ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-gray-200 text-gray-600'}">English</button>
				</div>
			</Block>

			<BlockTitle>{m.web_speech_stt_mode()}</BlockTitle>
			<Block inset strong>
				<div class="space-y-2">
					<button type="button" onclick={() => { sttMode = 'local_preferred'; saved = false; }} aria-pressed={sttMode === 'local_preferred'} class="w-full rounded-xl border p-3 text-left {sttMode === 'local_preferred' ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200'}">
						<p class="text-sm font-medium text-gray-800">{m.web_speech_local_preferred()}</p><p class="mt-1 text-xs leading-relaxed text-gray-500">{m.web_speech_local_preferred_body()}</p>
					</button>
					<button type="button" onclick={() => { sttMode = 'local_only'; saved = false; }} aria-pressed={sttMode === 'local_only'} class="w-full rounded-xl border p-3 text-left {sttMode === 'local_only' ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200'}">
						<p class="text-sm font-medium text-gray-800">{m.web_speech_local_only()}</p><p class="mt-1 text-xs leading-relaxed text-gray-500">{m.web_speech_local_only_body()}</p>
					</button>
					<button type="button" onclick={() => { sttMode = 'network'; saved = false; }} aria-pressed={sttMode === 'network'} class="w-full rounded-xl border p-3 text-left {sttMode === 'network' ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}">
						<p class="text-sm font-medium text-gray-800">{m.web_speech_network_mode()}</p><p class="mt-1 text-xs leading-relaxed text-gray-500">{m.web_speech_network_mode_body()}</p>
					</button>
				</div>
			</Block>

			<BlockTitle>{m.web_speech_turn_mode()}</BlockTitle>
			<Block inset strong>
				<div class="grid grid-cols-1 gap-2">
					<button type="button" onclick={() => { turnMode = 'auto_turn'; saved = false; }} aria-pressed={turnMode === 'auto_turn'} class="rounded-xl border p-3 text-left {turnMode === 'auto_turn' ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200'}">
						<p class="text-sm font-medium text-gray-800">{m.web_speech_auto_turn()}</p><p class="mt-1 text-xs leading-relaxed text-gray-500">{m.web_speech_auto_turn_body()}</p>
					</button>
					<button type="button" onclick={() => { turnMode = 'realtime'; saved = false; }} aria-pressed={turnMode === 'realtime'} class="rounded-xl border p-3 text-left {turnMode === 'realtime' ? 'border-violet-400 bg-violet-50' : 'border-gray-200'}">
						<p class="text-sm font-medium text-gray-800">{m.web_speech_realtime()}</p><p class="mt-1 text-xs leading-relaxed text-gray-500">{m.web_speech_realtime_body()}</p>
					</button>
				</div>
			</Block>

			<BlockTitle>{m.web_speech_delivery()}</BlockTitle>
			<Block inset strong>
				<div class="space-y-4">
					<p class="text-xs leading-relaxed text-gray-500">{m.web_speech_delivery_body()}</p>
					<label class="block text-xs font-medium text-gray-700" for="web-speech-rate">{m.web_speech_rate({ value: speechRate.toFixed(2) })}</label>
					<input id="web-speech-rate" type="range" min="0.5" max="2" step="0.05" bind:value={speechRate} oninput={() => (saved = false)} class="w-full accent-emerald-600" />
					<label class="block text-xs font-medium text-gray-700" for="web-speech-pitch">{m.web_speech_pitch({ value: speechPitch.toFixed(2) })}</label>
					<input id="web-speech-pitch" type="range" min="0.5" max="1.5" step="0.05" bind:value={speechPitch} oninput={() => (saved = false)} class="w-full accent-violet-600" />
					<button type="button" onclick={() => { speechRate = 1; speechPitch = 1; saved = false; }} class="w-full rounded-full border border-gray-300 py-2 text-xs text-gray-600">{m.web_speech_reset_delivery()}</button>
				</div>
			</Block>

			<BlockTitle>{m.web_speech_capabilities()}</BlockTitle>
			<Block inset strong>
				{#if loading}
					<p class="text-center text-sm text-gray-400">{m.common_loading()}</p>
				{:else if capabilities}
					<div class="space-y-2 text-xs">
						<p class={capabilities.recognition ? 'text-emerald-700' : 'text-red-600'}>{capabilities.recognition ? '✓' : '✗'} {capabilities.recognition ? m.web_speech_recognition_supported() : m.web_speech_recognition_missing()}</p>
						<p class={capabilities.onDeviceApi ? 'text-emerald-700' : 'text-amber-600'}>{capabilities.onDeviceApi ? '✓' : '!' } {capabilities.onDeviceApi ? m.web_speech_local_api_supported() : m.web_speech_local_api_missing()}</p>
						<p class="text-gray-600">{m.web_speech_local_status({ status: statusLabel(capabilities.onDeviceStatus) })}</p>
						<p class="text-gray-600">{m.web_speech_local_voices({ count: capabilities.localVoices.length })}</p>
						<p class="text-gray-600">{m.web_speech_network_voices({ count: capabilities.networkVoices.length })}</p>
						{#if capabilities.onDeviceStatus === 'downloadable' || capabilities.onDeviceStatus === 'downloading'}
							<button type="button" onclick={installLocalPack} disabled={installing} class="mt-2 w-full rounded-full border border-emerald-500 py-2.5 text-sm font-medium text-emerald-700 disabled:opacity-40">{installing ? m.web_speech_installing() : m.web_speech_install_local()}</button>
						{/if}
						<button type="button" onclick={inspect} disabled={loading || installing || testing !== null || speaking} class="w-full rounded-full border border-gray-300 py-2.5 text-sm text-gray-600 disabled:opacity-40">{m.web_speech_refresh()}</button>
					</div>
				{/if}
			</Block>

			<BlockTitle>{m.web_speech_network_title()}</BlockTitle>
			<Block inset strong>
				<div class="space-y-3">
					<p class="text-xs leading-relaxed text-amber-700">{m.web_speech_network_body()}</p>
					<label class="flex items-start gap-2 text-xs leading-relaxed text-gray-600">
						<input type="checkbox" bind:checked={networkAllowed} onchange={() => (saved = false)} class="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-600" />
						<span>{m.web_speech_network_confirm()}</span>
					</label>
					<p class="text-[10px] text-emerald-700">{m.web_speech_no_local_fallback()}</p>
				</div>
			</Block>

			<BlockTitle>{m.web_speech_stt_section()}</BlockTitle>
			<Block inset strong>
				<div class="space-y-2">
					<div class="grid grid-cols-2 gap-2">
						<button type="button" onclick={() => testStt(true)} disabled={testing !== null || speaking || capabilities?.onDeviceStatus !== 'available'} class="rounded-full bg-emerald-600 py-2.5 text-xs font-medium text-white disabled:opacity-40">{m.web_speech_local_stt()}</button>
						<button type="button" onclick={() => testStt(false)} disabled={testing !== null || speaking || !capabilities?.recognition || !networkAllowed} class="rounded-full bg-amber-500 py-2.5 text-xs font-medium text-white disabled:opacity-40">{m.web_speech_network_stt()}</button>
					</div>
					{#if testing}
						<button type="button" onclick={cancelOperation} class="w-full rounded-full border border-red-300 py-2 text-xs text-red-600">{m.web_speech_cancel()}</button>
						<p class="text-center text-xs text-violet-600">{m.web_speech_listening()}</p>
					{/if}
					{#if transcript}<div class="rounded-xl bg-violet-50 p-3"><p class="text-[10px] font-medium text-violet-500">{m.web_speech_result()}</p><p class="mt-1 text-sm text-violet-900">{transcript}</p></div>{/if}
				</div>
			</Block>

			<BlockTitle>{m.web_speech_tts_section()}</BlockTitle>
			<Block inset strong>
				<div class="space-y-3">
					<label class="block text-xs font-medium text-gray-700" for="web-speech-voice">{m.web_speech_voice()}</label>
					<select id="web-speech-voice" bind:value={selectedVoiceURI} onchange={() => (saved = false)} disabled={speaking} class="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm">
						{#each allVoices() as voice (voice.voiceURI)}
							<option value={voice.voiceURI}>{voice.name} · {voice.localService ? m.web_speech_voice_local() : m.web_speech_voice_network()}</option>
						{/each}
					</select>
					<label class="block text-xs font-medium text-gray-700" for="web-speech-phrase">{m.web_speech_phrase()}</label>
					<textarea id="web-speech-phrase" rows="3" bind:value={phrase} disabled={speaking} class="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm"></textarea>
					<button type="button" onclick={speaking ? cancelOperation : testTts} disabled={!speaking && (!phrase.trim() || allVoices().length === 0)} class="w-full rounded-full py-2.5 text-sm font-medium text-white disabled:opacity-40 {speaking ? 'bg-red-500' : 'bg-violet-600'}">{speaking ? m.web_speech_cancel() : m.web_speech_speak()}</button>
					{#if speaking}<p class="text-center text-xs text-violet-600">{m.web_speech_speaking()}</p>{/if}
				</div>
			</Block>

			<Block inset>
				<button type="button" onclick={save} disabled={saving || testing !== null || speaking} class="w-full rounded-full bg-emerald-600 py-2.5 text-sm font-medium text-white disabled:opacity-40">{saved ? m.web_speech_saved() : m.web_speech_save()}</button>
			</Block>

			{#if error}<Block inset><p class="rounded-xl bg-red-50 p-3 text-xs leading-relaxed text-red-600">⚠️ {error}</p></Block>{/if}
		</div>
	</div>
</div>
