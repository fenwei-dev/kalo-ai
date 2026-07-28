<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	// 把一次工具调用渲染成一张小卡片。基于 args（卡卡估算后传入的数值）。
	let { tool, args, failed = false, error = '' }: {
		tool: string;
		args: Record<string, any>;
		failed?: boolean;
		error?: string;
	} = $props();

	const round = (n: number) => Math.round(n * 10) / 10;
</script>

{#if failed}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
		<span>⚠️</span><span>{m.tool_failed({ tool, error: error ? `: ${error}` : '' })}</span>
	</div>
{:else if tool === 'logFood'}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
		<span class="text-base">🍽️</span>
		<span class="font-medium">{args.name}</span>
		<span class="text-emerald-600">{round(args.calories)} kcal</span>
		<span class="text-emerald-500/70">
			P{round(args.protein)} · C{round(args.carbs)} · F{round(args.fat)}
		</span>
	</div>
{:else if tool === 'logExercise'}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">
		<span class="text-base">🏃</span>
		<span class="font-medium">{args.description}</span>
		<span class="text-blue-600">{m.tool_exercise_minutes({ value: args.duration })}</span>
		<span class="text-blue-500/70">-{round(args.caloriesBurned)} kcal</span>
	</div>
{:else if tool === 'logWeight'}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-xs text-gray-700">
		<span class="text-base">⚖️</span>
		<span>{m.tool_weight()}</span>
		<span class="font-medium">{round(args.weight)} kg</span>
	</div>
{:else if tool === 'updateProfile'}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
		<span class="text-base">📝</span>
		<span>{args.targetWeight != null || args.targetDate != null ? m.tool_profile_goal() : m.tool_profile_data()}</span>
	</div>
{:else if tool === 'editLibrary'}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-xs text-gray-700">
		<span class="text-base">📚</span>
		<span>{args.action === 'remove' ? m.tool_library_remove({ name: args.item?.name ?? '' }) : m.tool_library_save({ name: args.item?.name ?? '' })}</span>
	</div>
{:else}
	<div class="my-1 inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-[11px] text-gray-500">
		🔧 {tool}
	</div>
{/if}
