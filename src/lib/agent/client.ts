import { Agent, type AgentMessage, type AgentToolResult } from '@earendil-works/pi-agent-core';
import type { Api, AssistantMessage, Message, ToolResultMessage } from '@earendil-works/pi-ai';
import { app } from '$lib/context/appContext.svelte';
import { addMessage, listMessages, markSessionMemoryVersion } from '$lib/db/repositories';
import type { ContentBlock, Message as DBMessage } from '$lib/db/schema';
import { getKaloSystemPrompt } from './systemPrompt';
import { getLocale } from '$lib/paraglide/runtime';
import { buildModels } from './provider';
import { localMessageTimestamp } from '$lib/utils/date';
import { agentTools, type ToolOutcome } from './tools';

const MODEL_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export interface ToolCallView {
	id: string;
	name: string;
	arguments: Record<string, any>;
}

export interface TurnCallbacks {
	onAssistantText?: (delta: string) => void;
	onAssistantMessage?: (msg: AssistantMessage) => void;
	/** Called after a completed assistant or tool-result message has been persisted. */
	onMessagesChanged?: () => void | Promise<void>;
	onToolCall?: (call: ToolCallView) => void;
	onToolResult?: (call: ToolCallView, outcome: ToolOutcome) => void;
	onError?: (message: string) => void;
}

function ensureConfig() {
	if (!app.aiConfig) throw new Error('还没有配置 AI，请先去「设置」填写 API Key 和模型。');
	if (!app.aiConfig.apiKey) throw new Error('API Key 为空，请去「设置」配置。');
	return app.aiConfig;
}

/** DB messages are rehydrated into the metadata-rich messages expected by pi-agent-core. */
function dbToAgentMessage(message: DBMessage): Message {
	const timestamp = message.createdAt;
	if (message.role === 'user') {
		const sentAt = message.localTimestamp ?? localMessageTimestamp(new Date(timestamp));
		let timestampAdded = false;
		const content = message.content.map((block) => {
			if (block.type !== 'text' || timestampAdded) return block;
			timestampAdded = true;
			return { ...block, text: `[Message sent at ${sentAt} local time]\n${block.text}` };
		});
		if (!timestampAdded) {
			content.unshift({
				type: 'text',
				text: `[Message sent at ${sentAt} local time]\n[User attached an image without text.]`
			});
		}
		return { role: 'user', content: content as any, timestamp };
	}
	if (message.role === 'toolResult') {
		return {
			role: 'toolResult',
			toolCallId: message.toolCallId ?? '',
			toolName: message.toolName ?? '',
			content: message.content as any,
			isError: !!message.isError,
			timestamp
		};
	}
	return {
		role: 'assistant',
		content: message.content as any,
		api: (app.aiConfig?.apiType ?? 'openai-completions') as Api,
		provider: 'kalo',
		model: app.aiConfig?.model ?? 'kalo',
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
		},
		stopReason: 'stop',
		timestamp
	};
}

async function persistAssistant(sessionId: string, message: AssistantMessage): Promise<void> {
	await addMessage({
		sessionId,
		role: 'assistant',
		content: message.content as ContentBlock[]
	});
}

async function persistToolResult(sessionId: string, message: ToolResultMessage): Promise<void> {
	await addMessage({
		sessionId,
		role: 'toolResult',
		content: message.content as ContentBlock[],
		toolCallId: message.toolCallId,
		toolName: message.toolName,
		isError: message.isError
	});
	if (!message.isError && (message.toolName === 'readUserMemory' || message.toolName === 'updateUserMemory')) {
		const text = message.content
			.filter((block) => block.type === 'text')
			.map((block) => block.text)
			.join('');
		try {
			const result = JSON.parse(text) as { version?: unknown };
			if (typeof result.version === 'number') await markSessionMemoryVersion(sessionId, result.version);
		} catch {
			// A malformed memory result should remain visible, but must not advance the session snapshot.
		}
	}
}

