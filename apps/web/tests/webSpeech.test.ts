import { expect, test } from "bun:test";
import {
	toVoicePlainText,
	voiceResponseInstruction,
} from "../src/lib/voice/voiceText";
import {
	isLikelySpeechEcho,
	resolveLocalRecognition,
} from "../src/lib/voice/webSpeech";

test("local-preferred STT never silently falls back without network permission", () => {
	expect(
		resolveLocalRecognition({
			mode: "local_preferred",
			onDeviceStatus: "available",
			networkAllowed: false,
		}),
	).toBe(true);
	expect(() =>
		resolveLocalRecognition({
			mode: "local_preferred",
			onDeviceStatus: "unavailable",
			networkAllowed: false,
		}),
	).toThrow("尚未允许网络");
	expect(
		resolveLocalRecognition({
			mode: "local_preferred",
			onDeviceStatus: "unavailable",
			networkAllowed: true,
		}),
	).toBe(false);
	expect(() =>
		resolveLocalRecognition({
			mode: "local_only",
			onDeviceStatus: "downloadable",
			networkAllowed: true,
		}),
	).toThrow("本地语音识别");
	expect(
		resolveLocalRecognition({
			mode: "network",
			onDeviceStatus: "available",
			networkAllowed: true,
		}),
	).toBe(false);
});

test("voice response text removes internal labels, Markdown, URLs, and emoji", () => {
	const source = `# [Spoken Kalo response]\n- **Today:** 1,800 kcal 🎉\n- Read [details](https://example.com)\n\`effectiveTDEE\``;
	const spoken = toVoicePlainText(source);
	expect(spoken).not.toContain("Spoken Kalo response");
	expect(spoken).not.toContain("#");
	expect(spoken).not.toContain("*");
	expect(spoken).not.toContain("https://");
	expect(spoken).not.toContain("🎉");
	expect(spoken).toContain("Today:");
	expect(spoken).toContain("effectiveTDEE");
	expect(voiceResponseInstruction("zh-cn")).toContain("口语化的纯文本");
	expect(voiceResponseInstruction("en-us")).toContain("spoken plain text");
});

test("full-duplex echo detection ignores punctuation but keeps unrelated speech", () => {
	expect(isLikelySpeechEcho("今天还剩 500 千卡", "今天还剩五百千卡。")).toBe(
		false,
	);
	expect(
		isLikelySpeechEcho("今天还剩五百千卡", "今天还剩五百千卡。继续加油！"),
	).toBe(true);
	expect(isLikelySpeechEcho("停止，我换个问题", "今天还剩五百千卡")).toBe(
		false,
	);
});
