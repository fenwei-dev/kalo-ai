import type { Api, AssistantMessage, Message } from '@earendil-works/pi-ai';
import { app } from '$lib/context/appContext.svelte';
import { addMessage, listMessages } from '$lib/db/repositories';
import type { ContentBlock, Message as DBMessage } from '$lib/db/schema';
import { KALO_SYSTEM_PROMPT } from './systemPrompt';
import { buildModels } from './provider';
import { executeTool, toolDefs, type ToolOutcome } from './tools';

export interface ToolCallView {
	id: string;
	name: string;
	arguments: Record<string, any>;
}

export interface TurnCallbacks {
	onAssistantText?: (delta: string) => void;
	onAssistantMessage?: (msg: AssistantMessage) => void;
	onToolCall?: (call: ToolCallView) => void;
	onToolResult?: (call: ToolCallView, outcome: ToolOutcome) => void;
	onError?: (message: string) => void;
}

class AgentError extends Error {}

function ensureConfig() {
	if (!app.aiConfig) throw new AgentError('还没有配置 AI，请先去「设置」填写 API Key 和模型。');
	if (!app.aiConfig.apiKey) throw new AgentError('API Key 为空，请去「设置」配置。');
	return app.aiConfig;
}

/** DB 消息 → pi-ai Context 消息（重建必要字段，元数据用占位值） */
function dbToContextMessage(m: DBMessage): Message {
	const timestamp = m.createdAt;
	if (m.role === 'user') {
		return { role: 'user', content: m.content as any, timestamp };
	}
	if (m.role === 'toolResult') {
		return {
			role: 'toolResult',
			toolCallId: m.toolCallId ?? '',
			toolName: m.toolName ?? '',
			content: m.content as any,
			isError: !!m.isError,
			timestamp
		};
	}
	// assistant
	return {
		role: 'assistant',
		content: m.content as any,
		api: (app.aiConfig?.apiType ?? 'openai-completions') as Api,
		provider: 'kalo' as any,
		model: app.aiConfig?.model ?? 'kalo',
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: 'stop',
		timestamp
	} as Message;
}

async function buildContext(sessionId: string) {
	const history = await listMessages(sessionId);
	return {
		systemPrompt: KALO_SYSTEM_PROMPT,
		messages: history.map(dbToContextMessage),
		tools: toolDefs
	};
}

/** 把 assistant 消息的内容块存入 DB */
async function persistAssistant(sessionId: string, msg: AssistantMessage): Promise<void> {
	await addMessage({
		sessionId,
		role: 'assistant',
		content: msg.content as ContentBlock[]
	});
}

/**
 * 跑一轮对话：从 DB 重建上下文 → 流式调用模型 → 有工具调用就执行并回填 → 继续，
 * 直到模型停止工具调用。所有 assistant / toolResult 消息实时入库。
 */
export async function runTurn(
	sessionId: string,
	cb: TurnCallbacks = {},
	signal?: AbortSignal
): Promise<void> {
	let cfg: ReturnType<typeof ensureConfig>;
	try {
		cfg = ensureConfig();
	} catch (e) {
		cb.onError?.(e instanceof Error ? e.message : String(e));
		return;
	}

	const { models, model } = buildModels(cfg);

	for (let iteration = 0; iteration < 8; iteration++) {
		const context = await buildContext(sessionId);

		let stream;
		try {
			stream = models.stream(model, context, { apiKey: cfg.apiKey, signal });
		} catch (e) {
			cb.onError?.(e instanceof Error ? e.message : String(e));
			return;
		}

		let assistant: AssistantMessage | undefined;
		try {
			for await (const event of stream) {
				if (event.type === 'text_delta') cb.onAssistantText?.(event.delta);
				else if (event.type === 'error') {
					cb.onError?.(event.error?.errorMessage || '请求出错');
					return;
				} else if (event.type === 'done') {
					assistant = event.message;
				}
			}
			if (!assistant) {
				try {
					assistant = await stream.result();
				} catch (e) {
					cb.onError?.(e instanceof Error ? e.message : String(e));
					return;
				}
			}
		} catch (e) {
			const text = e instanceof Error ? e.message : String(e);
			cb.onError?.(text);
			return;
		}

		if (!assistant) {
			cb.onError?.('未收到模型响应');
			return;
		}

		await persistAssistant(sessionId, assistant);
		cb.onAssistantMessage?.(assistant);

		const toolCalls = assistant.content.filter((b): b is Extract<typeof b, { type: 'toolCall' }> => b.type === 'toolCall');
		if (toolCalls.length === 0) return; // 一轮结束

		// 执行工具并回填结果
		for (const call of toolCalls) {
			const view: ToolCallView = { id: call.id, name: call.name, arguments: call.arguments };
			cb.onToolCall?.(view);
			const outcome = await executeTool(call.name, call.arguments);
			cb.onToolResult?.(view, outcome);
			await addMessage({
				sessionId,
				role: 'toolResult',
				content: [{ type: 'text', text: JSON.stringify(outcome.data ?? outcome.error) }],
				toolCallId: call.id,
				toolName: call.name,
				isError: !outcome.ok
			});
		}
		// 继续下一轮，让模型基于工具结果继续回复
	}

	cb.onError?.('工具调用次数过多，已停止');
}
