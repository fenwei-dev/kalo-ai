<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { app } from '$lib/context/appContext.svelte';
	import { saveAIConfig } from '$lib/db/repositories';
	import type { ApiType } from '$lib/db/schema';
	import { onboardingDestination } from '$lib/utils/onboarding';
	import * as m from '$lib/paraglide/messages';

	const apiTypes: { id: ApiType; label: string }[] = [
		{ id: 'openai-completions', label: 'Completions' },
		{ id: 'openai-responses', label: 'Responses' },
		{ id: 'anthropic-messages', label: 'Anthropic' }
	];

	let apiType = $state<ApiType>('openai-completions');
	let baseUrl = $state('');
	let apiKey = $state('');
	let model = $state('');
	let showKey = $state(false);
	let saving = $state(false);
	let errorMsg = $state('');
	let valid = $derived(apiKey.trim() !== '' && model.trim() !== '');

	onMount(() => {
		if (!app.profileConfigured) void goto('/onboarding', { replaceState: true });
		else if (app.aiConfigured) void goto('/', { replaceState: true });
	});

	async function save() {
		if (!valid || saving) return;
		saving = true;
		errorMsg = '';
		try {
			const config = await saveAIConfig({
				apiType,
				baseUrl: baseUrl.trim() || undefined,
				apiKey: apiKey.trim(),
				model: model.trim()
			});
			const destination = await onboardingDestination();
			app.aiConfig = config;
			await goto(destination);
		} catch (error) {
			errorMsg = error instanceof Error ? error.message : String(error);
		} finally {
			saving = false;
		}
	}
</script>

<div class="flex flex-1 flex-col pb-8">
	<div class="mb-5">
		<p class="text-xs font-semibold uppercase tracking-wider text-emerald-600">{m.onboarding_ai_step()}</p>
		<h1 class="mt-1 text-2xl font-bold text-gray-900">{m.onboarding_ai_title()}</h1>
		<p class="mt-2 text-sm leading-6 text-gray-500">{m.onboarding_ai_body()}</p>
	</div>

	<div class="space-y-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
		<fieldset>
			<legend class="mb-2 block text-xs font-medium text-gray-600">{m.ai_protocol()}</legend>
			<div class="grid grid-cols-3 rounded-xl bg-gray-100 p-1">
				{#each apiTypes as type}
					<button type="button" onclick={() => (apiType = type.id)} class="rounded-lg px-1 py-2.5 text-xs font-medium {apiType === type.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}">{type.label}</button>
				{/each}
			</div>
			<p class="mt-2 text-xs leading-5 text-gray-400">
				{#if apiType === 'openai-completions'}{m.ai_completions_hint()}
				{:else if apiType === 'openai-responses'}{m.ai_responses_hint()}
				{:else}{m.ai_anthropic_hint()}{/if}
			</p>
		</fieldset>

		<label class="block text-xs font-medium text-gray-600">
			{m.ai_base_url()}
			<input bind:value={baseUrl} type="url" inputmode="url" placeholder={m.ai_base_url_placeholder()} class="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none focus:border-emerald-400" />
		</label>

		<label class="block text-xs font-medium text-gray-600">
			{m.ai_model()}
			<input bind:value={model} placeholder={m.ai_model_placeholder()} class="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none focus:border-emerald-400" />
		</label>

		<label class="block text-xs font-medium text-gray-600">
			API Key
			<div class="relative mt-1.5">
				<input bind:value={apiKey} type={showKey ? 'text' : 'password'} placeholder="sk-..." autocomplete="off" class="w-full rounded-xl border border-gray-200 px-3 py-3 pr-16 text-sm outline-none focus:border-emerald-400" />
				<button type="button" onclick={() => (showKey = !showKey)} class="absolute right-3 top-3 text-xs font-medium text-emerald-600">{showKey ? m.onboarding_hide_key() : m.ai_show_key()}</button>
			</div>
		</label>

		<div class="rounded-2xl bg-amber-50 p-3 text-xs leading-5 text-amber-700">
			<p class="font-medium">🔐 {m.onboarding_ai_privacy_title()}</p>
			<p class="mt-1">{m.onboarding_ai_privacy_body()}</p>
		</div>

		{#if errorMsg}
			<p class="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">⚠️ {errorMsg}</p>
		{/if}

		<button type="button" onclick={save} disabled={!valid || saving} class="w-full rounded-full bg-emerald-500 py-3.5 text-sm font-semibold text-white shadow-sm disabled:opacity-40">
			{saving ? m.common_saving() : m.onboarding_finish()}
		</button>
	</div>

	<p class="mt-4 text-center text-xs leading-5 text-gray-400">{m.onboarding_ai_required()}</p>
</div>
