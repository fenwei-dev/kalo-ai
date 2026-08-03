<script lang="ts">
	import { BlockTitle, List, ListItem } from 'konsta/svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import * as m from '$lib/paraglide/messages';
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden pb-16">
	<AppHeader title={m.settings_title()} subtitle={m.settings_subtitle()} />
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<div class="mx-auto max-w-md py-3">
			<BlockTitle>{m.settings_group_personal()}</BlockTitle>
			<List inset strong>
				<ListItem href="/settings/profile" title={m.settings_profile_goal()} chevron />
			</List>

			<BlockTitle>{m.settings_group_ai()}</BlockTitle>
			<List inset strong>
				<ListItem href="/settings/ai" title={m.ai_title()} chevron />
				<ListItem href="/settings/memory" title={m.settings_memory()} chevron />
				<ListItem href="/settings/library" title={m.settings_library()} chevron />
			</List>

			<BlockTitle>{m.settings_group_app()}</BlockTitle>
			<List inset strong>
				<ListItem href="/settings/preferences" title={m.settings_preferences()} chevron />
				<ListItem href="/settings/data" title={m.settings_data_privacy()} chevron />
			</List>

			<BlockTitle>{m.settings_group_support()}</BlockTitle>
			<List inset strong>
				<ListItem href="/help" title={m.settings_help()} chevron />
				<ListItem href="/about" title={m.settings_about()} chevron />
			</List>
		</div>
	</div>
</div>
