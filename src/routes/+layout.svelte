<script lang="ts">
	import { onMount } from 'svelte';
	import { App } from 'konsta/svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Nav from '$lib/components/Nav.svelte';
	import { app } from '$lib/context/appContext.svelte';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	onMount(() => {
		app.init();
		// 注册 PWA service worker
		import('virtual:pwa-register').then(({ registerSW }) =>
			registerSW({ immediate: true })
		);
	});

	// 未完成 onboarding 时，强制停留在设置页
	$effect(() => {
		if (app.ready && !app.onboarded && page.url.pathname !== '/settings') {
			goto('/settings', { replaceState: true });
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<App theme="material" dark={false} safeAreas>
	<div class="flex h-[100dvh] w-full max-w-full flex-col overflow-hidden bg-gray-50 text-gray-900">
		<main class="relative flex-1 overflow-hidden">
			{#if !app.ready}
				<div class="flex h-full items-center justify-center text-sm text-gray-400">
					加载中…
				</div>
			{:else}
				{@render children()}
			{/if}
		</main>
		<Nav />
	</div>
</App>
