import "fake-indexeddb/auto";
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";

let repositories: typeof import("../src/lib/db/repositories");
let database: typeof import("../src/lib/db/schema");
let plugins: typeof import("../src/lib/plugins/manager");
let drafts: typeof import("../src/lib/plugins/drafts");
let developmentTools: typeof import("../src/lib/agent/pluginDevelopmentTools");
let dates: typeof import("../src/lib/utils/date");

beforeAll(async () => {
	database = await import("../src/lib/db/schema");
	repositories = await import("../src/lib/db/repositories");
	plugins = await import("../src/lib/plugins/manager");
	drafts = await import("../src/lib/plugins/drafts");
	developmentTools = await import("../src/lib/agent/pluginDevelopmentTools");
	dates = await import("../src/lib/utils/date");
});

beforeEach(async () => {
	await repositories.clearAllData();
});

afterAll(() => database.db.close());

async function installExampleFixture() {
	const { examplePlugin } = await import("@kalo-ai/plugin-example");
	const { analyzePluginModuleSource } = await import(
		"../src/lib/plugins/moduleSource"
	);
	const module = await analyzePluginModuleSource("export default {};");
	return plugins.installPluginPackage(
		"npm:@kalo-ai/plugin-example@0.1.0",
		async () => ({
			...module,
			sourceUrl: "https://esm.sh/example.bundle.mjs",
		}),
		async () => examplePlugin,
	);
}

test("memory uses monotonic versions and optimistic locking", async () => {
	const { getUserMemory, updateUserMemory } = repositories;
	expect(await getUserMemory()).toEqual({
		content: "",
		version: 0,
		updatedAt: null,
	});

	const first = await updateUserMemory("## Preferences\n- No cilantro", 0);
	expect(first.version).toBe(1);
	expect(first.content).toContain("No cilantro");

	await expect(updateUserMemory("stale overwrite", 0)).rejects.toThrow(
		"当前版本 1",
	);

	const cleared = await updateUserMemory("", 1);
	expect(cleared.version).toBe(2);
	expect(cleared.content).toBe("");
});

test("a changed memory snapshot is appended after the user message only once per version", async () => {
	const {
		addUserMessageWithMemorySync,
		createSession,
		getSession,
		listMessages,
		updateUserMemory,
	} = repositories;
	const session = await createSession();

	const firstUser = await addUserMessageWithMemorySync({
		sessionId: session.id,
		content: [{ type: "text", text: "Hello" }],
	});
	let messages = await listMessages(session.id);
	expect(messages.map((message) => message.role)).toEqual([
		"user",
		"assistant",
		"toolResult",
	]);
	expect(messages[0].id).toBe(firstUser.id);
	expect(messages[1].content[0]).toMatchObject({
		type: "toolCall",
		name: "readUserMemory",
	});
	expect(messages[1].synthetic).toBe(true);
	const initialMemoryContent = messages[2].content[0];
	if (initialMemoryContent?.type !== "text") {
		throw new Error("Expected an initial text memory tool result");
	}
	expect(JSON.parse(initialMemoryContent.text)).toMatchObject({
		content: "",
		version: 0,
	});
	expect((await getSession(session.id))?.memoryVersion).toBe(0);

	await addUserMessageWithMemorySync({
		sessionId: session.id,
		content: [{ type: "text", text: "Again" }],
	});
	messages = await listMessages(session.id);
	expect(messages.map((message) => message.role)).toEqual([
		"user",
		"assistant",
		"toolResult",
		"user",
	]);

	await updateUserMemory("## Routine\n- Runs on Friday", 0);
	await addUserMessageWithMemorySync({
		sessionId: session.id,
		content: [{ type: "text", text: "What should I do today?" }],
	});
	messages = await listMessages(session.id);
	expect(messages.slice(-3).map((message) => message.role)).toEqual([
		"user",
		"assistant",
		"toolResult",
	]);
	const latestMessage = messages.at(-1);
	const latestContent = latestMessage?.content[0];
	if (latestContent?.type !== "text") {
		throw new Error("Expected a text memory tool result");
	}
	expect(JSON.parse(latestContent.text)).toMatchObject({
		content: "## Routine\n- Runs on Friday",
		version: 1,
	});
	expect((await getSession(session.id))?.memoryVersion).toBe(1);
});

test("message revert deletion removes the selected range and resets session metadata", async () => {
	const session = await repositories.createSession("Revert test");
	const first = await repositories.addMessage({
		sessionId: session.id,
		role: "assistant",
		content: [{ type: "text", text: "Welcome" }],
	});
	const selected = await repositories.addMessage({
		sessionId: session.id,
		role: "user",
		content: [{ type: "text", text: "Try this" }],
	});
	await repositories.addMessage({
		sessionId: session.id,
		role: "assistant",
		content: [{ type: "text", text: "Later reply" }],
	});
	await repositories.markSessionMemoryVersion(session.id, 7);

	await repositories.deleteMessagesFrom(session.id, selected.order);
	expect(await repositories.listMessages(session.id)).toEqual([first]);
	const revertedSession = await repositories.getSession(session.id);
	expect(revertedSession?.lastMessageAt).toBe(first.createdAt);
	expect(revertedSession?.memoryVersion).toBeUndefined();
});

