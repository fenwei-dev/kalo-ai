<script lang="ts">
	import { onMount } from 'svelte';
	import { App } from 'konsta/svelte';
	import Nav from '$lib/components/Nav.svelte';
	import { app } from '$lib/context/appContext.svelte';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	onMount(() => {
		app.init();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<App theme="material" dark={false} safeAreas>
	<div class="flex h-[100dvh] flex-col bg-gray-50 text-gray-900">
		<main class="flex-1 overflow-y-auto pb-20">
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
