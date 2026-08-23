<script lang="ts">
	import { localize } from "@kalo-ai/plugin-sdk";
	import { Block, BlockTitle, List, ListItem } from "konsta/svelte";
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import AppHeader from "$lib/components/AppHeader.svelte";
	import * as m from "$lib/paraglide/messages";
	import { getLocale } from "$lib/paraglide/runtime";
	import {
		getPluginStates,
		installPluginPackage,
		type PluginState,
		type PluginStateStatus,
		pluginSourceLabel,
	} from "$lib/plugins/manager";

	let states = $state<PluginState[]>([]);
	let loading = $state(true);
	let packageSpecifier = $state("");
	let riskConfirmed = $state(false);
	let installing = $state(false);
	let installError = $state("");

	onMount(() => void reload());

	async function reload() {
		loading = true;
		try {
			states = await getPluginStates();
		} finally {
			loading = false;
		}
	}

	function statusLabel(status: PluginStateStatus): string {
		return {
			ready: m.plugins_status_enabled(),
			disabled: m.plugins_status_disabled(),
			needs_config: m.plugins_status_needs_config(),
			invalid_config: m.plugins_status_invalid(),
			incompatible: m.plugins_status_incompatible(),
			load_error: m.plugins_status_load_error(),
		}[status];
	}

	async function install() {
		if (installing || !riskConfirmed || !packageSpecifier.trim()) return;
		installing = true;
		installError = "";
		try {
			const state = await installPluginPackage(packageSpecifier);
			packageSpecifier = "";
			riskConfirmed = false;
			await reload();
			await goto(`/settings/plugins/${state.plugin.manifest.id}`);
		} catch (error) {
			installError = error instanceof Error ? error.message : String(error);
		} finally {
			installing = false;
		}
	}
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden pb-16">
	<AppHeader
		title={m.plugins_title()}
		subtitle={m.plugins_subtitle()}
		backHref="/settings"
	/>
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<div class="mx-auto max-w-md py-2">
			<BlockTitle>{m.plugins_bundled()}</BlockTitle>
			{#if loading}
				<Block inset strong>
					<p class="text-center text-sm text-gray-400">{m.common_loading()}</p>
				</Block>
			{:else}
				<List inset strong>
					{#each states.filter((state) => state.source.type === 'bundled') as state (state.plugin.manifest.id)}
						<ListItem
							href={`/settings/plugins/${state.plugin.manifest.id}`}
							title={localize(state.plugin.manifest.name, getLocale())}
							subtitle={statusLabel(state.status)}
							text={localize(state.plugin.manifest.description, getLocale())}
							chevron
						/>
					{/each}
				</List>
			{/if}
			<Block inset>
				<p class="text-xs leading-relaxed text-gray-500">{m.plugins_bundled_hint()}</p>
			</Block>

			<BlockTitle>{m.plugins_installed()}</BlockTitle>
			{#if !loading && states.some((state) => state.source.type !== 'bundled')}
				<List inset strong>
					{#each states.filter((state) => state.source.type !== 'bundled') as state (state.plugin.manifest.id)}
						<ListItem
							href={`/settings/plugins/${state.plugin.manifest.id}`}
							title={localize(state.plugin.manifest.name, getLocale())}
							subtitle={`${statusLabel(state.status)} · ${pluginSourceLabel(state)}`}
							text={state.loadError ?? localize(state.plugin.manifest.description, getLocale())}
							chevron
						/>
					{/each}
				</List>
			{:else if !loading}
				<Block inset strong>
					<p class="text-center text-sm text-gray-400">{m.plugins_installed_empty()}</p>
				</Block>
			{/if}

			<BlockTitle>{m.plugins_add_package()}</BlockTitle>
			<Block inset strong>
				<div class="space-y-3">
					<label for="plugin-package" class="block text-sm font-medium text-gray-700">
						{m.plugins_package_specifier()}
					</label>
					<input
						id="plugin-package"
						bind:value={packageSpecifier}
						placeholder="npm:@scope/kalo-plugin@1.2.3"
						autocapitalize="none"
						autocomplete="off"
						spellcheck="false"
						class="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
					/>
					<p class="text-xs leading-relaxed text-gray-500">
						{m.plugins_package_hint()}
					</p>
					<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700">
						{m.plugins_remote_risk()}
					</div>
					<label class="flex items-start gap-2 text-xs leading-relaxed text-gray-600">
						<input
							type="checkbox"
							bind:checked={riskConfirmed}
							class="mt-0.5 h-4 w-4 rounded border-gray-300 text-emerald-500"
						/>
						<span>{m.plugins_remote_confirm()}</span>
					</label>
					{#if installError}
						<p class="text-xs leading-relaxed text-red-500">{installError}</p>
					{/if}
					<button
						type="button"
						onclick={install}
						disabled={installing || !riskConfirmed || !packageSpecifier.trim()}
						class="w-full rounded-full bg-emerald-500 py-3 text-sm font-medium text-white disabled:opacity-40"
					>
						{installing ? m.plugins_installing() : m.plugins_install()}
					</button>
				</div>
			</Block>
		</div>
	</div>
</div>
