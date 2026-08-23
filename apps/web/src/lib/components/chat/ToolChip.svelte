<script lang="ts">
	import type { JsonObject } from "$lib/db/schema";
	import * as m from "$lib/paraglide/messages";

	// 把一次工具调用渲染成一张小卡片。基于 args（卡卡估算后传入的数值）。
	let {
		tool,
		args,
		failed = false,
		error = "",
	}: {
		tool: string;
		args: JsonObject;
		failed?: boolean;
		error?: string;
	} = $props();

	const round = (n: number) => Math.round(n * 10) / 10;
	const stringArg = (key: string) =>
		typeof args[key] === "string" ? args[key] : "";
	const numberArg = (key: string) =>
		typeof args[key] === "number" ? args[key] : 0;
	const itemName = () => {
		const item = args.item;
		return item &&
			!Array.isArray(item) &&
			typeof item === "object" &&
			typeof item.name === "string"
			? item.name
			: "";
	};
</script>

{#if failed}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
		<span>⚠️</span><span>{m.tool_failed({ tool, error: error ? `: ${error}` : '' })}</span>
	</div>
{:else if tool === 'getProfile'}
	<div class="my-1 flex items-center gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
		<span class="text-base">👤</span>
		<span class="font-medium">{m.tool_read_profile()}</span>
	</div>
{:else if tool === 'getTodayLog'}
	<div class="my-1 flex items-center gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
		<span class="text-base">📅</span>
		<span class="font-medium">
			{stringArg("date") ? m.tool_read_day({ date: stringArg("date") }) : m.tool_read_today()}
		</span>
	</div>
{:else if tool === 'getTrends'}
	<div class="my-1 flex items-center gap-2 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-800">
		<span class="text-base">📈</span>
		<span class="font-medium">{m.tool_read_trends({ days: stringArg("range") === '7d' ? 7 : stringArg("range") === '90d' ? 90 : 30 })}</span>
	</div>
{:else if tool === 'listLibrary'}
	<div class="my-1 flex items-center gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
		<span class="text-base">📚</span>
		<span class="font-medium">{m.tool_read_library()}</span>
	</div>
{:else if tool === 'readUserMemory'}
	<div class="my-1 flex items-center gap-2 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-800">
		<span class="text-base">🧠</span>
		<span class="font-medium">{m.tool_memory_read()}</span>
	</div>
{:else if tool === 'updateUserMemory'}
	<div class="my-1 flex items-center gap-2 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-800">
		<span class="text-base">🧠</span>
		<span class="font-medium">{stringArg("content") ? m.tool_memory_updated() : m.tool_memory_cleared()}</span>
	</div>
{:else if tool === 'getTrainingPlan'}
	<div class="my-1 flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
		<span class="text-base">📋</span><span class="font-medium">{m.tool_training_read()}</span>
	</div>
{:else if tool === 'createTrainingPlan'}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">
		<span class="text-base">📋</span><span class="font-medium">{m.tool_training_created()}</span>
	</div>
{:else if tool === 'addPlannedWorkout'}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">
		<span class="text-base">➕</span><span class="font-medium">{m.tool_training_added()}</span>
	</div>
{:else if tool === 'updatePlannedWorkout'}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">
		<span class="text-base">🗓️</span><span class="font-medium">{m.tool_training_updated()}</span>
	</div>
{:else if tool === 'completePlannedWorkout'}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
		<span class="text-base">✅</span><span class="font-medium">{m.tool_training_completed()}</span>
	</div>
{:else if tool === 'linkExerciseToPlannedWorkout'}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-800">
		<span class="text-base">🔗</span><span class="font-medium">{stringArg("action") === 'unlink' ? m.tool_training_unlinked() : m.tool_training_linked()}</span>
	</div>
{:else if tool === 'setTrainingPlanStatus'}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
		<span class="text-base">⏯️</span><span class="font-medium">{m.tool_training_status()}</span>
	</div>
{:else if tool === 'archiveTrainingPlan'}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-xs text-gray-700">
		<span class="text-base">🗄️</span><span class="font-medium">{m.tool_training_archived()}</span>
	</div>
{:else if tool === 'logFood'}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
		<span class="text-base">🍽️</span>
		<span class="font-medium">{stringArg("name")}</span>
		<span class="text-emerald-600">{round(numberArg("calories"))} kcal</span>
		<span class="text-emerald-500/70">
			P{round(numberArg("protein"))} · C{round(numberArg("carbs"))} · F{round(numberArg("fat"))}
		</span>
	</div>
{:else if tool === 'logExercise'}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">
		<span class="text-base">🏃</span>
		<span class="font-medium">{stringArg("description")}</span>
		<span class="text-blue-600">{m.tool_exercise_minutes({ value: numberArg("duration") })}</span>
		<span class="text-blue-500/70">-{round(numberArg("caloriesBurned"))} kcal</span>
	</div>
{:else if tool === 'logWeight'}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-xs text-gray-700">
		<span class="text-base">⚖️</span>
		<span>{m.tool_weight()}</span>
		<span class="font-medium">{round(numberArg("weight"))} kg</span>
	</div>
{:else if tool === 'updateProfile'}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
		<span class="text-base">📝</span>
		<span>{args.targetWeight != null || args.targetDate != null ? m.tool_profile_goal() : m.tool_profile_data()}</span>
	</div>
{:else if tool === 'deleteLog'}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
		<span class="text-base">🗑️</span>
		<span>{stringArg("type") === 'food' ? stringArg("expectedLabel") : stringArg("type") === 'exercise' ? stringArg("expectedLabel") : `${stringArg("expectedLabel")} kg`}</span>
	</div>
{:else if tool === 'editLibrary'}
	<div class="my-1 flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-xs text-gray-700">
		<span class="text-base">📚</span>
		<span>{stringArg("action") === 'remove' ? m.tool_library_remove({ name: itemName() }) : m.tool_library_save({ name: itemName() })}</span>
	</div>
{:else}
	<div class="my-1 inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
		<span class="text-base">🔧</span><span class="font-medium">{m.tool_completed({ tool })}</span>
	</div>
{/if}
