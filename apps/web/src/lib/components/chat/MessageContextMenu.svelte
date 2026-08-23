<script lang="ts">
	import { onMount } from "svelte";
	import * as m from "$lib/paraglide/messages";

	let {
		x,
		y,
		role,
		deferInteraction,
		canCopy,
		canRevert,
		oncopy,
		onrevert,
		onclose,
	}: {
		x: number;
		y: number;
		role: "user" | "assistant";
		deferInteraction: boolean;
		canCopy: boolean;
		canRevert: boolean;
		oncopy: () => void | Promise<void>;
		onrevert: () => void;
		onclose: () => void;
	} = $props();

	let firstButton = $state<HTMLButtonElement>();
	let interactionReady = $state(false);
	let releaseTimer: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		firstButton?.focus();
		interactionReady = !deferInteraction;
		if (!deferInteraction) return;
		const released = () => {
			window.removeEventListener("pointerup", released, true);
			window.removeEventListener("pointercancel", released, true);
			releaseTimer = setTimeout(() => (interactionReady = true), 100);
		};
		window.addEventListener("pointerup", released, true);
		window.addEventListener("pointercancel", released, true);
		return () => {
			window.removeEventListener("pointerup", released, true);
			window.removeEventListener("pointercancel", released, true);
			if (releaseTimer) clearTimeout(releaseTimer);
		};
	});

	function dismiss() {
		if (interactionReady) onclose();
	}

	async function copy() {
		if (interactionReady) await oncopy();
	}

	function revert() {
		if (interactionReady) onrevert();
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === "Escape") dismiss();
	}}
/>

<button
	type="button"
	class="fixed inset-0 z-60 cursor-default select-none bg-transparent [-webkit-touch-callout:none]"
	aria-label={m.common_close()}
	onclick={dismiss}
	oncontextmenu={(event) => {
		event.preventDefault();
		dismiss();
	}}
></button>
<div
	role="menu"
	tabindex="-1"
	aria-label={m.chat_message_actions()}
	class="fixed z-70 min-w-40 select-none overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl [-webkit-touch-callout:none]"
	style:left="{x}px"
	style:top="{y}px"
	oncontextmenu={(event) => event.preventDefault()}
>
	<button
		bind:this={firstButton}
		type="button"
		role="menuitem"
		disabled={!canCopy}
		onclick={copy}
		class="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:text-gray-300"
	>
		<span aria-hidden="true">⧉</span>
		<span>{m.chat_copy_message()}</span>
	</button>
	{#if role === 'user'}
		<button
			type="button"
			role="menuitem"
			disabled={!canRevert}
			onclick={revert}
			class="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 disabled:text-gray-300"
		>
			<span aria-hidden="true">↶</span>
			<span>{m.chat_revert_message()}</span>
		</button>
	{/if}
</div>