test("Web Speech settings and voice-origin messages survive backup", async () => {
	const initial = await repositories.getOrCreateVoiceConfig();
	expect(initial).toMatchObject({
		provider: "web_speech",
		sttMode: "local_preferred",
		turnMode: "auto_turn",
		speechRate: 1,
		speechPitch: 1,
	});
	const saved = await repositories.saveVoiceConfig({
		lang: "zh-CN",
		sttMode: "local_preferred",
		turnMode: "realtime",
		speechRate: 1.15,
		speechPitch: 0.9,
		preferredVoiceURI: "local.zh.voice",
		networkSpeechAllowedAt: Date.now(),
	});
	const session = await repositories.createSession("Voice backup");
	await repositories.addUserMessageWithMemorySync({
		sessionId: session.id,
		transport: "voice",
		content: [{ type: "text", text: "语音测试" }],
	});
	await repositories.addMessage({
		sessionId: session.id,
		role: "assistant",
		transport: "voice",
		content: [{ type: "text", text: "收到" }],
	});
	const backup = await repositories.exportAll();
	expect(backup.version).toBe(8);
	expect(backup.voiceConfig).toEqual([saved]);
	await repositories.clearAllData();
	await repositories.importAll(backup);
	expect(await repositories.getVoiceConfig()).toEqual(saved);
	expect(
		(await repositories.listMessages(session.id)).filter(
			(message) => message.transport === "voice",
		),
	).toHaveLength(2);
});

test("new chats default to standard and permanently lock their selected mode", async () => {
	const session = await repositories.createSession();
	expect(session).toMatchObject({ mode: "standard" });
	expect(session.modeLockedAt).toBeUndefined();

	const development = await repositories.updateSessionMode(
		session.id,
		"plugin_development",
	);
	expect(development.mode).toBe("plugin_development");
	await repositories.addUserMessageWithMemorySync({
		sessionId: session.id,
		content: [{ type: "text", text: "Build an echo plugin" }],
	});
	expect(
		(await repositories.listMessages(session.id)).map((item) => item.role),
	).toEqual(["user"]);
	const locked = await repositories.getSession(session.id);
	expect(locked?.mode).toBe("plugin_development");
	expect(locked?.modeLockedAt).toBeNumber();
	await expect(
		repositories.updateSessionMode(session.id, "standard"),
	).rejects.toThrow("模式不能再修改");

	await repositories.deleteMessagesFrom(session.id, 0);
	expect(await repositories.listMessages(session.id)).toEqual([]);
	expect((await repositories.getSession(session.id))?.modeLockedAt).toBe(
		locked?.modeLockedAt,
	);
	await expect(
		repositories.updateSessionMode(session.id, "standard"),
	).rejects.toThrow("模式不能再修改");

	const seeded = await repositories.createSession("Seeded");
	await repositories.addMessage({
		sessionId: seeded.id,
		role: "assistant",
		content: [{ type: "text", text: "Welcome" }],
	});
	expect((await repositories.getSession(seeded.id))?.modeLockedAt).toBeNumber();
});

test("development drafts are session scoped, revisioned, and tool managed", async () => {
	const session = await repositories.createSession(
		"Plugin dev",
		"plugin_development",
	);
	const source = `const plugin = {
  manifest: {
    id: "draft_echo",
    apiVersion: 1,
    version: "1.0.0",
    configVersion: 1,
    name: { "zh-cn": "草稿", "en-us": "Draft" },
    description: { "zh-cn": "测试", "en-us": "Test" },
    permissions: []
  },
  configSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  defaultConfig: {},
  createTools() { return []; }
};
export const kaloPlugin = plugin;
export default kaloPlugin;`;
	const created = await drafts.createPluginDraft({
		sessionId: session.id,
		fileName: "draft-echo.js",
		source,
	});
	expect(created).toMatchObject({ status: "valid", revision: 1 });

	const invalid = await drafts.createPluginDraft({
		sessionId: session.id,
		fileName: "invalid.js",
		source: 'import value from "remote"; export default value;',
	});
	expect(invalid.status).toBe("invalid");
	expect(invalid.diagnostics[0]?.message).toContain("无 import");

	const replaced = await drafts.replacePluginDraft({
		sessionId: session.id,
		draftId: created.id,
		expectedRevision: 1,
		source: source.replace('version: "1.0.0"', 'version: "1.0.1"'),
	});
	expect(replaced.revision).toBe(2);
	await expect(
		drafts.replacePluginDraft({
			sessionId: session.id,
			draftId: created.id,
			expectedRevision: 1,
			source,
		}),
	).rejects.toThrow("版本冲突");
	const restored = await drafts.restorePluginDraftRevision({
		sessionId: session.id,
		draftId: created.id,
		revision: 1,
		expectedRevision: 2,
	});
	expect(restored).toMatchObject({ revision: 3, sha256: created.sha256 });

	const other = await repositories.createSession("Other");
	await expect(drafts.getPluginDraft(other.id, created.id)).rejects.toThrow(
		"插件开发模式",
	);

	const tools = developmentTools.createPluginDevelopmentTools(session.id);
	expect(tools.map((tool) => tool.name)).toEqual([
		"createPluginDraft",
		"listPluginDrafts",
		"readPluginDraft",
		"replacePluginDraft",
		"validatePluginDraft",
		"restorePluginDraftRevision",
		"inspectPluginDraft",
		"testPluginDraftTool",
		"deletePluginDraft",
	]);
	const listTool = tools.find((tool) => tool.name === "listPluginDrafts");
	if (!listTool) throw new Error("Missing listPluginDrafts");
	const result = await listTool.execute("list-drafts", {});
	expect(result.content[0]?.type).toBe("text");
	if (result.content[0]?.type === "text") {
		expect(JSON.parse(result.content[0].text).drafts).toHaveLength(2);
	}

	await drafts.recordPluginDraftInspection({
		sessionId: session.id,
		draftId: created.id,
		expectedRevision: restored.revision,
		inspection: {
			revision: restored.revision,
			inspectedAt: Date.now(),
			descriptorSha256: "0".repeat(64),
			manifest: {
				id: "draft_echo",
				apiVersion: 1,
				version: "1.0.0",
				configVersion: 1,
				name: { "zh-cn": "草稿", "en-us": "Draft" },
				description: { "zh-cn": "测试", "en-us": "Test" },
				permissions: [],
			},
			configured: true,
			tools: [],
			prompt: "",
		},
	});
	const backup = await repositories.exportAll();
	expect(backup.version).toBe(8);
	expect(backup.pluginDrafts).toHaveLength(2);
	expect(backup.pluginDraftRevisions.length).toBeGreaterThanOrEqual(4);
	await repositories.clearAllData();
	await repositories.importAll(backup);
	expect((await repositories.getSession(session.id))?.mode).toBe(
		"plugin_development",
	);
	const restoredDrafts = await drafts.listPluginDrafts(session.id);
	expect(restoredDrafts).toHaveLength(2);
	expect(
		restoredDrafts.find((draft) => draft.id === created.id)?.inspection,
	).toBeUndefined();
	expect(
		restoredDrafts.find((draft) => draft.id === created.id)?.diagnostics[0]
			?.code,
	).toBe("restore-reinspect");
});

