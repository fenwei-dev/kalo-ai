import type { WebSpeechSttMode } from "$lib/db/schema";

export type OnDeviceSpeechStatus =
	| "available"
	| "downloadable"
	| "downloading"
	| "unavailable"
	| "unsupported";

interface BrowserSpeechRecognitionAlternative {
	transcript: string;
	confidence: number;
}

interface BrowserSpeechRecognitionResult {
	readonly isFinal: boolean;
	readonly length: number;
	[index: number]: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionEvent extends Event {
	readonly resultIndex: number;
	readonly results: {
		readonly length: number;
		[index: number]: BrowserSpeechRecognitionResult;
	};
}

interface BrowserSpeechRecognitionErrorEvent extends Event {
	readonly error: string;
	readonly message?: string;
}

interface BrowserSpeechRecognition extends EventTarget {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	maxAlternatives: number;
	processLocally?: boolean;
	onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
	onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
	onend: (() => void) | null;
	onspeechstart: (() => void) | null;
	onspeechend: (() => void) | null;
	start(): void;
	stop(): void;
	abort(): void;
}

interface BrowserSpeechRecognitionConstructor {
	new (): BrowserSpeechRecognition;
	available?: (options: {
		langs: string[];
		processLocally: boolean;
		quality?: "command" | "dictation";
	}) => Promise<Exclude<OnDeviceSpeechStatus, "unsupported">>;
	install?: (options: {
		langs: string[];
		processLocally: boolean;
		quality?: "command" | "dictation";
	}) => Promise<boolean>;
}

type SpeechWindow = Window & {
	SpeechRecognition?: BrowserSpeechRecognitionConstructor;
	webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
};

export interface WebSpeechCapabilities {
	recognition: boolean;
	onDeviceApi: boolean;
	onDeviceStatus: OnDeviceSpeechStatus;
	localVoices: SpeechSynthesisVoice[];
	networkVoices: SpeechSynthesisVoice[];
}

function speechRecognitionConstructor():
	| BrowserSpeechRecognitionConstructor
	| undefined {
	if (typeof window === "undefined") return undefined;
	const scope = window as SpeechWindow;
	return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

async function voices(timeoutMs = 2_000): Promise<SpeechSynthesisVoice[]> {
	if (!("speechSynthesis" in globalThis)) return [];
	let list = speechSynthesis.getVoices();
	if (list.length > 0) return list;
	await new Promise<void>((resolve) => {
		let timer: ReturnType<typeof setTimeout>;
		const changed = () => {
			list = speechSynthesis.getVoices();
			if (list.length === 0) return;
			clearTimeout(timer);
			speechSynthesis.removeEventListener("voiceschanged", changed);
			resolve();
		};
		timer = setTimeout(() => {
			speechSynthesis.removeEventListener("voiceschanged", changed);
			resolve();
		}, timeoutMs);
		speechSynthesis.addEventListener("voiceschanged", changed);
	});
	return speechSynthesis.getVoices();
}

export async function inspectWebSpeechCapabilities(
	lang: string,
): Promise<WebSpeechCapabilities> {
	const Recognition = speechRecognitionConstructor();
	let onDeviceStatus: OnDeviceSpeechStatus = "unsupported";
	if (Recognition?.available) {
		try {
			onDeviceStatus = await Recognition.available({
				langs: [lang],
				processLocally: true,
				quality: "dictation",
			});
		} catch {
			onDeviceStatus = "unavailable";
		}
	}
	const allVoices = await voices();
	const matchingVoices = allVoices.filter((voice) =>
		voice.lang
			.toLowerCase()
			.startsWith(lang.split("-")[0]?.toLowerCase() ?? ""),
	);
	return {
		recognition: Recognition !== undefined,
		onDeviceApi:
			Recognition?.available !== undefined && Recognition.install !== undefined,
		onDeviceStatus,
		localVoices: matchingVoices.filter((voice) => voice.localService),
		networkVoices: matchingVoices.filter((voice) => !voice.localService),
	};
}

export async function installOnDeviceSpeechLanguage(
	lang: string,
): Promise<boolean> {
	const Recognition = speechRecognitionConstructor();
	if (!Recognition?.install) {
		throw new Error("当前浏览器不支持安装本地语音识别语言包");
	}
	return Recognition.install({
		langs: [lang],
		processLocally: true,
		quality: "dictation",
	});
}

export function resolveLocalRecognition(input: {
	mode: WebSpeechSttMode;
	onDeviceStatus: OnDeviceSpeechStatus;
	networkAllowed: boolean;
}): boolean {
	if (input.mode === "local_only") {
		if (input.onDeviceStatus !== "available") {
			throw new Error("当前浏览器没有可用的本地语音识别语言包");
		}
		return true;
	}
	if (
		input.mode === "local_preferred" &&
		input.onDeviceStatus === "available"
	) {
		return true;
	}
	if (!input.networkAllowed) {
		throw new Error("本地语音识别不可用，且尚未允许网络 SpeechRecognition");
	}
	return false;
}

export interface ContinuousRecognitionCallbacks {
	onInterim?: (text: string) => void;
	onFinal: (text: string) => void;
	onError?: (message: string) => void;
	onListeningChange?: (listening: boolean) => void;
}

export class WebSpeechRecognizer {
	readonly #recognition: BrowserSpeechRecognition;
	readonly #callbacks: ContinuousRecognitionCallbacks;
	#stopped = false;
	#paused = true;
	#listening = false;
	#restartTimer: ReturnType<typeof setTimeout> | undefined;
	#endpointTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(input: {
		lang: string;
		local: boolean;
		callbacks: ContinuousRecognitionCallbacks;
	}) {
		const Recognition = speechRecognitionConstructor();
		if (!Recognition) throw new Error("当前浏览器不支持 SpeechRecognition");
		this.#callbacks = input.callbacks;
		this.#recognition = new Recognition();
		this.#recognition.lang = input.lang;
		// Restart single utterances ourselves. Native continuous mode often waits
		// several seconds before committing an otherwise complete sentence.
		this.#recognition.continuous = false;
		this.#recognition.interimResults = true;
		this.#recognition.maxAlternatives = 1;
		if ("processLocally" in this.#recognition) {
			this.#recognition.processLocally = input.local;
		} else if (input.local) {
			throw new Error("当前浏览器不能保证 SpeechRecognition 在本地执行");
		}
		this.#recognition.onspeechstart = () => this.#clearEndpoint();
		this.#recognition.onspeechend = () => this.#scheduleEndpoint(120);
		this.#recognition.onresult = (event) => {
			let interim = "";
			for (
				let index = event.resultIndex;
				index < event.results.length;
				index += 1
			) {
				const result = event.results[index];
				const text = result?.[0]?.transcript?.trim() ?? "";
				if (!text) continue;
				if (result?.isFinal) this.#callbacks.onFinal(text.slice(0, 8_000));
				else interim += `${text} `;
			}
			this.#callbacks.onInterim?.(interim.trim());
			if (interim.trim()) this.#scheduleEndpoint(900);
		};
		this.#recognition.onerror = (event) => {
			if (event.error === "aborted" || this.#paused || this.#stopped) return;
			if (event.error !== "no-speech") {
				this.#callbacks.onError?.(
					`语音识别失败：${event.error}${event.message ? ` (${event.message})` : ""}`,
				);
			}
		};
		this.#recognition.onend = () => {
			this.#clearEndpoint();
			this.#setListening(false);
			if (!this.#paused && !this.#stopped) this.#scheduleRestart();
		};
	}

	start(): void {
		if (this.#stopped) throw new Error("语音识别器已关闭");
		this.#paused = false;
		this.#clearRestart();
		this.#startNow();
	}

	pause(): void {
		if (this.#stopped) return;
		this.#paused = true;
		this.#clearRestart();
		this.#clearEndpoint();
		try {
			this.#recognition.abort();
		} catch {
			// Already idle.
		}
		this.#setListening(false);
	}

	stop(): void {
		if (this.#stopped) return;
		this.#stopped = true;
		this.#paused = true;
		this.#clearRestart();
		this.#clearEndpoint();
		this.#recognition.onresult = null;
		this.#recognition.onerror = null;
		this.#recognition.onend = null;
		this.#recognition.onspeechstart = null;
		this.#recognition.onspeechend = null;
		try {
			this.#recognition.abort();
		} catch {
			// Already idle.
		}
		this.#setListening(false);
	}

	#startNow(): void {
		if (this.#paused || this.#stopped || this.#listening) return;
		try {
			this.#recognition.start();
			this.#setListening(true);
		} catch (error) {
			this.#callbacks.onError?.(
				error instanceof Error ? error.message : String(error),
			);
			this.#scheduleRestart();
		}
	}

	#scheduleEndpoint(delayMs: number): void {
		this.#clearEndpoint();
		this.#endpointTimer = setTimeout(() => {
			this.#endpointTimer = undefined;
			if (this.#paused || this.#stopped || !this.#listening) return;
			try {
				// stop(), unlike abort(), asks the engine to finalize buffered speech.
				this.#recognition.stop();
			} catch {
				// Recognition may already be ending.
			}
		}, delayMs);
	}

	#clearEndpoint(): void {
		if (this.#endpointTimer) clearTimeout(this.#endpointTimer);
		this.#endpointTimer = undefined;
	}

	#scheduleRestart(): void {
		this.#clearRestart();
		this.#restartTimer = setTimeout(() => {
			this.#restartTimer = undefined;
			this.#startNow();
		}, 250);
	}

	#clearRestart(): void {
		if (this.#restartTimer) clearTimeout(this.#restartTimer);
		this.#restartTimer = undefined;
	}

	#setListening(listening: boolean): void {
		if (this.#listening === listening) return;
		this.#listening = listening;
		this.#callbacks.onListeningChange?.(listening);
	}
}

