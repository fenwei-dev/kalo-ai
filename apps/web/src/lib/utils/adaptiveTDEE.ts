import {
	getFoodEntriesSince,
	getUser,
	getWeightEntries,
	updateUser,
} from "$lib/db/repositories";
import {
	calculateProfileBMR,
	calculateTDEE,
	isValidBMRConfiguration,
	KCAL_PER_KG,
} from "$lib/utils/calculations";
import { localDateOffset, parseLocalDate } from "$lib/utils/date";

const DAY_MS = 86_400_000;
// A 14-day rolling window may start between weigh-ins, so accept at least
// 12 calendar days of actual span instead of requiring exact endpoint dates.
const MIN_SPAN_DAYS = 12;
const MIN_WEIGHT_RECORDS = 5;
const MIN_INTAKE_COVERAGE = 0.85;

export interface AdaptiveTDEEEstimate {
	tdee: number;
	confidence: number;
	rawTDEE: number;
	spanDays: number;
	intakeCoverage: number;
	weightRecords: number;
}

interface DatedWeight {
	date: string;
	weight: number;
	createdAt?: number;
}

interface DatedCalories {
	date: string;
	calories: number;
}

function daysBetween(start: string, end: string): number {
	return Math.round(
		(parseLocalDate(end).getTime() - parseLocalDate(start).getTime()) / DAY_MS,
	);
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Estimate TDEE from logged intake and a robust weight trend.
 *
 * The old implementation used only the first and last scale readings. A normal
 * water-weight swing at either endpoint could therefore move the estimate by
 * hundreds of kcal/day. This uses a Theil–Sen median slope across weigh-ins,
 * requires a meaningful time span and high food-log coverage, and bounds the
 * estimate relative to the profile formula before it can affect recommendations.
 */
export function estimateAdaptiveTDEE(opts: {
	food: DatedCalories[];
	weights: DatedWeight[];
	formulaTDEE: number;
}): AdaptiveTDEEEstimate | null {
	if (!Number.isFinite(opts.formulaTDEE) || opts.formulaTDEE <= 0) return null;

	// Old databases may contain duplicate dates. Keep the latest record for trend fitting.
	const byDate = new Map<string, DatedWeight>();
	for (const weight of opts.weights) {
		const existing = byDate.get(weight.date);
		if (!existing || (weight.createdAt ?? 0) >= (existing.createdAt ?? 0))
			byDate.set(weight.date, weight);
	}
	const weights = [...byDate.values()].sort((a, b) =>
		a.date.localeCompare(b.date),
	);
	if (weights.length < MIN_WEIGHT_RECORDS) return null;

	const startDate = weights[0].date;
	const endDate = weights[weights.length - 1].date;
	const spanDays = daysBetween(startDate, endDate);
	if (spanDays < MIN_SPAN_DAYS) return null;

	// A same-time daily weigh-in reflects intake from the start date through the
	// day before the final weigh-in. Exclude the final date to avoid counting food
	// eaten after that scale reading.
	const intervalFood = opts.food.filter(
		(entry) => entry.date >= startDate && entry.date < endDate,
	);
	const caloriesByDate = new Map<string, number>();
	for (const entry of intervalFood) {
		caloriesByDate.set(
			entry.date,
			(caloriesByDate.get(entry.date) ?? 0) + entry.calories,
		);
	}
	const daysCovered = caloriesByDate.size;
	const intakeCoverage = daysCovered / spanDays;
	if (daysCovered === 0 || intakeCoverage < MIN_INTAKE_COVERAGE) return null;
	const averageIntake =
		[...caloriesByDate.values()].reduce((sum, value) => sum + value, 0) /
		daysCovered;

	// The median of all pairwise slopes is robust to one unusually high or low
	// endpoint. Keep short pairs as standard Theil–Sen does: excluding them can
	// over-weight a noisy endpoint when a two-week window has sparse weigh-ins.
	const slopes: number[] = [];
	for (let i = 0; i < weights.length - 1; i++) {
		for (let j = i + 1; j < weights.length; j++) {
			const pairDays = daysBetween(weights[i].date, weights[j].date);
			if (pairDays > 0)
				slopes.push((weights[j].weight - weights[i].weight) / pairDays);
		}
	}
	if (slopes.length === 0) return null;
	const weightChangePerDay = median(slopes);
	const rawTDEE = averageIntake - weightChangePerDay * KCAL_PER_KG;

	// Values this far from the profile estimate are more likely to indicate
	// incomplete intake logs or temporary water shifts than a real metabolism.
	if (
		!Number.isFinite(rawTDEE) ||
		rawTDEE < opts.formulaTDEE * 0.5 ||
		rawTDEE > opts.formulaTDEE * 1.5
	) {
		return null;
	}
	const boundedTDEE = Math.min(
		opts.formulaTDEE * 1.15,
		Math.max(opts.formulaTDEE * 0.7, rawTDEE),
	);

	// Two weeks are enough to estimate, but confidence remains below a full
	// four-week observation so the empirical value cannot dominate the formula.
	const spanFactor = Math.min(1, spanDays / 28);
	const coverageFactor = Math.min(1, intakeCoverage);
	const recordFactor = Math.min(1, weights.length / 10);
	const confidence =
		Math.round(
			Math.min(
				0.9,
				0.35 * spanFactor + 0.35 * coverageFactor + 0.3 * recordFactor,
			) * 100,
		) / 100;

	return {
		tdee: Math.round(boundedTDEE),
		confidence,
		rawTDEE: Math.round(rawTDEE),
		spanDays,
		intakeCoverage: Math.round(intakeCoverage * 100) / 100,
		weightRecords: weights.length,
	};
}

/** Recompute the persisted estimate from the latest two weeks of local data. */
export async function recomputeAdaptiveTDEE(days = 14): Promise<void> {
	const user = await getUser();
	if (!user) return;

	const sinceISO = localDateOffset(-days);
	const [food, allWeights] = await Promise.all([
		getFoodEntriesSince(sinceISO),
		getWeightEntries(),
	]);
	const weights = allWeights.filter((entry) => entry.date >= sinceISO);
	if (!isValidBMRConfiguration(user.bmrMethod, user.bodyFatPercentage)) return;
	const bmr = calculateProfileBMR({
		weight: user.currentWeight,
		height: user.height,
		age: user.age,
		gender: user.gender,
		bmrMethod: user.bmrMethod,
		bodyFatPercentage: user.bodyFatPercentage,
	});
	const formulaTDEE = calculateTDEE(bmr, user.activityLevel);
	const estimate = estimateAdaptiveTDEE({ food, weights, formulaTDEE });
	const adaptiveTDEE = estimate?.tdee;
	const adaptiveConfidence = estimate?.confidence;
	if (
		user.calculatedBMR === bmr &&
		user.adaptiveTDEE === adaptiveTDEE &&
		user.adaptiveConfidence === adaptiveConfidence
	)
		return;

	await updateUser({ calculatedBMR: bmr, adaptiveTDEE, adaptiveConfidence });
}
