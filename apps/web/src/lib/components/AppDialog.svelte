<script lang="ts">
	import { Dialog, DialogButton } from "konsta/svelte";
	import * as m from "$lib/paraglide/messages";

	let {
		open = $bindable(false),
		title,
		message,
		kind = "alert",
		confirmLabel,
		onconfirm,
		onclose,
	}: {
		open: boolean;
		title: string;
		message: string;
		kind?: "alert" | "confirm";
		confirmLabel?: string;
		onconfirm?: () => void | Promise<void>;
		onclose?: () => void;
	} = $props();

	let busy = $state(false);

	function close() {
		if (busy) return;
		onclose?.();
		open = false;
	}

	async function confirm() {
		if (busy) return;
		busy = true;
		try {
			await onconfirm?.();
			open = false;
		} finally {
			busy = false;
		}
	}
</script>

{#snippet dialogTitle()}
	{title}
{/snippet}

{#snippet buttons()}
	{#if kind === 'confirm'}
		<DialogButton onclick={close} disabled={busy}>{m.common_cancel()}</DialogButton>
	{/if}
	<DialogButton strong onclick={confirm} disabled={busy}>
		{confirmLabel ?? (kind === 'confirm' ? m.common_confirm() : m.common_ok())}
	</DialogButton>
{/snippet}

<Dialog
	opened={open}
	title={dialogTitle}
	{buttons}
	onBackdropClick={close}
>
	<p class="text-sm leading-relaxed">{message}</p>
</Dialog>
