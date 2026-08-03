<script lang="ts">
	import { onMount } from 'svelte';
	import { App } from 'konsta/svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Nav from '$lib/components/Nav.svelte';
	import { app } from '$lib/context/appContext.svelte';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { getLocale } from '$lib/paraglide/runtime';

	let { children } = $props();

	onMount(() => {
		document.documentElement.lang = getLocale();
		app.init();
		// 注册 PWA service worker
		import('virtual:pwa-register').then(({ registerSW }) =>
			registerSW({ immediate: true })
		);
	});

	// 必要配置遗失时回到对应 onboarding 步骤；配置完整后离开引导页。
	$effect(() => {
		if (!app.ready) return;
		const pathname = page.url.pathname;

		if (!app.profileConfigured) {
			const allowed = pathname === '/onboarding' || pathname === '/onboarding/profile';
			if (!allowed) void goto('/onboarding', { replaceState: true });
			return;
		}
		if (!app.aiConfigured) {
			if (pathname !== '/onboarding/ai') void goto('/onboarding/ai', { replaceState: true });
			return;
		}
		// Completed onboarding pages navigate explicitly after their writes finish.
		// Keeping the guard idle here avoids racing the final welcome-session setup.
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<App theme="material" dark={false} safeAreas>
	<div class="flex h-[100dvh] w-full max-w-full flex-col overflow-hidden bg-gray-50 text-gray-900">
		<main class="relative min-h-0 min-w-0 flex-1 overflow-hidden">
			{#if !app.ready}
				<div class="flex h-full items-center justify-center text-sm text-gray-400">
					{getLocale() === 'zh-cn' ? '加载中…' : 'Loading…'}
				</div>
			{:else}
				{@render children()}
			{/if}
		</main>
		<Nav />
	</div>
</App>
