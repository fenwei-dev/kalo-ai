import type {
	AgentTool,
	KaloPlugin,
	PluginJsonObject,
	PluginJsonValue,
	PluginManifest,
	PluginPermission,
	PluginSettingField,
	TSchema,
} from "@kalo-ai/plugin-sdk";
import { listPluginData } from "$lib/db/repositories";
import { isPluginManifest, isPluginSettings } from "./contract";
import { validatePluginNetworkUrl } from "./networkPolicy";
import { isJsonRpcValue, structuredValueSize } from "./rpcValue";
import { assertSafePluginSchema, safeCheckPluginConfig } from "./safeSchema";
import { createPluginServices } from "./services";
import { validateSandboxToolResult } from "./toolResult";

const INITIALIZE_TIMEOUT_MS = 10_000;
const RPC_TIMEOUT_MS = 30_000;
const TOOL_EXECUTION_TIMEOUT_MS = 90_000;
const TOOL_CANCEL_GRACE_MS = 2_000;
const MAX_RPC_JSON_BYTES = 1024 * 1024;
const MAX_NETWORK_RESPONSE_BYTES = 1024 * 1024;
const MAX_STORAGE_VALUE_BYTES = 64 * 1024;
const MAX_STORAGE_TOTAL_BYTES = 512 * 1024;
const MAX_STORAGE_RECORDS = 100;
const STORAGE_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;

interface SandboxToolDescriptor {
	name: string;
	label: string;
	description: string;
	parameters: TSchema;
	executionMode?: "parallel" | "sequential";
	constrainedSampling?: AgentTool["constrainedSampling"];
}

interface SandboxDescriptor {
	manifest: PluginManifest;
	configSchema: TSchema;
	defaultConfig: PluginJsonObject;
	settings?: { fields: PluginSettingField<PluginJsonObject>[] };
	supportsIsConfigured: boolean;
	supportsMigration: boolean;
}

interface SandboxRuntimeDescriptor {
	tools: SandboxToolDescriptor[];
	prompt: string;
}

interface SandboxReadyMessage {
	kind: "ready";
	descriptor: SandboxDescriptor;
}

interface SandboxResponseMessage {
	kind: "response";
	id: string;
	ok: boolean;
	value?: unknown;
	error?: string;
}

interface SandboxServiceRequest {
	kind: "service_request";
	id: string;
	service: string;
	args: unknown[];
}

