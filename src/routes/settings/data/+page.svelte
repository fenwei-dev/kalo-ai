<script lang="ts">
	import { Block, BlockTitle, Button } from "konsta/svelte";
	import AppDialog from "$lib/components/AppDialog.svelte";
	import AppHeader from "$lib/components/AppHeader.svelte";
	import { app } from "$lib/context/appContext.svelte";
	import { clearAllData, exportAll, importAll } from "$lib/db/repositories";
	import * as m from "$lib/paraglide/messages";
	import { localDateISO } from "$lib/utils/date";

	let importing = $state(false);
	let confirmingClear = $state(false);
	let exportDialogOpen = $state(false);
	let importDialogOpen = $state(false);
	let resultDialogOpen = $state(false);
	let resultTitle = $state("");
	let resultMessage = $state("");
	let pendingImport: { text: string; input: HTMLInputElement } | null = null;

	async function handleExport() {
		if (app.aiConfig?.apiKey) {
			exportDialogOpen = true;
			return;
		}
		await performExport();
	}

	async function performExport() {
		const data = await exportAll();
		const blob = new Blob([JSON.stringify(data, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `kalo-backup-${localDateISO()}.json`;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	async function handleImport(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importing = true;
		try {
			pendingImport = { text: await file.text(), input };
			importDialogOpen = true;
		} catch {
			showResult(m.settings_import_failed_title(), m.settings_import_failed());
			input.value = "";
			importing = false;
		}
	}

	async function performImport() {
		if (!pendingImport) return;
		const { text, input } = pendingImport;
		try {
			await importAll(JSON.parse(text));
			await app.reload();
			showResult(
				m.settings_import_success_title(),
				m.settings_import_success(),
			);
		} catch {
			showResult(m.settings_import_failed_title(), m.settings_import_failed());
		} finally {
			pendingImport = null;
			input.value = "";
			importing = false;
		}
	}

	function cancelImport() {
		if (pendingImport) pendingImport.input.value = "";
		pendingImport = null;
		importing = false;
	}

	function showResult(title: string, message: string) {
		resultTitle = title;
		resultMessage = message;
		resultDialogOpen = true;
	}

	async function handleClear() {
		await clearAllData();
		await app.reload();
		confirmingClear = false;
	}
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden pb-16">
	<AppHeader title={m.settings_data_privacy()} subtitle={m.settings_data_subtitle()} backHref="/settings" />
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<div class="mx-auto max-w-md py-2">
			<BlockTitle>{m.settings_privacy_title()}</BlockTitle>
			<Block inset strong>
				<p class="text-sm leading-relaxed text-gray-600">{m.settings_privacy_body()}</p>
			</Block>

			<BlockTitle>{m.settings_backup_title()}</BlockTitle>
			<Block inset>
				<p class="mb-4 text-xs leading-relaxed text-gray-500">{m.settings_backup_body()}</p>
				<div class="grid grid-cols-2 gap-3">
					<Button outline rounded onclick={handleExport}>{m.settings_export()}</Button>
					<label class="flex cursor-pointer items-center justify-center rounded-full border border-gray-300 py-2 text-sm font-medium">
						{importing ? m.settings_importing() : m.settings_import()}
						<input type="file" accept=".json" class="hidden" onchange={handleImport} />
					</label>
				</div>
			</Block>

			<BlockTitle>{m.settings_danger_title()}</BlockTitle>
			<Block inset strong>
				{#if confirmingClear}
					<div class="rounded-xl bg-red-50 p-3 text-center">
						<p class="mb-3 text-xs text-red-600">{m.settings_clear_confirm()}</p>
						<div class="grid grid-cols-2 gap-3">
							<Button small outline rounded onclick={() => (confirmingClear = false)}>{m.common_cancel()}</Button>
							<button onclick={handleClear} class="rounded-full bg-red-500 py-2 text-sm font-medium text-white">{m.settings_confirm_clear()}</button>
						</div>
					</div>
				{:else}
					<p class="mb-3 text-xs leading-relaxed text-gray-500">{m.settings_clear_body()}</p>
					<button onclick={() => (confirmingClear = true)} class="w-full rounded-full border border-red-200 py-2.5 text-sm font-medium text-red-500">{m.settings_clear()}</button>
				{/if}
			</Block>
		</div>
	</div>
</div>

<AppDialog
	bind:open={exportDialogOpen}
	title={m.settings_export_warning_title()}
	message={m.settings_export_warning()}
	kind="confirm"
	onconfirm={performExport}
/>
<AppDialog
	bind:open={importDialogOpen}
	title={m.settings_import_warning_title()}
	message={m.settings_import_warning()}
	kind="confirm"
	onconfirm={performImport}
	onclose={cancelImport}
/>
<AppDialog bind:open={resultDialogOpen} title={resultTitle} message={resultMessage} />
