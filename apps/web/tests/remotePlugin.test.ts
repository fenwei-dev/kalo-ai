import { expect, test } from "bun:test";
import { definePlugin, Type } from "@kalo-ai/plugin-sdk";
import {
	importRemotePlugin,
	parsePluginPackageSpecifier,
	remotePluginModuleUrl,
} from "../src/lib/plugins/remote";

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

test("loads a compatible default-exported plugin module", async () => {
	const plugin = definePlugin({
		manifest: {
			id: "remote_fixture",
			apiVersion: 1,
			version: "1.0.0",
			configVersion: 1,
			name: { "zh-cn": "远程测试", "en-us": "Remote fixture" },
			description: { "zh-cn": "测试", "en-us": "Test fixture" },
		},
		configSchema: Type.Object({}),
		defaultConfig: {},
		createTools: () => [],
	});
	let importedUrl = "";
	const loaded = await importRemotePlugin(
		parsePluginPackageSpecifier("npm:@scope/plugin@1.2.3"),
		async (url) => {
			importedUrl = url;
			return { default: plugin };
		},
	);
	expect(importedUrl).toBe(
		"https://esm.sh/@scope/plugin@1.2.3?bundle&target=es2022",
	);
	expect(loaded.manifest.id).toBe("remote_fixture");
});

test("hydrates a dependency-free raw definition exported as kaloPlugin", async () => {
	const loaded = await importRemotePlugin(
		parsePluginPackageSpecifier("jsr:@scope/plain-plugin@1.0.0"),
		async () => ({
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
		}),
	);
	expect(loaded.manifest.id).toBe("plain_remote");
	expect(loaded.validateConfig({})).toBe(true);
});
