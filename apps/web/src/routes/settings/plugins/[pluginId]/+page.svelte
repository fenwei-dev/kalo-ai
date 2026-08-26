<script lang="ts">
	import {
		localize,
		type PluginJsonObject,
		type PluginJsonValue,
		type PluginPermission,
		type PluginSettingField,
	} from "@kalo-ai/plugin-sdk";
	import { Block, BlockTitle } from "konsta/svelte";
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import AppDialog from "$lib/components/AppDialog.svelte";
	import AppHeader from "$lib/components/AppHeader.svelte";
	import * as m from "$lib/paraglide/messages";
	import { getLocale } from "$lib/paraglide/runtime";
	import {
		disableInstalledPlugin,
		getInstalledPluginSource,
		getPluginState,
		type PluginState,
		pluginSourceLabel,
		removePluginPackage,
		resetPluginSettings,
		savePluginSettings,
	} from "$lib/plugins/manager";

	let pluginState = $state<PluginState | null>(null);
	let config = $state<PluginJsonObject>({});
	let enabled = $state(false);
	let loading = $state(true);
	let saving = $state(false);
	let saved = $state(false);
	let error = $state("");
	let resetDialogOpen = $state(false);
	let removeDialogOpen = $state(false);
	let installedSource =
		$state<Awaited<ReturnType<typeof getInstalledPluginSource>>>(null);

	onMount(() => void load());

	async function load() {
		loading = true;
		try {
			const loaded = await getPluginState(page.params.pluginId ?? "");
			if (!loaded) {
				await goto("/settings/plugins", { replaceState: true });
				return;
			}
			pluginState = loaded;
			config = structuredClone(loaded.config);
			enabled = loaded.enabled;
			installedSource =
				loaded.source.type === "bundled"
					? null
					: await getInstalledPluginSource(loaded.plugin.manifest.id);
		} finally {
			loading = false;
		}
	}

	function setValue(key: string, value: PluginJsonValue) {
		config = { ...config, [key]: value };
		saved = false;
	}

	function inputValue(event: Event): string {
		return event.currentTarget instanceof HTMLInputElement
			? event.currentTarget.value
			: "";
	}

	function selectValue(event: Event): string {
		return event.currentTarget instanceof HTMLSelectElement
			? event.currentTarget.value
			: "";
	}

	function permissionLabel(permission: PluginPermission): string {
		return {
			network: m.plugins_permission_network(),
			"profile.read": m.plugins_permission_profile_read(),
			"logs.read": m.plugins_permission_logs_read(),
			"logs.write": m.plugins_permission_logs_write(),
			storage: m.plugins_permission_storage(),
		}[permission];
	}

	async function save() {
		if (!pluginState || saving) return;
		saving = true;
		error = "";
		try {
			const savedState = await savePluginSettings(
				pluginState.plugin.manifest.id,
				config,
				enabled,
			);
			config = structuredClone(savedState.config);
			enabled = savedState.enabled;
			pluginState = savedState;
			saved = true;
			setTimeout(() => (saved = false), 1500);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			saving = false;
		}
	}

	async function reset() {
		if (!pluginState) return;
		const resetState = await resetPluginSettings(
			pluginState.plugin.manifest.id,
		);
		config = structuredClone(resetState.config);
		enabled = resetState.enabled;
		pluginState = resetState;
		resetDialogOpen = false;
		error = "";
	}

	async function disableUnavailable() {
		if (!pluginState || pluginState.source.type === "bundled") return;
		try {
			pluginState = await disableInstalledPlugin(
				pluginState.plugin.manifest.id,
			);
			enabled = false;
			error = "";
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	function downloadSource() {
		if (!installedSource) return;
		const url = URL.createObjectURL(
			new Blob([installedSource.source], { type: "text/javascript" }),
		);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = installedSource.fileName;
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}

	async function remove() {
		if (!pluginState || pluginState.source.type === "bundled") return;
		try {
			await removePluginPackage(pluginState.plugin.manifest.id);
			removeDialogOpen = false;
			await goto("/settings/plugins", { replaceState: true });
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			removeDialogOpen = false;
		}
	}

	function hasSecretField(
		fields: PluginSettingField<PluginJsonObject>[],
	): boolean {
		return fields.some(
			(field) =>
				field.type === "password" || ("secret" in field && field.secret),
		);
	}
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden pb-16">
	<AppHeader
		title={pluginState ? localize(pluginState.plugin.manifest.name, getLocale()) : m.plugins_title()}
		subtitle={pluginState ? `v${pluginState.plugin.manifest.version}` : ""}
		backHref="/settings/plugins"
	/>
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<div class="mx-auto max-w-md py-2">
			{#if loading || !pluginState}
				<Block inset strong><p class="text-center text-sm text-gray-400">{m.common_loading()}</p></Block>
			{:else}
				<BlockTitle>{m.plugins_about()}</BlockTitle>
				<Block inset strong>
					<p class="text-sm leading-relaxed text-gray-600">
						{localize(pluginState.plugin.manifest.description, getLocale())}
					</p>
					<p class="mt-2 break-all text-xs text-gray-400">
						{m.plugins_source()}: {pluginSourceLabel(pluginState)}
					</p>
					{#if pluginState.source.type !== 'bundled' && pluginState.status !== 'load_error'}
						<p class="mt-2 text-xs font-medium text-emerald-600">
							{m.plugins_sandboxed()}
						</p>
					{/if}
					{#if installedSource}
						<p class="mt-2 break-all font-mono text-[10px] text-gray-400">
							sha256:{installedSource.sha256}
						</p>
						<button
							type="button"
							onclick={downloadSource}
							class="mt-2 text-xs font-medium text-emerald-600"
						>
							{m.plugins_download_source()}
						</button>
					{/if}
					{#if pluginState.loadError}
						<div class="mt-3 rounded-xl bg-red-50 p-3 text-xs leading-relaxed text-red-600">
							<p>{m.plugins_load_error()}: {pluginState.loadError}</p>
							{#if pluginState.enabled && pluginState.source.type !== 'bundled'}
								<button
									type="button"
									onclick={disableUnavailable}
									class="mt-2 font-medium underline"
								>
									{m.plugins_disable_unavailable()}
								</button>
							{/if}
						</div>
					{/if}
					{#if pluginState.runtimeError}
						<p class="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-700">
							{m.plugins_runtime_error()}: {pluginState.runtimeError}
						</p>
					{/if}
					{#if pluginState.source.type !== 'bundled'}
						<p class="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700">
							{m.plugins_remote_detail_risk()}
						</p>
					{/if}
					{#if pluginState.status !== 'load_error'}
						<div class="mt-3 flex items-center justify-between gap-3">
							<div>
								<p class="text-sm font-medium">{m.plugins_enabled()}</p>
								<p class="text-xs text-gray-400">{m.plugins_changes_next_turn()}</p>
							</div>
							<button
								type="button"
								role="switch"
								aria-label={m.plugins_toggle()}
								aria-checked={enabled}
								onclick={() => (enabled = !enabled)}
								class="relative h-7 w-12 rounded-full transition-colors {enabled ? 'bg-emerald-500' : 'bg-gray-300'}"
							>
								<span class="absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all {enabled ? 'left-6' : 'left-1'}"></span>
							</button>
						</div>
					{/if}
				</Block>

				{#if pluginState.status !== 'load_error' && pluginState.plugin.settings?.fields.length}
					<BlockTitle>{m.plugins_configuration()}</BlockTitle>
					<Block inset strong>
						<div class="space-y-4">
							{#each pluginState.plugin.settings.fields as field (field.key)}
								<div>
									<span class="text-sm font-medium text-gray-700">{localize(field.label, getLocale())}</span>
									{#if field.description}
										<span class="mt-0.5 block text-xs leading-relaxed text-gray-400">{localize(field.description, getLocale())}</span>
									{/if}
									{#if field.type === 'text' || field.type === 'password'}
										<input
											type={field.type}
											aria-label={localize(field.label, getLocale())}
											value={typeof config[field.key] === 'string' ? config[field.key] : ''}
											placeholder={field.placeholder ? localize(field.placeholder, getLocale()) : ''}
											oninput={(event) => setValue(field.key, inputValue(event))}
											class="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
										/>
									{:else if field.type === 'number'}
										<input
											type="number"
											aria-label={localize(field.label, getLocale())}
											value={typeof config[field.key] === 'number' ? config[field.key] : ''}
											min={field.min}
											max={field.max}
											step={field.step}
											oninput={(event) => setValue(field.key, Number(inputValue(event)))}
											class="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
										/>
									{:else if field.type === 'select'}
										<select
											aria-label={localize(field.label, getLocale())}
											value={typeof config[field.key] === 'string' ? config[field.key] : ''}
											onchange={(event) => setValue(field.key, selectValue(event))}
											class="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
										>
											{#each field.options as option (option.value)}
												<option value={option.value}>{localize(option.label, getLocale())}</option>
											{/each}
										</select>
									{:else}
										<div class="mt-2 flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2.5">
											<span class="text-sm text-gray-500">
												{config[field.key] === true ? m.common_on() : m.common_off()}
											</span>
											<button
												type="button"
												role="switch"
												aria-label={localize(field.label, getLocale())}
												aria-checked={config[field.key] === true}
												onclick={() => setValue(field.key, config[field.key] !== true)}
												class="relative h-7 w-12 rounded-full transition-colors {config[field.key] === true ? 'bg-emerald-500' : 'bg-gray-300'}"
											>
												<span class="absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all {config[field.key] === true ? 'left-6' : 'left-1'}"></span>
											</button>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</Block>
				{/if}

				<BlockTitle>{m.plugins_permissions()}</BlockTitle>
				<Block inset strong>
					{#if pluginState.plugin.manifest.permissions?.length}
						<ul class="list-disc space-y-1 pl-5 text-sm text-gray-600">
							{#each pluginState.plugin.manifest.permissions as permission (permission)}
								<li>{permissionLabel(permission)}</li>
							{/each}
						</ul>
					{:else}
						<p class="text-sm text-gray-500">{m.plugins_no_permissions()}</p>
					{/if}
				</Block>

				{#if pluginState.plugin.settings && hasSecretField(pluginState.plugin.settings.fields)}
					<Block inset><p class="text-xs leading-relaxed text-amber-700">{m.plugins_secret_warning()}</p></Block>
				{/if}
				<Block inset>
					{#if error}<p class="mb-3 text-xs text-red-500">{error}</p>{/if}
					{#if pluginState.status !== 'load_error'}
						<button
							onclick={save}
							disabled={saving}
							class="w-full rounded-full bg-emerald-500 py-3 text-sm font-medium text-white disabled:opacity-50"
						>
							{saving ? m.common_saving() : saved ? m.common_saved() : m.common_save()}
						</button>
						<button onclick={() => (resetDialogOpen = true)} class="mt-3 w-full text-center text-xs text-red-500">
							{m.plugins_reset()}
						</button>
					{/if}
					{#if pluginState.source.type !== 'bundled'}
						<button onclick={() => (removeDialogOpen = true)} class="mt-3 w-full text-center text-xs text-red-600">
							{m.plugins_remove()}
						</button>
					{/if}
				</Block>
			{/if}
		</div>
	</div>
</div>

<AppDialog
	bind:open={resetDialogOpen}
	title={m.plugins_reset_title()}
	message={m.plugins_reset_message()}
	kind="confirm"
	onconfirm={reset}
/>

<AppDialog
	bind:open={removeDialogOpen}
	title={m.plugins_remove_title()}
	message={m.plugins_remove_message()}
	kind="confirm"
	onconfirm={remove}
/>
