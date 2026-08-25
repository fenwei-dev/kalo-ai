import { expect, test } from "bun:test";
import { definePlugin, Type } from "@kalo-ai/plugin-sdk";
import { normalizePluginModule } from "../src/lib/plugins/contract";
import { prepareLocalPluginFile } from "../src/lib/plugins/local";
import { analyzePluginModuleSource } from "../src/lib/plugins/moduleSource";
import {
	downloadRemotePluginModule,
	parsePluginPackageSpecifier,
	remotePluginModuleUrl,
} from "../src/lib/plugins/remote";

const fixturePlugin = definePlugin({
	manifest: {
		id: "remote_fixture",
		apiVersion: 1,
		version: "1.2.3",
		configVersion: 1,
		name: { "zh-cn": "远程测试", "en-us": "Remote fixture" },
		description: { "zh-cn": "测试", "en-us": "Test fixture" },
	},
	configSchema: Type.Object({}),
	defaultConfig: {},
	createTools: () => [],
});

function fixtureFetcher(requests: string[]) {
	return async (input: RequestInfo | URL): Promise<Response> => {
		const url = String(input);
		requests.push(url);
		if (url.includes("?bundle")) {
			return new Response("entry", {
				status: 200,
				headers: {
					"x-esm-path": "/@scope/plugin@1.2.3/es2022/plugin.bundle.mjs",
				},
			});
		}
		return new Response("export default {};", { status: 200 });
	};
}

test("parses exact npm and JSR package specifiers", () => {
	expect(parsePluginPackageSpecifier("npm:kalo-plugin@1.2.3")).toEqual({
		registry: "npm",
		packageName: "kalo-plugin",
		packageVersion: "1.2.3",
		canonicalSpecifier: "npm:kalo-plugin@1.2.3",
	});
	expect(
		parsePluginPackageSpecifier("npm:@scope/kalo-plugin@2.0.0-beta.1"),
	).toEqual({
		registry: "npm",
		packageName: "@scope/kalo-plugin",
		packageVersion: "2.0.0-beta.1",
		canonicalSpecifier: "npm:@scope/kalo-plugin@2.0.0-beta.1",
	});
	expect(parsePluginPackageSpecifier("jsr:@scope/kalo-plugin@3.4.5")).toEqual({
		registry: "jsr",
		packageName: "@scope/kalo-plugin",
		packageVersion: "3.4.5",
		canonicalSpecifier: "jsr:@scope/kalo-plugin@3.4.5",
	});
});

test("rejects mutable, unversioned, URL, and invalid JSR package references", () => {
	for (const specifier of [
		"npm:kalo-plugin",
		"npm:kalo-plugin@latest",
		"npm:kalo-plugin@^1.2.3",
		"https://example.com/plugin.js",
		"jsr:kalo-plugin@1.2.3",
	]) {
		expect(() => parsePluginPackageSpecifier(specifier)).toThrow();
	}
});

test("maps package references to pinned esm.sh module URLs", () => {
	expect(
		remotePluginModuleUrl(
			parsePluginPackageSpecifier("npm:@scope/plugin@1.2.3"),
		),
	).toBe("https://esm.sh/@scope/plugin@1.2.3?bundle&target=es2022");
	expect(
		remotePluginModuleUrl(
			parsePluginPackageSpecifier("jsr:@scope/plugin@1.2.3"),
		),
	).toBe("https://esm.sh/jsr/@scope/plugin@1.2.3?bundle&target=es2022");
});

test("downloads the final self-contained esm.sh bundle", async () => {
	const requests: string[] = [];
	const downloaded = await downloadRemotePluginModule(
		parsePluginPackageSpecifier("npm:@scope/plugin@1.2.3"),
		fixtureFetcher(requests),
	);
	expect(requests).toEqual([
		"https://esm.sh/@scope/plugin@1.2.3?bundle&target=es2022",
		"https://esm.sh/@scope/plugin@1.2.3/es2022/plugin.bundle.mjs",
	]);
	expect(downloaded.source).toBe("export default {};");
	expect(downloaded.sha256).toMatch(/^[a-f0-9]{64}$/);
});

test("normalizes a compatible registry plugin export without executing source", () => {
	const loaded = normalizePluginModule({ default: fixturePlugin });
	expect(loaded.manifest.id).toBe("remote_fixture");
});

test("hydrates a dependency-free raw definition exported as kaloPlugin", () => {
	const loaded = normalizePluginModule({
		kaloPlugin: {
			manifest: {
				id: "plain_remote",
				apiVersion: 1,
				version: "1.0.0",
				configVersion: 1,
				name: { "zh-cn": "纯对象", "en-us": "Plain definition" },
				description: { "zh-cn": "测试", "en-us": "Test fixture" },
			},
			configSchema: { type: "object", properties: {}, required: [] },
			defaultConfig: {},
			createTools: () => [],
		},
	});
	expect(loaded.manifest.id).toBe("plain_remote");
	expect(loaded.validateConfig({})).toBe(true);
});

test("local plugin preparation rejects imports and records a stable hash", async () => {
	await expect(
		analyzePluginModuleSource(
			'import value from "example"; export default value;',
		),
	).rejects.toThrow("无 import");
	await expect(
		analyzePluginModuleSource(
			'export default import("https://example.com/x.js");',
		),
	).rejects.toThrow("无 import");
	const prepared = await prepareLocalPluginFile({
		name: "fixture.js",
		size: 23,
		text: async () => "export default { ok: 1 };",
	});
	expect(prepared.fileName).toBe("fixture.js");
	expect(prepared.sha256).toMatch(/^[a-f0-9]{64}$/);
});