test("enabled plugin contributes tools and a bounded system prompt", async () => {
	for (const pluginId of ["mcdonalds_sg", "subway_sg", "kfc_sg"]) {
		const plugin = await plugins.getPluginState(pluginId);
		expect(plugin).toMatchObject({ enabled: true, status: "ready" });
	}
	await installExampleFixture();
	const initial = await plugins.getPluginState("example");
	expect(initial).toMatchObject({ enabled: false, status: "disabled" });
	const defaultRuntime = await plugins.loadPluginRuntime("en-us", [
		"getProfile",
	]);
	expect(defaultRuntime.tools.map((tool) => tool.name)).toEqual([
		"mcdonalds_sg_listProducts",
		"mcdonalds_sg_getNutrition",
		"subway_sg_listProducts",
		"subway_sg_getNutrition",
		"kfc_sg_listProducts",
		"kfc_sg_getNutrition",
	]);
	expect(defaultRuntime.promptSections).toHaveLength(3);
	expect(defaultRuntime.promptSections).toEqual(
		expect.arrayContaining([
			expect.stringContaining("### Plugin: mcdonalds_sg"),
			expect.stringContaining("### Plugin: subway_sg"),
			expect.stringContaining("### Plugin: kfc_sg"),
		]),
	);
	for (const section of defaultRuntime.promptSections) {
		expect(section).toContain('exactly once with {"category":"all"}');
	}
	const fullIndexTools = defaultRuntime.tools.filter((tool) =>
		tool.name.endsWith("_listProducts"),
	);
	expect(fullIndexTools).toHaveLength(3);
	for (const listTool of fullIndexTools) {
		expect(listTool.parameters).toMatchObject({ required: ["category"] });
		expect(listTool.parameters).toMatchObject({
			properties: {
				category: { enum: expect.arrayContaining(["all"]) },
			},
		});
		expect(listTool.description).toContain("category is required");
		const fullIndexResult = await listTool.execute(
			`${listTool.name}-full-index`,
			{ category: "all" },
		);
		const content = fullIndexResult.content[0];
		expect(content?.type).toBe("text");
		if (content?.type === "text") {
			const payload = JSON.parse(content.text);
			expect(payload.category).toBe("all");
			expect(payload.products.length).toBeGreaterThan(0);
		}
	}
	const mcdList = defaultRuntime.tools.find(
		(tool) => tool.name === "mcdonalds_sg_listProducts",
	);
	if (!mcdList)
		throw new Error("McDonald's Singapore list tool was not loaded");
	const listResult = await mcdList.execute("mcd-list", {
		category: "burgers",
	});
	expect(listResult.content[0]?.type).toBe("text");
	if (listResult.content[0]?.type === "text") {
		expect(listResult.content[0].text).toContain("Big Mac");
		expect(listResult.content[0].text).toContain("burgers");
	}

	await plugins.savePluginSettings(
		"example",
		{
			prefix: "Plugin test",
			apiKey: "secret",
			repeatCount: 2,
			mode: "bracketed",
			uppercase: true,
		},
		true,
	);
	const runtime = await plugins.loadPluginRuntime("en-us", ["getProfile"]);
	expect(runtime.promptSections).toHaveLength(4);
	expect(runtime.promptSections[3]).toContain("### Plugin: example");
	const echo = runtime.tools.find((tool) => tool.name === "example_echo");
	if (!echo) throw new Error("example_echo was not loaded");
	const result = await echo.execute("echo-call", { text: "hello" });
	expect(result.content).toEqual([
		{
			type: "text",
			text: JSON.stringify({ echoed: "Plugin test: [HELLO] [HELLO]" }),
		},
	]);
});

