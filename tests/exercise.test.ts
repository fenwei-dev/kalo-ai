/// <reference types="bun" />
import { expect, test } from "bun:test";
import { estimateExerciseCalories } from "../src/lib/utils/exercise";

test("MET exercise estimate uses activity, intensity, weight, and duration", () => {
	// Running at 8.3 MET, 80 kg, 30 min => 348.6 kcal.
	expect(
		estimateExerciseCalories({
			category: "running",
			intensity: "moderate",
			duration: 30,
			weight: 80,
		}),
	).toBe(349);
});

test("MET exercise estimate rejects invalid duration or weight", () => {
	expect(
		estimateExerciseCalories({
			category: "walking",
			intensity: "light",
			duration: 0,
			weight: 80,
		}),
	).toBe(0);
	expect(
		estimateExerciseCalories({
			category: "strength",
			intensity: "vigorous",
			duration: 45,
			weight: Number.NaN,
		}),
	).toBe(0);
});
