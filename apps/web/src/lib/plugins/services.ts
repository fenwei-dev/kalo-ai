import type { PluginJsonValue, PluginServices } from "@kalo-ai/plugin-sdk";
import {
	deletePluginData,
	getExerciseEntriesByDate,
	getFoodEntriesByDate,
	getPluginData,
	getUser,
	getWeightEntriesByDate,
	setPluginData,
} from "$lib/db/repositories";

export function createPluginServices(pluginId: string): PluginServices {
	return {
		profile: {
			get: async () => {
				const user = await getUser();
				if (!user) return null;
				return {
					age: user.age,
					gender: user.gender,
					height: user.height,
					currentWeight: user.currentWeight,
					activityLevel: user.activityLevel,
					targetWeight: user.targetWeight,
					targetDate: user.targetDate,
				};
			},
		},
		logs: {
			getDay: async (date) => {
				const [food, exercise, weights] = await Promise.all([
					getFoodEntriesByDate(date),
					getExerciseEntriesByDate(date),
					getWeightEntriesByDate(date),
				]);
				return {
					date,
					food: food.map((entry) => ({
						id: entry.id,
						date: entry.date,
						time: entry.time,
						name: entry.name,
						calories: entry.calories,
						protein: entry.protein,
						carbs: entry.carbs,
						fat: entry.fat,
					})),
					exercise: exercise.map((entry) => ({
						id: entry.id,
						date: entry.date,
						time: entry.time,
						description: entry.description,
						duration: entry.duration,
						caloriesBurned: entry.caloriesBurned,
					})),
					weights: weights.map((entry) => ({
						id: entry.id,
						date: entry.date,
						weight: entry.weight,
					})),
				};
			},
		},
		storage: {
			get: async (key) => (await getPluginData(pluginId, key))?.value,
			set: async (key, value: PluginJsonValue) => {
				await setPluginData({ pluginId, key, value });
			},
			delete: async (key) => deletePluginData(pluginId, key),
		},
		fetch: (input, init) => globalThis.fetch(input, init),
	};
}