test("user-installed package plugins load disabled and can be removed with their data", async () => {
	const { definePlugin, Type } = await import("@kalo-ai/plugin-sdk");
	const remotePlugin = definePlugin({
		manifest: {
			id: "remote_fixture",
			apiVersion: 1,
			version: "1.0.0",
			configVersion: 1,
			name: { "zh-cn": "远程测试", "en-us": "Remote fixture" },
			description: { "zh-cn": "测试", "en-us": "Test fixture" },
			defaultEnabled: true,
		},
		configSchema: Type.Object({}),
		defaultConfig: {},
		createTools: () => [
			{
				name: "remote_fixture_ping",
				label: "Remote ping",
				description: "Return a remote plugin test value.",
				parameters: Type.Object({}),
				executionMode: "parallel",
				execute: async () => ({
					content: [{ type: "text", text: "pong" }],
					details: { ok: true, data: { value: "pong" } },
				}),
			},
		],
	});
	const { analyzePluginModuleSource } = await import(
		"../src/lib/plugins/moduleSource"
	);
	const module = await analyzePluginModuleSource("export default {};");
	const installed = await plugins.installPluginPackage(
		"npm:@scope/remote-fixture@1.0.0",
		async () => ({
			...module,
			sourceUrl: "https://esm.sh/fixture.bundle.mjs",
		}),
		async () => remotePlugin,
	);
	expect(installed).toMatchObject({
		enabled: false,
		status: "disabled",
		source: {
			type: "npm",
			packageName: "@scope/remote-fixture",
			packageVersion: "1.0.0",
		},
	});
	expect(await repositories.listPluginInstallations()).toEqual([
		expect.objectContaining({
			pluginId: "remote_fixture",
			packageName: "@scope/remote-fixture",
			moduleSha256: module.sha256,
		}),
	]);
	expect(await repositories.getPluginModule("remote_fixture")).toMatchObject({
		sha256: module.sha256,
		source: "export default {};",
	});

	await plugins.savePluginSettings("remote_fixture", {}, true);
	const runtime = await plugins.loadPluginRuntime("en-us", []);
	expect(runtime.tools.map((tool) => tool.name)).toContain(
		"remote_fixture_ping",
	);
	await repositories.setPluginData({
		pluginId: "remote_fixture",
		key: "sample",
		value: { retained: false },
	});
	const updated = await plugins.installPluginPackage(
		"npm:@scope/remote-fixture@1.0.0",
		async () => ({
			...module,
			sourceUrl: "https://esm.sh/fixture.bundle.mjs",
		}),
		async () => remotePlugin,
	);
	expect(updated).toMatchObject({ enabled: false, status: "disabled" });
	const disabled = await plugins.disableInstalledPlugin("remote_fixture");
	expect(disabled).toMatchObject({ enabled: false, status: "disabled" });
	await plugins.removePluginPackage("remote_fixture");
	expect(await repositories.listPluginInstallations()).toEqual([]);
	expect(await repositories.getPluginConfig("remote_fixture")).toBeUndefined();
	expect(
		await repositories.getPluginData("remote_fixture", "sample"),
	).toBeUndefined();
	expect(await repositories.getPluginModule("remote_fixture")).toBeUndefined();
});

test("installed descriptor drift is rejected before permissions can change", async () => {
	const { definePlugin, Type } = await import("@kalo-ai/plugin-sdk");
	const { analyzePluginModuleSource } = await import(
		"../src/lib/plugins/moduleSource"
	);
	const plugin = definePlugin({
		manifest: {
			id: "descriptor_drift",
			apiVersion: 1,
			version: "1.0.0",
			configVersion: 1,
			name: { "zh-cn": "漂移测试", "en-us": "Descriptor drift" },
			description: { "zh-cn": "测试", "en-us": "Test fixture" },
			permissions: [],
		},
		configSchema: Type.Object({}),
		defaultConfig: {},
		createTools: () => [],
	});
	const module = await analyzePluginModuleSource("export default {};");
	await plugins.installPluginPackage(
		"npm:@scope/descriptor-drift@1.0.0",
		async () => ({
			...module,
			sourceUrl: "https://esm.sh/descriptor-drift.bundle.mjs",
		}),
		async () => plugin,
	);
	plugin.manifest.permissions = ["storage"];
	await expect(
		plugins.savePluginSettings("descriptor_drift", {}, true),
	).rejects.toThrow("descriptor");
	expect(await repositories.getPluginConfig("descriptor_drift")).toMatchObject({
		enabled: false,
	});
});

test("unsafe user plugin schemas are rejected before installation", async () => {
	const { definePlugin, Type } = await import("@kalo-ai/plugin-sdk");
	const { analyzePluginModuleSource } = await import(
		"../src/lib/plugins/moduleSource"
	);
	const unsafe = definePlugin({
		manifest: {
			id: "unsafe_schema",
			apiVersion: 1,
			version: "1.0.0",
			configVersion: 1,
			name: { "zh-cn": "不安全 Schema", "en-us": "Unsafe schema" },
			description: { "zh-cn": "测试", "en-us": "Test fixture" },
		},
		configSchema: Type.Object({ value: Type.String({ pattern: "[" }) }),
		defaultConfig: { value: "test" },
		createTools: () => [],
	});
	const module = await analyzePluginModuleSource("export default {};");
	await expect(
		plugins.installPluginPackage(
			"npm:@scope/unsafe-schema@1.0.0",
			async () => ({
				...module,
				sourceUrl: "https://esm.sh/unsafe-schema.bundle.mjs",
			}),
			async () => unsafe,
		),
	).rejects.toThrow("pattern");
	expect(
		await repositories.getPluginInstallation("unsafe_schema"),
	).toBeUndefined();
});

