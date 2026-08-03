<script lang="ts">
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';

	let { children } = $props();
	let step = $derived(
		page.url.pathname === '/onboarding/profile' ? 1 : page.url.pathname === '/onboarding/ai' ? 2 : 0
	);
</script>

<div class="h-full min-h-0 overflow-y-auto overscroll-contain bg-gradient-to-b from-emerald-50 via-gray-50 to-gray-50 px-4 py-[max(1.5rem,env(safe-area-inset-top))]">
	<div class="mx-auto flex min-h-full max-w-md flex-col">
		<div class="mb-6 flex items-center justify-between">
			<div class="flex items-center gap-2">
				<div class="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-sm font-black text-white shadow-sm shadow-emerald-500/20">K</div>
				<div>
					<p class="text-sm font-bold text-gray-900">Kalo AI · 卡卡 AI</p>
					<p class="text-[11px] text-gray-400">{m.onboarding_local_first()}</p>
				</div>
			</div>
			<div class="flex gap-1.5" aria-label={m.onboarding_progress({ current: step + 1, total: 3 })}>
				{#each [0, 1, 2] as index}
					<span class="h-1.5 rounded-full transition-all {index === step ? 'w-6 bg-emerald-500' : index < step ? 'w-3 bg-emerald-300' : 'w-3 bg-gray-200'}"></span>
				{/each}
			</div>
		</div>

		{@render children()}
	</div>
</div>
