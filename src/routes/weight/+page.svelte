<script lang="ts">
	import { onMount } from 'svelte';
	import { Block, BlockTitle, Segmented, SegmentedButton } from 'konsta/svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import InteractiveWeightChart, { type WeightPoint } from '$lib/components/charts/InteractiveWeightChart.svelte';
	import { getWeightEntries } from '$lib/db/repositories';
	import type { WeightEntry } from '$lib/db/schema';
	import { app } from '$lib/context/appContext.svelte';
	import { getLocale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';
	import { localDateOffset, parseLocalDate } from '$lib/utils/date';

	type Range = '7d' | '30d' | '1y' | 'all';
	let range = $state<Range>('30d');
	let entries = $state<WeightEntry[]>([]);
	let selected = $state<WeightPoint | null>(null);

	const rangeDays: Record<Exclude<Range, 'all'>, number> = { '7d': 7, '30d': 30, '1y': 365 };
	const round = (value: number) => Math.round(value * 10) / 10;
	const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
	const dateFormat = new Intl.DateTimeFormat(getLocale(), { year: 'numeric', month: 'short', day: 'numeric' });

	onMount(async () => {
		entries = await getWeightEntries();
	});

	let sorted = $derived([...entries].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt));
	let visible = $derived(
		range === 'all'
			? sorted
			: sorted.filter((entry) => entry.date >= localDateOffset(-(rangeDays[range as Exclude<Range, 'all'>] - 1)))
	);
	let points = $derived(buildPoints(visible));
	let current = $derived(sorted.at(-1)?.weight ?? null);
	let change = $derived(visible.length >= 2 ? round(visible.at(-1)!.weight - visible[0].weight) : null);
	let goalDistance = $derived(current != null && app.user?.targetWeight != null ? round(current - app.user.targetWeight) : null);

	function buildPoints(items: WeightEntry[]): WeightPoint[] {
		const base = items.map((entry, index) => {
			const at = parseLocalDate(entry.date);
			const created = new Date(entry.createdAt);
			at.setHours(created.getHours(), created.getMinutes(), index % 60, 0);
			return { id: entry.id, at, date: entry.date, weight: entry.weight };
		});
		return base.map((point) => {
			const cutoff = new Date(point.at);
			cutoff.setDate(cutoff.getDate() - 6);
			const window = base.filter((candidate) => candidate.at >= cutoff && candidate.at <= point.at);
			return { ...point, average: round(window.reduce((sum, item) => sum + item.weight, 0) / window.length) };
		});
	}

	function selectRange(value: Range) {
		range = value;
		selected = null;
	}

	function previousDelta(entry: WeightEntry): number | null {
		const index = sorted.findIndex((item) => item.id === entry.id);
		return index > 0 ? round(entry.weight - sorted[index - 1].weight) : null;
	}

	function displayDate(entry: WeightEntry): string {
		return dateFormat.format(parseLocalDate(entry.date));
	}

</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden">
	<AppHeader title={m.weight_title()} subtitle={m.weight_subtitle()} backHref="/" />
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<div class="mx-auto max-w-md py-4">
			<Block inset>
				<Segmented>
					<SegmentedButton active={range === '7d'} onclick={() => selectRange('7d')}>{m.weight_range_7d()}</SegmentedButton>
					<SegmentedButton active={range === '30d'} onclick={() => selectRange('30d')}>{m.weight_range_30d()}</SegmentedButton>
					<SegmentedButton active={range === '1y'} onclick={() => selectRange('1y')}>{m.weight_range_1y()}</SegmentedButton>
					<SegmentedButton active={range === 'all'} onclick={() => selectRange('all')}>{m.weight_range_all()}</SegmentedButton>
				</Segmented>
			</Block>

			<div class="mx-4 grid grid-cols-3 gap-2">
				<div class="rounded-xl bg-white p-3 text-center shadow-sm">
					<p class="text-[10px] text-gray-400">{m.weight_current()}</p>
					<p class="mt-1 text-base font-bold">{current == null ? '—' : `${current} kg`}</p>
				</div>
				<div class="rounded-xl bg-white p-3 text-center shadow-sm">
					<p class="text-[10px] text-gray-400">{m.weight_change()}</p>
					<p class="mt-1 text-base font-bold {change != null && change > 0 ? 'text-amber-600' : 'text-emerald-600'}">{change == null ? '—' : `${signed(change)} kg`}</p>
				</div>
				<div class="rounded-xl bg-white p-3 text-center shadow-sm">
					<p class="text-[10px] text-gray-400">{m.weight_records()}</p>
					<p class="mt-1 text-base font-bold">{visible.length}</p>
				</div>
			</div>

			{#if goalDistance != null}
				<p class="mx-4 mt-2 text-center text-xs text-gray-500">{m.weight_from_goal()}: <strong>{Math.max(0, goalDistance).toFixed(1)} kg</strong></p>
			{/if}

			<BlockTitle>{m.weight_chart_title()}</BlockTitle>
			<Block inset strong>
				{#if points.length >= 1}
					<InteractiveWeightChart data={points} targetWeight={app.user?.targetWeight} onselect={(point) => (selected = point)} />
					<p class="mt-1 text-center text-[10px] text-gray-400">{m.weight_chart_hint()}</p>
					{#if selected}
						<div class="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-center">
							<p class="text-xs text-emerald-700">{dateFormat.format(selected.at)}</p>
							<p class="mt-0.5 text-lg font-bold text-emerald-800">{selected.weight.toFixed(1)} kg</p>
						</div>
					{/if}
				{:else}
					<div class="py-12 text-center">
						<p class="text-sm text-gray-500">{m.weight_no_data()}</p>
						<p class="mt-1 text-xs text-gray-400">{m.weight_no_data_hint()}</p>
					</div>
				{/if}
			</Block>

			<h2 class="mx-4 mb-3 mt-7 text-sm font-semibold text-gray-600">{m.weight_history()}</h2>
			<div class="mx-4 mb-6 overflow-hidden rounded-2xl bg-white shadow-sm">
				{#each [...visible].reverse() as entry, index (entry.id)}
					{@const delta = previousDelta(entry)}
					<div class="flex items-center justify-between gap-4 px-4 py-3 {index ? 'border-t border-gray-100' : ''}">
						<div class="min-w-0">
							<p class="truncate text-sm text-gray-700">{displayDate(entry)}</p>
							<p class="mt-0.5 text-[11px] text-gray-400">
								{delta == null ? m.weight_first_record() : m.weight_delta_previous({ value: signed(delta) })}
							</p>
						</div>
						<p class="shrink-0 text-base font-bold text-gray-900">{entry.weight.toFixed(1)} kg</p>
					</div>
				{:else}
					<div class="px-4 py-8 text-center text-sm text-gray-400">{m.weight_no_data()}</div>
				{/each}
			</div>
		</div>
	</div>
</div>
