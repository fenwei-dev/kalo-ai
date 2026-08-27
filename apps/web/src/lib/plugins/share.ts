import type { PreparedLocalPluginFile } from "./local";
import {
	analyzePluginModuleSource,
	pluginModuleByteSize,
} from "./moduleSource";

export const PLUGIN_SHARE_FORMAT = "kalo-plugin-share";
export const PLUGIN_SHARE_VERSION = 1;
export const MAX_SHARED_PLUGIN_SOURCE_BYTES = 48 * 1024;
export const MAX_PLUGIN_SHARE_TOKEN_LENGTH = 96 * 1024;
const MAX_PLUGIN_SHARE_JSON_BYTES = MAX_SHARED_PLUGIN_SOURCE_BYTES + 8 * 1024;
const LOCAL_PLUGIN_FILE_PATTERN = /^[^/\\\0]{1,200}\.(?:js|mjs)$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

interface PluginShareEnvelope {
	format: typeof PLUGIN_SHARE_FORMAT;
	version: typeof PLUGIN_SHARE_VERSION;
	fileName: string;
	source: string;
	size: number;
	sha256: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(
			...bytes.subarray(offset, offset + chunkSize),
		);
	}
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
	if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
		throw new Error("插件分享参数不是有效的 base64url");
	}
	const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat((4 - (value.length % 4)) % 4)}`;
	let binary: string;
	try {
		binary = atob(padded);
	} catch (error) {
		throw new Error("插件分享参数无法解码", { cause: error });
	}
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

function copiedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([copiedArrayBuffer(bytes)])
		.stream()
		.pipeThrough(new CompressionStream("gzip"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipBounded(bytes: Uint8Array): Promise<Uint8Array> {
	const reader = new Blob([copiedArrayBuffer(bytes)])
		.stream()
		.pipeThrough(new DecompressionStream("gzip"))
		.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const item = await reader.read();
			if (item.done) break;
			size += item.value.byteLength;
			if (size > MAX_PLUGIN_SHARE_JSON_BYTES) {
				await reader.cancel();
				throw new Error("插件分享内容解压后超过大小限制");
			}
			chunks.push(item.value);
		}
	} finally {
		reader.releaseLock();
	}
	const joined = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		joined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return joined;
}

function parseEnvelope(value: unknown): PluginShareEnvelope {
	if (
		!isRecord(value) ||
		Object.keys(value).some(
			(key) =>
				!["format", "version", "fileName", "source", "size", "sha256"].includes(
					key,
				),
		) ||
		value.format !== PLUGIN_SHARE_FORMAT ||
		value.version !== PLUGIN_SHARE_VERSION ||
		typeof value.fileName !== "string" ||
		!LOCAL_PLUGIN_FILE_PATTERN.test(value.fileName) ||
		typeof value.source !== "string" ||
		typeof value.size !== "number" ||
		!Number.isInteger(value.size) ||
		value.size <= 0 ||
		value.size > MAX_SHARED_PLUGIN_SOURCE_BYTES ||
		pluginModuleByteSize(value.source) !== value.size ||
		typeof value.sha256 !== "string" ||
		!SHA256_PATTERN.test(value.sha256)
	) {
		throw new Error("插件分享 envelope 格式无效");
	}
	return value as unknown as PluginShareEnvelope;
}

export async function encodePluginShare(
	prepared: PreparedLocalPluginFile,
): Promise<string> {
	if (!LOCAL_PLUGIN_FILE_PATTERN.test(prepared.fileName)) {
		throw new Error("分享的插件文件名必须是 .js 或 .mjs");
	}
	const analyzed = await analyzePluginModuleSource(prepared.source);
	if (analyzed.size !== prepared.size || analyzed.sha256 !== prepared.sha256) {
		throw new Error("插件草稿的大小或 SHA-256 已发生变化");
	}
	if (analyzed.size > MAX_SHARED_PLUGIN_SOURCE_BYTES) {
		throw new Error("内联分享只支持不超过 48 KiB 的插件源码");
	}
	const envelope: PluginShareEnvelope = {
		format: PLUGIN_SHARE_FORMAT,
		version: PLUGIN_SHARE_VERSION,
		fileName: prepared.fileName,
		source: analyzed.source,
		size: analyzed.size,
		sha256: analyzed.sha256,
	};
	const compressed = await gzip(
		new TextEncoder().encode(JSON.stringify(envelope)),
	);
	const token = bytesToBase64Url(compressed);
	if (token.length > MAX_PLUGIN_SHARE_TOKEN_LENGTH) {
		throw new Error("压缩后的插件分享链接仍然过长");
	}
	return token;
}

export async function decodePluginShare(
	token: string,
): Promise<PreparedLocalPluginFile> {
	if (!token || token.length > MAX_PLUGIN_SHARE_TOKEN_LENGTH) {
		throw new Error("插件分享参数为空或超过长度限制");
	}
	let decoded: Uint8Array;
	try {
		decoded = await gunzipBounded(base64UrlToBytes(token));
	} catch (error) {
		if (error instanceof Error && error.message.includes("大小限制"))
			throw error;
		throw new Error("插件分享参数不是有效的 gzip envelope", {
			cause: error,
		});
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(decoded),
		);
	} catch (error) {
		throw new Error("插件分享 envelope 不是有效的 UTF-8 JSON", {
			cause: error,
		});
	}
	const envelope = parseEnvelope(parsed);
	const analyzed = await analyzePluginModuleSource(envelope.source);
	if (analyzed.size !== envelope.size || analyzed.sha256 !== envelope.sha256) {
		throw new Error("插件分享源码的 SHA-256 或大小不匹配");
	}
	return {
		fileName: envelope.fileName,
		source: analyzed.source,
		size: analyzed.size,
		sha256: analyzed.sha256,
	};
}

export async function createPluginShareUrl(
	prepared: PreparedLocalPluginFile,
	baseUrl = location.origin,
): Promise<string> {
	const token = await encodePluginShare(prepared);
	const url = new URL("/plugins/import", baseUrl);
	url.hash = new URLSearchParams({ plugin: token }).toString();
	return url.toString();
}

export function pluginShareTokenFromUrl(url: URL): string | null {
	const fragment = new URLSearchParams(url.hash.replace(/^#/u, ""));
	return fragment.get("plugin") ?? url.searchParams.get("plugin");
}
