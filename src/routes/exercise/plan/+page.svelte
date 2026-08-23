<script lang="ts">
	import { Block, BlockTitle, List, ListInput } from "konsta/svelte";
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import AppDialog from "$lib/components/AppDialog.svelte";
	import AppHeader from "$lib/components/AppHeader.svelte";
	import ExerciseTabs from "$lib/components/exercise/ExerciseTabs.svelte";
	import { app } from "$lib/context/appContext.svelte";
	import {
		addPlannedWorkout,
		addUserMessageWithMemorySync,
		archiveTrainingPlan,
		completePlannedWorkout,
		createSession,
		createTrainingPlan,
		deletePlannedWorkout,
		getCurrentTrainingPlan,
		getPlannedWorkouts,
		getTrainingPlans,
		setTrainingPlanStatus,
		updatePlannedWorkout,
	} from "$lib/db/repositories";
	import type {
		ExerciseCategory,
		ExerciseIntensity,
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

	type FormMode = "plan" | "add" | "edit" | "complete" | null;
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

	let plan = $state<TrainingPlan | null>(null);
	let workouts = $state<PlannedWorkout[]>([]);
	let recentPlans = $state<TrainingPlan[]>([]);
	let loading = $state(true);
	let formMode = $state<FormMode>(null);
	let editingId = $state<string | null>(null);
	let saving = $state(false);
	let error = $state("");

	let planTitle = $state("");
	let planGoal = $state("");
	let planStartDate = $state(localDateISO());
	let planEndDate = $state("");

	let description = $state("");
	let category = $state<ExerciseCategory>("other");
	let intensity = $state<ExerciseIntensity>("moderate");
	let workoutDate = $state(localDateISO());
	let workoutTime = $state("");
	let plannedDuration = $state("30");
	let estimatedCalories = $state("");
	let notes = $state("");
	let autoCalories = $state(true);

	let actualDate = $state(localDateISO());
	let actualTime = $state(localTimeHHMM());
	let actualDuration = $state("30");
	let actualCalories = $state("");
	let autoActualCalories = $state(true);

	let pendingDelete = $state<PlannedWorkout | null>(null);
	let deleteDialogOpen = $state(false);
	let archiveDialogOpen = $state(false);
	let scrollContainer = $state<HTMLDivElement>();

	const dateFormatter = new Intl.DateTimeFormat(getLocale(), {
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
			const [current, plans] = await Promise.all([
				getCurrentTrainingPlan(),
				getTrainingPlans(),
			]);
			const displayedPlan =
				current ??
				plans.find((item) => item.status === "completed") ??
				plans.find((item) => item.status === "archived") ??
				null;
			plan = displayedPlan;
			workouts = displayedPlan
				? await getPlannedWorkouts(displayedPlan.id)
				: [];
			recentPlans = plans
				.filter((item) => item.id !== displayedPlan?.id)
				.slice(0, 5);
		} finally {
			loading = false;
		}
	}

	let today = $derived(localDateISO());
	let planEditable = $derived(
		plan?.status === "active" || plan?.status === "paused",
	);
	let planned = $derived(
		workouts.filter((workout) => workout.status === "planned"),
	);
	let overdue = $derived(planned.filter((workout) => workout.date < today));
	let todayWorkouts = $derived(
		planned.filter((workout) => workout.date === today),
	);
	let upcoming = $derived(planned.filter((workout) => workout.date > today));
	let completed = $derived(
		workouts.filter((workout) => workout.status === "completed"),
	);
	let skipped = $derived(
		workouts.filter((workout) => workout.status === "skipped"),
	);
	let weekStart = $derived(
		localDateOffset(
			-((parseLocalDate(today).getDay() + 6) % 7),
			parseLocalDate(today),
		),
	);
	let weekEnd = $derived(localDateOffset(6, parseLocalDate(weekStart)));
	let weekWorkouts = $derived(
		workouts.filter(
			(workout) => workout.date >= weekStart && workout.date <= weekEnd,
		),
	);
	let weekCompleted = $derived(
		weekWorkouts.filter((workout) => workout.status === "completed"),
	);
	let weekCompletedMinutes = $derived(
		weekCompleted.reduce((sum, workout) => sum + workout.plannedDuration, 0),
	);
	let weekPlannedMinutes = $derived(
		weekWorkouts.reduce((sum, workout) => sum + workout.plannedDuration, 0),
	);
	let planFormValid = $derived(
		planTitle.trim().length > 0 &&
			/^\d{4}-\d{2}-\d{2}$/.test(planStartDate) &&
			planStartDate >= localDateISO() &&
			(!planEndDate || planEndDate >= planStartDate),
	);
	let workoutFormValid = $derived(
		description.trim().length > 0 &&
			/^\d{4}-\d{2}-\d{2}$/.test(workoutDate) &&
			(formMode === "edit" || workoutDate >= localDateISO()) &&
			(!workoutTime || /^([01]\d|2[0-3]):[0-5]\d$/.test(workoutTime)) &&
			Number.isFinite(+plannedDuration) &&
			+plannedDuration >= 1 &&
			+plannedDuration <= 1440 &&
			Number.isFinite(+estimatedCalories) &&
			+estimatedCalories >= 0,
	);
	let completionFormValid = $derived(
		/^\d{4}-\d{2}-\d{2}$/.test(actualDate) &&
			actualDate <= localDateISO() &&
			/^([01]\d|2[0-3]):[0-5]\d$/.test(actualTime) &&
			Number.isFinite(+actualDuration) &&
			+actualDuration >= 1 &&
			+actualDuration <= 1440 &&
			Number.isFinite(+actualCalories) &&
			+actualCalories >= 0,
	);

	$effect(() => {
		if (!autoCalories) return;
		estimatedCalories = String(
			estimateExerciseCalories({
				category,
				intensity,
				duration: Number(plannedDuration),
				weight: app.user?.currentWeight ?? 70,
			}),
		);
	});

	$effect(() => {
		if (!autoActualCalories) return;
		actualCalories = String(
			estimateExerciseCalories({
				category,
				intensity,
				duration: Number(actualDuration),
				weight: app.user?.currentWeight ?? 70,
			}),
		);
	});

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

	function categoryIcon(value: ExerciseCategory): string {
		return {
			walking: "🚶",
			running: "🏃",
			cycling: "🚴",
			strength: "🏋️",
			swimming: "🏊",
			sports: "⚽",
			other: "🏃",
		}[value];
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

	function openPlanForm() {
		planTitle = "";
		planGoal = "";
		planStartDate = localDateISO();
		planEndDate = "";
		error = "";
		formMode = "plan";
		scrollToTop();
	}

	function resetWorkoutForm() {
		description = "";
		category = "other";
		intensity = "moderate";
		workoutDate =
			plan?.startDate && plan.startDate > today ? plan.startDate : today;
		workoutTime = "";
		plannedDuration = "30";
		estimatedCalories = "";
		notes = "";
		autoCalories = true;
		error = "";
	}

	function openAddForm() {
		if (!plan || !planEditable) return;
		editingId = null;
		resetWorkoutForm();
		formMode = "add";
		scrollToTop();
	}

	function openEditForm(workout: PlannedWorkout) {
		editingId = workout.id;
		description = workout.description;
		category = workout.category;
		intensity = workout.intensity;
		workoutDate = workout.date;
		workoutTime = workout.time ?? "";
		plannedDuration = String(workout.plannedDuration);
		estimatedCalories = String(workout.estimatedCalories ?? 0);
		notes = workout.notes ?? "";
		autoCalories = false;
		error = "";
		formMode = "edit";
		scrollToTop();
	}

	function openCompletionForm(workout: PlannedWorkout) {
		editingId = workout.id;
		category = workout.category;
		intensity = workout.intensity;
		actualDate = localDateISO();
		actualTime = localTimeHHMM();
		actualDuration = String(workout.plannedDuration);
		actualCalories = "";
		autoActualCalories = true;
		error = "";
		formMode = "complete";
		scrollToTop();
	}

	function closeForm() {
		formMode = null;
		editingId = null;
		error = "";
	}

	async function savePlan() {
		if (!planFormValid || saving) return;
		saving = true;
		try {
			await createTrainingPlan({
				title: planTitle,
				goal: planGoal || undefined,
				startDate: planStartDate,
				endDate: planEndDate || undefined,
			});
			closeForm();
			await reload();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			saving = false;
		}
	}

	async function saveWorkout() {
		if (!plan || !workoutFormValid || saving) return;
		saving = true;
		try {
			const values = {
				date: workoutDate,
				time: workoutTime || undefined,
				category,
				description: description.trim(),
				intensity,
				plannedDuration: +plannedDuration,
				estimatedCalories: +estimatedCalories,
				notes: notes.trim() || undefined,
			};
			if (formMode === "edit" && editingId) {
				await updatePlannedWorkout(editingId, values);
			} else {
				await addPlannedWorkout(plan.id, values);
			}
			closeForm();
			await reload();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			saving = false;
		}
	}

	async function completeWorkout() {
		if (!editingId || !completionFormValid || saving) return;
		saving = true;
		try {
			await completePlannedWorkout(editingId, {
				date: actualDate,
				time: actualTime,
				duration: +actualDuration,
				caloriesBurned: +actualCalories,
			});
			closeForm();
			await Promise.all([reload(), app.refreshToday()]);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			saving = false;
		}
	}

	async function setWorkoutStatus(
		workout: PlannedWorkout,
		status: "planned" | "skipped",
	) {
		await updatePlannedWorkout(workout.id, { status });
		await reload();
	}

	async function togglePause() {
		if (!plan) return;
		await setTrainingPlanStatus(
			plan.id,
			plan.status === "paused" ? "active" : "paused",
		);
		await reload();
	}

	function requestDelete(workout: PlannedWorkout) {
		pendingDelete = workout;
		deleteDialogOpen = true;
	}

	async function confirmDelete() {
		if (!pendingDelete) return;
		await deletePlannedWorkout(pendingDelete.id);
		pendingDelete = null;
		await reload();
	}

	async function confirmArchive() {
		if (!plan) return;
		await archiveTrainingPlan(plan.id, plan.title);
		closeForm();
		await reload();
	}

	async function askKalo() {
		const english = getLocale() === "en-us";
		const adjusting = planEditable;
		const session = await createSession(
			adjusting
				? english
					? "Adjust my training plan"
					: "调整训练计划"
				: english
					? "Create a training plan"
					: "制定训练计划",
		);
		await addUserMessageWithMemorySync({
			sessionId: session.id,
			content: [
				{
					type: "text",
					text: adjusting
						? english
							? "Please review my current training plan and help me adjust it. Ask what changed before modifying any scheduled workouts."
							: "请查看我当前的训练计划并帮我调整。修改任何计划训练前，请先询问我的情况发生了什么变化。"
						: english
							? "Help me create a safe and practical training plan. Please ask about my weekly availability, session length, experience, equipment, preferences, and any injury constraints before proposing the plan."
							: "请帮我制定一个安全、可执行的训练计划。请先询问我每周可训练天数、单次时间、经验、器材、偏好和伤病限制，再给出计划草案。",
				},
			],
		});
		await app.refreshSessions();
		await goto(`/chat/${session.id}`);
	}
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden">
	<AppHeader
		title={m.training_plan_title()}
		subtitle={m.training_plan_subtitle()}
		backHref="/"
		actionLabel={planEditable ? m.training_add_workout() : m.training_new_plan()}
		onaction={planEditable ? openAddForm : openPlanForm}
	/>
	<div bind:this={scrollContainer} class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<div class="mx-auto max-w-md py-2">
			<ExerciseTabs active="plan" />

			{#if formMode === 'plan'}
				<BlockTitle>{m.training_new_plan()}</BlockTitle>
				<List inset strong>
					<ListInput label={m.training_plan_name()} type="text" bind:value={planTitle} />
					<ListInput label={m.training_goal()} type="text" bind:value={planGoal} />
					<ListInput label={m.training_start_date()} type="date" min={localDateISO()} bind:value={planStartDate} />
					<ListInput label={m.training_end_date()} type="date" min={planStartDate} bind:value={planEndDate} />
				</List>
				<Block inset>
					{#if error}<p class="mb-3 text-xs text-red-500">{error}</p>{/if}
					<div class="grid grid-cols-2 gap-3">
						<button onclick={closeForm} class="rounded-full border border-gray-300 py-2.5 text-sm font-medium text-gray-600">{m.common_cancel()}</button>
						<button onclick={savePlan} disabled={!planFormValid || saving} class="rounded-full bg-blue-500 py-2.5 text-sm font-medium text-white disabled:opacity-50">
							{saving ? m.common_saving() : m.common_save()}
						</button>
					</div>
				</Block>
			{:else if formMode === 'add' || formMode === 'edit'}
				<BlockTitle>{formMode === 'edit' ? m.training_edit_workout() : m.training_add_workout()}</BlockTitle>
				<List inset strong>
					<ListInput label={m.exercise_name()} type="text" bind:value={description} />
					<ListInput label={m.exercise_category()} type="select" bind:value={category}>
						{#each categories as value (value)}<option value={value}>{categoryLabel(value)}</option>{/each}
					</ListInput>
					<ListInput label={m.exercise_intensity()} type="select" bind:value={intensity}>
						{#each intensities as value (value)}<option value={value}>{intensityLabel(value)}</option>{/each}
					</ListInput>
					<ListInput label={m.exercise_date()} type="date" min={formMode === 'add' ? localDateISO() : undefined} bind:value={workoutDate} />
					<ListInput label={m.exercise_time()} type="time" bind:value={workoutTime} />
					<ListInput label={m.training_planned_duration()} type="number" min="1" max="1440" bind:value={plannedDuration} />
					<ListInput label={m.training_estimated_calories()} type="number" min="0" max="10000" oninput={() => (autoCalories = false)} bind:value={estimatedCalories} />
					<ListInput label={m.training_notes()} type="text" bind:value={notes} />
				</List>
				<Block inset>
					<div class="flex items-start justify-between gap-3">
						<p class="text-xs text-gray-500">{m.training_estimate_hint()}</p>
						<button onclick={() => (autoCalories = true)} class="shrink-0 text-xs font-medium text-blue-600">{m.exercise_recalculate()}</button>
					</div>
					{#if error}<p class="mt-2 text-xs text-red-500">{error}</p>{/if}
					<div class="mt-4 grid grid-cols-2 gap-3">
						<button onclick={closeForm} class="rounded-full border border-gray-300 py-2.5 text-sm font-medium text-gray-600">{m.common_cancel()}</button>
						<button onclick={saveWorkout} disabled={!workoutFormValid || saving} class="rounded-full bg-blue-500 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? m.common_saving() : m.common_save()}</button>
					</div>
				</Block>
			{:else if formMode === 'complete'}
				<BlockTitle>{m.training_complete_workout()}</BlockTitle>
				<List inset strong>
					<ListInput label={m.training_actual_date()} type="date" max={localDateISO()} bind:value={actualDate} />
					<ListInput label={m.training_actual_time()} type="time" bind:value={actualTime} />
					<ListInput label={m.training_actual_duration()} type="number" min="1" max="1440" bind:value={actualDuration} />
					<ListInput label={m.exercise_calories()} type="number" min="0" max="10000" oninput={() => (autoActualCalories = false)} bind:value={actualCalories} />
				</List>
				<Block inset>
					<div class="flex items-start justify-between gap-3">
						<p class="text-xs text-gray-500">{m.training_complete_hint()}</p>
						<button onclick={() => (autoActualCalories = true)} class="shrink-0 text-xs font-medium text-blue-600">{m.exercise_recalculate()}</button>
					</div>
					{#if error}<p class="mt-2 text-xs text-red-500">{error}</p>{/if}
					<div class="mt-4 grid grid-cols-2 gap-3">
						<button onclick={closeForm} class="rounded-full border border-gray-300 py-2.5 text-sm font-medium text-gray-600">{m.common_cancel()}</button>
						<button onclick={completeWorkout} disabled={!completionFormValid || saving} class="rounded-full bg-emerald-500 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? m.common_saving() : m.training_mark_complete()}</button>
					</div>
				</Block>
			{/if}

			{#if loading}
				<Block inset strong><p class="text-center text-sm text-gray-400">{m.common_loading()}</p></Block>
			{:else if !plan}
				<BlockTitle>{m.training_current_plan()}</BlockTitle>
				<Block inset strong>
					<div class="py-3 text-center">
						<p class="text-sm text-gray-500">{m.training_no_plan()}</p>
						<button onclick={askKalo} class="mt-3 rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-medium text-white">{m.training_ask_kalo()}</button>
					</div>
				</Block>
				{#if recentPlans.length}
					<BlockTitle>{m.training_recent_plans()}</BlockTitle>
					<Block inset strong>
						<ul class="divide-y divide-gray-100">
							{#each recentPlans as item (item.id)}
								<li class="py-2.5">
									<p class="text-sm font-medium">{item.title}</p>
									<p class="text-xs text-gray-400">{item.status === 'completed' ? m.training_status_completed() : m.training_status_archived()}</p>
								</li>
							{/each}
						</ul>
					</Block>
				{/if}
			{:else}
				<BlockTitle>{planEditable ? m.training_current_plan() : m.training_plan_details()}</BlockTitle>
				<Block inset strong>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<h2 class="truncate text-base font-semibold">{plan.title}</h2>
							{#if plan.goal}<p class="mt-1 text-xs leading-relaxed text-gray-500">{plan.goal}</p>{/if}
							<p class="mt-1 text-[11px] text-gray-400">
								{dateFormatter.format(parseLocalDate(plan.startDate))}
								{#if plan.endDate} – {dateFormatter.format(parseLocalDate(plan.endDate))}{/if}
							</p>
						</div>
						<span class="rounded-full px-2 py-1 text-[11px] font-medium {plan.status === 'paused'
							? 'bg-amber-50 text-amber-700'
							: plan.status === 'completed'
								? 'bg-emerald-50 text-emerald-700'
								: plan.status === 'archived'
									? 'bg-gray-100 text-gray-600'
									: 'bg-blue-50 text-blue-700'}">
							{plan.status === 'paused'
								? m.training_status_paused()
								: plan.status === 'completed'
									? m.training_status_completed()
									: plan.status === 'archived'
										? m.training_status_archived()
										: m.training_status_active()}
						</span>
					</div>
					{#if planEditable}
						<div class="mt-4 grid grid-cols-3 gap-2 text-center">
							<div class="rounded-xl bg-gray-50 p-2"><p class="font-semibold">{weekCompleted.length}/{weekWorkouts.length}</p><p class="text-[11px] text-gray-400">{m.training_week_sessions()}</p></div>
							<div class="rounded-xl bg-gray-50 p-2"><p class="font-semibold">{weekCompletedMinutes}/{weekPlannedMinutes}</p><p class="text-[11px] text-gray-400">{m.training_week_minutes()}</p></div>
							<div class="rounded-xl bg-gray-50 p-2"><p class="font-semibold">{completed.length}/{workouts.length}</p><p class="text-[11px] text-gray-400">{m.training_plan_progress()}</p></div>
						</div>
						<div class="mt-4 grid grid-cols-3 gap-2">
							<button onclick={togglePause} class="rounded-full border border-gray-300 py-2 text-xs font-medium text-gray-600">{plan.status === 'paused' ? m.training_resume() : m.training_pause()}</button>
							<button onclick={askKalo} class="rounded-full border border-emerald-300 py-2 text-xs font-medium text-emerald-600">{m.training_adjust_with_kalo()}</button>
							<button onclick={() => (archiveDialogOpen = true)} class="rounded-full border border-red-200 py-2 text-xs font-medium text-red-500">{m.training_archive()}</button>
						</div>
					{:else}
						<div class="mt-4 rounded-xl bg-gray-50 p-3 text-center">
							<p class="text-lg font-semibold">{completed.length}/{workouts.length}</p>
							<p class="text-[11px] text-gray-400">{m.training_plan_progress()}</p>
						</div>
					{/if}
				</Block>

				{#if plan.status === 'paused'}
					<Block inset><p class="text-center text-xs text-amber-700">{m.training_paused_hint()}</p></Block>
				{/if}

				{#if overdue.length}
					<BlockTitle>{m.training_overdue()}</BlockTitle>
					<Block>
						{#each overdue as workout (workout.id)}{@render workoutCard(workout)}{/each}
					</Block>
				{/if}
				{#if todayWorkouts.length}
					<BlockTitle>{m.training_today()}</BlockTitle>
					<Block>
						{#each todayWorkouts as workout (workout.id)}{@render workoutCard(workout)}{/each}
					</Block>
				{/if}
				{#if upcoming.length}
					<BlockTitle>{m.training_upcoming()}</BlockTitle>
					<Block>
						{#each upcoming as workout (workout.id)}{@render workoutCard(workout)}{/each}
					</Block>
				{/if}
				{#if completed.length || skipped.length}
					<BlockTitle>{m.training_history()}</BlockTitle>
					<Block>
						{#each [...completed, ...skipped].sort((a, b) => b.date.localeCompare(a.date)) as workout (workout.id)}
							{@render workoutCard(workout)}
						{/each}
					</Block>
				{/if}
				{#if workouts.length === 0}
					<Block inset strong>
						<div class="py-3 text-center">
							<p class="text-sm text-gray-400">{m.training_no_workouts()}</p>
							{#if planEditable}
								<button onclick={openAddForm} class="mt-2 text-sm font-medium text-blue-600">{m.training_add_workout()}</button>
							{/if}
						</div>
					</Block>
				{/if}
			{/if}
		</div>
	</div>
</div>

{#snippet workoutCard(workout: PlannedWorkout)}
	<div class="mb-2 rounded-2xl bg-white p-4 shadow-sm">
		<div class="flex items-start justify-between gap-3">
			<div class="min-w-0">
				<p class="truncate text-sm font-medium">{categoryIcon(workout.category)} {workout.description}</p>
				<p class="mt-1 text-xs text-gray-400">
					{dateFormatter.format(parseLocalDate(workout.date))}
					{#if workout.time} · {workout.time}{/if}
					· {workout.plannedDuration} {m.exercise_minutes_unit()}
					· {intensityLabel(workout.intensity)}
				</p>
				{#if workout.notes}<p class="mt-1 text-xs text-gray-500">{workout.notes}</p>{/if}
			</div>
			<span class="shrink-0 rounded-full px-2 py-1 text-[11px] font-medium {workout.status === 'completed'
				? 'bg-emerald-50 text-emerald-700'
				: workout.status === 'skipped'
					? 'bg-gray-100 text-gray-500'
					: workout.date < today
						? 'bg-red-50 text-red-600'
						: 'bg-blue-50 text-blue-600'}">
				{workout.status === 'completed'
					? m.training_status_completed()
					: workout.status === 'skipped'
						? m.training_status_skipped()
						: workout.date < today
							? m.training_status_overdue()
							: m.training_status_planned()}
			</span>
		</div>
		{#if workout.status === 'planned' && planEditable}
			<div class="mt-3 grid grid-cols-3 gap-2">
				<button onclick={() => openCompletionForm(workout)} class="rounded-full bg-emerald-500 py-2 text-xs font-medium text-white">{m.training_complete()}</button>
				<button onclick={() => setWorkoutStatus(workout, 'skipped')} class="rounded-full border border-gray-300 py-2 text-xs font-medium text-gray-600">{m.training_skip()}</button>
				<button onclick={() => openEditForm(workout)} class="rounded-full border border-blue-200 py-2 text-xs font-medium text-blue-600">{m.training_adjust()}</button>
			</div>
		{:else if workout.status === 'skipped' && planEditable}
			<div class="mt-3 grid grid-cols-3 gap-2">
				<button onclick={() => setWorkoutStatus(workout, 'planned')} class="rounded-full border border-emerald-300 py-2 text-xs font-medium text-emerald-600">{m.training_restore()}</button>
				<button onclick={() => openEditForm(workout)} class="rounded-full border border-blue-200 py-2 text-xs font-medium text-blue-600">{m.training_adjust()}</button>
				<button onclick={() => requestDelete(workout)} class="rounded-full border border-red-200 py-2 text-xs font-medium text-red-500">{m.common_delete()}</button>
			</div>
		{:else if workout.exerciseEntryId}
			<a
				href={`/exercise?entry=${workout.exerciseEntryId}`}
				class="mt-3 block rounded-full border border-blue-200 py-2 text-center text-xs font-medium text-blue-600"
			>
				{m.training_view_exercise_record()}
			</a>
		{/if}
	</div>
{/snippet}

<AppDialog
	bind:open={deleteDialogOpen}
	title={m.training_delete_workout_title()}
	message={pendingDelete ? m.training_delete_workout_message({ name: pendingDelete.description }) : ''}
	kind="confirm"
	confirmLabel={m.common_delete()}
	onconfirm={confirmDelete}
	onclose={() => (pendingDelete = null)}
/>
<AppDialog
	bind:open={archiveDialogOpen}
	title={m.training_archive_title()}
	message={plan ? m.training_archive_message({ title: plan.title }) : ''}
	kind="confirm"
	confirmLabel={m.training_archive()}
	onconfirm={confirmArchive}
/>
