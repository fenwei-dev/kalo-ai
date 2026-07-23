<script lang="ts">
	import { List, ListInput, Block, BlockTitle, Segmented, SegmentedButton } from 'konsta/svelte';
	import { app } from '$lib/context/appContext.svelte';
	import { saveAIConfig, updateAIConfig } from '$lib/db/repositories';
	import type { ApiType } from '$lib/db/schema';

	const c = app.aiConfig;
	let apiType = $state<ApiType>(c?.apiType ?? 'openai-completions');
	let baseUrl = $state<string>(c?.baseUrl ?? '');
	let apiKey = $state<string>(c?.apiKey ?? '');
	let model = $state<string>(c?.model ?? 'gpt-4o-mini');
	let showKey = $state(false);

	let saving = $state(false);
	let saved = $state(false);

	let valid = $derived(apiKey.trim() !== '' && model.trim() !== '');

	const apiTypes: { id: ApiType; label: string }[] = [
		{ id: 'openai-completions', label: 'Completions' },
		{ id: 'openai-responses', label: 'Responses' },
		{ id: 'anthropic-messages', label: 'Anthropic' }
	];

	async function save() {
		if (!valid) return;
		saving = true;
		try {
			const data = {
				apiType,
				baseUrl: baseUrl.trim() || undefined,
				apiKey: apiKey.trim(),
				model: model.trim()
			};
			if (app.aiConfig) {
				app.aiConfig = (await updateAIConfig(data)) ?? null;
			} else {
				app.aiConfig = await saveAIConfig(data);
			}
			saved = true;
			setTimeout(() => (saved = false), 1500);
		} finally {
			saving = false;
		}
	}
</script>

<BlockTitle>AI 配置</BlockTitle>

<Block inset>
	<div class="mb-2 text-xs text-gray-500">API 协议</div>
	<Segmented>
		{#each apiTypes as t (t.id)}
			<SegmentedButton active={apiType === t.id} onclick={() => (apiType = t.id)}>
				{t.label}
			</SegmentedButton>
		{/each}
	</Segmented>
	<p class="mt-2 text-xs text-gray-400">
		{#if apiType === 'openai-completions'}OpenAI 兼容 /v1/chat/completions（最通用）{/if}
		{#if apiType === 'openai-responses'}OpenAI Responses API{/if}
		{#if apiType === 'anthropic-messages'}Anthropic Messages API（Claude）{/if}
	</p>
</Block>

<List inset strong>
	<ListInput label="Base URL（留空=官方）" placeholder="如 https://api.openai.com/v1" bind:value={baseUrl} />
	<ListInput label="Model ID" placeholder="如 gpt-4o-mini、claude-sonnet-4-5" bind:value={model} />
	<ListInput
		label="API Key"
		type={showKey ? 'text' : 'password'}
		placeholder="sk-..."
		bind:value={apiKey}
	/>
</List>

<Block inset>
	<label class="mb-3 flex items-center justify-between text-sm text-gray-600">
		<span>显示密钥</span>
		<input type="checkbox" bind:checked={showKey} class="h-5 w-5 accent-emerald-500" />
	</label>
	<p class="pb-2 text-xs leading-relaxed text-gray-400">
		卡卡通过你配置的接口直接对话，API Key 仅保存在本地。注意：部分自建代理/网关可能不支持浏览器跨域（CORS），如遇请求失败请检查端点的 CORS 设置。
	</p>
	<button
		onclick={save}
		disabled={!valid || saving}
		class="w-full rounded-full bg-emerald-500 py-3 font-medium text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
	>
		{saving ? '保存中…' : app.aiConfig ? (saved ? '已保存 ✓' : '保存') : '保存配置'}
	</button>
</Block>
