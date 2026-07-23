<script lang="ts">
	import { App } from 'konsta/svelte';
	import Nav from '$lib/components/Nav.svelte';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<App theme="material" dark={false} safeAreas>
	<div class="flex h-[100dvh] flex-col bg-gray-50 text-gray-900">
		<main class="flex-1 overflow-y-auto pb-20">
			{@render children()}
		</main>
		<Nav />
	</div>
</App>
