<script lang="ts">
	import { List, ListInput, Block, BlockTitle, Segmented, SegmentedButton } from 'konsta/svelte';
	import { app } from '$lib/context/appContext.svelte';
	import { saveAIConfig, updateAIConfig } from '$lib/db/repositories';
	import type { ApiType } from '$lib/db/schema';
	import * as m from '$lib/paraglide/messages';

	let { showTitle = true }: { showTitle?: boolean } = $props();

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

{#if showTitle}<BlockTitle>{m.ai_title()}</BlockTitle>{/if}

<Block inset>
	<div class="mb-2 text-xs text-gray-500">{m.ai_protocol()}</div>
	<Segmented>
		{#each apiTypes as t (t.id)}
			<SegmentedButton active={apiType === t.id} onclick={() => (apiType = t.id)}>
				{t.label}
			</SegmentedButton>
		{/each}
	</Segmented>
	<p class="mt-2 text-xs text-gray-400">
		{#if apiType === 'openai-completions'}{m.ai_completions_hint()}{/if}
		{#if apiType === 'openai-responses'}{m.ai_responses_hint()}{/if}
		{#if apiType === 'anthropic-messages'}{m.ai_anthropic_hint()}{/if}
	</p>
</Block>

<List inset strong>
	<ListInput label={m.ai_base_url()} placeholder={m.ai_base_url_placeholder()} bind:value={baseUrl} />
	<ListInput label={m.ai_model()} placeholder={m.ai_model_placeholder()} bind:value={model} />
	<ListInput
		label="API Key"
		type={showKey ? 'text' : 'password'}
		placeholder="sk-..."
		bind:value={apiKey}
	/>
</List>

<Block inset>
	<label class="mb-3 flex items-center justify-between text-sm text-gray-600">
		<span>{m.ai_show_key()}</span>
		<input type="checkbox" bind:checked={showKey} class="h-5 w-5 accent-emerald-500" />
	</label>
	<p class="pb-2 text-xs leading-relaxed text-gray-400">
		{m.ai_privacy()}
	</p>
	<button
		onclick={save}
		disabled={!valid || saving}
		class="w-full rounded-full bg-emerald-500 py-3 font-medium text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
	>
		{saving ? m.common_saving() : app.aiConfig ? (saved ? m.common_saved() : m.common_save()) : m.ai_save_config()}
	</button>
</Block>