type SandboxMessage =
	| SandboxReadyMessage
	| SandboxResponseMessage
	| SandboxServiceRequest;

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
	timer: ReturnType<typeof setTimeout>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializedSize(value: unknown): number {
	try {
		return structuredValueSize(value);
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

function cloneRpcValue(value: unknown): unknown {
	try {
		const cloned = JSON.parse(JSON.stringify(value));
		if (serializedSize(cloned) > MAX_RPC_JSON_BYTES) {
			throw new Error("插件 RPC 数据超过 1 MiB 限制");
		}
		return cloned;
	} catch (error) {
		if (error instanceof Error && error.message.includes("1 MiB")) throw error;
		throw new Error("插件 RPC 数据必须可 JSON 序列化", { cause: error });
	}
}

function assertRpcSize(value: unknown): void {
	if (serializedSize(value) > MAX_RPC_JSON_BYTES) {
		throw new Error("插件 RPC 数据超过 1 MiB 限制");
	}
}

function assertRuntimeString(value: unknown, path: string): void {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${path} must be a non-empty string`);
	}
}

function assertConstrainedSampling(value: unknown, path: string): void {
	if (value === undefined || value === false) return;
	if (!isRecord(value) || typeof value.type !== "string") {
		throw new Error(`${path} must be false or a supported object`);
	}
	if (value.type === "json_schema") {
		if (value.strict !== "prefer" && value.strict !== "require") {
			throw new Error(`${path}.strict must be prefer or require`);
		}
		return;
	}
	if (value.type === "grammar") {
		if (!isRecord(value.variants)) {
			throw new Error(`${path}.variants must be an object`);
		}
		for (const [name, grammar] of Object.entries(value.variants)) {
			if (
				(name !== "openai_lark" && name !== "openai_regex") ||
				typeof grammar !== "string"
			) {
				throw new Error(`${path}.variants contains an invalid grammar`);
			}
		}
		return;
	}
	throw new Error(`${path}.type must be json_schema or grammar`);
}

/** Validate the untrusted runtime envelope with field-specific diagnostics. */
export function assertValidSandboxRuntimeDescriptor(value: unknown): void {
	if (!isRecord(value)) throw new Error("runtime must be an object");
	if (!Array.isArray(value.tools)) {
		throw new Error("runtime.tools must be an array");
	}
	if (typeof value.prompt !== "string") {
		throw new Error("runtime.prompt must be a string");
	}
	for (const [index, tool] of value.tools.entries()) {
		const path = `runtime.tools[${index}]`;
		if (!isRecord(tool)) throw new Error(`${path} must be an object`);
		assertRuntimeString(tool.name, `${path}.name`);
		assertRuntimeString(tool.label, `${path}.label`);
		assertRuntimeString(tool.description, `${path}.description`);
		if (!isRecord(tool.parameters)) {
			throw new Error(`${path}.parameters must be a JSON Schema object`);
		}
		if (
			tool.executionMode !== undefined &&
			tool.executionMode !== "parallel" &&
			tool.executionMode !== "sequential"
		) {
			throw new Error(`${path}.executionMode must be parallel or sequential`);
		}
		assertConstrainedSampling(
			tool.constrainedSampling,
			`${path}.constrainedSampling`,
		);
		try {
			assertSafePluginSchema(tool.parameters);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`${path}.parameters is not a safe schema: ${message}`);
		}
	}
}

function validatedStorageKey(value: unknown): string {
	if (typeof value !== "string" || !STORAGE_KEY_PATTERN.test(value)) {
		throw new Error("插件存储 key 必须是 1–100 位字母、数字、点、横线或下划线");
	}
	return value;
}

const SANDBOX_FRAME_HTML = `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; style-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; navigate-to 'none'">
<script>
addEventListener("message", function connect(event) {
  if (!event.data || event.data.type !== "kalo-sandbox-connect" || !event.data.rpcPort || !event.data.controlPort) return;
  const rpcPort = event.data.rpcPort;
  const controlPort = event.data.controlPort;
  let worker;
  try {
    const workerUrl = URL.createObjectURL(new Blob([event.data.workerSource], { type: "text/javascript" }));
    worker = new Worker(workerUrl, { name: "kalo-plugin-sandbox" });
    setTimeout(() => URL.revokeObjectURL(workerUrl), 1000);
    worker.onerror = function (error) {
      controlPort.postMessage({ type: "worker_error", error: error.message || "Sandbox worker failed" });
    };
    worker.onmessageerror = function () {
      controlPort.postMessage({ type: "worker_error", error: "Sandbox worker message failed" });
    };
    worker.postMessage({ type: "connect", source: event.data.pluginSource, debugName: event.data.debugName, rpcPort }, [rpcPort]);
  } catch (error) {
    controlPort.postMessage({ type: "worker_error", error: error instanceof Error ? error.message : String(error) });
    return;
  }
  controlPort.onmessage = function (message) {
    if (message.data && message.data.type === "terminate") worker?.terminate();
  };
  controlPort.start();
}, { once: true });
</script>`;

const SANDBOX_WORKER_SOURCE = String.raw`
let rpcPort;
let sendRpc;
let startRpc;
let plugin;
let activeTools = new Map();
const serviceRequests = new Map();
const toolControllers = new Map();
let nextServiceId = 0;
const nativeJsonStringify = JSON.stringify.bind(JSON);
const nativeJsonParse = JSON.parse.bind(JSON);
const nativeDefineProperty = Object.defineProperty.bind(Object);
const nativeGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor.bind(Object);
const nativeGetPrototypeOf = Object.getPrototypeOf.bind(Object);
const nativeReflectGet = Reflect.get.bind(Reflect);

const blockedWorkerGlobals = [
  "BroadcastChannel",
  "EventSource",
  "RTCPeerConnection",
  "SharedWorker",
  "WebSocket",
  "WebSocketStream",
  "WebTransport",
  "Worker",
  "XMLHttpRequest",
  "caches",
  "cookieStore",
  "fetch",
  "importScripts",
  "indexedDB",
  "postMessage",
  "webkitRTCPeerConnection"
];

const blockedNavigatorCapabilities = [
  "bluetooth",
  "clipboard",
  "credentials",
  "geolocation",
  "gpu",
  "hid",
  "keyboard",
  "locks",
  "mediaDevices",
  "permissions",
  "serial",
  "serviceWorker",
  "storage",
  "usb",
  "wakeLock"
];

function lockProperty(root, name, label) {
  let current = root;
  let found = false;
  const visited = new Set();
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    const descriptor = nativeGetOwnPropertyDescriptor(current, name);
    if (descriptor) {
      found = true;
      if (descriptor.configurable) {
        nativeDefineProperty(current, name, {
          value: undefined,
          writable: false,
          enumerable: descriptor.enumerable,
          configurable: false
        });
      } else if ("value" in descriptor && descriptor.writable) {
        nativeDefineProperty(current, name, {
          ...descriptor,
          value: undefined,
          writable: false
        });
      } else {
        let value;
        try {
          value = nativeReflectGet(current, name, root);
        } catch {
          value = undefined;
        }
        if (value !== undefined) {
          throw new Error("Cannot lock sandbox capability: " + label);
        }
      }
    }
    current = nativeGetPrototypeOf(current);
  }

  if (!found) return;
  const ownDescriptor = nativeGetOwnPropertyDescriptor(root, name);
  if (!ownDescriptor) {
    nativeDefineProperty(root, name, {
      value: undefined,
      writable: false,
      enumerable: false,
      configurable: false
    });
  }
  let exposed;
  try {
    exposed = nativeReflectGet(root, name);
  } catch {
    exposed = undefined;
  }
  if (exposed !== undefined) {
    throw new Error("Sandbox capability remains available: " + label);
  }
}

function lockDownDirectCapabilities() {
  for (const name of blockedWorkerGlobals) {
    lockProperty(globalThis, name, "globalThis." + name);
  }
  if (typeof navigator === "object" && navigator !== null) {
    for (const name of blockedNavigatorCapabilities) {
      lockProperty(navigator, name, "navigator." + name);
    }
  }
}

function cloneJson(value, label) {
  try {
    return nativeJsonParse(nativeJsonStringify(value));
  } catch (error) {
    throw new Error(label + " must be JSON serializable: " + String(error));
  }
}

function requireToolString(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(path + " must be a non-empty string");
  }
}

function validateToolConstrainedSampling(value, path) {
  if (value === undefined || value === false) return;
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.type !== "string") {
    throw new Error(path + " must be false or a supported object");
  }
  if (value.type === "json_schema") {
    if (value.strict !== "prefer" && value.strict !== "require") {
      throw new Error(path + ".strict must be prefer or require");
    }
    return;
  }
  if (value.type === "grammar") {
    if (!value.variants || typeof value.variants !== "object" || Array.isArray(value.variants)) {
      throw new Error(path + ".variants must be an object");
    }
    for (const [name, grammar] of Object.entries(value.variants)) {
      if ((name !== "openai_lark" && name !== "openai_regex") || typeof grammar !== "string") {
        throw new Error(path + ".variants contains an invalid grammar");
      }
    }
    return;
  }
  throw new Error(path + ".type must be json_schema or grammar");
}

