<script lang="ts">
	import { LineChart } from "layerchart";
	import { getLocale } from "$lib/paraglide/runtime";

	export interface WeightPoint {
		id: string;
		at: Date;
		date: string;
		weight: number;
		average?: number;
	}

	let {
		data,
		targetWeight,
		onselect,
	}: {
		data: WeightPoint[];
		targetWeight?: number;
		onselect?: (point: WeightPoint) => void;
	} = $props();

	const dateFormatter = new Intl.DateTimeFormat(getLocale(), {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
	const formatDate = (value: unknown) =>
		dateFormatter.format(new Date(value as string | number | Date));
	const formatWeight = (value: unknown) => `${Number(value).toFixed(1)} kg`;

	let yDomain = $derived(
		data.length
			? [
					Math.min(...data.map((point) => point.weight)) - 1,
					Math.max(...data.map((point) => point.weight)) + 1,
				]
			: undefined,
	);
	let series = $derived([
		{
			key: "weight",
			label: getLocale() === "zh-cn" ? "体重" : "Weight",
			value: "weight",
			color: "#10b981",
		},
		{
			key: "average",
			label: getLocale() === "zh-cn" ? "7 日均重" : "7-day average",
			value: "average",
			color: "#64748b",
		},
	]);
	let annotations: any = $derived(
		targetWeight == null
			? []
			: [
					{
						type: "line",
						y: targetWeight,
						label: getLocale() === "zh-cn" ? "目标" : "Goal",
						stroke: "#f59e0b",
						strokeDasharray: "5 4",
					},
				],
	);
</script>

<div class="h-72 w-full min-w-0 touch-pan-y text-gray-500 [--color-primary:#10b981]">
	<LineChart
		{data}
		x="at"
		y="weight"
		{series}
		{annotations}
		{yDomain}
		yBaseline={null}
		xNice
		yNice
		padding={{ top: 20, right: 18, bottom: 28, left: 42 }}
		points={{ radius: 4 }}
		highlight={{ lines: true, points: true }}
		onPointClick={(_, details) => {
			const point = data.find((item) => item.at.getTime() === new Date(details.data.x).getTime() && item.weight === details.data.y);
			if (point) onselect?.(point);
		}}
		props={{
			spline: { strokeWidth: 2.5 },
			grid: { stroke: '#e5e7eb' },
			tooltip: {
				header: { format: formatDate },
				item: { format: formatWeight }
			}
		}}
	/>
</div>
