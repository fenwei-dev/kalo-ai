/// <reference types="bun" />
import { expect, test } from "bun:test";
import type {
	ExerciseEntry,
	FoodEntry,
	WeightEntry,
} from "../src/lib/db/schema";
import { buildTrendSummary } from "../src/lib/utils/trends";

const food = (date: string, calories: number): FoodEntry => ({
	id: `food-${date}-${calories}`,
	date,
	time: "12:00",
	name: "Test food",
	calories,
	protein: 0,
	carbs: 0,
	fat: 0,
	tef: 0,
	source: "manual",
	createdAt: 0,
});
const exercise = (
	date: string,
	duration: number,
	caloriesBurned: number,
): ExerciseEntry => ({
	id: `exercise-${date}-${duration}`,
	date,
	time: "18:00",
	description: "Test exercise",
	duration,
	caloriesBurned,
	source: "manual",
	createdAt: 0,
});
const weight = (date: string, value: number): WeightEntry => ({
	id: `weight-${date}`,
	date,
	weight: value,
	createdAt: 0,
});

test("trend summary aggregates food and exercise by date", () => {
	const summary = buildTrendSummary({
		food: [
			food("2026-01-01", 500),
			food("2026-01-01", 700),
			food("2026-01-02", 1500),
		],
		exercise: [
			exercise("2026-01-01", 20, 150),
			exercise("2026-01-01", 30, 200),
		],
		weights: [],
		days: 7,
	});
	expect(summary.intake).toEqual([
		{ date: "2026-01-01", value: 1200 },
		{ date: "2026-01-02", value: 1500 },
	]);
	expect(summary.exerciseMinutes[0].value).toBe(50);
	expect(summary.exerciseCalories[0].value).toBe(350);
});

test("trend summary detects a possible weight plateau", () => {
	const summary = buildTrendSummary({
		food: [],
		exercise: [],
		weights: [weight("2026-01-01", 70), weight("2026-01-15", 69.9)],
		days: 30,
	});
	expect(summary.insights.some((item) => item.includes("平台期"))).toBe(true);
});