test("remote package and plugin manifest versions must match", async () => {
	const { definePlugin, Type } = await import("@kalo-ai/plugin-sdk");
	const mismatched = definePlugin({
		manifest: {
			id: "remote_mismatch",
			apiVersion: 1,
			version: "2.0.0",
			configVersion: 1,
			name: { "zh-cn": "版本错误", "en-us": "Version mismatch" },
			description: { "zh-cn": "测试", "en-us": "Test fixture" },
		},
		configSchema: Type.Object({}),
		defaultConfig: {},
		createTools: () => [],
	});
	const { analyzePluginModuleSource } = await import(
		"../src/lib/plugins/moduleSource"
	);
	const module = await analyzePluginModuleSource("export default {};");
	await expect(
		plugins.installPluginPackage(
			"npm:@scope/version-mismatch@1.0.0",
			async () => ({
				...module,
				sourceUrl: "https://esm.sh/mismatch.bundle.mjs",
			}),
			async () => mismatched,
		),
	).rejects.toThrow("版本");
	expect(await repositories.listPluginInstallations()).toEqual([]);
});

test("local single-file plugins persist source, install disabled, and require version bumps", async () => {
	const { definePlugin, Type } = await import("@kalo-ai/plugin-sdk");
	const { analyzePluginModuleSource } = await import(
		"../src/lib/plugins/moduleSource"
	);
	const localPlugin = definePlugin({
		manifest: {
			id: "local_fixture",
			apiVersion: 1,
			version: "1.0.0",
			configVersion: 1,
			name: { "zh-cn": "本地测试", "en-us": "Local fixture" },
			description: { "zh-cn": "测试", "en-us": "Test fixture" },
		},
		configSchema: Type.Object({}),
		defaultConfig: {},
		createTools: () => [],
	});
	const analyzed = await analyzePluginModuleSource("export default {};");
	let executions = 0;
	const executor = async () => {
		executions += 1;
		return localPlugin;
	};
	const installed = await plugins.installLocalPlugin(
		{ fileName: "local-fixture.js", ...analyzed },
		executor,
	);
	expect(installed).toMatchObject({
		enabled: false,
		status: "disabled",
		source: { type: "local", packageName: "local-fixture.js" },
	});
	expect(await repositories.getPluginModule("local_fixture")).toMatchObject({
		sha256: analyzed.sha256,
		source: analyzed.source,
	});
	await plugins.getPluginState("local_fixture");
	expect(executions).toBe(1);
	const backup = await repositories.exportAll();
	expect(backup.pluginModules).toEqual([
		expect.objectContaining({
			pluginId: "local_fixture",
			sha256: analyzed.sha256,
			source: analyzed.source,
		}),
	]);

	const changed = await analyzePluginModuleSource(
		"export default { changed: true };",
	);
	await expect(
		plugins.installLocalPlugin(
			{ fileName: "local-fixture.js", ...changed },
			executor,
		),
	).rejects.toThrow("manifest.version");
});

test("plugin configuration migrates to the package config version", async () => {
	await installExampleFixture();
	await repositories.savePluginConfig({
		pluginId: "example",
		enabled: true,
		configVersion: 1,
		config: { prefix: "Legacy", uppercase: true },
	});
	const migrated = await plugins.getPluginState("example");
	expect(migrated).toMatchObject({
		enabled: true,
		status: "ready",
		config: {
			prefix: "Legacy",
			apiKey: "",
			repeatCount: 1,
			mode: "plain",
			uppercase: true,
		},
	});
	expect(await repositories.getPluginConfig("example")).toMatchObject({
		configVersion: 2,
	});
});

test("resetting a plugin removes its configuration and scoped data", async () => {
	await installExampleFixture();
	await plugins.savePluginSettings(
		"example",
		{
			prefix: "Stored",
			apiKey: "",
			repeatCount: 1,
			mode: "plain",
			uppercase: false,
		},
		true,
	);
	await repositories.setPluginData({
		pluginId: "example",
		key: "cache",
		value: { hit: true },
	});
	await repositories.setPluginData({
		pluginId: "other_plugin",
		key: "cache",
		value: { retained: true },
	});
	const reset = await plugins.resetPluginSettings("example");
	expect(reset).toMatchObject({ enabled: false, status: "disabled" });
	expect(await repositories.getPluginConfig("example")).toBeUndefined();
	expect(await repositories.getPluginData("example", "cache")).toBeUndefined();
	expect(
		await repositories.getPluginData("other_plugin", "cache"),
	).toMatchObject({
		value: { retained: true },
	});
});

test("Katch-McArdle profiles require body fat at the repository boundary", async () => {
	await expect(
		repositories.saveUser({
			age: 30,
			gender: "male",
			height: 175,
			currentWeight: 80,
			activityLevel: "moderate",
			bmrMethod: "katch-mcardle",
			calculatedBMR: 1666,
		}),
	).rejects.toThrow("体脂率");

	const user = await repositories.saveUser({
		age: 30,
		gender: "male",
		height: 175,
		currentWeight: 80,
		activityLevel: "moderate",
		bmrMethod: "katch-mcardle",
		bodyFatPercentage: 25,
		calculatedBMR: 1666,
	});
	expect(user).toMatchObject({
		bmrMethod: "katch-mcardle",
		bodyFatPercentage: 25,
	});
	await expect(
		repositories.updateUser({ bodyFatPercentage: undefined }),
	).rejects.toThrow("体脂率");
});

