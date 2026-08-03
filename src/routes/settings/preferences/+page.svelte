<script lang="ts">
	import AppHeader from '$lib/components/AppHeader.svelte';
	import LanguageSection from '$lib/components/settings/LanguageSection.svelte';
	import * as m from '$lib/paraglide/messages';
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden pb-16">
	<AppHeader
		title={m.settings_preferences()}
		subtitle={m.settings_preferences_subtitle()}
		backHref="/settings"
	/>
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<div class="mx-auto max-w-md py-2">
			<LanguageSection />
		</div>
	</div>
</div>
