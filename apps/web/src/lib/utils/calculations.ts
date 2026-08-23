import type { ActivityLevel, BMRMethod, Gender } from "$lib/db/schema";
import { getLocale } from "$lib/paraglide/runtime";

/** 1kg 脂肪约等于 7700 kcal */
export const KCAL_PER_KG = 7700;
export const DEFAULT_BMR_METHOD: BMRMethod = "mifflin-st-jeor";
export const MIN_BODY_FAT_PERCENTAGE = 2;
export const MAX_BODY_FAT_PERCENTAGE = 70;

/** 活动系数 */
export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
	sedentary: 1.2,
	light: 1.375,
	moderate: 1.55,
	active: 1.725,
	very_active: 1.9,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
	sedentary: "久坐不动",
	light: "轻度活动",
	moderate: "中度活动",
	active: "高度活动",
	very_active: "极高活动",
};

/** Mifflin–St Jeor 基础代谢率 (kcal/day)。 */
export function calculateBMR(
	weight: number,
	height: number,
	age: number,
	gender: Gender,
): number {
	const base = 10 * weight + 6.25 * height - 5 * age;
	return Math.round(gender === "male" ? base + 5 : base - 161);
}

export function isValidBodyFatPercentage(value?: number): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= MIN_BODY_FAT_PERCENTAGE &&
		value <= MAX_BODY_FAT_PERCENTAGE
	);
}

/** Katch–McArdle 基础代谢率，依赖由体脂率计算出的去脂体重。 */
export function calculateKatchMcArdleBMR(
	weight: number,
	bodyFatPercentage: number,
): number {
	if (!isValidBodyFatPercentage(bodyFatPercentage)) {
		throw new Error(
			`Katch–McArdle 需要 ${MIN_BODY_FAT_PERCENTAGE}–${MAX_BODY_FAT_PERCENTAGE}% 的有效体脂率`,
		);
	}
	const leanBodyMass = weight * (1 - bodyFatPercentage / 100);
	return Math.round(370 + 21.6 * leanBodyMass);
}

export function isValidBMRConfiguration(
	method: BMRMethod | undefined,
	bodyFatPercentage?: number,
): boolean {
	if (
		bodyFatPercentage !== undefined &&
		!isValidBodyFatPercentage(bodyFatPercentage)
	)
		return false;
	return (
		(method ?? DEFAULT_BMR_METHOD) !== "katch-mcardle" ||
		isValidBodyFatPercentage(bodyFatPercentage)
	);
}

/** 按用户选择的公式计算 BMR；旧资料默认使用 Mifflin–St Jeor。 */
export function calculateProfileBMR(opts: {
	weight: number;
	height: number;
	age: number;
	gender: Gender;
	bmrMethod?: BMRMethod;
	bodyFatPercentage?: number;
}): number {
	if ((opts.bmrMethod ?? DEFAULT_BMR_METHOD) === "katch-mcardle") {
		if (!isValidBodyFatPercentage(opts.bodyFatPercentage)) {
			throw new Error("选择 Katch–McArdle 前必须提供有效体脂率");
		}
		return calculateKatchMcArdleBMR(opts.weight, opts.bodyFatPercentage);
	}
	return calculateBMR(opts.weight, opts.height, opts.age, opts.gender);
}

export function getActivityMultiplier(level: ActivityLevel): number {
	return ACTIVITY_MULTIPLIERS[level];
}

/** 公式 TDEE = BMR × 活动系数 */
export function calculateTDEE(bmr: number, level: ActivityLevel): number {
	return Math.round(bmr * ACTIVITY_MULTIPLIERS[level]);
}

/**
 * 食物热效应 (kcal)
 * 蛋白质 25%、碳水 8%、脂肪 3%
 */
export function calculateTEF(
	protein: number,
	carbs: number,
	fat: number,
): number {
	const proteinTEF = protein * 4 * 0.25;
	const carbsTEF = carbs * 4 * 0.08;
	const fatTEF = fat * 9 * 0.03;
	return Math.round(proteinTEF + carbsTEF + fatTEF);
}

/**
 * Recommendation TDEE. Empirical data gradually influences the formula instead
 * of abruptly replacing it after a low confidence threshold. Upward adaptation
 * is deliberately conservative because an inflated calorie budget can directly
 * undermine a weight-loss plan.
 */
