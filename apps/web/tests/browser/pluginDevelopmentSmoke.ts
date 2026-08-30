import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

interface PendingCommand {
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
}

interface CdpTarget {
	type: string;
	webSocketDebuggerUrl: string;
}

const webRoot = resolve(import.meta.dir, "../..");
const port = 43243;
const debuggingPort = 9283;
const origin = `http://127.0.0.1:${port}`;
const chromeCandidates = [
	process.env.CHROME_BIN,
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/usr/bin/google-chrome",
	"/usr/bin/google-chrome-stable",
].filter((candidate): candidate is string => Boolean(candidate));
const chromePath = chromeCandidates.find(
	(candidate) => Bun.file(candidate).size > 0,
);
if (!chromePath) throw new Error("Chrome not found; set CHROME_BIN");

const profile = await mkdtemp(join(tmpdir(), "kalo-plugin-development-"));
const vite = Bun.spawn(
	[
		"node",
		"node_modules/vite/bin/vite.js",
		"dev",
		"--host",
		"127.0.0.1",
		"--port",
		String(port),
	],
	{ cwd: webRoot, stdout: "ignore", stderr: "ignore" },
);
let chrome: ReturnType<typeof Bun.spawn> | undefined;
let socket: WebSocket | undefined;

const sleep = (milliseconds: number) =>
	new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

async function waitForHttp(url: string, timeout = 30_000): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < timeout) {
		try {
			if ((await fetch(url)).ok) return;
		} catch {
			// Server is still starting.
		}
		await sleep(100);
	}
	throw new Error(`Timed out waiting for ${url}`);
}