test("exercise records support correction and reject future dates", async () => {
	const entry = await repositories.addExerciseEntry({
		date: "2020-01-01",
		time: "18:00",
		description: "Run",
		category: "running",
		intensity: "moderate",
		duration: 30,
		caloriesBurned: 300,
		source: "manual",
	});
	const corrected = await repositories.updateExerciseEntry(entry.id, {
		date: "2020-01-01",
		time: "18:00",
		description: "Run",
		category: "running",
		intensity: "vigorous",
		duration: 40,
		caloriesBurned: 420,
		source: "manual",
	});
	expect(corrected).toMatchObject({
		id: entry.id,
		duration: 40,
		caloriesBurned: 420,
	});
	expect(await repositories.getExerciseEntries()).toHaveLength(1);

	await expect(
		repositories.addExerciseEntry({
			date: "2999-01-01",
			time: "12:00",
			description: "Future run",
			duration: 30,
			caloriesBurned: 200,
			source: "manual",
		}),
	).rejects.toThrow("未来日期");
});

test("training plan completion creates exactly one linked exercise record", async () => {
	const today = dates.localDateISO();
	const tomorrow = dates.localDateOffset(1);
	const { plan, workouts } = await repositories.createTrainingPlan({
		title: "Starter plan",
		goal: "Build consistency",
		startDate: today,
		endDate: dates.localDateOffset(7),
		workouts: [
			{
				date: today,
				time: "08:00",
				category: "running",
				description: "Easy run",
				intensity: "light",
				plannedDuration: 30,
				estimatedCalories: 240,
			},
			{
				date: tomorrow,
				category: "strength",
				description: "Strength session",
				intensity: "moderate",
				plannedDuration: 40,
			},
		],
	});
	expect(plan.status).toBe("active");
	expect(workouts).toHaveLength(2);

	const first = await repositories.completePlannedWorkout(workouts[0].id, {
		date: today,
		time: "08:10",
		duration: 32,
		caloriesBurned: 250,
	});
	const repeated = await repositories.completePlannedWorkout(workouts[0].id, {
		date: today,
		time: "09:00",
		duration: 60,
		caloriesBurned: 500,
	});
	expect(repeated.exercise.id).toBe(first.exercise.id);
	expect(await repositories.getExerciseEntries()).toHaveLength(1);
	expect(first.exercise).toMatchObject({
		plannedWorkoutId: workouts[0].id,
		duration: 32,
		source: "manual",
	});

	await repositories.deleteExerciseEntry(first.exercise.id);
	const restoredWorkout = await repositories.getPlannedWorkout(workouts[0].id);
	expect(restoredWorkout?.status).toBe("planned");
	expect(restoredWorkout?.exerciseEntryId).toBeUndefined();
});

test("training plans enforce one current plan and preserve logs when archived", async () => {
	const today = dates.localDateISO();
	const created = await repositories.createTrainingPlan({
		title: "Current plan",
		startDate: today,
		workouts: [
			{
				date: today,
				category: "walking",
				description: "Walk",
				intensity: "moderate",
				plannedDuration: 20,
			},
		],
	});
	await expect(
		repositories.createTrainingPlan({
			title: "Another plan",
			startDate: today,
		}),
	).rejects.toThrow("已有当前训练计划");

	const completed = await repositories.completePlannedWorkout(
		created.workouts[0].id,
		{
			date: today,
			duration: 20,
			caloriesBurned: 80,
		},
	);
	const repeated = await repositories.completePlannedWorkout(
		created.workouts[0].id,
		{
			date: today,
			duration: 99,
			caloriesBurned: 999,
		},
	);
	expect(repeated.exercise.id).toBe(completed.exercise.id);
	const completedPlan = await repositories.getTrainingPlan(created.plan.id);
	expect(completedPlan?.status).toBe("completed");
	await repositories.archiveTrainingPlan(created.plan.id, created.plan.title);
	expect(await repositories.getExerciseEntries()).toHaveLength(1);
	expect((await repositories.getTrainingPlan(created.plan.id))?.status).toBe(
		"archived",
	);
});

test("any exercise can be linked, moved, or unlinked from a plan item", async () => {
	const today = dates.localDateISO();
	const created = await repositories.createTrainingPlan({
		title: "Linkable plan",
		startDate: today,
		workouts: [
			{
				date: today,
				category: "running",
				description: "Run A",
				intensity: "light",
				plannedDuration: 20,
			},
			{
				date: today,
				category: "running",
				description: "Run B",
				intensity: "moderate",
				plannedDuration: 30,
			},
		],
	});
	const exercise = await repositories.addExerciseEntry({
		date: today,
		time: "09:00",
		description: "Actual run",
		category: "running",
		intensity: "moderate",
		duration: 28,
		caloriesBurned: 240,
		source: "third_party",
	});

	await repositories.linkExerciseToPlannedWorkout(
		exercise.id,
		created.workouts[0].id,
	);
	expect(
		await repositories.getPlannedWorkout(created.workouts[0].id),
	).toMatchObject({
		status: "completed",
		exerciseEntryId: exercise.id,
	});
	expect(
		(await repositories.getExerciseEntry(exercise.id))?.plannedWorkoutId,
	).toBe(created.workouts[0].id);

	await repositories.linkExerciseToPlannedWorkout(
		exercise.id,
		created.workouts[1].id,
	);
	expect(
		(await repositories.getPlannedWorkout(created.workouts[0].id))?.status,
	).toBe("planned");
	expect(
		(await repositories.getPlannedWorkout(created.workouts[1].id))?.status,
	).toBe("completed");

	await repositories.linkExerciseToPlannedWorkout(exercise.id, null);
	expect(
		(await repositories.getExerciseEntry(exercise.id))?.plannedWorkoutId,
	).toBeUndefined();
	expect(
		(await repositories.getPlannedWorkout(created.workouts[1].id))?.status,
	).toBe("planned");
});

