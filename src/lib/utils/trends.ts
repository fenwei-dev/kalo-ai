import type { ExerciseEntry, FoodEntry, WeightEntry } from '$lib/db/schema';

export interface TrendPoint {
	date: string;
	value: number;
}

export function buildTrendSummary(opts: {
	food: FoodEntry[];
	exercise: ExerciseEntry[];
	weights: WeightEntry[];
	days: number;
}) {
	const intake = aggregate(opts.food, (entry) => entry.calories);
	const exerciseCalories = aggregate(opts.exercise, (entry) => entry.caloriesBurned);
	const exerciseMinutes = aggregate(opts.exercise, (entry) => entry.duration);
	const weights = [...opts.weights]
		.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
		.map((entry) => ({ date: entry.date, value: entry.weight }));
	const insights: string[] = [];

	if (weights.length >= 2) {
		const change = round(weights.at(-1)!.value - weights[0].value, 1);
		if (Math.abs(change) < 0.3 && opts.days >= 14) insights.push('近期体重变化小于 0.3kg，可能处于平台期');
		else insights.push(`期间体重${change <= 0 ? '下降' : '上升'} ${Math.abs(change)}kg`);
	}
	if (intake.length >= 3) {
		const average = intake.reduce((sum, point) => sum + point.value, 0) / intake.length;
		const unusual = intake.filter((point) => Math.abs(point.value - average) > Math.max(500, average * 0.35));
		if (unusual.length) insights.push(`${unusual.length} 天摄入明显偏离记录日均值`);
	}
	if (!insights.length) insights.push('数据还不够，继续记录几天后可生成趋势洞察');

	return { intake, exerciseCalories, exerciseMinutes, weights, insights };
}

function aggregate<T extends { date: string }>(entries: T[], value: (entry: T) => number): TrendPoint[] {
	const values = new Map<string, number>();
	for (const entry of entries) values.set(entry.date, (values.get(entry.date) ?? 0) + value(entry));
	return [...values].sort(([a], [b]) => a.localeCompare(b)).map(([date, total]) => ({ date, value: round(total, 1) }));
}

function round(value: number, digits: number): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}
