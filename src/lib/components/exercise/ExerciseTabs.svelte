<script lang="ts">
	import * as m from "$lib/paraglide/messages";

	let { active }: { active: "records" | "plan" } = $props();
</script>

<nav class="mx-4 mt-3 grid grid-cols-2 rounded-xl bg-gray-100 p-1" aria-label={m.exercise_section_nav()}>
	<a
		href="/exercise"
		aria-current={active === "records" ? "page" : undefined}
		class="rounded-lg py-2 text-center text-sm font-medium transition {active === 'records'
			? 'bg-white text-blue-600 shadow-sm'
			: 'text-gray-500'}"
	>
		{m.exercise_records_tab()}
	</a>
	<a
		href="/exercise/plan"
		aria-current={active === "plan" ? "page" : undefined}
		class="rounded-lg py-2 text-center text-sm font-medium transition {active === 'plan'
			? 'bg-white text-blue-600 shadow-sm'
			: 'text-gray-500'}"
	>
		{m.training_plan_tab()}
	</a>
</nav>
