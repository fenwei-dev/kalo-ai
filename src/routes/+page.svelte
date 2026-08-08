<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Dialog, DialogButton } from 'konsta/svelte';
	import { app } from '$lib/context/appContext.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import ProgressRing from '$lib/components/charts/ProgressRing.svelte';
	import WeightSparkline from '$lib/components/charts/WeightSparkline.svelte';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { localDateISO, localDateOffset, parseLocalDate } from '$lib/utils/date';

	let intake = $derived(app.today.food.reduce((s, e) => s + e.calories, 0));
	let burned = $derived(app.today.exercise.reduce((s, e) => s + e.caloriesBurned, 0));
	let protein = $derived(app.today.food.reduce((s, e) => s + e.protein, 0));
	let carbs = $derived(app.today.food.reduce((s, e) => s + e.carbs, 0));
	let fat = $derived(app.today.food.reduce((s, e) => s + e.fat, 0));
	let visibleWeights = $derived(weightEntriesForLast30Days());
	let weightSeries = $derived(visibleWeights.map((w) => w.weight));

	function weightEntriesForLast30Days() {
		const start = localDateOffset(-29, parseLocalDate(app.viewDate));
		const latestByDate = new Map<string, (typeof app.weightHistory)[number]>();
		for (const entry of app.weightHistory) {
			if (entry.date >= start && entry.date <= app.viewDate) latestByDate.set(entry.date, entry);
		}
		return [...latestByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
	}
	let currentDate = $derived(localDateISO());
	let isToday = $derived(app.viewDate === currentDate);
	let dateLabel = $derived(formatViewDate(app.viewDate));
	let dateDialogOpen = $state(false);
	let pendingDate = $state(app.viewDate);

	// App context is a long-lived cache. Refresh when entering or refocusing the
	// dashboard so writes from chat, settings, app resume, or another tab are visible.
	onMount(() => {
		const refresh = () => void app.refreshToday();
		const refreshWhenVisible = () => {
			if (document.visibilityState === 'visible') refresh();
		};
		refresh();
		window.addEventListener('focus', refresh);
		document.addEventListener('visibilitychange', refreshWhenVisible);
		return () => {
			window.removeEventListener('focus', refresh);
			document.removeEventListener('visibilitychange', refreshWhenVisible);
		};
	});

	function formatViewDate(value: string): string {
		if (value === localDateISO()) return m.home_selected_today();
		if (value === localDateOffset(-1)) return m.home_selected_yesterday();
		return new Intl.DateTimeFormat(getLocale(), {
			month: 'short', day: 'numeric', weekday: 'short', year: 'numeric'
		}).format(parseLocalDate(value));
	}

	function openDateDialog() {
		pendingDate = app.viewDate;
		dateDialogOpen = true;
	}

	async function applyDate() {
		if (pendingDate && pendingDate <= localDateISO()) await app.setViewDate(pendingDate);
		dateDialogOpen = false;
	}

	async function returnToday() {
		pendingDate = localDateISO();
		await app.setViewDate(pendingDate);
		dateDialogOpen = false;
	}

	let todayList = $derived(
		[
			...app.today.food.map((f) => ({ kind: 'food' as const, time: f.time, icon: '🍽️', name: f.name, value: `${f.calories} kcal` })),
			...app.today.exercise.map((e) => ({ kind: 'exercise' as const, time: e.time, icon: '🏃', name: e.description, value: `-${e.caloriesBurned} kcal` }))
		].sort((a, b) => b.time.localeCompare(a.time))
	);
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden pb-16">
	<AppHeader
		title={m.home_title()}
		subtitle={m.home_subtitle()}
		actionLabel={dateLabel}
		onaction={app.onboarded ? openDateDialog : undefined}
	/>
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
	<div class="mx-auto max-w-md px-4 py-5">
		{#if !app.onboarded}
			<div class="rounded-2xl bg-emerald-50 p-5 text-center">
				<p class="text-sm font-medium text-emerald-700">{m.home_welcome()}</p>
				<p class="mt-1 text-xs text-emerald-600">{m.home_onboarding()}</p>
				<a href="/settings" class="mt-3 inline-block rounded-full bg-emerald-500 px-5 py-2 text-sm font-medium text-white"
					>{m.home_go_settings()}</a
				>
			</div>
		{:else}
			<!-- 状态条 -->
			<div class="rounded-2xl bg-white p-4 shadow-sm">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-xs text-gray-400">{m.home_budget()}</p>
						<p class="text-2xl font-bold">{app.dailyBudget || '—'}<span class="text-sm font-normal text-gray-400"> kcal</span></p>
					</div>
					<div class="text-right">
						<p class="text-xs text-gray-400">{m.home_intake_remaining()}</p>
						<p class="text-sm font-semibold {intake > (app.dailyBudget || Infinity) ? 'text-red-500' : 'text-gray-700'}">
							{intake} / {Math.max(0, (app.dailyBudget || 0) - intake)}
						</p>
					</div>
				</div>
				<div class="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
					<div
						class="h-full rounded-full {intake > (app.dailyBudget || Infinity) ? 'bg-red-400' : 'bg-emerald-500'}"
						style="width:{app.dailyBudget ? Math.min(100, (intake / app.dailyBudget) * 100) : 0}%"
					></div>
				</div>
				<div class="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
					<div><div class="font-semibold text-emerald-600">{Math.round(protein)}g</div><div class="text-gray-400">{m.home_protein()}</div></div>
					<div><div class="font-semibold text-amber-600">{Math.round(carbs)}g</div><div class="text-gray-400">{m.home_carbs()}</div></div>
					<div><div class="font-semibold text-sky-600">{Math.round(fat)}g</div><div class="text-gray-400">{m.home_fat()}</div></div>
					<div><div class="font-semibold text-gray-600">{burned}</div><div class="text-gray-400">{m.home_exercise()}</div></div>
				</div>
			</div>

			<!-- 进度环 + 体重趋势 -->
			<div class="mt-3 grid grid-cols-2 gap-3">
				<div class="flex flex-col items-center rounded-2xl bg-white p-4 shadow-sm">
					<ProgressRing
						current={intake}
						target={app.dailyBudget || 2000}
						label={m.home_intake_progress()}
					/>
				</div>
				<a
					href="/weight"
					aria-label={m.home_view_weight_details()}
					class="block rounded-2xl bg-white p-4 shadow-sm transition active:scale-[0.98]"
				>
					<div class="flex items-center justify-between gap-2">
						<p class="text-xs text-gray-400">{m.home_weight_trend()} {m.home_weight_trend_30d()}</p>
						<svg class="h-4 w-4 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" /></svg>
					</div>
					{#if visibleWeights.length}
						<p class="mt-1 text-lg font-bold">{visibleWeights[visibleWeights.length - 1].weight} kg</p>
					{:else}
						<p class="mt-1 text-lg font-bold text-gray-300">—</p>
					{/if}
					<div class="mt-2">
						<WeightSparkline weights={weightSeries} />
					</div>
				</a>
			</div>

			<!-- 卡卡的消息（主动消息，v1 占位） -->
			<a href="/chat" class="mt-3 block rounded-2xl bg-white p-4 shadow-sm">
				<div class="flex items-center gap-2">
					<span class="text-base">🌿</span>
					<span class="text-sm font-medium">{m.home_kaka()}</span>
				</div>
				<p class="mt-1 text-xs text-gray-400">{m.home_no_messages()}</p>
			</a>

			<!-- 今日时间线 -->
			<div class="mt-4">
				<div class="mb-2 flex items-center justify-between">
					<h2 class="text-sm font-semibold text-gray-700">{dateLabel}</h2>
					{#if !isToday}
						<button onclick={() => app.setViewDate(localDateISO())} class="text-xs font-medium text-emerald-600">{m.home_return_today()}</button>
					{/if}
				</div>
				{#if todayList.length === 0}
					<div class="rounded-2xl bg-white p-6 text-center shadow-sm">
						<p class="text-sm text-gray-400">{m.home_no_logs()}</p>
						<a href="/chat" class="mt-2 inline-block text-sm font-medium text-emerald-600">{m.home_chat_cta()}</a>
					</div>
				{:else}
					<ul class="space-y-2">
						{#each todayList as item (item.kind + item.time + item.name)}
							<li class="flex items-center gap-3 rounded-xl bg-white px-4 py-2.5 shadow-sm">
								<span class="text-lg">{item.icon}</span>
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">{item.name}</p>
									<p class="text-[11px] text-gray-400">{item.time}</p>
								</div>
								<span class="text-sm {item.kind === 'exercise' ? 'text-blue-500' : 'text-gray-600'}">{item.value}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<button
				onclick={() => goto('/chat')}
				class="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 font-medium text-white shadow-sm hover:bg-emerald-600"
			>
				{m.home_chat_cta()}
			</button>
		{/if}
	</div>
	</div>
</div>

{#snippet dateDialogTitle()}
	{m.home_select_date()}
{/snippet}
{#snippet dateDialogButtons()}
	{#if !isToday}
		<DialogButton onclick={returnToday}>{m.home_return_today()}</DialogButton>
	{/if}
	<DialogButton onclick={() => (dateDialogOpen = false)}>{m.common_cancel()}</DialogButton>
	<DialogButton strong onclick={applyDate}>{m.common_confirm()}</DialogButton>
{/snippet}

<Dialog
	opened={dateDialogOpen}
	title={dateDialogTitle}
	buttons={dateDialogButtons}
	onBackdropClick={() => (dateDialogOpen = false)}
>
	<div class="min-w-0 max-w-full overflow-hidden py-2">
		<label class="date-field relative block min-w-0 max-w-full">
			<input
				type="date"
				bind:value={pendingDate}
				max={currentDate}
				aria-label={m.home_select_date()}
				class="date-input block min-w-0 max-w-full rounded-xl border border-gray-200 bg-white py-3 pl-3 pr-11 text-gray-900 outline-none focus:border-emerald-500"
			/>
			<svg
				class="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 011 1v14H4V6a1 1 0 011-1z" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		</label>
	</div>
</Dialog>

<style>
	.date-input {
		width: 100%;
		box-sizing: border-box;
		-webkit-appearance: none;
		appearance: none;
	}

	.date-input::-webkit-calendar-picker-indicator {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}
</style>
