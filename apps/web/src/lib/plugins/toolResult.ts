import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { PluginJsonValue } from "@kalo-ai/plugin-sdk";
import { isJsonRpcValue, structuredValueSize } from "./rpcValue";

const MAX_CONTENT_BLOCKS = 32;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_DETAILS_BYTES = 256 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
]);
const BASE64_PATTERN =
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textBlock(value: unknown): TextContent {
	if (
		!isRecord(value) ||
		value.type !== "text" ||
		typeof value.text !== "string"
	) {
		throw new Error("插件工具返回了无效 text content block");
	}
	if (new TextEncoder().encode(value.text).byteLength > MAX_TEXT_BYTES) {
		throw new Error("插件工具 text content 超过 1 MiB");
	}
	if (
		value.textSignature !== undefined &&
		(typeof value.textSignature !== "string" ||
			value.textSignature.length > 10_000)
	) {
		throw new Error("插件工具 textSignature 无效");
	}
	return {
		type: "text",
		text: value.text,
		textSignature: value.textSignature,
	};
}

function imageBlock(value: unknown): ImageContent {
	if (
		!isRecord(value) ||
		value.type !== "image" ||
		typeof value.data !== "string" ||
		typeof value.mimeType !== "string" ||
		!ALLOWED_IMAGE_TYPES.has(value.mimeType) ||
		!BASE64_PATTERN.test(value.data)
	) {
		throw new Error("插件工具返回了无效 image content block");
	}
	const padding = value.data.endsWith("==")
		? 2
		: value.data.endsWith("=")
			? 1
			: 0;
	const decodedBytes = (value.data.length / 4) * 3 - padding;
	if (decodedBytes > MAX_IMAGE_BYTES) {
		throw new Error("插件工具 image content 超过 1 MiB");
	}
	return { type: "image", data: value.data, mimeType: value.mimeType };
}

export function validateSandboxToolResult(
	value: unknown,
): AgentToolResult<PluginJsonValue> {
	if (
		!isRecord(value) ||
		!Array.isArray(value.content) ||
		value.content.length > MAX_CONTENT_BLOCKS ||
		!("details" in value) ||
		!isJsonRpcValue(value.details) ||
		structuredValueSize(value.details) > MAX_DETAILS_BYTES ||
		(value.terminate !== undefined && typeof value.terminate !== "boolean")
	) {
		throw new Error("插件工具返回格式无效");
	}
	const content = value.content.map((block) => {
		if (isRecord(block) && block.type === "text") return textBlock(block);
		if (isRecord(block) && block.type === "image") return imageBlock(block);
		throw new Error("插件工具包含不支持的 content block");
	});
	return {
		content,
		details: value.details as PluginJsonValue,
		terminate: value.terminate,
	};
}