test("a planned workout cannot link to two exercise records", async () => {
	const today = dates.localDateISO();
	const created = await repositories.createTrainingPlan({
		title: "One-to-one plan",
		startDate: today,
		workouts: [
			{
				date: today,
				category: "walking",
				description: "Walk",
				intensity: "light",
				plannedDuration: 20,
			},
		],
	});
	const makeExercise = (id: string) =>
		repositories.addExerciseEntry({
			date: today,
			time: "09:00",
			description: id,
			duration: 20,
			caloriesBurned: 70,
			source: "manual",
		});
	const first = await makeExercise("First");
	const second = await makeExercise("Second");
	await repositories.linkExerciseToPlannedWorkout(
		first.id,
		created.workouts[0].id,
	);
	await expect(
		repositories.linkExerciseToPlannedWorkout(
			second.id,
			created.workouts[0].id,
		),
	).rejects.toThrow("已经关联另一条运动记录");
});

test("deleting an old plan completion never creates two current plans", async () => {
	const today = dates.localDateISO();
	const firstPlan = await repositories.createTrainingPlan({
		title: "First",
		startDate: today,
		workouts: [
			{
				date: today,
				category: "walking",
				description: "Walk",
				intensity: "light",
				plannedDuration: 20,
			},
		],
	});
	const completion = await repositories.completePlannedWorkout(
		firstPlan.workouts[0].id,
		{ date: today, duration: 20, caloriesBurned: 70 },
	);
	const secondPlan = await repositories.createTrainingPlan({
		title: "Second",
		startDate: today,
	});
	await repositories.deleteExerciseEntry(completion.exercise.id);
	expect((await repositories.getTrainingPlan(firstPlan.plan.id))?.status).toBe(
		"archived",
	);
	expect((await repositories.getCurrentTrainingPlan())?.id).toBe(
		secondPlan.plan.id,
	);
});

test("legacy health and watch exercise sources import as third party", async () => {
	await repositories.importAll({
		version: 1,
		exportedAt: Date.now(),
		user: [],
		aiConfig: [],
		foodEntries: [],
		exerciseEntries: [
			{
				id: "legacy-watch",
				date: "2020-01-01",
				time: "08:00",
				description: "Walk",
				duration: 20,
				caloriesBurned: 80,
				source: "watch",
				createdAt: 1,
			},
		],
		weightEntries: [],
		foodLibrary: [],
		sessions: [],
		messages: [],
	});
	expect(await repositories.getExerciseEntries()).toEqual([
		expect.objectContaining({ id: "legacy-watch", source: "third_party" }),
	]);
});

test("backup imports reject malformed entity arrays", async () => {
	await expect(
		repositories.importAll({
			version: 1,
			exportedAt: Date.now(),
			user: [],
			aiConfig: [],
			foodEntries: [{ date: "2026-01-01", calories: 500 }],
			exerciseEntries: [],
			weightEntries: [],
			foodLibrary: [],
			sessions: [],
			messages: [],
		}),
	).rejects.toThrow("foodEntries 数据格式无效");
});

