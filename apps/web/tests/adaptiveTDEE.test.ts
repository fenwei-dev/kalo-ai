import "fake-indexeddb/auto";
import { beforeAll, expect, test } from "bun:test";

let estimateAdaptiveTDEE: typeof import("../src/lib/utils/adaptiveTDEE").estimateAdaptiveTDEE;

beforeAll(async () => {
	({ estimateAdaptiveTDEE } = await import("../src/lib/utils/adaptiveTDEE"));
});

const date = (day: number) => `2026-01-${String(day).padStart(2, "0")}`;
const dailyFood = (
	startDay: number,
	endDayExclusive: number,
	calories: number,
) =>
	Array.from({ length: endDayExclusive - startDay }, (_, index) => ({
		date: date(startDay + index),
		calories,
	}));

test("adaptive TDEE moves down when logged intake predicts more loss than the robust weight trend shows", () => {
	const weights = [
		{ date: date(1), weight: 80 },
		{ date: date(3), weight: 79.97 },
		{ date: date(5), weight: 79.94 },
		{ date: date(7), weight: 79.91 },
		{ date: date(9), weight: 79.88 },
		{ date: date(11), weight: 79.85 },
		{ date: date(13), weight: 79.82 },
		{ date: date(15), weight: 79.79 },
	];
	const estimate = estimateAdaptiveTDEE({
		food: dailyFood(1, 15, 1700),
		weights,
		formulaTDEE: 2200,
	});

	expect(estimate).not.toBeNull();
	if (!estimate) throw new Error("Expected an adaptive TDEE estimate");
	expect(estimate.rawTDEE).toBeLessThan(1900);
	expect(estimate.tdee).toBeLessThan(2200);
	expect(estimate.spanDays).toBe(14);
	expect(estimate.intakeCoverage).toBe(1);
});

test("robust weight slope ignores misleading high and low endpoint readings", () => {
	const weights = [
		{ date: date(1), weight: 81 },
		{ date: date(3), weight: 80 },
		{ date: date(5), weight: 80 },
		{ date: date(7), weight: 80 },
		{ date: date(9), weight: 80 },
		{ date: date(11), weight: 80 },
		{ date: date(13), weight: 80 },
		{ date: date(15), weight: 79 },
	];
	const estimate = estimateAdaptiveTDEE({
		food: dailyFood(1, 15, 1800),
		weights,
		formulaTDEE: 2200,
	});

	expect(estimate).not.toBeNull();
	if (!estimate) throw new Error("Expected an adaptive TDEE estimate");
	// Endpoint-only math would infer 2,900 kcal. The median trend sees the
	// stable middle of the series and stays near the 1,800 kcal intake.
	expect(estimate.rawTDEE).toBe(1800);
	expect(estimate.tdee).toBe(1800);
});

test("adaptive TDEE requires enough time, weigh-ins, and intake coverage", () => {
	const tooShort = estimateAdaptiveTDEE({
		food: dailyFood(1, 11, 1800),
		weights: [1, 3, 5, 7, 11].map((day) => ({ date: date(day), weight: 80 })),
		formulaTDEE: 2200,
	});
	const sparseFood = estimateAdaptiveTDEE({
		food: dailyFood(1, 15, 1800),
		weights: [1, 5, 9, 13, 17, 21, 25, 29].map((day) => ({
			date: date(day),
			weight: 80,
		})),
		formulaTDEE: 2200,
	});

	expect(tooShort).toBeNull();
	expect(sparseFood).toBeNull();
});
