import { expect, test } from "bun:test";
import { analyzePluginModuleSource } from "../src/lib/plugins/moduleSource";
import {
	createPluginShareUrl,
	decodePluginShare,
	encodePluginShare,
	MAX_SHARED_PLUGIN_SOURCE_BYTES,
	pluginShareTokenFromUrl,
} from "../src/lib/plugins/share";

const source = `const plugin = {
  manifest: {
    id: "shared_echo",
    apiVersion: 1,
    version: "1.0.0",
    configVersion: 1,
    name: { "zh-cn": "分享回声", "en-us": "Shared echo" },
    description: { "zh-cn": "你好，世界", "en-us": "Hello, world" },
    permissions: []
  },
  configSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  defaultConfig: {},
  createTools() { return []; }
};
export const kaloPlugin = plugin;
export default kaloPlugin;`;

async function prepared(fileName = "shared-echo.js") {
	return { fileName, ...(await analyzePluginModuleSource(source)) };
}

test("inline plugin share round-trips Unicode source through gzip base64url", async () => {
	const input = await prepared();
	const token = await encodePluginShare(input);
	expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
	expect(token).not.toContain("分享回声");
	expect(await decodePluginShare(token)).toEqual(input);

	const url = await createPluginShareUrl(
		input,
		"https://kalo.example/settings/plugins",
	);
	expect(url).toStartWith("https://kalo.example/plugins/import#plugin=");
	expect(pluginShareTokenFromUrl(new URL(url))).toBe(token);
	expect(
		pluginShareTokenFromUrl(
			new URL(`https://kalo.example/plugins/import?plugin=${token}`),
		),
	).toBe(token);
});

test("inline plugin share rejects malformed, tampered, and oversized payloads", async () => {
	await expect(decodePluginShare("not-a-gzip-token")).rejects.toThrow(
		"gzip envelope",
	);
	const token = await encodePluginShare(await prepared());
	const replacement = token.endsWith("A") ? "B" : "A";
	await expect(
		decodePluginShare(`${token.slice(0, -1)}${replacement}`),
	).rejects.toThrow();

	const oversizedSource = `// ${"x".repeat(MAX_SHARED_PLUGIN_SOURCE_BYTES)}\nexport default {};`;
	const oversized = {
		fileName: "oversized.js",
		...(await analyzePluginModuleSource(oversizedSource)),
	};
	await expect(encodePluginShare(oversized)).rejects.toThrow("48 KiB");
});
