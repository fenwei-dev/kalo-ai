import { getFoodEntriesSince, getUser, getWeightEntries, updateUser } from '$lib/db/repositories';
import { localDateOffset, parseLocalDate } from '$lib/utils/date';

/**
 * 自适应 TDEE：基于近期体重变化和饮食摄入反推真实每日消耗。
 *   实际 TDEE = 平均每日摄入 − (体重变化 × 7700) / 天数
 * 置信度随数据量增长（天数、体重记录数）。
 */
export async function recomputeAdaptiveTDEE(days = 14): Promise<void> {
	const user = await getUser();
	if (!user) return;

	const weights = await getWeightEntries();
	if (weights.length < 2) {
		await updateUser({ adaptiveTDEE: undefined, adaptiveConfidence: undefined });
		return;
	}

	const sinceISO = localDateOffset(-days);
	const food = await getFoodEntriesSince(sinceISO);
	const windowWeights = weights.filter((w) => w.date >= sinceISO);
	if (windowWeights.length < 2) {
		await updateUser({ adaptiveTDEE: undefined, adaptiveConfidence: undefined });
		return;
	}

	const sorted = [...windowWeights].sort((a, b) => a.date.localeCompare(b.date));
	const startW = sorted[0];
	const endW = sorted[sorted.length - 1];
	const spanDays = Math.max(
		1,
		(parseLocalDate(endW.date).getTime() - parseLocalDate(startW.date).getTime()) / 86400000
	);
	await computeAndSave(food, startW.weight, endW.weight, spanDays, windowWeights.length);
}

async function computeAndSave(
	food: { calories: number; date: string }[],
	startWeight: number,
	endWeight: number,
	spanDays: number,
	totalWeightRecords: number
) {
	const totalIntake = food.reduce((s, e) => s + e.calories, 0);
	const daysCovered = new Set(food.map((e) => e.date)).size;
	const requiredCoverage = Math.max(3, Math.ceil(Math.min(14, spanDays + 1) * 0.7));
	if (daysCovered < requiredCoverage) {
		await updateUser({ adaptiveTDEE: undefined, adaptiveConfidence: undefined });
		return;
	}
	const avgIntake = totalIntake / daysCovered;
	const weightChange = endWeight - startWeight;
	const actualTDEE = avgIntake - (weightChange * 7700) / spanDays;

	if (!isFinite(actualTDEE) || actualTDEE <= 0 || actualTDEE > 6000) {
		await updateUser({ adaptiveTDEE: undefined, adaptiveConfidence: undefined });
		return;
	}

	// 置信度：天数占比 + 体重记录数，封顶 0.9
	const dayFactor = Math.min(1, daysCovered / 14);
	const recordFactor = Math.min(1, totalWeightRecords / 7);
	const confidence = Math.round(Math.min(0.9, 0.5 * dayFactor + 0.5 * recordFactor) * 100) / 100;

	await updateUser({
		adaptiveTDEE: Math.round(actualTDEE),
		adaptiveConfidence: confidence
	});
}
