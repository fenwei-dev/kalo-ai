<script lang="ts">
	import { localize } from "@kalo-ai/plugin-sdk";
	import { Block, BlockTitle, List, ListItem } from "konsta/svelte";
	import { onMount } from "svelte";
	import AppHeader from "$lib/components/AppHeader.svelte";
	import * as m from "$lib/paraglide/messages";
	import { getLocale } from "$lib/paraglide/runtime";
	import {
		getPluginStates,
		type PluginState,
		type PluginStateStatus,
	} from "$lib/plugins/manager";

	let states = $state<PluginState[]>([]);
	let loading = $state(true);

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
		}[status];
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
					{#each states as state (state.plugin.manifest.id)}
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
		</div>
	</div>
</div>
