<script lang="ts">
	import AppHeader from "$lib/components/AppHeader.svelte";
	import ProfileSection from "$lib/components/settings/ProfileSection.svelte";
	import * as m from "$lib/paraglide/messages";
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden pb-16">
	<AppHeader
		title={m.settings_profile_goal()}
		subtitle={m.settings_profile_goal_subtitle()}
		backHref="/settings"
	/>
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<div class="mx-auto max-w-md py-2">
			<ProfileSection />
		</div>
	</div>
</div>