export async function testSpeechRecognition(input: {
	lang: string;
	local: boolean;
	timeoutMs?: number;
	signal?: AbortSignal;
	onInterim?: (text: string) => void;
}): Promise<string> {
	const Recognition = speechRecognitionConstructor();
	if (!Recognition) throw new Error("当前浏览器不支持 SpeechRecognition");
	const recognition = new Recognition();
	recognition.lang = input.lang;
	recognition.continuous = false;
	recognition.interimResults = true;
	recognition.maxAlternatives = 1;
	if ("processLocally" in recognition) {
		recognition.processLocally = input.local;
	} else if (input.local) {
		throw new Error("当前浏览器不能保证 SpeechRecognition 在本地执行");
	}
	return new Promise((resolve, reject) => {
		let settled = false;
		let finalText = "";
		const cleanup = () => {
			clearTimeout(timer);
			input.signal?.removeEventListener("abort", abort);
			recognition.onresult = null;
			recognition.onerror = null;
			recognition.onend = null;
		};
		const finish = (result: { text: string } | { error: Error }) => {
			if (settled) return;
			settled = true;
			cleanup();
			try {
				recognition.abort();
			} catch {
				// Recognition may already be stopped.
			}
			if ("text" in result) resolve(result.text);
			else reject(result.error);
		};
		const abort = () => finish({ error: new Error("语音识别测试已取消") });
		const timer = setTimeout(
			() => finish({ error: new Error("语音识别测试超时") }),
			input.timeoutMs ?? 15_000,
		);
		if (input.signal?.aborted) {
			abort();
			return;
		}
		input.signal?.addEventListener("abort", abort, { once: true });
		recognition.onresult = (event) => {
			let interim = "";
			for (
				let index = event.resultIndex;
				index < event.results.length;
				index += 1
			) {
				const result = event.results[index];
				const transcript = result?.[0]?.transcript?.trim() ?? "";
				if (!transcript) continue;
				if (result?.isFinal) finalText += `${transcript} `;
				else interim += `${transcript} `;
			}
			input.onInterim?.(`${finalText}${interim}`.trim());
			if (finalText.trim()) finish({ text: finalText.trim() });
		};
		recognition.onerror = (event) => {
			finish({
				error: new Error(
					`语音识别失败：${event.error}${event.message ? ` (${event.message})` : ""}`,
				),
			});
		};
		recognition.onend = () => {
			if (finalText.trim()) finish({ text: finalText.trim() });
			else finish({ error: new Error("没有识别到语音") });
		};
		try {
			recognition.start();
		} catch (error) {
			finish({
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}
	});
}

function normalizedSpeechText(text: string): string {
	return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function isLikelySpeechEcho(
	transcript: string,
	spokenText: string,
): boolean {
	const heard = normalizedSpeechText(transcript);
	const spoken = normalizedSpeechText(spokenText);
	if (heard.length < 3 || spoken.length < 3) return false;
	if (spoken.includes(heard) || heard.includes(spoken)) return true;
	const bigrams = (value: string) => {
		const result = new Set<string>();
		for (let index = 0; index < value.length - 1; index += 1) {
			result.add(value.slice(index, index + 2));
		}
		return result;
	};
	const heardBigrams = bigrams(heard);
	const spokenBigrams = bigrams(spoken);
	let overlap = 0;
	for (const pair of heardBigrams) {
		if (spokenBigrams.has(pair)) overlap += 1;
	}
	return (
		overlap / Math.max(1, Math.min(heardBigrams.size, spokenBigrams.size)) >=
		0.65
	);
}

export async function speakWebSpeech(input: {
	text: string;
	lang: string;
	voiceURI?: string;
	localOnly: boolean;
	rate?: number;
	pitch?: number;
	signal?: AbortSignal;
}): Promise<void> {
	if (!("speechSynthesis" in globalThis)) {
		throw new Error("当前浏览器不支持 speechSynthesis");
	}
	const availableVoices = await voices();
	const selected = input.voiceURI
		? availableVoices.find((voice) => voice.voiceURI === input.voiceURI)
		: availableVoices.find(
				(voice) =>
					voice.localService &&
					voice.lang
						.toLowerCase()
						.startsWith(input.lang.split("-")[0]?.toLowerCase() ?? ""),
			);
	if (input.localOnly && !selected?.localService) {
		throw new Error("当前设备没有可用的本地语音合成 voice");
	}
	if (input.signal?.aborted) throw new Error("语音合成已取消");
	await new Promise<void>((resolve, reject) => {
		const utterance = new SpeechSynthesisUtterance(input.text.slice(0, 8_000));
		utterance.lang = input.lang;
		utterance.rate = Math.max(0.1, Math.min(10, input.rate ?? 1));
		utterance.pitch = Math.max(0, Math.min(2, input.pitch ?? 1));
		if (selected) utterance.voice = selected;
		const abort = () => {
			speechSynthesis.cancel();
			reject(new Error("语音合成已取消"));
		};
		input.signal?.addEventListener("abort", abort, { once: true });
		utterance.onend = () => {
			input.signal?.removeEventListener("abort", abort);
			resolve();
		};
		utterance.onerror = (event) => {
			input.signal?.removeEventListener("abort", abort);
			reject(new Error(`语音合成失败：${event.error}`));
		};
		speechSynthesis.cancel();
		speechSynthesis.speak(utterance);
	});
}