function outcomeFromResult(result: AgentToolResult<unknown>, isError: boolean): ToolOutcome {
	const details = result.details;
	if (
		details &&
		typeof details === 'object' &&
		'ok' in details &&
		typeof (details as ToolOutcome).ok === 'boolean'
	) {
		return details as ToolOutcome;
	}
	const text = result.content
		.filter((block) => block.type === 'text')
		.map((block) => block.text)
		.join('\n');
	return isError
		? { ok: false, data: null, error: text || '工具执行失败' }
		: { ok: true, data: details ?? text };
}

/**
 * Continue from the user message already persisted by the UI. pi-agent-core owns the
 * model/tool loop and emits ordered lifecycle events; this adapter persists completed
 * assistant and tool-result messages into Dexie.
 */
export async function runTurn(
	sessionId: string,
	cb: TurnCallbacks = {},
	signal?: AbortSignal
): Promise<void> {
	let cfg: ReturnType<typeof ensureConfig>;
	try {
		cfg = ensureConfig();
	} catch (error) {
		cb.onError?.(error instanceof Error ? error.message : String(error));
		return;
	}

	const history = await listMessages(sessionId);
	if (history.length === 0) {
		cb.onError?.('没有可处理的用户消息');
		return;
	}

	const { models, model } = buildModels(cfg);
	let toolTurnCount = 0;
	const agent = new Agent({
		initialState: {
			systemPrompt: getKaloSystemPrompt(getLocale()),
			model,
			tools: agentTools,
			messages: history.map(dbToAgentMessage) as AgentMessage[]
		},
		streamFn: (activeModel, context, options) =>
			models.streamSimple(activeModel, context, {
				...options,
				timeoutMs: options?.timeoutMs ?? MODEL_REQUEST_TIMEOUT_MS,
				maxRetryDelayMs: options?.maxRetryDelayMs ?? 60_000
			}),
		getApiKey: () => cfg.apiKey,
		sessionId,
		toolExecution: 'sequential',
		prepareNextTurnWithContext: ({ toolResults }) => {
			if (toolResults.length > 0 && ++toolTurnCount >= 8) {
				throw new Error('工具调用次数过多，已停止');
			}
			return undefined;
		}
	});

	let reportedError = '';
	const unsubscribe = agent.subscribe(async (event) => {
		switch (event.type) {
			case 'message_update':
				if (event.assistantMessageEvent.type === 'text_delta') {
					cb.onAssistantText?.(event.assistantMessageEvent.delta);
				}
				break;

			case 'message_end':
				if (event.message.role === 'assistant') {
					if (event.message.errorMessage) {
						reportedError = event.message.errorMessage;
						break;
					}
					await persistAssistant(sessionId, event.message);
					await cb.onMessagesChanged?.();
					cb.onAssistantMessage?.(event.message);
				} else if (event.message.role === 'toolResult') {
					await persistToolResult(sessionId, event.message);
					await cb.onMessagesChanged?.();
				}
				break;

			case 'tool_execution_start':
				cb.onToolCall?.({
					id: event.toolCallId,
					name: event.toolName,
					arguments: event.args
				});
				break;

			case 'tool_execution_end':
				cb.onToolResult?.(
					{ id: event.toolCallId, name: event.toolName, arguments: {} },
					outcomeFromResult(event.result, event.isError)
				);
				break;

			case 'agent_end':
				if (agent.state.errorMessage) reportedError = agent.state.errorMessage;
				break;
		}
	});

	const abortAgent = () => agent.abort();
	if (signal?.aborted) {
		unsubscribe();
		cb.onError?.('请求已取消');
		return;
	}
	signal?.addEventListener('abort', abortAgent, { once: true });

	try {
		await agent.continue();
	} finally {
		signal?.removeEventListener('abort', abortAgent);
		unsubscribe();
	}

	if (reportedError) cb.onError?.(reportedError);
}
