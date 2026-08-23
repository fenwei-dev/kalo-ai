<script lang="ts">
	import { BarChart } from "layerchart";
	import { getLocale } from "$lib/paraglide/runtime";

	export interface ExerciseChartPoint {
		date: string;
		minutes: number;
	}

	let { data }: { data: ExerciseChartPoint[] } = $props();

	const dateFormatter = new Intl.DateTimeFormat(getLocale(), {
		month: "short",
		day: "numeric",
	});
	const formatDate = (value: string) =>
		dateFormatter.format(new Date(`${value}T12:00:00`));
	const formatMinutes = (value: number) =>
		getLocale() === "zh-cn"
			? `${Math.round(value)} 分钟`
			: `${Math.round(value)} min`;
	const series = [
		{
			key: "minutes",
			label: getLocale() === "zh-cn" ? "运动分钟" : "Exercise minutes",
			value: "minutes",
			color: "#3b82f6",
		},
	];
</script>

<div class="h-64 w-full min-w-0 text-gray-500 [--color-primary:#3b82f6]">
	<BarChart
		{data}
		x="date"
		y="minutes"
		{series}
		yDomain={[0, null]}
		yNice
		bandPadding={0.25}
		padding={{ top: 12, right: 12, bottom: 28, left: 40 }}
		props={{
			bars: { radius: 3 },
			grid: { stroke: '#e5e7eb' },
			tooltip: {
				header: { format: formatDate },
				item: { format: formatMinutes }
			}
		}}
	/>
</div>