test("backups include memory and BMR settings while version 1 backups remain importable", async () => {
	const { exportAll, getUserMemory, importAll, updateUserMemory } =
		repositories;
	await repositories.saveUser({
		age: 30,
		gender: "female",
		height: 165,
		currentWeight: 60,
		activityLevel: "light",
		bmrMethod: "katch-mcardle",
		bodyFatPercentage: 25,
		calculatedBMR: 1342,
	});
	await updateUserMemory("Remember this", 0);
	await installExampleFixture();
	await plugins.savePluginSettings(
		"example",
		{
			prefix: "Backup plugin",
			apiKey: "backup-secret",
			repeatCount: 3,
			mode: "plain",
			uppercase: false,
		},
		true,
	);
	await repositories.setPluginData({
		pluginId: "example",
		key: "sample",
		value: ["saved", 1],
	});
	const { analyzePluginModuleSource } = await import(
		"../src/lib/plugins/moduleSource"
	);
	const cachedModule = await analyzePluginModuleSource("export default {};");
	await repositories.savePluginInstallationWithModule(
		{
			pluginId: "backup_remote",
			registry: "jsr",
			packageName: "@scope/backup-plugin",
			packageVersion: "1.2.3",
			moduleSha256: cachedModule.sha256,
			moduleSize: cachedModule.size,
			manifest: {
				id: "backup_remote",
				apiVersion: 1,
				version: "1.2.3",
				configVersion: 1,
				name: { "zh-cn": "备份插件", "en-us": "Backup plugin" },
				description: { "zh-cn": "备份测试", "en-us": "Backup test" },
			},
		},
		{
			pluginId: "backup_remote",
			source: cachedModule.source,
			sha256: cachedModule.sha256,
			size: cachedModule.size,
			fileName: "backup_remote-1.2.3.js",
			sourceUrl: "https://esm.sh/backup.bundle.mjs",
		},
	);
	await repositories.savePluginConfig({
		pluginId: "backup_remote",
		enabled: true,
		configVersion: 1,
		config: {},
	});
	const backedPlan = await repositories.createTrainingPlan({
		title: "Backed-up plan",
		startDate: dates.localDateISO(),
		workouts: [
			{
				date: dates.localDateISO(),
				category: "cycling",
				description: "Easy ride",
				intensity: "light",
				plannedDuration: 30,
			},
		],
	});
	await repositories.completePlannedWorkout(backedPlan.workouts[0].id, {
		date: dates.localDateISO(),
		duration: 32,
		caloriesBurned: 180,
	});
	const backup = await exportAll();
	expect(backup.version).toBe(8);
	expect(backup.user).toEqual([
		expect.objectContaining({
			bmrMethod: "katch-mcardle",
			bodyFatPercentage: 25,
		}),
	]);
	expect(backup.trainingPlans).toEqual([
		expect.objectContaining({ title: "Backed-up plan", status: "completed" }),
	]);
	expect(backup.plannedWorkouts).toEqual([
		expect.objectContaining({
			description: "Easy ride",
			status: "completed",
			exerciseEntryId: expect.any(String),
		}),
	]);
	expect(backup.pluginConfigs).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				pluginId: "example",
				enabled: true,
				config: {
					prefix: "Backup plugin",
					apiKey: "backup-secret",
					repeatCount: 3,
					mode: "plain",
					uppercase: false,
				},
			}),
			expect.objectContaining({
				pluginId: "backup_remote",
				enabled: true,
			}),
		]),
	);
	expect(backup.pluginData).toEqual([
		expect.objectContaining({
			pluginId: "example",
			key: "sample",
			value: ["saved", 1],
		}),
	]);
	expect(backup.pluginInstallations).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ pluginId: "example", registry: "npm" }),
			expect.objectContaining({
				pluginId: "backup_remote",
				registry: "jsr",
				packageName: "@scope/backup-plugin",
				packageVersion: "1.2.3",
				moduleSha256: cachedModule.sha256,
			}),
		]),
	);
	expect(backup.pluginModules).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ pluginId: "example" }),
			expect.objectContaining({
				pluginId: "backup_remote",
				sha256: cachedModule.sha256,
				source: cachedModule.source,
			}),
		]),
	);
	expect(backup.userMemory).toEqual([
		expect.objectContaining({
			id: "user-memory",
			content: "Remember this",
			version: 1,
		}),
	]);
	const invalidBackup = structuredClone(backup);
	delete invalidBackup.user[0].bodyFatPercentage;
	await expect(importAll(invalidBackup)).rejects.toThrow("user 数据格式无效");
	const invalidPluginBackup = structuredClone(backup);
	invalidPluginBackup.pluginInstallations[0].packageVersion = "latest";
	await expect(importAll(invalidPluginBackup)).rejects.toThrow(
		"pluginInstallations 数据格式无效",
	);
	const invalidModuleBackup = structuredClone(backup);
	invalidModuleBackup.pluginModules[0].source =
		"export default { changed: true };";
	await expect(importAll(invalidModuleBackup)).rejects.toThrow(
		"pluginModules 数据格式无效",
	);
	const invalidDescriptorBackup = structuredClone(backup);
	const descriptorInstallation =
		invalidDescriptorBackup.pluginInstallations.find(
			(installation) => installation.descriptor,
		);
	if (!descriptorInstallation) throw new Error("Descriptor fixture missing");
	descriptorInstallation.manifest.permissions = ["storage"];
	await expect(importAll(invalidDescriptorBackup)).rejects.toThrow(
		"descriptor hash",
	);

	await repositories.clearAllData();
	await importAll(backup);
	expect(await repositories.getPluginConfig("example")).toMatchObject({
		enabled: false,
		config: {
			prefix: "Backup plugin",
			apiKey: "backup-secret",
			repeatCount: 3,
			mode: "plain",
			uppercase: false,
		},
	});
	expect(await repositories.getPluginData("example", "sample")).toMatchObject({
		value: ["saved", 1],
	});
	expect(await repositories.listPluginInstallations()).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ pluginId: "example" }),
			expect.objectContaining({
				pluginId: "backup_remote",
				packageVersion: "1.2.3",
			}),
		]),
	);
	expect(await repositories.getPluginConfig("backup_remote")).toMatchObject({
		enabled: false,
	});
	expect(await repositories.getPluginModule("backup_remote")).toMatchObject({
		sha256: cachedModule.sha256,
	});
	expect(await repositories.getTrainingPlans()).toHaveLength(1);
	const restoredWorkouts = await repositories.getPlannedWorkouts(
		backup.trainingPlans[0].id,
	);
	expect(restoredWorkouts).toHaveLength(1);
	expect((await repositories.getExerciseEntries())[0]).toMatchObject({
		plannedWorkoutId: restoredWorkouts[0].id,
	});
	expect(await repositories.getUser()).toMatchObject({
		bmrMethod: "katch-mcardle",
		bodyFatPercentage: 25,
	});
	expect(await getUserMemory()).toEqual(
		expect.objectContaining({ content: "Remember this", version: 1 }),
	);

	await importAll({
		version: 1,
		exportedAt: Date.now(),
		user: [],
		aiConfig: [],
		foodEntries: [],
		exerciseEntries: [],
		weightEntries: [],
		foodLibrary: [],
		sessions: [],
		messages: [],
	});
	expect(await getUserMemory()).toEqual({
		content: "",
		version: 0,
		updatedAt: null,
	});
	expect(await repositories.getTrainingPlans()).toEqual([]);
	expect(await repositories.listPluginConfigs()).toEqual([]);
	expect(await repositories.listPluginInstallations()).toEqual([]);
	expect(await repositories.listPluginModules()).toEqual([]);
});
