import type { ExerciseCategory, ExerciseIntensity } from "$lib/db/schema";

export const EXERCISE_MET_VALUES: Record<
	ExerciseCategory,
	Record<ExerciseIntensity, number>
> = {
	walking: { light: 2.8, moderate: 4.3, vigorous: 6 },
	running: { light: 6, moderate: 8.3, vigorous: 11 },
	cycling: { light: 4, moderate: 6.8, vigorous: 10 },
	strength: { light: 3.5, moderate: 5, vigorous: 6 },
	swimming: { light: 4.8, moderate: 7, vigorous: 9.8 },
	sports: { light: 4, moderate: 6, vigorous: 8 },
	other: { light: 3, moderate: 5, vigorous: 7 },
};

/** Estimate gross exercise energy from MET, body weight, and duration. */
export function estimateExerciseCalories(opts: {
	category: ExerciseCategory;
	intensity: ExerciseIntensity;
	duration: number;
	weight: number;
}): number {
	if (
		!Number.isFinite(opts.duration) ||
		opts.duration <= 0 ||
		!Number.isFinite(opts.weight) ||
		opts.weight <= 0
	) {
		return 0;
	}
	const met = EXERCISE_MET_VALUES[opts.category][opts.intensity];
	return Math.max(
		0,
		Math.round((met * 3.5 * opts.weight * opts.duration) / 200),
	);
}
