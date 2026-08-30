const MARKDOWN_TABLE_SEPARATOR =
	/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/u;
const URL_PATTERN = /https?:\/\/[^\s)\]}>,]+/giu;
const EMOJI_PATTERN = /(?:\p{Extended_Pictographic}|\uFE0F|\u200D)/gu;

/** Convert model Markdown into bounded, natural text suitable for local TTS. */
export function toVoicePlainText(input: string): string {
	const lines = input
		.replaceAll("\r\n", "\n")
		.replaceAll("\r", "\n")
		.split("\n")
		.filter((line) => !MARKDOWN_TABLE_SEPARATOR.test(line))
		.map((line) =>
			line
				.replace(/^\s{0,3}#{1,6}\s+/u, "")
				.replace(/^\s*>+\s?/u, "")
				.replace(/^\s*(?:[-+*]|\d+[.)])\s+/u, "")
				.replace(/^\s*\[[ xX]\]\s+/u, "")
				.replace(/\|/gu, "，")
				.trim(),
		)
		.filter(Boolean);
	let text = lines
		.join("。")
		.replace(/\[(?:Spoken Kalo response|Voice transcript)\]/giu, "")
		.replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
		.replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
		.replace(/<https?:\/\/[^>]+>/giu, "")
		.replace(URL_PATTERN, "")
		.replace(/```[^\n]*\n?/gu, "")
		.replace(/`([^`]+)`/gu, "$1")
		.replace(/\*\*([^*]+)\*\*/gu, "$1")
		.replace(/__([^_]+)__/gu, "$1")
		.replace(/~~([^~]+)~~/gu, "$1")
		.replace(/(?<!\*)\*([^*]+)\*(?!\*)/gu, "$1")
		.replace(/(?<!_)_([^_]+)_(?!_)/gu, "$1")
		.replace(/<[^>]+>/gu, "")
		.replace(EMOJI_PATTERN, "")
		.replace(/&nbsp;/giu, " ")
		.replace(/&amp;/giu, "和")
		.replace(/&lt;/giu, "小于")
		.replace(/&gt;/giu, "大于")
		.replace(/\s+/gu, " ")
		.replace(/。{2,}/gu, "。")
		.trim();
	// Avoid reading dangling Markdown punctuation left by malformed model output.
	text = text.replace(/^[#>*_~`\s]+|[#>*_~`\s]+$/gu, "").trim();
	return text;
}

export function voiceResponseInstruction(locale: "zh-cn" | "en-us"): string {
	return locale === "en-us"
		? `## Voice response mode\nThe current turn will be spoken aloud. The final user-facing response must be concise, natural spoken plain text. Do not use Markdown headings, bullets, numbered lists, tables, code fences, inline code, links, URLs, emoji, emoticons, decorative symbols, or raw JSON. Use short complete sentences and pronounce numbers and units naturally. Tool calls are still allowed, but after tools finish, return only the spoken response.`
		: `## 语音回复模式\n当前 turn 会被语音朗读。最终面向用户的回复必须是简洁、自然、口语化的纯文本。不要使用 Markdown 标题、项目符号、编号列表、表格、代码块、行内代码、链接、URL、emoji、颜文字、装饰符号或原始 JSON。使用简短完整的句子，并以自然方式表达数字和单位。仍可正常调用工具，但工具结束后只能输出适合直接朗读的正文。`;
}
