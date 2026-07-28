<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let {
		title,
		subtitle = '',
		backHref,
		actionLabel = '',
		actionHref,
		onaction,
		disabled = false
	}: {
		title: string;
		subtitle?: string;
		backHref?: string;
		actionLabel?: string;
		actionHref?: string;
		onaction?: () => void | Promise<void>;
		disabled?: boolean;
	} = $props();
</script>

<header class="z-30 shrink-0 border-b border-gray-200 bg-white/95 px-4 pt-[env(safe-area-inset-top)] shadow-[0_1px_3px_rgba(0,0,0,0.06)] backdrop-blur-xl">
	<div class="mx-auto flex min-h-14 max-w-md items-center gap-3 py-2">
		{#if backHref}
			<a
				href={backHref}
				class="-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-600 active:bg-gray-100"
				aria-label={m.common_back()}
			>
				<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
					<path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</a>
		{:else}
			<div
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-sm font-black tracking-tighter text-white shadow-sm shadow-emerald-500/20"
				aria-hidden="true"
			>
				K
			</div>
		{/if}

		<div class="min-w-0 flex-1">
			<h1 class="truncate text-lg font-bold leading-tight text-gray-900">{title}</h1>
			{#if subtitle}<p class="mt-0.5 truncate text-[11px] leading-tight text-gray-400">{subtitle}</p>{/if}
		</div>

		{#if actionHref}
			<a href={actionHref} class="shrink-0 rounded-full bg-emerald-50 px-3.5 py-2 text-sm font-medium text-emerald-700 active:bg-emerald-100">
				{actionLabel}
			</a>
		{:else if onaction}
			<button
				type="button"
				onclick={onaction}
				{disabled}
				class="shrink-0 rounded-full bg-emerald-50 px-3.5 py-2 text-sm font-medium text-emerald-700 active:bg-emerald-100 disabled:opacity-40"
			>
				{actionLabel}
			</button>
		{/if}
	</div>
</header>
