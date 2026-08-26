import { expect, test } from "bun:test";
import { Type } from "@kalo-ai/plugin-sdk";
import {
	isBlockedPluginHostname,
	validatePluginNetworkUrl,
} from "../src/lib/plugins/networkPolicy";
import {
	isJsonRpcValue,
	structuredValueSize,
} from "../src/lib/plugins/rpcValue";
import {
	assertSafePluginSchema,
	safeCheckPluginConfig,
} from "../src/lib/plugins/safeSchema";
import { isUnverifiedWebKitSandbox } from "../src/lib/plugins/sandbox";
import { validateSandboxToolResult } from "../src/lib/plugins/toolResult";

test("safe plugin schemas accept the supported TypeBox subset", () => {
	const schema = Type.Object({
		name: Type.String({ minLength: 1, maxLength: 40 }),
		count: Type.Integer({ minimum: 0, maximum: 10 }),
		mode: Type.Union([Type.Literal("one"), Type.Literal("two")]),
	});
	expect(() => assertSafePluginSchema(schema)).not.toThrow();
	expect(
		safeCheckPluginConfig(schema, { name: "test", count: 1, mode: "one" }),
	).toBe(true);
	expect(
		safeCheckPluginConfig(schema, { name: "", count: 1, mode: "one" }),
	).toBe(false);
});

test("unsafe regex and overly deep plugin schemas are rejected without throwing from config checks", () => {
	const invalidPattern = {
		type: "object",
		properties: { value: { type: "string", pattern: "[" } },
	};
	expect(() => assertSafePluginSchema(invalidPattern)).toThrow("pattern");
	expect(safeCheckPluginConfig(invalidPattern, { value: "x" })).toBe(false);
	let deep: Record<string, unknown> = { type: "string" };
	for (let index = 0; index < 20; index += 1) {
		deep = { type: "array", items: deep };
	}
	expect(() => assertSafePluginSchema(deep)).toThrow("深度");
});

test("network policy blocks local, metadata, reserved, and mapped addresses", () => {
	for (const hostname of [
		"localhost",
		"api.localhost",
		"service.local",
		"127.0.0.1",
		"10.0.0.1",
		"100.64.0.1",
		"169.254.169.254",
		"172.16.0.1",
		"192.168.1.1",
		"198.18.0.1",
		"224.0.0.1",
		"[::1]",
		"[fc00::1]",
		"[fe80::1]",
		"[ff02::1]",
		"[::ffff:127.0.0.1]",
		"[::ffff:7f00:1]",
	]) {
		expect(isBlockedPluginHostname(hostname)).toBe(true);
	}
	expect(isBlockedPluginHostname("api.example.com")).toBe(false);
	expect(isBlockedPluginHostname("8.8.8.8")).toBe(false);
	expect(() =>
		validatePluginNetworkUrl(
			"https://169.254.169.254/latest",
			"https://kalo.example",
		),
	).toThrow();
	for (const encodedLoopback of [
		"https://2130706433/",
		"https://0x7f000001/",
	]) {
		expect(() =>
			validatePluginNetworkUrl(encodedLoopback, "https://kalo.example"),
		).toThrow();
	}
	expect(() =>
		validatePluginNetworkUrl(
			"https://kalo.example/private",
			"https://kalo.example",
		),
	).toThrow();
	expect(
		validatePluginNetworkUrl(
			"https://api.example.com/data",
			"https://kalo.example",
		).href,
	).toBe("https://api.example.com/data");
});

test("RPC size accounting counts binary values and rejects non-JSON service data", () => {
	const binary = new Uint8Array(1024);
	expect(structuredValueSize(binary)).toBe(1024);
	expect(isJsonRpcValue(binary)).toBe(false);
	expect(isJsonRpcValue({ text: "ok", values: [1, true, null] })).toBe(true);
	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	expect(() => structuredValueSize(cyclic)).toThrow("循环");
	expect(isJsonRpcValue(cyclic)).toBe(false);
});

test("unverified Safari and iOS WebKit sandboxes fail closed", () => {
	expect(
		isUnverifiedWebKitSandbox(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
		),
	).toBe(true);
	expect(
		isUnverifiedWebKitSandbox(
			"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0 Mobile/15E148 Safari/604.1",
		),
	).toBe(true);
	expect(
		isUnverifiedWebKitSandbox(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",
		),
	).toBe(false);
});

test("sandbox tool results are reconstructed from strict text/image blocks", () => {
	expect(
		validateSandboxToolResult({
			content: [{ type: "text", text: "ok" }],
			details: { ok: true, data: { value: 1 } },
		}),
	).toEqual({
		content: [{ type: "text", text: "ok", textSignature: undefined }],
		details: { ok: true, data: { value: 1 } },
		terminate: undefined,
	});
	expect(() =>
		validateSandboxToolResult({
			content: [{ type: "text" }],
			details: {},
		}),
	).toThrow();
	expect(() =>
		validateSandboxToolResult({
			content: [{ type: "toolCall", id: "forged" }],
			details: {},
		}),
	).toThrow("不支持");
	expect(() =>
		validateSandboxToolResult({
			content: [
				{ type: "image", mimeType: "application/octet-stream", data: "AAAA" },
			],
			details: {},
		}),
	).toThrow();
});