export function effectiveTDEE(opts: {
	adaptiveTDEE?: number;
	adaptiveConfidence?: number;
	formulaTDEE: number;
}): number {
	const confidence = opts.adaptiveConfidence ?? 0;
	if (
		typeof opts.adaptiveTDEE !== "number" ||
		!Number.isFinite(opts.adaptiveTDEE) ||
		!Number.isFinite(opts.formulaTDEE) ||
		confidence < 0.45
	) {
		return opts.formulaTDEE;
	}

	// Also constrain estimates saved by older app versions immediately, before
	// the next weigh-in has a chance to recompute them with the robust algorithm.
	const boundedAdaptive = Math.min(
		opts.formulaTDEE * 1.15,
		Math.max(opts.formulaTDEE * 0.7, opts.adaptiveTDEE),
	);
	const blendWeight = Math.min(
		0.75,
		Math.max(0, ((confidence - 0.4) / 0.5) * 0.75),
	);
	return Math.round(
		opts.formulaTDEE * (1 - blendWeight) + boundedAdaptive * blendWeight,
	);
}

export function calculateWeightProgress(
	start: number,
	current: number,
	target: number,
): number {
	const total = start - target;
	if (total <= 0) return 0;
	const done = start - current;
	return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

export type SafetyLevel = "ok" | "fast" | "danger" | "unknown";

export interface GoalPlan {
	weeks: number | null;
	weeklyRate: number | null; // kg/周
	dailyDeficit: number | null; // kcal/天
	safety: SafetyLevel;
	warning?: string;
}

/**
 * 根据当前体重、目标体重、目标日期，计算每周减重与每日热量缺口及安全判定。
 * 安全标准：
 *  - 每周 > 1kg 或 > 体重的 1% → danger（过快，掉肌肉/反弹风险）
 *  - 每日缺口 > 1000kcal 或低于 BMR → danger
 *  - 每周 > 0.5kg 但未触发 danger → ok（推荐区间 0.5-1kg）
 *  - 每周 ≤ 0.5kg → ok（偏慢但安全）
 */
export function calculateGoalPlan(opts: {
	currentWeight: number;
	targetWeight?: number;
	targetDate?: string;
	bmr?: number;
	tdee?: number;
}): GoalPlan {
	const { currentWeight, targetWeight, targetDate, bmr, tdee } = opts;

	if (!targetWeight || !targetDate) {
		return {
			weeks: null,
			weeklyRate: null,
			dailyDeficit: null,
			safety: "unknown",
		};
	}

	if (targetWeight >= currentWeight) {
		return {
			weeks: null,
			weeklyRate: null,
			dailyDeficit: null,
			safety: "unknown",
			warning:
				getLocale() === "en-us"
					? "Target weight must be below current weight"
					: "目标体重应低于当前体重",
		};
	}

	const targetTime = new Date(`${targetDate}T12:00:00`).getTime();
	const daysToTarget = Math.ceil(
		(targetTime - Date.now()) / (1000 * 60 * 60 * 24),
	);
	if (!Number.isFinite(targetTime) || daysToTarget <= 0) {
		return {
			weeks: 0,
			weeklyRate: null,
			dailyDeficit: null,
			safety: "unknown",
			warning:
				getLocale() === "en-us"
					? "The target date has passed; choose a new date"
					: "目标日期已过，请重新设定",
		};
	}

	const totalLoss = currentWeight - targetWeight;
	const weeks = daysToTarget / 7;
	const weeklyRate = totalLoss / weeks;
	const dailyDeficit = (weeklyRate * KCAL_PER_KG) / 7;

	let safety: SafetyLevel = "ok";
	let warning: string | undefined;

	const weightCap = currentWeight * 0.01;
	if (weeklyRate > 1 || weeklyRate > weightCap) {
		safety = "danger";
		warning =
			getLocale() === "en-us"
				? "This pace is too fast and may increase muscle-loss and rebound risk"
				: "减重过快，有掉肌肉和反弹风险，建议放慢节奏";
	} else if (
		dailyDeficit > 1000 ||
		(typeof bmr === "number" &&
			typeof tdee === "number" &&
			tdee - dailyDeficit < bmr)
	) {
		safety = "danger";
		warning =
			getLocale() === "en-us"
				? "The deficit is too large and would put intake below BMR"
				: "每日热量缺口过大，目标摄入会低于基础代谢，影响健康";
	} else if (weeklyRate > 0.5) {
		safety = "ok";
	} else {
		safety = "ok";
	}

	return {
		weeks: Math.max(0, Math.round(weeks * 10) / 10),
		weeklyRate: Math.round(weeklyRate * 100) / 100,
		dailyDeficit: Math.round(dailyDeficit),
		safety,
		warning,
	};
}

/** 基于身高的健康体重区间（BMI 18.5–23.9，亚洲标准） */
export function healthWeightRange(heightCm: number): {
	min: number;
	max: number;
} {
	const m = heightCm / 100;
	return {
		min: Math.round(18.5 * m * m * 10) / 10,
		max: Math.round(23.9 * m * m * 10) / 10,
	};
}

/** BMI 值 */
export function bmi(weightKg: number, heightCm: number): number {
	const m = heightCm / 100;
	return Math.round((weightKg / (m * m)) * 10) / 10;
}