try {
	console.log("[plugin-development-smoke] starting Vite");
	await waitForHttp(origin);
	chrome = Bun.spawn(
		[
			chromePath,
			"--headless=new",
			"--disable-gpu",
			"--no-first-run",
			"--no-default-browser-check",
			"--disable-background-networking",
			`--remote-debugging-port=${debuggingPort}`,
			`--user-data-dir=${profile}`,
			`${origin}/`,
		],
		{ stdout: "ignore", stderr: "ignore" },
	);
	await waitForHttp(`http://127.0.0.1:${debuggingPort}/json`);
	console.log("[plugin-development-smoke] Chrome ready");
	const targets = (await fetch(`http://127.0.0.1:${debuggingPort}/json`).then(
		(response) => response.json(),
	)) as unknown;
	if (!Array.isArray(targets)) throw new Error("Invalid Chrome target list");
	const target = targets.find(
		(value): value is CdpTarget =>
			typeof value === "object" &&
			value !== null &&
			"type" in value &&
			value.type === "page" &&
			"webSocketDebuggerUrl" in value &&
			typeof value.webSocketDebuggerUrl === "string",
	);
	if (!target) throw new Error("Chrome page target missing");

	socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise<void>((resolveSocket, reject) => {
		socket?.addEventListener("open", () => resolveSocket(), { once: true });
		socket?.addEventListener(
			"error",
			() => reject(new Error("CDP connection failed")),
			{ once: true },
		);
	});
	let nextId = 0;
	const pending = new Map<number, PendingCommand>();
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(String(event.data)) as {
			id?: number;
			result?: unknown;
			error?: unknown;
		};
		if (message.id === undefined) return;
		const request = pending.get(message.id);
		if (!request) return;
		pending.delete(message.id);
		if (message.error) request.reject(new Error(JSON.stringify(message.error)));
		else request.resolve(message.result);
	});

	function command(
		method: string,
		params: Record<string, unknown> = {},
	): Promise<unknown> {
		return new Promise((resolveCommand, reject) => {
			const id = ++nextId;
			pending.set(id, { resolve: resolveCommand, reject });
			socket?.send(JSON.stringify({ id, method, params }));
		});
	}

	async function evaluate<T>(expression: string): Promise<T> {
		const response = (await command("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		})) as {
			result?: { value?: T };
			exceptionDetails?: unknown;
		};
		if (response.exceptionDetails) {
			throw new Error(
				`Browser evaluation failed: ${JSON.stringify(response.exceptionDetails)}`,
			);
		}
		return response.result?.value as T;
	}

	async function waitFor<T>(expression: string, timeout = 30_000): Promise<T> {
		const started = Date.now();
		while (Date.now() - started < timeout) {
			const value = await evaluate<T | null>(expression);
			if (value) return value;
			await sleep(100);
		}
		throw new Error(`Timed out waiting for: ${expression}`);
	}

	await command("Runtime.enable");
	await command("Page.enable");
	await waitFor("document.readyState === 'complete'");

	const source = `const plugin = {
  manifest: {
    id: "dev_browser",
    apiVersion: 1,
    version: "1.0.0",
    configVersion: 1,
    name: { "zh-cn": "浏览器开发测试", "en-us": "Browser development test" },
    description: { "zh-cn": "零权限沙箱测试", "en-us": "Zero-permission sandbox test" },
    permissions: []
  },
  configSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  defaultConfig: {},
  createTools(context) {
    return [{
      name: "dev_browser_echo",
      label: "Development echo",
      description: "Echo one test string.",
      parameters: {
        type: "object",
        properties: { text: { type: "string", maxLength: 100 } },
        required: ["text"],
        additionalProperties: false
      },
      executionMode: "parallel",
      async execute(_toolCallId, params) {
        const echoed = "draft:" + params.text;
        return {
          content: [{ type: "text", text: echoed }],
          details: { ok: true, data: { echoed } }
        };
      }
    }, {
      name: "dev_browser_denied_storage",
      label: "Denied storage",
      description: "Verify undeclared draft storage is denied.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      executionMode: "sequential",
      async execute() {
        await context.services.storage.set("probe", 1);
        return {
          content: [{ type: "text", text: "unexpected" }],
          details: { ok: true, data: null }
        };
      }
    }];
  },
  systemPrompt() { return "Use dev_browser_echo only when explicitly requested."; }
};
export const kaloPlugin = plugin;
export default kaloPlugin;`;

	console.log("[plugin-development-smoke] creating and testing drafts");
	const fixture = await evaluate<{
		sessionId: string;
		draftId: string;
		testText: string;
		denied: boolean;
		failedLoadCleaned: boolean;
		preciseRuntimeError: boolean;
	}>(`(async () => {
  const repositories = await import('/src/lib/db/repositories.ts');
  const drafts = await import('/src/lib/plugins/drafts.ts');
  const sandbox = await import('/src/lib/plugins/draftSandbox.ts');
  const context = await import('/src/lib/context/appContext.svelte.ts');
  await repositories.clearAllData();
  await repositories.saveUser({age:30,gender:'male',height:175,currentWeight:70,activityLevel:'moderate',bmrMethod:'mifflin-st-jeor',calculatedBMR:1650});
  await repositories.saveAIConfig({apiType:'openai-completions',apiKey:'test',model:'mock'});
  const session = await repositories.createSession('Plugin browser smoke', 'plugin_development');
  const draft = await drafts.createPluginDraft({sessionId:session.id,fileName:'dev-browser.js',source:${JSON.stringify(source)}});
  await sandbox.inspectPluginDraftInSandbox({sessionId:session.id,draftId:draft.id,locale:'en-us'});
  const tested = await sandbox.testPluginDraftTool({sessionId:session.id,draftId:draft.id,locale:'en-us',toolName:'dev_browser_echo',arguments:{text:'hello'}});
  let denied = false;
  try {
    await sandbox.testPluginDraftTool({sessionId:session.id,draftId:draft.id,locale:'en-us',toolName:'dev_browser_denied_storage',arguments:{}});
  } catch {
    denied = (await drafts.getPluginDraft(session.id, draft.id)).lastTest?.ok === false;
  }
  const unsafeSource = ${JSON.stringify(`const plugin = {
  manifest: {
    id: "dev_unsafe",
    apiVersion: 1,
    version: "1.0.0",
    configVersion: 1,
    name: { "zh-cn": "不安全", "en-us": "Unsafe" },
    description: { "zh-cn": "测试", "en-us": "Test" },
    permissions: []
  },
  configSchema: {
    type: "object",
    properties: { value: { type: "string", pattern: "[" } },
    required: ["value"]
  },
  defaultConfig: { value: "x" },
  createTools() { return []; }
};
export const kaloPlugin = plugin;
export default kaloPlugin;`)};
  const unsafe = await drafts.createPluginDraft({sessionId:session.id,fileName:'unsafe.js',source:unsafeSource});
  try { await sandbox.inspectPluginDraftInSandbox({sessionId:session.id,draftId:unsafe.id,locale:'en-us'}); } catch {}
  const missingLabelSource = ${JSON.stringify(`const plugin = {
  manifest: {
    id: "missing_label",
    apiVersion: 1,
    version: "1.0.0",
    configVersion: 1,
    name: { "zh-cn": "缺少 Label", "en-us": "Missing label" },
    description: { "zh-cn": "测试", "en-us": "Test" },
    permissions: []
  },
  configSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  defaultConfig: {},
  createTools() {
    return [{
      name: "missing_label_echo",
      description: "Missing the required label field.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      async execute() { return { content: [{ type: "text", text: "x" }], details: {} }; }
    }];
  }
};
export const kaloPlugin = plugin;
export default kaloPlugin;`)};
  const missingLabel = await drafts.createPluginDraft({sessionId:session.id,fileName:'missing-label.js',source:missingLabelSource});
  let preciseRuntimeError = false;
  try {
    await sandbox.inspectPluginDraftInSandbox({sessionId:session.id,draftId:missingLabel.id,locale:'en-us'});
  } catch (error) {
    preciseRuntimeError = error instanceof Error && error.message.includes('createTools()[0].label must be a non-empty string');
  }
  const failedLoadCleaned = document.querySelectorAll('iframe[sandbox]').length === 0 && (await drafts.getPluginDraft(session.id, unsafe.id)).status === 'invalid' && (await drafts.getPluginDraft(session.id, missingLabel.id)).status === 'invalid';
  await context.app.reload();
  return {sessionId:session.id,draftId:draft.id,testText:tested.lastTest?.content?.[0]?.text ?? '',denied,failedLoadCleaned,preciseRuntimeError};
})()`);
	console.log("[plugin-development-smoke] draft sandbox RPC complete");
	if (
		fixture.testText !== "draft:hello" ||
		!fixture.denied ||
		!fixture.failedLoadCleaned ||
		!fixture.preciseRuntimeError
	) {
		throw new Error(`Draft sandbox checks failed: ${JSON.stringify(fixture)}`);
	}

	console.log("[plugin-development-smoke] opening review UI");
	await command("Page.navigate", {
		url: `${origin}/chat/${fixture.sessionId}`,
	});
	await waitFor("document.readyState === 'complete'");
	await waitFor("document.body.innerText.includes('dev-browser.js')");
	await evaluate(`(() => {
  const summary = [...document.querySelectorAll('summary')].find((item) => item.textContent?.includes('dev-browser.js'));
  if (!(summary instanceof HTMLElement)) throw new Error('Draft summary missing');
  summary.click();
  return true;
})()`);
	await waitFor(
		"document.body.innerText.includes('dev_browser_echo') && document.body.innerText.includes('dev_browser_denied_storage')",
	);
	await evaluate(`(() => {
  const details = [...document.querySelectorAll('details')].find((item) => item.textContent?.includes('dev-browser.js'));
  const button = [...(details?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes('Review installation'));
  if (!(button instanceof HTMLButtonElement) || button.disabled) throw new Error('Review button missing');
  button.click();
  return true;
})()`);
	await waitFor(
		"document.querySelector('[role=dialog] input[type=checkbox]') !== null",
	);
	await evaluate(`(() => {
  const dialog = document.querySelector('[role=dialog]');
  const checkbox = dialog?.querySelector('input[type=checkbox]');
  if (!(checkbox instanceof HTMLInputElement)) throw new Error('Review checkbox missing');
  checkbox.click();
  return true;
})()`);
	await waitFor(`(() => {
  const dialog = document.querySelector('[role=dialog]');
  const install = [...(dialog?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes('Install disabled'));
  return install instanceof HTMLButtonElement && !install.disabled;
})()`);
	await evaluate(`(() => {
  const dialog = document.querySelector('[role=dialog]');
  const install = [...(dialog?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes('Install disabled'));
  if (!(install instanceof HTMLButtonElement)) throw new Error('Install button unavailable');
  install.click();
  return true;
})()`);
	await waitFor(
		"document.body.innerText.includes('Installed disabled: dev_browser')",
	);
	console.log("[plugin-development-smoke] reviewed install complete");
	const installed = await evaluate<{
		registry?: string;
		enabled?: boolean;
		sourceStored?: boolean;
	}>(`(async () => {
  const repositories = await import('/src/lib/db/repositories.ts');
  const installation = await repositories.getPluginInstallation('dev_browser');
  const config = await repositories.getPluginConfig('dev_browser');
  const module = await repositories.getPluginModule('dev_browser');
  return {registry:installation?.registry,enabled:config?.enabled,sourceStored:module?.source.includes('dev_browser_echo')};
})()`);
	if (
		installed.registry !== "local" ||
		installed.enabled !== false ||
		installed.sourceStored !== true
	) {
		throw new Error(`Reviewed install failed: ${JSON.stringify(installed)}`);
	}

	console.log("[plugin-development-smoke] opening inline share route");
	const sharedSource = source.replaceAll("dev_browser", "shared_browser");
	const shareToken = await evaluate<string>(`(async () => {
  const modules = await import('/src/lib/plugins/moduleSource.ts');
  const share = await import('/src/lib/plugins/share.ts');
  const analyzed = await modules.analyzePluginModuleSource(${JSON.stringify(sharedSource)});
  return share.encodePluginShare({fileName:'shared-browser.js',...analyzed});
})()`);
	await command("Page.navigate", {
		url: `${origin}/plugins/import#plugin=${shareToken}`,
	});
	await waitFor("document.readyState === 'complete'");
	await waitFor(
		"document.body.innerText.includes('shared-browser.js') && document.body.innerText.includes('No plugin code has run yet')",
	);
	const unopened = await evaluate<{
		iframeCount: number;
		installed: boolean;
		hash: string;
	}>(`(async () => {
  const repositories = await import('/src/lib/db/repositories.ts');
  return {
    iframeCount: document.querySelectorAll('iframe[sandbox]').length,
    installed: Boolean(await repositories.getPluginInstallation('shared_browser')),
    hash: location.hash
  };
})()`);
	if (unopened.iframeCount !== 0 || unopened.installed || unopened.hash) {
		throw new Error(
			`Shared source executed or persisted on open: ${JSON.stringify(unopened)}`,
		);
	}
	await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Inspect in zero-permission sandbox'));
  if (!(button instanceof HTMLButtonElement)) throw new Error('Shared inspect button missing');
  button.click();
  return true;
})()`);
	await waitFor("document.body.innerText.includes('shared_browser_echo')");
	await waitFor("document.querySelector('input[type=checkbox]') !== null");
	await evaluate(`(() => {
  const checkbox = document.querySelector('input[type=checkbox]');
  if (!(checkbox instanceof HTMLInputElement)) throw new Error('Shared review checkbox missing');
  checkbox.click();
  return true;
})()`);
	await waitFor(`(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Install disabled'));
  return button instanceof HTMLButtonElement && !button.disabled;
})()`);
	await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Install disabled'));
  if (!(button instanceof HTMLButtonElement)) throw new Error('Shared install button missing');
  button.click();
  return true;
})()`);
	await waitFor(
		"document.body.innerText.includes('Installed disabled. Review settings before enabling it.')",
	);
	const sharedInstalled = await evaluate<{
		enabled?: boolean;
		registry?: string;
	}>(`(async () => {
  const repositories = await import('/src/lib/db/repositories.ts');
  return {
    enabled: (await repositories.getPluginConfig('shared_browser'))?.enabled,
    registry: (await repositories.getPluginInstallation('shared_browser'))?.registry
  };
})()`);
	if (
		sharedInstalled.enabled !== false ||
		sharedInstalled.registry !== "local"
	) {
		throw new Error(
			`Shared install failed: ${JSON.stringify(sharedInstalled)}`,
		);
	}
	console.log(
		JSON.stringify(
			{
				status: "passed",
				draftToolResult: fixture.testText,
				undeclaredStorageDenied: fixture.denied,
				failedLoadCleaned: fixture.failedLoadCleaned,
				preciseRuntimeError: fixture.preciseRuntimeError,
				installation: installed,
				shareRouteDidNotAutoExecute: true,
				sharedInstallation: sharedInstalled,
			},
			null,
			2,
		),
	);
} finally {
	socket?.close();
	chrome?.kill();
	vite.kill();
	await rm(profile, { recursive: true, force: true });
}

// Bun can retain a closing CDP WebSocket after Chrome has exited.
process.exit(0);
