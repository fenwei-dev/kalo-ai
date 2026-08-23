<script lang="ts">
	import {
		Block,
		BlockTitle,
		List,
		ListInput,
		Segmented,
		SegmentedButton,
	} from "konsta/svelte";
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import AppDialog from "$lib/components/AppDialog.svelte";
	import AppHeader from "$lib/components/AppHeader.svelte";
	import ExerciseMinutesChart, {
		type ExerciseChartPoint,
	} from "$lib/components/charts/ExerciseMinutesChart.svelte";
	import ExerciseTabs from "$lib/components/exercise/ExerciseTabs.svelte";
	import SwipeListItem from "$lib/components/SwipeListItem.svelte";
	import { app } from "$lib/context/appContext.svelte";
	import {
		addExerciseEntry,
		deleteExerciseEntry,
		getAllPlannedWorkouts,
		getExerciseEntries,
		getTrainingPlans,
		linkExerciseToPlannedWorkout,
		updateExerciseEntry,
	} from "$lib/db/repositories";
	import type {
		ExerciseCategory,
		ExerciseEntry,
		ExerciseIntensity,
		ExerciseSource,
		PlannedWorkout,
		TrainingPlan,
	} from "$lib/db/schema";
	import * as m from "$lib/paraglide/messages";
	import { getLocale } from "$lib/paraglide/runtime";
	import {
		localDateISO,
		localDateOffset,
		localTimeHHMM,
		parseLocalDate,
	} from "$lib/utils/date";
	import { estimateExerciseCalories } from "$lib/utils/exercise";

	type Range = "7d" | "30d" | "90d" | "all";
	const rangeDays: Record<Exclude<Range, "all">, number> = {
		"7d": 7,
		"30d": 30,
		"90d": 90,
	};
	const categories: ExerciseCategory[] = [
		"walking",
		"running",
		"cycling",
		"strength",
		"swimming",
		"sports",
		"other",
	];
	const intensities: ExerciseIntensity[] = ["light", "moderate", "vigorous"];

	let range = $state<Range>("30d");
	let entries = $state<ExerciseEntry[]>([]);
	let plans = $state<TrainingPlan[]>([]);
	let plannedWorkouts = $state<PlannedWorkout[]>([]);
	let loading = $state(true);
	let formOpen = $state(false);
	let editingId = $state<string | null>(null);
	let description = $state("");
	let category = $state<ExerciseCategory>("other");
	let intensity = $state<ExerciseIntensity>("moderate");
	let date = $state(localDateISO());
	let time = $state(localTimeHHMM());
	let duration = $state("30");
	let calories = $state("");
	let source = $state<ExerciseSource>("manual");
	let selectedPlannedWorkoutId = $state("");
	let autoCalories = $state(true);
	let saving = $state(false);
	let error = $state("");
	let revealedId = $state<string | null>(null);
	let pendingDelete = $state<ExerciseEntry | null>(null);
	let deleteDialogOpen = $state(false);
	let scrollContainer = $state<HTMLDivElement>();
	let openedQueryEntry = false;

	const dateFormatter = new Intl.DateTimeFormat(getLocale(), {
		year: "numeric",
		month: "short",
		day: "numeric",
		weekday: "short",
	});

	onMount(() => {
		const refresh = () => void reload();
		const refreshWhenVisible = () => {
			if (document.visibilityState === "visible") refresh();
		};
		refresh();
		window.addEventListener("focus", refresh);
		document.addEventListener("visibilitychange", refreshWhenVisible);
		return () => {
			window.removeEventListener("focus", refresh);
			document.removeEventListener("visibilitychange", refreshWhenVisible);
		};
	});

	async function reload() {
		loading = true;
		try {
			const [loadedEntries, loadedPlans, loadedWorkouts] = await Promise.all([
				getExerciseEntries(),
				getTrainingPlans(),
				getAllPlannedWorkouts(),
			]);
			entries = loadedEntries;
			plans = loadedPlans;
			plannedWorkouts = loadedWorkouts;
			const queryEntry = page.url.searchParams.get("entry");
			if (
				!openedQueryEntry &&
				queryEntry &&
				loadedEntries.some((entry) => entry.id === queryEntry)
			) {
				openedQueryEntry = true;
				startEdit(queryEntry);
			}
		} finally {
			loading = false;
		}
	}

	let visible = $derived.by(() => {
		if (range === "all") return entries;
		const start = localDateOffset(-(rangeDays[range] - 1));
		return entries.filter((entry) => entry.date >= start);
	});
	let totalMinutes = $derived(
		visible.reduce((sum, entry) => sum + entry.duration, 0),
	);
	let totalCalories = $derived(
		visible.reduce((sum, entry) => sum + entry.caloriesBurned, 0),
	);
	let activeDays = $derived(new Set(visible.map((entry) => entry.date)).size);
	let chartPoints = $derived(buildChartPoints(visible, range));
	let chartWidth = $derived(Math.max(320, chartPoints.length * 16));
	let associationOptions = $derived(
		plannedWorkouts.filter(
			(workout) =>
				(!workout.exerciseEntryId || workout.exerciseEntryId === editingId) &&
				(workout.status !== "completed" ||
					workout.exerciseEntryId === editingId),
		),
	);
	let formValid = $derived(
		description.trim().length > 0 &&
			/^\d{4}-\d{2}-\d{2}$/.test(date) &&
			date <= localDateISO() &&
			/^([01]\d|2[0-3]):[0-5]\d$/.test(time) &&
			Number.isFinite(+duration) &&
			+duration >= 1 &&
			+duration <= 1440 &&
			Number.isFinite(+calories) &&
			+calories >= 0 &&
			+calories <= 10000,
	);

	$effect(() => {
		if (!autoCalories) return;
		const estimate = estimateExerciseCalories({
			category,
			intensity,
			duration: Number(duration),
			weight: app.user?.currentWeight ?? 70,
		});
		calories = String(estimate);
	});

	function buildChartPoints(
		items: ExerciseEntry[],
		selectedRange: Range,
	): ExerciseChartPoint[] {
		const minutes = new Map<string, number>();
		for (const entry of items) {
			minutes.set(entry.date, (minutes.get(entry.date) ?? 0) + entry.duration);
		}
		if (selectedRange === "all") {
			return [...minutes]
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([pointDate, value]) => ({ date: pointDate, minutes: value }));
		}
		const days = rangeDays[selectedRange];
		return Array.from({ length: days }, (_, index) => {
			const pointDate = localDateOffset(index - days + 1);
			return { date: pointDate, minutes: minutes.get(pointDate) ?? 0 };
		});
	}

	function categoryLabel(value: ExerciseCategory): string {
		return {
			walking: m.exercise_category_walking(),
			running: m.exercise_category_running(),
			cycling: m.exercise_category_cycling(),
			strength: m.exercise_category_strength(),
			swimming: m.exercise_category_swimming(),
			sports: m.exercise_category_sports(),
			other: m.exercise_category_other(),
		}[value];
	}

	function categoryIcon(value?: ExerciseCategory): string {
		return {
			walking: "🚶",
			running: "🏃",
			cycling: "🚴",
			strength: "🏋️",
			swimming: "🏊",
			sports: "⚽",
			other: "🏃",
		}[value ?? "other"];
	}

	function planTitle(planId: string): string {
		return (
			plans.find((item) => item.id === planId)?.title ??
			m.training_unknown_plan()
		);
	}

	function associationLabel(workout: PlannedWorkout): string {
		return m.exercise_plan_option({
			plan: planTitle(workout.planId),
			date: workout.date,
			workout: workout.description,
		});
	}

	function intensityLabel(value: ExerciseIntensity): string {
		return {
			light: m.exercise_intensity_light(),
			moderate: m.exercise_intensity_moderate(),
			vigorous: m.exercise_intensity_vigorous(),
		}[value];
	}

	function scrollToTop() {
		requestAnimationFrame(() =>
			scrollContainer?.scrollTo({ top: 0, behavior: "smooth" }),
		);
	}

	function startNew() {
		editingId = null;
		description = "";
		category = "other";
		intensity = "moderate";
		date = localDateISO();
		time = localTimeHHMM();
		duration = "30";
		calories = "";
		source = "manual";
		selectedPlannedWorkoutId = "";
		autoCalories = true;
		error = "";
		formOpen = true;
		scrollToTop();
	}

	function startEdit(id: string) {
		const entry = entries.find((item) => item.id === id);
		if (!entry) return;
		editingId = entry.id;
		description = entry.description;
		category = entry.category ?? "other";
		intensity = entry.intensity ?? "moderate";
		date = entry.date;
		time = entry.time;
		duration = String(entry.duration);
		calories = String(entry.caloriesBurned);
		source = entry.source;
		selectedPlannedWorkoutId = entry.plannedWorkoutId ?? "";
		autoCalories = false;
		error = "";
		formOpen = true;
		scrollToTop();
	}

	function closeForm() {
		formOpen = false;
		editingId = null;
		error = "";
	}

	async function saveEntry() {
		if (!formValid || saving) return;
		saving = true;
		error = "";
		try {
			const values = {
				date,
				time,
				description: description.trim(),
				category,
				intensity,
				duration: +duration,
				caloriesBurned: +calories,
				source,
			};
			const entry = editingId
				? await updateExerciseEntry(editingId, values)
				: await addExerciseEntry(values);
			const desiredLink = selectedPlannedWorkoutId || null;
			if ((entry.plannedWorkoutId ?? null) !== desiredLink) {
				await linkExerciseToPlannedWorkout(entry.id, desiredLink);
			}
			closeForm();
			await Promise.all([reload(), app.refreshToday()]);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			saving = false;
		}
	}

	function requestDelete(id: string) {
		pendingDelete = entries.find((entry) => entry.id === id) ?? null;
		revealedId = null;
		if (pendingDelete) deleteDialogOpen = true;
	}

	async function confirmDelete() {
		if (!pendingDelete) return;
		await deleteExerciseEntry(pendingDelete.id);
		pendingDelete = null;
		await Promise.all([reload(), app.refreshToday()]);
	}

	function recordSubtitle(entry: ExerciseEntry): string {
		const meta = m.exercise_record_meta({
			time: entry.time,
			minutes: entry.duration,
			calories: Math.round(entry.caloriesBurned),
		});
		if (!entry.plannedWorkoutId) return meta;
		const workout = plannedWorkouts.find(
			(item) => item.id === entry.plannedWorkoutId,
		);
		return workout
			? `${meta} · ${m.exercise_linked_plan({ title: planTitle(workout.planId) })}`
			: meta;
	}
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden">
	<AppHeader
		title={m.exercise_title()}
		subtitle={m.exercise_subtitle()}
		backHref="/"
		actionLabel={m.common_add()}
		onaction={startNew}
	/>
	<div bind:this={scrollContainer} class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<div class="mx-auto max-w-md py-2">
			<ExerciseTabs active="records" />
			{#if formOpen}
				<BlockTitle>{editingId ? m.exercise_edit() : m.exercise_add()}</BlockTitle>
				<List inset strong>
					<ListInput label={m.exercise_name()} type="text" bind:value={description} />
					<ListInput label={m.exercise_category()} type="select" bind:value={category}>
						{#each categories as value (value)}
							<option value={value}>{categoryLabel(value)}</option>
						{/each}
					</ListInput>
					<ListInput label={m.exercise_intensity()} type="select" bind:value={intensity}>
						{#each intensities as value (value)}
							<option value={value}>{intensityLabel(value)}</option>
						{/each}
					</ListInput>
					<ListInput label={m.exercise_date()} type="date" max={localDateISO()} bind:value={date} />
					<ListInput label={m.exercise_time()} type="time" bind:value={time} />
					<ListInput
						label={m.exercise_duration()}
						type="number"
						inputmode="numeric"
						min="1"
						max="1440"
						placeholder={m.exercise_minutes_unit()}
						bind:value={duration}
					/>
					<ListInput
						label={m.exercise_calories()}
						type="number"
						inputmode="numeric"
						min="0"
						max="10000"
						placeholder="kcal"
						oninput={() => (autoCalories = false)}
						bind:value={calories}
					/>
					<ListInput
						label={m.exercise_plan_association()}
						type="select"
						bind:value={selectedPlannedWorkoutId}
					>
						<option value="">{m.exercise_no_plan_association()}</option>
						{#each associationOptions as workout (workout.id)}
							<option value={workout.id}>{associationLabel(workout)}</option>
						{/each}
					</ListInput>
				</List>
				<Block inset>
					<div class="flex items-start justify-between gap-3">
						<p class="text-xs leading-relaxed text-gray-500">{m.exercise_calorie_hint()}</p>
						<button
							type="button"
							onclick={() => (autoCalories = true)}
							class="shrink-0 text-xs font-medium text-blue-600"
						>
							{m.exercise_recalculate()}
						</button>
					</div>
					<p class="mt-2 text-xs leading-relaxed text-gray-500">
						{m.exercise_plan_association_hint()}
					</p>
					{#if error}<p class="mt-2 text-xs text-red-500">{error}</p>{/if}
					<div class="mt-4 grid grid-cols-2 gap-3">
						<button onclick={closeForm} class="rounded-full border border-gray-300 py-2.5 text-sm font-medium text-gray-600">
							{m.common_cancel()}
						</button>
						<button
							onclick={saveEntry}
							disabled={!formValid || saving}
							class="rounded-full bg-blue-500 py-2.5 text-sm font-medium text-white disabled:opacity-50"
						>
							{saving ? m.common_saving() : m.common_save()}
						</button>
					</div>
				</Block>
			{/if}

			<BlockTitle>{m.exercise_range()}</BlockTitle>
			<Block inset>
				<Segmented>
					<SegmentedButton active={range === '7d'} onclick={() => (range = '7d')}>{m.weight_range_7d()}</SegmentedButton>
					<SegmentedButton active={range === '30d'} onclick={() => (range = '30d')}>{m.weight_range_30d()}</SegmentedButton>
					<SegmentedButton active={range === '90d'} onclick={() => (range = '90d')}>{m.exercise_range_90d()}</SegmentedButton>
					<SegmentedButton active={range === 'all'} onclick={() => (range = 'all')}>{m.weight_range_all()}</SegmentedButton>
				</Segmented>
			</Block>

			<BlockTitle>{m.exercise_summary()}</BlockTitle>
			<Block inset strong>
				<div class="grid grid-cols-2 gap-3 text-center">
					<div class="rounded-xl bg-blue-50 p-3">
						<p class="text-xl font-bold text-blue-700">{visible.length}</p>
						<p class="text-xs text-blue-600">{m.exercise_sessions()}</p>
					</div>
					<div class="rounded-xl bg-emerald-50 p-3">
						<p class="text-xl font-bold text-emerald-700">{Math.round(totalMinutes)}</p>
						<p class="text-xs text-emerald-600">{m.exercise_total_minutes()}</p>
					</div>
					<div class="rounded-xl bg-violet-50 p-3">
						<p class="text-xl font-bold text-violet-700">{activeDays}</p>
						<p class="text-xs text-violet-600">{m.exercise_active_days()}</p>
					</div>
					<div class="rounded-xl bg-amber-50 p-3">
						<p class="text-xl font-bold text-amber-700">{Math.round(totalCalories)}</p>
						<p class="text-xs text-amber-600">{m.exercise_estimated_calories()}</p>
					</div>
				</div>
				<p class="mt-3 text-center text-[11px] leading-relaxed text-gray-400">
					{m.exercise_budget_note()}
				</p>
			</Block>

			{#if visible.length}
				<BlockTitle>{m.exercise_minutes_chart()}</BlockTitle>
				<Block inset strong>
					<div class="overflow-x-auto [-webkit-overflow-scrolling:touch]">
						<div style:min-width="{chartWidth}px">
							<ExerciseMinutesChart data={chartPoints} />
						</div>
					</div>
				</Block>
			{/if}

			<BlockTitle>{m.exercise_records()}</BlockTitle>
			<div class="mx-4 mb-5">
				{#if loading}
					<div class="rounded-2xl bg-white p-6 text-center text-sm text-gray-400 shadow-sm">
						{m.common_loading()}
					</div>
				{:else if visible.length === 0}
					<div class="rounded-2xl bg-white p-6 text-center shadow-sm">
						<p class="text-sm text-gray-400">{m.exercise_empty()}</p>
						<button onclick={startNew} class="mt-2 text-sm font-medium text-blue-600">{m.exercise_add_first()}</button>
					</div>
				{:else}
					<div class="space-y-2">
						{#each visible as entry, index (entry.id)}
							{#if index === 0 || visible[index - 1].date !== entry.date}
								<p class="px-1 pt-2 text-xs font-medium text-gray-500">
									{dateFormatter.format(parseLocalDate(entry.date))}
								</p>
							{/if}
							<SwipeListItem
								id={entry.id}
								title={`${categoryIcon(entry.category)} ${entry.description}`}
								subtitle={recordSubtitle(entry)}
								deleteAriaLabel={m.exercise_delete_aria({ name: entry.description })}
								deletingLabel={m.exercise_deleting()}
								revealed={revealedId === entry.id}
								onreveal={(id) => (revealedId = id)}
								onselect={startEdit}
								ondelete={requestDelete}
							/>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<AppDialog
	bind:open={deleteDialogOpen}
	title={m.exercise_delete_title()}
	message={pendingDelete
		? m.exercise_delete_message({ name: pendingDelete.description, minutes: pendingDelete.duration })
		: ''}
	kind="confirm"
	confirmLabel={m.common_delete()}
	onconfirm={confirmDelete}
	onclose={() => (pendingDelete = null)}
/>
