<script lang="ts">
	import { goto } from "$app/navigation";
	import { app } from "$lib/context/appContext.svelte";
	import * as m from "$lib/paraglide/messages";
	import { getLocale, type Locale, setLocale } from "$lib/paraglide/runtime";

	let locale = $state<Locale>(getLocale());

	$effect(() => {
		if (app.onboarded) void goto("/", { replaceState: true });
	});

	function changeLanguage(next: Locale) {
		if (next === locale) return;
		locale = next;
		document.documentElement.lang = next;
		setLocale(next, { reload: true });
	}
</script>

<div class="flex flex-1 flex-col justify-center pb-10">
	<div class="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5">
		<div class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-3xl">🌿</div>
		<h1 class="text-3xl font-bold tracking-tight text-gray-900">{m.onboarding_welcome_title()}</h1>
		<p class="mt-3 text-sm leading-6 text-gray-600">{m.onboarding_welcome_body()}</p>

		<div class="mt-6 grid grid-cols-3 gap-2">
			<div class="rounded-2xl bg-emerald-50 p-3 text-center">
				<div class="text-xl">💬</div>
				<p class="mt-1 text-xs font-medium text-emerald-800">{m.onboarding_feature_chat()}</p>
			</div>
			<div class="rounded-2xl bg-blue-50 p-3 text-center">
				<div class="text-xl">📊</div>
				<p class="mt-1 text-xs font-medium text-blue-800">{m.onboarding_feature_data()}</p>
			</div>
			<div class="rounded-2xl bg-violet-50 p-3 text-center">
				<div class="text-xl">🔒</div>
				<p class="mt-1 text-xs font-medium text-violet-800">{m.onboarding_feature_local()}</p>
			</div>
		</div>

		<div class="mt-6">
			<p class="mb-2 text-xs font-medium text-gray-500">{m.language()}</p>
			<div class="grid grid-cols-2 rounded-xl bg-gray-100 p-1">
				<button
					type="button"
					onclick={() => changeLanguage('zh-cn')}
					class="rounded-lg py-2 text-sm font-medium {locale === 'zh-cn' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}"
				>{m.language_zh()}</button
				>
				<button
					type="button"
					onclick={() => changeLanguage('en-us')}
					class="rounded-lg py-2 text-sm font-medium {locale === 'en-us' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}"
				>{m.language_en()}</button
				>
			</div>
		</div>

		<button
			type="button"
			onclick={() => goto('/onboarding/profile')}
			class="mt-6 w-full rounded-full bg-emerald-500 py-3.5 text-sm font-semibold text-white shadow-sm shadow-emerald-500/20 active:bg-emerald-600"
		>
			{m.onboarding_get_started()}
		</button>
	</div>
	<p class="mt-4 px-4 text-center text-xs leading-5 text-gray-400">{m.onboarding_privacy_note()}</p>
</div>
