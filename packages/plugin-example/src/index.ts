import { type AgentTool, definePlugin, Type } from "@kalo-ai/plugin-sdk";

const configSchema = Type.Object({
	prefix: Type.String({ minLength: 1, maxLength: 40 }),
	apiKey: Type.String({ maxLength: 100 }),
	repeatCount: Type.Integer({ minimum: 1, maximum: 5 }),
	mode: Type.Union([Type.Literal("plain"), Type.Literal("bracketed")]),
	uppercase: Type.Boolean(),
});

const echoParameters = Type.Object({
	text: Type.String({ minLength: 1, maxLength: 500 }),
});

export const examplePlugin = definePlugin({
	manifest: {
		id: "example",
		apiVersion: 1,
		version: "0.1.0",
		configVersion: 2,
		name: {
			"zh-cn": "示例插件",
			"en-us": "Example plugin",
		},
		description: {
			"zh-cn": "验证插件配置、Agent 工具和 System Prompt 扩展。",
			"en-us":
				"Demonstrates plugin settings, Agent tools, and prompt extensions.",
		},
		defaultEnabled: false,
	},
	configSchema,
	defaultConfig: {
		prefix: "Kalo plugin",
		apiKey: "",
		repeatCount: 1,
		mode: "plain",
		uppercase: false,
	},
	settings: {
		fields: [
			{
				key: "prefix",
				type: "text",
				label: { "zh-cn": "回复前缀", "en-us": "Echo prefix" },
				description: {
					"zh-cn": "example_echo 返回文字时使用的前缀。",
					"en-us": "Prefix used when example_echo returns text.",
				},
			},
			{
				key: "apiKey",
				type: "password",
				secret: true,
				label: { "zh-cn": "测试密钥", "en-us": "Test secret" },
				description: {
					"zh-cn": "仅用于测试 password 字段；工具不会返回这个值。",
					"en-us":
						"Tests the password field; the tool never returns this value.",
				},
			},
			{
				key: "repeatCount",
				type: "number",
				min: 1,
				max: 5,
				step: 1,
				label: { "zh-cn": "重复次数", "en-us": "Repeat count" },
			},
			{
				key: "mode",
				type: "select",
				label: { "zh-cn": "输出模式", "en-us": "Output mode" },
				options: [
					{
						value: "plain",
						label: { "zh-cn": "普通", "en-us": "Plain" },
					},
					{
						value: "bracketed",
						label: { "zh-cn": "方括号", "en-us": "Bracketed" },
					},
				],
			},
			{
				key: "uppercase",
				type: "toggle",
				label: { "zh-cn": "转换为大写", "en-us": "Convert to uppercase" },
			},
		],
	},
	isConfigured: (config) => config.prefix.trim().length > 0,
	createTools: (context) => {
		const echoTool: AgentTool<typeof echoParameters> = {
			name: "example_echo",
			label: "Example echo",
			description:
				"Echo text through the enabled example plugin. Use only when the user explicitly asks to test or use the example plugin.",
			parameters: echoParameters,
			executionMode: "parallel",
			execute: async (_toolCallId, params, signal) => {
				if (signal?.aborted) throw new Error("Request cancelled");
				const transformed = context.config.uppercase
					? params.text.toUpperCase()
					: params.text;
				const source =
					context.config.mode === "bracketed"
						? `[${transformed}]`
						: transformed;
				const repeated = Array.from(
					{ length: context.config.repeatCount },
					() => source,
				).join(" ");
				const echoed = `${context.config.prefix}: ${repeated}`;
				return {
					content: [{ type: "text", text: JSON.stringify({ echoed }) }],
					details: { ok: true, data: { echoed } },
				};
			},
		};
		return [echoTool];
	},
	migrateConfig: (config, fromVersion) =>
		fromVersion < 2
			? {
					...config,
					apiKey: typeof config.apiKey === "string" ? config.apiKey : "",
					repeatCount:
						typeof config.repeatCount === "number" ? config.repeatCount : 1,
					mode:
						config.mode === "bracketed" || config.mode === "plain"
							? config.mode
							: "plain",
				}
			: config,
	systemPrompt: ({ locale }) =>
		locale === "en-us"
			? "The example_echo tool is only for explicit plugin testing requests. Never call it proactively."
			: "example_echo 工具只用于用户明确提出的插件测试请求，不得主动调用。",
});