function validateRuntimeTool(tool, index) {
  const path = "createTools()[" + index + "]";
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
    throw new Error(path + " must be an object");
  }
  requireToolString(tool.name, path + ".name");
  requireToolString(tool.label, path + ".label");
  requireToolString(tool.description, path + ".description");
  if (!tool.parameters || typeof tool.parameters !== "object" || Array.isArray(tool.parameters)) {
    throw new Error(path + ".parameters must be a JSON Schema object");
  }
  if (tool.executionMode !== undefined && tool.executionMode !== "parallel" && tool.executionMode !== "sequential") {
    throw new Error(path + ".executionMode must be parallel or sequential");
  }
  validateToolConstrainedSampling(tool.constrainedSampling, path + ".constrainedSampling");
  if (typeof tool.execute !== "function") {
    throw new Error(path + ".execute must be a function");
  }
}

function asPlugin(module) {
  if (!module || typeof module !== "object") throw new Error("Invalid ESM plugin module");
  const candidate = module.kaloPlugin ?? module.default;
  if (!candidate || typeof candidate !== "object") throw new Error("Missing default or kaloPlugin export");
  if (!candidate.manifest || !candidate.configSchema || !candidate.defaultConfig || typeof candidate.createTools !== "function") {
    throw new Error("Invalid Kalo plugin export");
  }
  return candidate;
}

