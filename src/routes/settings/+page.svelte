<script lang="ts">
	import { Block, BlockTitle, List, ListItem, Button } from 'konsta/svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import AppDialog from '$lib/components/AppDialog.svelte';
	import ProfileSection from '$lib/components/settings/ProfileSection.svelte';
	import AIConfigSection from '$lib/components/settings/AIConfigSection.svelte';
	import LanguageSection from '$lib/components/settings/LanguageSection.svelte';
	import { app } from '$lib/context/appContext.svelte';
	import { exportAll, importAll, clearAllData } from '$lib/db/repositories';
	import { localDateISO } from '$lib/utils/date';
	import * as m from '$lib/paraglide/messages';

	let importing = $state(false);
	let confirmingClear = $state(false);
	let exportDialogOpen = $state(false);
	let importDialogOpen = $state(false);
	let resultDialogOpen = $state(false);
	let resultTitle = $state('');
	let resultMessage = $state('');
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
		const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `kalo-backup-${localDateISO()}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function handleImport(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importing = true;
		try {
			pendingImport = { text: await file.text(), input };
			importDialogOpen = true;
		} catch {
			showResult(m.settings_import_failed_title(), m.settings_import_failed());
			input.value = '';
			importing = false;
		}
	}

	async function performImport() {
		if (!pendingImport) return;
		const { text, input } = pendingImport;
		try {
			await importAll(JSON.parse(text));
			await app.reload();
			showResult(m.settings_import_success_title(), m.settings_import_success());
		} catch {
			showResult(m.settings_import_failed_title(), m.settings_import_failed());
		} finally {
			pendingImport = null;
			input.value = '';
			importing = false;
		}
	}

	function cancelImport() {
		if (pendingImport) pendingImport.input.value = '';
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
	<AppHeader
		title={m.settings_title()}
		subtitle={app.onboarded ? m.settings_subtitle() : m.settings_onboarding_subtitle()}
	/>
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
	<div class="mx-auto max-w-md pt-2">
		{#if !app.onboarded}
			<p class="mx-4 mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{m.settings_onboarding_notice()}</p>
		{/if}

		<LanguageSection />
		<ProfileSection />
		<AIConfigSection />

		<BlockTitle>{m.settings_library()}</BlockTitle>
		<List inset strong>
			<ListItem href="/settings/library" title={m.settings_manage_library()} chevron />
		</List>

		<BlockTitle>{m.settings_data()}</BlockTitle>
		<Block inset>
			<div class="grid grid-cols-2 gap-3">
				<Button outline rounded onclick={handleExport}>{m.settings_export()}</Button>
				<label
					class="flex cursor-pointer items-center justify-center rounded-full border border-gray-300 py-2 text-sm font-medium"
				>
					{importing ? m.settings_importing() : m.settings_import()}
					<input type="file" accept=".json" class="hidden" onchange={handleImport} />
				</label>
			</div>
			{#if confirmingClear}
				<div class="mt-3 rounded-xl bg-red-50 p-3 text-center">
					<p class="mb-2 text-xs text-red-600">{m.settings_clear_confirm()}</p>
					<div class="grid grid-cols-2 gap-3">
						<Button small outline rounded onclick={() => (confirmingClear = false)}>{m.common_cancel()}</Button>
						<button
							onclick={handleClear}
							class="rounded-full bg-red-500 py-2 text-sm font-medium text-white">{m.settings_confirm_clear()}</button
						>
					</div>
				</div>
			{:else}
				<Button clear class="mt-2 !text-red-500" onclick={() => (confirmingClear = true)}
					>{m.settings_clear()}</Button
				>
			{/if}
		</Block>

		<p class="px-4 pb-4 pt-2 text-center text-xs text-gray-400">{m.settings_local_only()}</p>
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
