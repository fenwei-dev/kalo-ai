import { getFoodEntriesSince, getUser, getWeightEntries, updateUser } from '$lib/db/repositories';

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

	const sinceISO = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
	const food = await getFoodEntriesSince(sinceISO);

	// 窗口内的体重记录
	const windowStart = Date.now() - days * 86400000;
	const windowWeights = weights.filter((w) => new Date(w.date).getTime() >= windowStart);
	if (windowWeights.length < 2) {
		// 窗口内不足，退而用全部记录的首尾
		const sortedAll = [...weights].sort((a, b) => a.date.localeCompare(b.date));
		const startW = sortedAll[0];
		const endW = sortedAll[sortedAll.length - 1];
		const spanDays = Math.max(
			1,
			(new Date(endW.date).getTime() - new Date(startW.date).getTime()) / 86400000
		);
		await computeAndSave(user.id, food, startW.weight, endW.weight, spanDays, weights.length);
		return;
	}

	const sorted = [...windowWeights].sort((a, b) => a.date.localeCompare(b.date));
	const startW = sorted[0];
	const endW = sorted[sorted.length - 1];
	const spanDays = Math.max(
		1,
		(new Date(endW.date).getTime() - new Date(startW.date).getTime()) / 86400000
	);
	await computeAndSave(user.id, food, startW.weight, endW.weight, spanDays, weights.length);
}

async function computeAndSave(
	userId: 'me',
	food: { calories: number; date: string }[],
	startWeight: number,
	endWeight: number,
	spanDays: number,
	totalWeightRecords: number
) {
	const foodInWindow = food; // 已是 since=days 天的数据
	const totalIntake = foodInWindow.reduce((s, e) => s + e.calories, 0);
	const daysCovered = new Set(foodInWindow.map((e) => e.date)).size || spanDays;
	const avgIntake = totalIntake / Math.max(1, daysCovered);
	const weightChange = endWeight - startWeight;
	const actualTDEE = avgIntake - (weightChange * 7700) / spanDays;

	if (!isFinite(actualTDEE) || actualTDEE <= 0 || actualTDEE > 6000) {
		return; // 数据异常，不更新
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