function callService(service, args) {
  return new Promise((resolve, reject) => {
    const id = "service_" + (++nextServiceId);
    serviceRequests.set(id, { resolve, reject });
    sendRpc({ kind: "service_request", id, service, args: cloneJson(args, "Service arguments") });
  });
}

function services() {
  return {
    profile: { get: () => callService("profile.get", []) },
    logs: { getDay: (date) => callService("logs.getDay", [date]) },
    storage: {
      get: (key) => callService("storage.get", [key]),
      set: (key, value) => callService("storage.set", [key, value]),
      delete: (key) => callService("storage.delete", [key])
    },
    fetch: async (input, init) => {
      const result = await callService("network.fetch", [String(input), init ?? {}]);
      return new Response(result.body, {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers
      });
    }
  };
}

function descriptor(candidate) {
  return cloneJson({
    manifest: candidate.manifest,
    configSchema: candidate.configSchema,
    defaultConfig: candidate.defaultConfig,
    settings: candidate.settings,
    supportsIsConfigured: typeof candidate.isConfigured === "function",
    supportsMigration: typeof candidate.migrateConfig === "function"
  }, "Plugin descriptor");
}

async function initialize(source, debugName) {
  const suffix = String(debugName || "plugin.js").replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 120);
  const url = URL.createObjectURL(new Blob([source + "\n//# sourceURL=kalo-sandbox:" + suffix + "\n"], { type: "text/javascript" }));
  try {
    lockDownDirectCapabilities();
    plugin = asPlugin(await import(url));
    sendRpc({ kind: "ready", descriptor: descriptor(plugin) });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function handleRequest(message) {
  const payload = message.payload || {};
  if (message.method === "isConfigured") {
    return typeof plugin.isConfigured === "function" ? !!(await plugin.isConfigured(payload.config)) : true;
  }
  if (message.method === "migrateConfig") {
    if (typeof plugin.migrateConfig !== "function") throw new Error("Plugin does not support migration");
    return cloneJson(await plugin.migrateConfig(payload.config, payload.fromVersion), "Migrated config");
  }
  if (message.method === "runtime") {
    const context = { config: payload.config, locale: payload.locale, services: services() };
    const tools = await plugin.createTools(context);
    if (!Array.isArray(tools)) throw new Error("createTools must return an array");
    activeTools = new Map();
    const toolDescriptors = tools.map((tool, index) => {
      validateRuntimeTool(tool, index);
      activeTools.set(tool.name, tool);
      return cloneJson({
        name: tool.name,
        label: tool.label,
        description: tool.description,
        parameters: tool.parameters,
        executionMode: tool.executionMode,
        constrainedSampling: tool.constrainedSampling
      }, "Tool descriptor");
    });
    const prompt = typeof plugin.systemPrompt === "function" ? await plugin.systemPrompt(context) : "";
    if (typeof prompt !== "string") throw new Error("systemPrompt must return a string");
    return { tools: toolDescriptors, prompt };
  }
  if (message.method === "executeTool") {
    const tool = activeTools.get(payload.name);
    if (!tool) throw new Error("Tool not initialized: " + String(payload.name));
    const controller = new AbortController();
    toolControllers.set(payload.toolCallId, controller);
    try {
      return cloneJson(await tool.execute(payload.toolCallId, payload.params, controller.signal), "Tool result");
    } finally {
      toolControllers.delete(payload.toolCallId);
    }
  }
  if (message.method === "cancelTool") {
    toolControllers.get(payload.toolCallId)?.abort();
    return null;
  }
  throw new Error("Unknown sandbox method: " + String(message.method));
}

addEventListener("message", async (event) => {
  if (!event.data || event.data.type !== "connect" || !event.data.rpcPort) return;
  rpcPort = event.data.rpcPort;
  sendRpc = rpcPort.postMessage.bind(rpcPort);
  startRpc = rpcPort.start.bind(rpcPort);
  Object.freeze(MessagePort.prototype);
  rpcPort.onmessage = async (rpcEvent) => {
    const message = rpcEvent.data;
    if (!message || typeof message !== "object") return;
    if (message.kind === "service_response") {
      const pending = serviceRequests.get(message.id);
      if (!pending) return;
      serviceRequests.delete(message.id);
      if (message.ok) pending.resolve(message.value);
      else pending.reject(new Error(message.error || "Service failed"));
      return;
    }
    if (message.kind !== "request") return;
    try {
      const value = await handleRequest(message);
      sendRpc({ kind: "response", id: message.id, ok: true, value });
    } catch (error) {
      sendRpc({ kind: "response", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  startRpc();
  try {
    await initialize(event.data.source, event.data.debugName);
  } catch (error) {
    sendRpc({ kind: "response", id: "initialize", ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}, { once: true });
`;

export function isUnverifiedWebKitSandbox(userAgent: string): boolean {
	const webKit = /AppleWebKit/i.test(userAgent);
	const iOS =
		/iP(?:hone|ad|od)/i.test(userAgent) ||
		(/Macintosh/i.test(userAgent) && /Mobile/i.test(userAgent));
	const chromium = /(?:Chrome|Chromium|Edg|OPR)\//i.test(userAgent);
	return webKit && (iOS || !chromium);
}

export class SandboxPluginClient {
	readonly descriptor: SandboxDescriptor;
	readonly proxyPlugin: KaloPlugin;
	readonly #iframe: HTMLIFrameElement;
	readonly #rpcPort: MessagePort;
	readonly #controlPort: MessagePort;
	readonly #pending = new Map<string, PendingRequest>();
	readonly #grantedPermissions: ReadonlySet<PluginPermission>;
	#nextRequestId = 0;
	#disposed = false;

	get disposed(): boolean {
		return this.#disposed;
	}

	permissionsMatch(permissions: readonly PluginPermission[]): boolean {
		const expected = new Set(permissions);
		return (
			expected.size === this.#grantedPermissions.size &&
			[...expected].every((permission) =>
				this.#grantedPermissions.has(permission),
			)
		);
	}

	private constructor(
		descriptor: SandboxDescriptor,
		iframe: HTMLIFrameElement,
		rpcPort: MessagePort,
		controlPort: MessagePort,
		grantedPermissions?: readonly PluginPermission[],
	) {
		this.descriptor = descriptor;
		this.#grantedPermissions = new Set(grantedPermissions ?? []);
		this.#iframe = iframe;
		this.#rpcPort = rpcPort;
		this.#controlPort = controlPort;
		this.#controlPort.onmessage = (event) => {
			if (event.data?.type === "worker_error") this.dispose();
		};
		this.#controlPort.start();
		this.proxyPlugin = {
			manifest: descriptor.manifest,
			configSchema: descriptor.configSchema,
			defaultConfig: descriptor.defaultConfig,
			settings: descriptor.settings,
			validateConfig: (config) =>
				safeCheckPluginConfig(descriptor.configSchema, config),
			isConfigured: () => {
				throw new Error(
					"Sandbox isConfigured must be awaited through the manager",
				);
			},
			createTools: () => {
				throw new Error("Sandbox tools must be created asynchronously");
			},
			systemPrompt: () => {
				throw new Error("Sandbox prompt must be created asynchronously");
			},
			migrateConfig: descriptor.supportsMigration
				? () => {
						throw new Error(
							"Sandbox migration must be awaited through the manager",
						);
					}
				: undefined,
		};
	}

	static async create(
		source: string,
		debugName: string,
		grantedPermissions: readonly PluginPermission[] = [],
	): Promise<SandboxPluginClient> {
		if (typeof document === "undefined") {
			throw new Error("用户插件沙箱只能在浏览器中启动");
		}
		if (isUnverifiedWebKitSandbox(navigator.userAgent)) {
			throw new Error(
				"Safari/WebKit 的插件网络隔离尚未完成真机验证，当前已安全禁用用户插件",
			);
		}
		const iframe = document.createElement("iframe");
		iframe.hidden = true;
		iframe.tabIndex = -1;
		iframe.setAttribute("aria-hidden", "true");
		iframe.setAttribute("sandbox", "allow-scripts");
		iframe.srcdoc = SANDBOX_FRAME_HTML;
		document.body.appendChild(iframe);
		try {
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(
					() => reject(new Error("创建插件沙箱超时")),
					INITIALIZE_TIMEOUT_MS,
				);
				iframe.addEventListener(
					"load",
					() => {
						clearTimeout(timer);
						resolve();
					},
					{ once: true },
				);
			});
		} catch (error) {
			iframe.remove();
			throw error;
		}
		const rpcChannel = new MessageChannel();
		const controlChannel = new MessageChannel();
		let descriptor: SandboxDescriptor;
		try {
			descriptor = await new Promise<SandboxDescriptor>((resolve, reject) => {
				const timer = setTimeout(() => {
					reject(new Error("初始化插件沙箱超时"));
				}, INITIALIZE_TIMEOUT_MS);
				rpcChannel.port1.onmessage = (event: MessageEvent<SandboxMessage>) => {
					const message = event.data;
					if (message.kind === "ready") {
						clearTimeout(timer);
						resolve(message.descriptor);
					} else if (
						message.kind === "response" &&
						message.id === "initialize" &&
						!message.ok
					) {
						clearTimeout(timer);
						reject(new Error(message.error ?? "插件初始化失败"));
					}
				};
				controlChannel.port1.onmessage = (event) => {
					if (event.data?.type === "worker_error") {
						clearTimeout(timer);
						reject(new Error(event.data.error ?? "插件 Worker 启动失败"));
					}
				};
				controlChannel.port1.start();
				rpcChannel.port1.start();
				iframe.contentWindow?.postMessage(
					{
						type: "kalo-sandbox-connect",
						workerSource: SANDBOX_WORKER_SOURCE,
						pluginSource: source,
						debugName,
						rpcPort: rpcChannel.port2,
						controlPort: controlChannel.port2,
					},
					"*",
					[rpcChannel.port2, controlChannel.port2],
				);
			});
		} catch (error) {
			controlChannel.port1.postMessage({ type: "terminate" });
			rpcChannel.port1.close();
			controlChannel.port1.close();
			iframe.remove();
			throw error;
		}
		try {
			if (
				!isPluginManifest(descriptor.manifest) ||
				!isRecord(descriptor.configSchema) ||
				!isRecord(descriptor.defaultConfig) ||
				!isPluginSettings(descriptor.settings) ||
				serializedSize(descriptor) > MAX_RPC_JSON_BYTES
			) {
				throw new Error("插件沙箱返回了无效 descriptor");
			}
			assertSafePluginSchema(descriptor.configSchema);
			if (
				!safeCheckPluginConfig(
					descriptor.configSchema,
					descriptor.defaultConfig,
				)
			) {
				throw new Error("插件默认配置不符合安全 schema");
			}
		} catch (error) {
			controlChannel.port1.postMessage({ type: "terminate" });
			rpcChannel.port1.close();
			controlChannel.port1.close();
			iframe.remove();
			throw error;
		}
		const client = new SandboxPluginClient(
			descriptor,
			iframe,
			rpcChannel.port1,
			controlChannel.port1,
			grantedPermissions,
		);
		client.#rpcPort.onmessage = (event: MessageEvent<SandboxMessage>) => {
			void client.#handleMessage(event.data);
		};
		return client;
	}

	async isConfigured(config: PluginJsonObject): Promise<boolean> {
		return (await this.#request("isConfigured", { config })) === true;
	}

	async migrateConfig(
		config: PluginJsonObject,
		fromVersion: number,
	): Promise<PluginJsonObject> {
		const value = await this.#request("migrateConfig", {
			config,
			fromVersion,
		});
		if (!isRecord(value)) throw new Error("插件迁移返回了无效配置");
		return value as PluginJsonObject;
	}

	async runtime(
		config: PluginJsonObject,
		locale: "zh-cn" | "en-us",
	): Promise<SandboxRuntimeDescriptor> {
		const value = await this.#request("runtime", { config, locale });
		assertValidSandboxRuntimeDescriptor(value);
		return value as SandboxRuntimeDescriptor;
	}

	createToolProxy(
		descriptor: SandboxToolDescriptor,
		onError?: (error: unknown) => void,
	): AgentTool {
		return {
			name: descriptor.name,
			label: descriptor.label,
			description: descriptor.description,
			parameters: descriptor.parameters,
			executionMode: descriptor.executionMode,
			constrainedSampling: descriptor.constrainedSampling,
			execute: async (toolCallId, params, signal) => {
				if (signal?.aborted) throw new Error("Request cancelled");
				const abort = () => {
					void this.#request("cancelTool", { toolCallId }).catch(
						() => undefined,
					);
				};
				signal?.addEventListener("abort", abort, { once: true });
				try {
					const value = await this.#request(
						"executeTool",
						{
							toolCallId,
							name: descriptor.name,
							params,
						},
						{
							timeoutMs: TOOL_EXECUTION_TIMEOUT_MS,
							cancelToolCallId: toolCallId,
						},
					);
					return validateSandboxToolResult(value);
				} catch (error) {
					onError?.(error);
					throw error;
				} finally {
					signal?.removeEventListener("abort", abort);
				}
			},
		};
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#controlPort.postMessage({ type: "terminate" });
		this.#rpcPort.close();
		this.#controlPort.close();
		this.#iframe.remove();
		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new Error("插件沙箱已关闭"));
		}
		this.#pending.clear();
	}

	async #request(
		method: string,
		payload: unknown,
		options: { timeoutMs?: number; cancelToolCallId?: string } = {},
	): Promise<unknown> {
		if (this.#disposed) throw new Error("插件沙箱已关闭");
		const safePayload = cloneRpcValue(payload);
		const id = `request_${++this.#nextRequestId}`;
		return new Promise((resolve, reject) => {
			const fail = () => {
				this.#pending.delete(id);
				this.dispose();
				reject(new Error(`插件沙箱调用超时：${method}`));
			};
			const pending: PendingRequest = {
				resolve,
				reject,
				timer: setTimeout(() => {
					if (!options.cancelToolCallId) {
						fail();
						return;
					}
					this.#rpcPort.postMessage({
						kind: "request",
						id: `cancel_${id}`,
						method: "cancelTool",
						payload: { toolCallId: options.cancelToolCallId },
					});
					pending.timer = setTimeout(fail, TOOL_CANCEL_GRACE_MS);
				}, options.timeoutMs ?? RPC_TIMEOUT_MS),
			};
			this.#pending.set(id, pending);
			this.#rpcPort.postMessage({
				kind: "request",
				id,
				method,
				payload: safePayload,
			});
		});
	}

	async #handleMessage(message: SandboxMessage): Promise<void> {
		if (message.kind === "response") {
			const pending = this.#pending.get(message.id);
			if (!pending) return;
			this.#pending.delete(message.id);
			clearTimeout(pending.timer);
			if (message.ok) {
				if (serializedSize(message.value) > MAX_RPC_JSON_BYTES) {
					pending.reject(new Error("插件 RPC 响应超过 1 MiB 限制"));
				} else {
					pending.resolve(message.value);
				}
			} else {
				pending.reject(new Error(message.error ?? "插件沙箱调用失败"));
			}
			return;
		}
		if (message.kind !== "service_request") return;
		try {
			if (!Array.isArray(message.args) || !isJsonRpcValue(message.args)) {
				throw new Error("插件 service 参数必须是 JSON 数据");
			}
			assertRpcSize(message.args);
			const value = await this.#executeService(message.service, message.args);
			assertRpcSize(value);
			this.#rpcPort.postMessage({
				kind: "service_response",
				id: message.id,
				ok: true,
				value,
			});
		} catch (error) {
			this.#rpcPort.postMessage({
				kind: "service_response",
				id: message.id,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	async #executeService(service: string, args: unknown[]): Promise<unknown> {
		const permissions = this.#grantedPermissions;
		const services = createPluginServices(this.descriptor.manifest.id);
		if (service === "profile.get") {
			if (!permissions.has("profile.read"))
				throw new Error("插件未获 profile.read 权限");
			return services.profile.get();
		}
		if (service === "logs.getDay") {
			if (!permissions.has("logs.read"))
				throw new Error("插件未获 logs.read 权限");
			if (typeof args[0] !== "string") throw new Error("日期参数无效");
			return services.logs.getDay(args[0]);
		}
		if (service === "storage.get") {
			if (!permissions.has("storage")) throw new Error("插件未获 storage 权限");
			return services.storage.get(validatedStorageKey(args[0]));
		}
		if (service === "storage.set") {
			if (!permissions.has("storage")) throw new Error("插件未获 storage 权限");
			const key = validatedStorageKey(args[0]);
			if (serializedSize(args[1]) > MAX_STORAGE_VALUE_BYTES) {
				throw new Error("插件单个存储值不能超过 64 KiB");
			}
			const records = await listPluginData(this.descriptor.manifest.id);
			const otherRecords = records.filter((record) => record.key !== key);
			if (otherRecords.length >= MAX_STORAGE_RECORDS) {
				throw new Error("插件存储最多允许 100 个 key");
			}
			const totalBytes =
				otherRecords.reduce(
					(total, record) =>
						total +
						serializedSize(record.value) +
						new TextEncoder().encode(record.key).byteLength,
					0,
				) +
				serializedSize(args[1]) +
				new TextEncoder().encode(key).byteLength;
			if (totalBytes > MAX_STORAGE_TOTAL_BYTES) {
				throw new Error("插件存储总量不能超过 512 KiB");
			}
			await services.storage.set(key, args[1] as PluginJsonValue);
			return null;
		}
		if (service === "storage.delete") {
			if (!permissions.has("storage")) throw new Error("插件未获 storage 权限");
			await services.storage.delete(validatedStorageKey(args[0]));
			return null;
		}
		if (service === "network.fetch") {
			if (!permissions.has("network")) throw new Error("插件未获 network 权限");
			const url = validatePluginNetworkUrl(args[0], location.origin);
			const init = isRecord(args[1]) ? args[1] : {};
			const response = await fetch(url, {
				method: typeof init.method === "string" ? init.method : "GET",
				headers: isRecord(init.headers)
					? Object.fromEntries(
							Object.entries(init.headers).filter(
								(entry): entry is [string, string] =>
									typeof entry[1] === "string",
							),
						)
					: undefined,
				body: typeof init.body === "string" ? init.body : undefined,
				credentials: "omit",
				redirect: "follow",
				signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
			});
			const finalUrl = validatePluginNetworkUrl(response.url, location.origin);
			if (finalUrl.origin !== url.origin) {
				throw new Error("插件网络请求不允许跨 origin 重定向");
			}
			const declaredLength = Number(
				response.headers.get("content-length") ?? 0,
			);
			if (declaredLength > MAX_NETWORK_RESPONSE_BYTES) {
				throw new Error("插件网络响应超过 1 MiB 限制");
			}
			const body = await response.arrayBuffer();
			if (body.byteLength > MAX_NETWORK_RESPONSE_BYTES) {
				throw new Error("插件网络响应超过 1 MiB 限制");
			}
			return {
				status: response.status,
				statusText: response.statusText,
				headers: [...response.headers.entries()],
				body,
			};
		}
		throw new Error(`未知插件 service：${service}`);
	}
}
