import {
	createModels,
	createProvider,
	type Api,
	type Model,
	type MutableModels,
	type ProviderStreams
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import type { AIConfig, ApiType } from '$lib/db/schema';

const API_FACTORY: Record<ApiType, () => ProviderStreams> = {
	'openai-completions': openAICompletionsApi,
	'openai-responses': openAIResponsesApi,
	'anthropic-messages': anthropicMessagesApi
};

const DEFAULT_BASE_URL: Record<ApiType, string> = {
	'openai-completions': 'https://api.openai.com/v1',
	'openai-responses': 'https://api.openai.com/v1',
	'anthropic-messages': 'https://api.anthropic.com'
};

export interface BuiltModels {
	models: MutableModels;
	model: Model<Api>;
	apiType: ApiType;
}

/** 根据用户配置构建一个自定义 provider + model 的 Models 集合。 */
export function buildModels(cfg: AIConfig): BuiltModels {
	const baseUrl = cfg.baseUrl?.trim() || DEFAULT_BASE_URL[cfg.apiType];
	const model: Model<Api> = {
		id: cfg.model,
		name: cfg.model,
		api: cfg.apiType as Api,
		provider: 'kalo' as any,
		baseUrl,
		reasoning: false,
		input: ['text', 'image'],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192
	};

	const provider = createProvider({
		id: 'kalo',
		name: '自定义',
		baseUrl,
		// apiKey 通过 stream/complete 选项传入，provider auth 解析为空。
		auth: { apiKey: { name: 'Kalo API key', resolve: async () => ({ auth: {} }) } },
		models: [model],
		api: API_FACTORY[cfg.apiType]()
	});

	const models = createModels();
	models.setProvider(provider);
	return { models, model, apiType: cfg.apiType };
}
