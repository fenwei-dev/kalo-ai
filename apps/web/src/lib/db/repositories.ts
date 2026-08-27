import { getLocale } from "$lib/paraglide/runtime";
import { descriptorSnapshotHash } from "$lib/plugins/descriptorPolicy";
import {
	analyzePluginModuleSource,
	sha256Text,
} from "$lib/plugins/moduleSource";
import { isValidBMRConfiguration } from "$lib/utils/calculations";
import { type KaloBackupV7, parseKaloBackup } from "./backup";

export type {
	KaloBackup,
	KaloBackupV1,
	KaloBackupV2,
	KaloBackupV3,
	KaloBackupV4,
	KaloBackupV5,
	KaloBackupV6,
	KaloBackupV7,
} from "./backup";

import {
	localDateISO,
	localMessageTimestamp,
	localTimeHHMM,
} from "$lib/utils/date";
import type {
	AIConfig,
	ExerciseEntry,
	FoodEntry,
	FoodLibraryItem,
	Message,
	PlannedWorkout,
	PluginConfigRecord,
	PluginDataRecord,
	PluginDraft,
	PluginInstallation,
	PluginModuleRecord,
	Session,
	SessionMode,
	TrainingPlan,
	TrainingPlanStatus,
	User,
	UserMemory,
	WeightEntry,
} from "./schema";
import { db } from "./schema";

const uid = (prefix = ""): string =>
	prefix +
	(globalThis.crypto?.randomUUID?.() ??
		Math.random().toString(36).slice(2) + Date.now().toString(36));

const now = (): number => Date.now();
export const MAX_USER_MEMORY_LENGTH = 8_000;

export interface UserMemorySnapshot {
	content: string;
	version: number;
	updatedAt: number | null;
}

// ---------- User (singleton, id='me') ----------

function assertUserBMRConfiguration(
	user: Pick<User, "bmrMethod" | "bodyFatPercentage">,
): void {
	if (!isValidBMRConfiguration(user.bmrMethod, user.bodyFatPercentage)) {
		throw new Error("选择 Katch–McArdle 前必须提供有效体脂率");
	}
}

export async function getUser(): Promise<User | undefined> {
	return db.user.get("me");
}

export async function saveUser(
	data: Omit<User, "id" | "createdAt" | "updatedAt">,
): Promise<User> {
	assertUserBMRConfiguration(data);
	const existing = await db.user.get("me");
	const ts = now();
	const user: User = {
		...data,
		id: "me",
		createdAt: existing?.createdAt ?? ts,
		updatedAt: ts,
	};
	await db.user.put(user);
	return user;
}

export async function saveUserWithWeightEntry(
	data: Omit<User, "id" | "createdAt" | "updatedAt">,
	date: string,
): Promise<User> {
	assertUserBMRConfiguration(data);
	assertWeightDate(date);
	return db.transaction("rw", db.user, db.weightEntries, async () => {
		const existingUser = await db.user.get("me");
		const ts = now();
		const user: User = {
			...data,
			id: "me",
			createdAt: existingUser?.createdAt ?? ts,
			updatedAt: ts,
		};
		await db.user.put(user);

		const existingWeights = await db.weightEntries
			.where("date")
			.equals(date)
			.toArray();
		if (existingWeights.length) {
			const keep = [...existingWeights].sort(
				(a, b) => b.createdAt - a.createdAt,
			)[0];
			await db.weightEntries.put({ ...keep, date, weight: data.currentWeight });
			await db.weightEntries.bulkDelete(
				existingWeights
					.filter((item) => item.id !== keep.id)
					.map((item) => item.id),
			);
		} else {
			await db.weightEntries.add({
				id: uid("w_"),
				date,
				weight: data.currentWeight,
				createdAt: ts,
			});
		}
		await syncCurrentWeightInTransaction();
		return (await db.user.get("me")) ?? user;
	});
}

export async function updateUser(
	patch: Partial<Omit<User, "id" | "createdAt">>,
): Promise<User | undefined> {
	const existing = await db.user.get("me");
	if (!existing) return undefined;
	const updated: User = { ...existing, ...patch, updatedAt: now() };
	assertUserBMRConfiguration(updated);
	await db.user.put(updated);
	return updated;
}

// ---------- AIConfig (singleton, id='singleton') ----------

export async function getAIConfig(): Promise<AIConfig | undefined> {
	return db.aiConfig.get("singleton");
}

export async function saveAIConfig(
	data: Omit<AIConfig, "id" | "updatedAt">,
): Promise<AIConfig> {
	const cfg: AIConfig = { ...data, id: "singleton", updatedAt: now() };
	await db.aiConfig.put(cfg);
	return cfg;
}

export async function updateAIConfig(
	patch: Partial<Omit<AIConfig, "id">>,
): Promise<AIConfig | undefined> {
	const existing = await db.aiConfig.get("singleton");
	if (!existing) return undefined;
	const cfg: AIConfig = {
		...existing,
		...patch,
		id: "singleton",
		updatedAt: now(),
	};
	await db.aiConfig.put(cfg);
	return cfg;
}

// ---------- Plugin configuration and scoped data ----------

export async function listPluginConfigs(): Promise<PluginConfigRecord[]> {
	return db.pluginConfigs.toArray();
}

export async function getPluginConfig(
	pluginId: string,
): Promise<PluginConfigRecord | undefined> {
	return db.pluginConfigs.get(pluginId);
}

export async function savePluginConfig(
	record: Omit<PluginConfigRecord, "updatedAt">,
): Promise<PluginConfigRecord> {
	const saved: PluginConfigRecord = { ...record, updatedAt: now() };
	await db.pluginConfigs.put(saved);
	return saved;
}

export async function deletePluginConfig(pluginId: string): Promise<void> {
	await db.transaction("rw", [db.pluginConfigs, db.pluginData], async () => {
		await db.pluginConfigs.delete(pluginId);
		await db.pluginData.where("pluginId").equals(pluginId).delete();
	});
}

export async function getPluginData(
	pluginId: string,
	key: string,
): Promise<PluginDataRecord | undefined> {
	return db.pluginData.get([pluginId, key]);
}

export async function listPluginData(
	pluginId: string,
): Promise<PluginDataRecord[]> {
	return db.pluginData.where("pluginId").equals(pluginId).toArray();
}

export async function setPluginData(
	record: Omit<PluginDataRecord, "updatedAt">,
): Promise<PluginDataRecord> {
	const saved: PluginDataRecord = { ...record, updatedAt: now() };
	await db.pluginData.put(saved);
	return saved;
}

export async function deletePluginData(
	pluginId: string,
	key: string,
): Promise<void> {
	await db.pluginData.delete([pluginId, key]);
}

export async function listPluginInstallations(): Promise<PluginInstallation[]> {
	return db.pluginInstallations.orderBy("installedAt").toArray();
}

export async function getPluginInstallation(
	pluginId: string,
): Promise<PluginInstallation | undefined> {
	return db.pluginInstallations.get(pluginId);
}

export async function savePluginInstallation(
	record: Omit<PluginInstallation, "installedAt" | "updatedAt">,
): Promise<PluginInstallation> {
	const existing = await db.pluginInstallations.get(record.pluginId);
	const timestamp = now();
	const saved: PluginInstallation = {
		...record,
		installedAt: existing?.installedAt ?? timestamp,
		updatedAt: timestamp,
	};
	await db.pluginInstallations.put(saved);
	return saved;
}

export async function getPluginModule(
	pluginId: string,
): Promise<PluginModuleRecord | undefined> {
	return db.pluginModules.get(pluginId);
}

export async function listPluginModules(): Promise<PluginModuleRecord[]> {
	return db.pluginModules.toArray();
}

export async function savePluginModule(
	record: Omit<PluginModuleRecord, "createdAt" | "updatedAt">,
): Promise<PluginModuleRecord> {
	const existing = await db.pluginModules.get(record.pluginId);
	const timestamp = now();
	const saved: PluginModuleRecord = {
		...record,
		createdAt: existing?.createdAt ?? timestamp,
		updatedAt: timestamp,
	};
	await db.pluginModules.put(saved);
	return saved;
}

export async function savePluginInstallationWithModule(
	installation: Omit<PluginInstallation, "installedAt" | "updatedAt">,
	module: Omit<PluginModuleRecord, "createdAt" | "updatedAt">,
): Promise<{ installation: PluginInstallation; module: PluginModuleRecord }> {
	return db.transaction(
		"rw",
		[db.pluginInstallations, db.pluginModules],
		async () => {
			const existing = await db.pluginInstallations.get(installation.pluginId);
			if (!existing && (await db.pluginInstallations.count()) >= 10) {
				throw new Error("最多只能安装 10 个用户插件");
			}
			const savedInstallation = await savePluginInstallation(installation);
			const savedModule = await savePluginModule(module);
			return { installation: savedInstallation, module: savedModule };
		},
	);
}

export async function deletePluginInstallation(
	pluginId: string,
): Promise<void> {
	await db.transaction(
		"rw",
		[db.pluginInstallations, db.pluginModules, db.pluginConfigs, db.pluginData],
		async () => {
			await db.pluginInstallations.delete(pluginId);
			await db.pluginModules.delete(pluginId);
			await db.pluginConfigs.delete(pluginId);
			await db.pluginData.where("pluginId").equals(pluginId).delete();
		},
	);
}

// ---------- Food entries ----------

export async function addFoodEntry(
	data: Omit<FoodEntry, "id" | "createdAt">,
): Promise<FoodEntry> {
	const entry: FoodEntry = { ...data, id: uid("food_"), createdAt: now() };
	await db.foodEntries.add(entry);
	return entry;
}

export async function getFoodEntriesByDate(date: string): Promise<FoodEntry[]> {
	return db.foodEntries.where("date").equals(date).reverse().sortBy("time");
}

export async function getFoodEntriesSince(
	sinceISO: string,
): Promise<FoodEntry[]> {
	return db.foodEntries.where("date").aboveOrEqual(sinceISO).toArray();
}

export async function updateFoodEntry(
	id: string,
	patch: Partial<FoodEntry>,
): Promise<void> {
	const updated = await db.foodEntries.update(id, patch);
	if (!updated) throw new Error("要修正的饮食记录不存在");
}

export async function deleteFoodEntry(id: string): Promise<void> {
	await db.foodEntries.delete(id);
}

export async function getFoodEntry(id: string): Promise<FoodEntry | undefined> {
	return db.foodEntries.get(id);
}

// ---------- Exercise entries ----------

function assertExerciseEntry(
	data: Omit<ExerciseEntry, "id" | "createdAt">,
): void {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date))
		throw new Error("运动日期格式无效");
	if (data.date > localDateISO()) throw new Error("不能记录未来日期的运动");
	if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time))
		throw new Error("运动时间格式无效");
	if (!data.description.trim()) throw new Error("运动名称不能为空");
	if (
		!Number.isFinite(data.duration) ||
		data.duration <= 0 ||
		data.duration > 1440
	) {
		throw new Error("运动时长必须在 1–1440 分钟之间");
	}
	if (
		!Number.isFinite(data.caloriesBurned) ||
		data.caloriesBurned < 0 ||
		data.caloriesBurned > 10000
	) {
		throw new Error("运动消耗必须在 0–10000 kcal 之间");
	}
}

export async function addExerciseEntry(
	data: Omit<ExerciseEntry, "id" | "createdAt">,
): Promise<ExerciseEntry> {
	assertExerciseEntry(data);
	const entry: ExerciseEntry = {
		...data,
		description: data.description.trim(),
		id: uid("ex_"),
		createdAt: now(),
	};
	await db.exerciseEntries.add(entry);
	return entry;
}

export async function updateExerciseEntry(
	id: string,
	data: Omit<ExerciseEntry, "id" | "createdAt">,
): Promise<ExerciseEntry> {
	assertExerciseEntry(data);
	const existing = await db.exerciseEntries.get(id);
	if (!existing) throw new Error("要修正的运动记录不存在");
	const entry: ExerciseEntry = {
		...data,
		description: data.description.trim(),
		plannedWorkoutId: existing.plannedWorkoutId,
		id,
		createdAt: existing.createdAt,
	};
	await db.exerciseEntries.put(entry);
	return entry;
}

export async function getExerciseEntriesByDate(
	date: string,
): Promise<ExerciseEntry[]> {
	return db.exerciseEntries.where("date").equals(date).reverse().sortBy("time");
}

export async function getExerciseEntriesSince(
	sinceISO: string,
): Promise<ExerciseEntry[]> {
	return db.exerciseEntries.where("date").aboveOrEqual(sinceISO).toArray();
}

export async function getExerciseEntries(): Promise<ExerciseEntry[]> {
	const entries = await db.exerciseEntries.orderBy("date").reverse().toArray();
	return entries.sort(
		(a, b) =>
			b.date.localeCompare(a.date) ||
			b.time.localeCompare(a.time) ||
			b.createdAt - a.createdAt,
	);
}

export async function deleteExerciseEntry(id: string): Promise<void> {
	await db.transaction(
		"rw",
		[db.exerciseEntries, db.plannedWorkouts, db.trainingPlans],
		async () => {
			const exercise = await db.exerciseEntries.get(id);
			if (!exercise) throw new Error("要删除的运动记录不存在");
			await db.exerciseEntries.delete(id);
			if (exercise.plannedWorkoutId) {
				const workout = await db.plannedWorkouts.get(exercise.plannedWorkoutId);
				if (workout?.exerciseEntryId === id) {
					await db.plannedWorkouts.update(workout.id, {
						status: "planned",
						exerciseEntryId: undefined,
						updatedAt: now(),
					});
					await reconcileTrainingPlanStatus(workout.planId);
				}
			}
		},
	);
}

export async function getExerciseEntry(
	id: string,
): Promise<ExerciseEntry | undefined> {
	return db.exerciseEntries.get(id);
}

// ---------- Training plans ----------

export interface PlannedWorkoutDraft {
	date: string;
	time?: string;
	category: PlannedWorkout["category"];
	description: string;
	intensity: PlannedWorkout["intensity"];
	plannedDuration: number;
	estimatedCalories?: number;
	notes?: string;
}

export interface CreateTrainingPlanInput {
	title: string;
	goal?: string;
	startDate: string;
	endDate?: string;
	workouts?: PlannedWorkoutDraft[];
}

function assertCalendarDate(date: string, label: string): void {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${label}格式无效`);
}

function assertFutureOrToday(date: string, label: string): void {
	assertCalendarDate(date, label);
	if (date < localDateISO()) throw new Error(`${label}不能早于今天`);
}

function assertPlannedWorkoutDraft(workout: PlannedWorkoutDraft): void {
	assertCalendarDate(workout.date, "训练日期");
	if (workout.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(workout.time)) {
		throw new Error("训练时间格式无效");
	}
	if (!workout.description.trim()) throw new Error("训练名称不能为空");
	if (
		!Number.isFinite(workout.plannedDuration) ||
		workout.plannedDuration < 1 ||
		workout.plannedDuration > 1440
	) {
		throw new Error("计划时长必须在 1–1440 分钟之间");
	}
	if (
		workout.estimatedCalories !== undefined &&
		(!Number.isFinite(workout.estimatedCalories) ||
			workout.estimatedCalories < 0 ||
			workout.estimatedCalories > 10000)
	) {
		throw new Error("计划消耗必须在 0–10000 kcal 之间");
	}
}

function plannedWorkoutFromDraft(
	planId: string,
	workout: PlannedWorkoutDraft,
	timestamp: number,
): PlannedWorkout {
	return {
		...workout,
		id: uid("pw_"),
		planId,
		description: workout.description.trim(),
		notes: workout.notes?.trim() || undefined,
		status: "planned",
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

export async function createTrainingPlan(
	data: CreateTrainingPlanInput,
): Promise<{ plan: TrainingPlan; workouts: PlannedWorkout[] }> {
	const title = data.title.trim();
	if (!title) throw new Error("计划名称不能为空");
	assertFutureOrToday(data.startDate, "计划开始日期");
	if (data.endDate) {
		assertCalendarDate(data.endDate, "计划结束日期");
		if (data.endDate < data.startDate)
			throw new Error("计划结束日期不能早于开始日期");
	}
	const drafts = data.workouts ?? [];
	if (drafts.length > 84) throw new Error("一个计划最多包含 84 次训练");
	for (const workout of drafts) {
		assertPlannedWorkoutDraft(workout);
		if (workout.date < data.startDate)
			throw new Error("训练日期不能早于计划开始日期");
		if (data.endDate && workout.date > data.endDate) {
			throw new Error("训练日期不能晚于计划结束日期");
		}
	}

	return db.transaction(
		"rw",
		[db.trainingPlans, db.plannedWorkouts],
		async () => {
			const current = await db.trainingPlans
				.where("status")
				.anyOf(["active", "paused"])
				.first();
			if (current)
				throw new Error(`已有当前训练计划「${current.title}」，请先归档`);
			const timestamp = now();
			const plan: TrainingPlan = {
				id: uid("plan_"),
				title,
				goal: data.goal?.trim() || undefined,
				startDate: data.startDate,
				endDate: data.endDate,
				status: "active",
				createdAt: timestamp,
				updatedAt: timestamp,
			};
			const workouts = drafts.map((workout) =>
				plannedWorkoutFromDraft(plan.id, workout, timestamp),
			);
			await db.trainingPlans.add(plan);
			if (workouts.length) await db.plannedWorkouts.bulkAdd(workouts);
			return { plan, workouts };
		},
	);
}

export async function getTrainingPlans(): Promise<TrainingPlan[]> {
	return db.trainingPlans.orderBy("updatedAt").reverse().toArray();
}

export async function getTrainingPlan(
	id: string,
): Promise<TrainingPlan | undefined> {
	return db.trainingPlans.get(id);
}

export async function getCurrentTrainingPlan(): Promise<
	TrainingPlan | undefined
> {
	const plans = await db.trainingPlans
		.where("status")
		.anyOf(["active", "paused"])
		.toArray();
	return plans.sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export async function getPlannedWorkouts(
	planId: string,
): Promise<PlannedWorkout[]> {
	const workouts = await db.plannedWorkouts
		.where("planId")
		.equals(planId)
		.toArray();
	return workouts.sort(
		(a, b) =>
			a.date.localeCompare(b.date) ||
			(a.time ?? "99:99").localeCompare(b.time ?? "99:99") ||
			a.createdAt - b.createdAt,
	);
}

export async function getPlannedWorkout(
	id: string,
): Promise<PlannedWorkout | undefined> {
	return db.plannedWorkouts.get(id);
}

export async function getAllPlannedWorkouts(): Promise<PlannedWorkout[]> {
	const workouts = await db.plannedWorkouts.orderBy("date").reverse().toArray();
	return workouts.sort(
		(a, b) =>
			b.date.localeCompare(a.date) ||
			(b.time ?? "").localeCompare(a.time ?? "") ||
			b.createdAt - a.createdAt,
	);
}

/**
 * Link, move, or unlink an actual exercise and a planned workout atomically.
 * The relationship is one-to-one and linking marks the plan item completed.
 */
export async function linkExerciseToPlannedWorkout(
	exerciseId: string,
	plannedWorkoutId: string | null,
): Promise<{ exercise: ExerciseEntry; workout: PlannedWorkout | null }> {
	return db.transaction(
		"rw",
		[db.exerciseEntries, db.trainingPlans, db.plannedWorkouts],
		async () => {
			const exercise = await db.exerciseEntries.get(exerciseId);
			if (!exercise) throw new Error("运动记录不存在");
			if (exercise.plannedWorkoutId === plannedWorkoutId) {
				const workout = plannedWorkoutId
					? ((await db.plannedWorkouts.get(plannedWorkoutId)) ?? null)
					: null;
				if (plannedWorkoutId && !workout) throw new Error("计划训练不存在");
				if (workout && workout.exerciseEntryId !== exercise.id) {
					throw new Error("运动记录与计划训练的关联不一致");
				}
				return { exercise, workout };
			}

			const oldWorkout = exercise.plannedWorkoutId
				? await db.plannedWorkouts.get(exercise.plannedWorkoutId)
				: undefined;
			const targetWorkout = plannedWorkoutId
				? await db.plannedWorkouts.get(plannedWorkoutId)
				: undefined;
			if (plannedWorkoutId && !targetWorkout) throw new Error("计划训练不存在");
			if (
				targetWorkout &&
				!(await db.trainingPlans.get(targetWorkout.planId))
			) {
				throw new Error("训练计划不存在");
			}
			if (
				targetWorkout?.exerciseEntryId &&
				targetWorkout.exerciseEntryId !== exerciseId
			) {
				throw new Error("该计划训练已经关联另一条运动记录");
			}

			const timestamp = now();
			if (oldWorkout?.exerciseEntryId === exerciseId) {
				await db.plannedWorkouts.update(oldWorkout.id, {
					status: "planned",
					exerciseEntryId: undefined,
					updatedAt: timestamp,
				});
			}
			if (targetWorkout) {
				await db.plannedWorkouts.update(targetWorkout.id, {
					status: "completed",
					exerciseEntryId: exerciseId,
					updatedAt: timestamp,
				});
			}
			const updatedExercise: ExerciseEntry = {
				...exercise,
				plannedWorkoutId: targetWorkout?.id,
			};
			await db.exerciseEntries.put(updatedExercise);

			const affectedPlans = new Set(
				[oldWorkout?.planId, targetWorkout?.planId].filter(
					(planId): planId is string => !!planId,
				),
			);
			for (const planId of affectedPlans) {
				await reconcileTrainingPlanStatus(planId);
			}
			return {
				exercise: updatedExercise,
				workout: targetWorkout
					? {
							...targetWorkout,
							status: "completed",
							exerciseEntryId: exerciseId,
							updatedAt: timestamp,
						}
					: null,
			};
		},
	);
}

export async function addPlannedWorkout(
	planId: string,
	draft: PlannedWorkoutDraft,
): Promise<PlannedWorkout> {
	assertPlannedWorkoutDraft(draft);
	assertFutureOrToday(draft.date, "训练日期");
	return db.transaction(
		"rw",
		[db.trainingPlans, db.plannedWorkouts],
		async () => {
			const plan = await db.trainingPlans.get(planId);
			if (!plan || (plan.status !== "active" && plan.status !== "paused")) {
				throw new Error("当前训练计划不存在");
			}
			if (draft.date < plan.startDate)
				throw new Error("训练日期不能早于计划开始日期");
			if (plan.endDate && draft.date > plan.endDate)
				throw new Error("训练日期不能晚于计划结束日期");
			const entry = plannedWorkoutFromDraft(planId, draft, now());
			await db.plannedWorkouts.add(entry);
			await db.trainingPlans.update(planId, { updatedAt: now() });
			return entry;
		},
	);
}

export async function updatePlannedWorkout(
	id: string,
	patch: Partial<PlannedWorkoutDraft> & { status?: "planned" | "skipped" },
): Promise<PlannedWorkout> {
	return db.transaction(
		"rw",
		[db.trainingPlans, db.plannedWorkouts],
		async () => {
			const existing = await db.plannedWorkouts.get(id);
			if (!existing) throw new Error("计划训练不存在");
			if (existing.status === "completed")
				throw new Error("已完成训练请在运动记录中修改");
			const plan = await db.trainingPlans.get(existing.planId);
			if (!plan || (plan.status !== "active" && plan.status !== "paused")) {
				throw new Error("当前训练计划不存在");
			}
			const merged: PlannedWorkout = {
				...existing,
				...patch,
				description: patch.description?.trim() || existing.description,
				notes:
					patch.notes === undefined
						? existing.notes
						: patch.notes.trim() || undefined,
				updatedAt: now(),
			};
			assertPlannedWorkoutDraft(merged);
			if (patch.date !== undefined && patch.date !== existing.date) {
				assertFutureOrToday(merged.date, "训练日期");
				if (merged.date < plan.startDate)
					throw new Error("训练日期不能早于计划开始日期");
				if (plan.endDate && merged.date > plan.endDate) {
					throw new Error("训练日期不能晚于计划结束日期");
				}
			}
			await db.plannedWorkouts.put(merged);
			await db.trainingPlans.update(plan.id, { updatedAt: now() });
			return merged;
		},
	);
}

export async function deletePlannedWorkout(id: string): Promise<void> {
	await db.transaction(
		"rw",
		[db.trainingPlans, db.plannedWorkouts],
		async () => {
			const workout = await db.plannedWorkouts.get(id);
			if (!workout) throw new Error("计划训练不存在");
			if (workout.status === "completed")
				throw new Error("不能删除已完成的计划训练");
			await db.plannedWorkouts.delete(id);
			await db.trainingPlans.update(workout.planId, { updatedAt: now() });
		},
	);
}

async function reconcileTrainingPlanStatus(planId: string): Promise<void> {
	const plan = await db.trainingPlans.get(planId);
	if (!plan || plan.status === "archived") return;
	const remaining = await db.plannedWorkouts
		.where("planId")
		.equals(planId)
		.filter((workout) => workout.status === "planned")
		.count();
	if (remaining === 0) {
		await db.trainingPlans.update(planId, {
			status: "completed",
			updatedAt: now(),
		});
		return;
	}
	if (plan.status === "completed") {
		const otherCurrent = await db.trainingPlans
			.where("status")
			.anyOf(["active", "paused"])
			.filter((candidate) => candidate.id !== planId)
			.first();
		await db.trainingPlans.update(planId, {
			status: otherCurrent ? "archived" : "active",
			updatedAt: now(),
		});
	}
}

export async function completePlannedWorkout(
	id: string,
	actual: {
		date?: string;
		time?: string;
		duration: number;
		caloriesBurned: number;
	},
): Promise<{ workout: PlannedWorkout; exercise: ExerciseEntry }> {
	return db.transaction(
		"rw",
		[db.trainingPlans, db.plannedWorkouts, db.exerciseEntries],
		async () => {
			const workout = await db.plannedWorkouts.get(id);
			if (!workout) throw new Error("计划训练不存在");
			if (workout.exerciseEntryId) {
				const exercise = await db.exerciseEntries.get(workout.exerciseEntryId);
				if (exercise) return { workout, exercise };
			}
			const plan = await db.trainingPlans.get(workout.planId);
			if (!plan || (plan.status !== "active" && plan.status !== "paused")) {
				throw new Error("当前训练计划不存在");
			}
			const exerciseData = {
				date: actual.date ?? localDateISO(),
				time: actual.time ?? localTimeHHMM(),
				description: workout.description,
				category: workout.category,
				intensity: workout.intensity,
				duration: actual.duration,
				caloriesBurned: actual.caloriesBurned,
				source: "manual" as const,
				plannedWorkoutId: workout.id,
			};
			assertExerciseEntry(exerciseData);
			const timestamp = now();
			const exercise: ExerciseEntry = {
				...exerciseData,
				id: uid("ex_"),
				createdAt: timestamp,
			};
			const completed: PlannedWorkout = {
				...workout,
				status: "completed",
				exerciseEntryId: exercise.id,
				updatedAt: timestamp,
			};
			await db.exerciseEntries.add(exercise);
			await db.plannedWorkouts.put(completed);
			await reconcileTrainingPlanStatus(workout.planId);
			return { workout: completed, exercise };
		},
	);
}

export async function setTrainingPlanStatus(
	id: string,
	status: Extract<TrainingPlanStatus, "active" | "paused">,
): Promise<TrainingPlan> {
	return db.transaction("rw", db.trainingPlans, async () => {
		const plan = await db.trainingPlans.get(id);
		if (!plan || plan.status === "archived") throw new Error("训练计划不存在");
		if (status === "active") {
			const other = await db.trainingPlans
				.where("status")
				.anyOf(["active", "paused"])
				.filter((candidate) => candidate.id !== id)
				.first();
			if (other) throw new Error(`已有当前训练计划「${other.title}」`);
		}
		const updated = { ...plan, status, updatedAt: now() };
		await db.trainingPlans.put(updated);
		return updated;
	});
}

export async function archiveTrainingPlan(
	id: string,
	expectedTitle: string,
): Promise<TrainingPlan> {
	const plan = await db.trainingPlans.get(id);
	if (!plan) throw new Error("训练计划不存在");
	if (
		plan.title.trim().toLocaleLowerCase() !==
		expectedTitle.trim().toLocaleLowerCase()
	) {
		throw new Error("计划 id 与标题不匹配，已拒绝归档");
	}
	const archived: TrainingPlan = {
		...plan,
		status: "archived",
		updatedAt: now(),
	};
	await db.trainingPlans.put(archived);
	return archived;
}

// ---------- Weight entries ----------

function assertWeightDate(date: string): void {
	if (date > localDateISO()) throw new Error("不能记录未来日期的体重");
}

export async function addWeightEntry(
	data: Omit<WeightEntry, "id" | "createdAt">,
): Promise<WeightEntry> {
	assertWeightDate(data.date);
	return db.transaction("rw", db.weightEntries, db.user, async () => {
		const existing = await db.weightEntries
			.where("date")
			.equals(data.date)
			.first();
		if (existing) {
			throw new Error(
				`日期 ${data.date} 已有体重记录（${existing.weight} kg），每天只能记录一次；如需更正请先删除原记录`,
			);
		}
		const entry: WeightEntry = { ...data, id: uid("w_"), createdAt: now() };
		await db.weightEntries.add(entry);
		await syncCurrentWeightInTransaction();
		return entry;
	});
}

/** 设置资料时使用：当天无记录则创建，有记录则修改，并清理旧版本遗留的同日重复项。 */
export async function upsertWeightEntryForDate(
	data: Omit<WeightEntry, "id" | "createdAt">,
): Promise<{
	entry: WeightEntry;
	status: "created" | "updated";
}> {
	assertWeightDate(data.date);
	return db.transaction("rw", db.weightEntries, db.user, async () => {
		const existing = await db.weightEntries
			.where("date")
			.equals(data.date)
			.toArray();
		if (!existing.length) {
			const entry: WeightEntry = { ...data, id: uid("w_"), createdAt: now() };
			await db.weightEntries.add(entry);
			await syncCurrentWeightInTransaction();
			return { entry, status: "created" as const };
		}
		const keep = [...existing].sort((a, b) => b.createdAt - a.createdAt)[0];
		const entry: WeightEntry = { ...keep, ...data };
		await db.weightEntries.put(entry);
		await db.weightEntries.bulkDelete(
			existing.filter((item) => item.id !== keep.id).map((item) => item.id),
		);
		await syncCurrentWeightInTransaction();
		return { entry, status: "updated" as const };
	});
}

async function syncCurrentWeightInTransaction(): Promise<
	WeightEntry | undefined
> {
	const all = await db.weightEntries.orderBy("date").toArray();
	const latest = all
		.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
		.at(-1);
	if (latest && (await db.user.get("me"))) {
		await db.user.update("me", {
			currentWeight: latest.weight,
			updatedAt: now(),
		});
	}
	return latest;
}

/** 当存在体重记录时，让 Profile.currentWeight 始终等于日期最晚的记录。 */
export async function syncCurrentWeightFromLatest(): Promise<
	WeightEntry | undefined
> {
	return db.transaction(
		"rw",
		db.weightEntries,
		db.user,
		syncCurrentWeightInTransaction,
	);
}

export async function getWeightEntries(): Promise<WeightEntry[]> {
	return db.weightEntries.orderBy("date").toArray();
}

export async function getWeightEntriesByDate(
	date: string,
): Promise<WeightEntry[]> {
	return db.weightEntries.where("date").equals(date).toArray();
}

export async function getWeightEntry(
	id: string,
): Promise<WeightEntry | undefined> {
	return db.weightEntries.get(id);
}

export async function deleteWeightEntry(id: string): Promise<void> {
	await db.transaction("rw", db.weightEntries, db.user, async () => {
		const entry = await db.weightEntries.get(id);
		if (!entry) throw new Error("要删除的体重记录不存在");
		if ((await db.weightEntries.count()) <= 1)
			throw new Error("不能删除唯一一条体重记录");
		await db.weightEntries.delete(id);
		await syncCurrentWeightInTransaction();
	});
}

export async function getLatestWeight(): Promise<WeightEntry | undefined> {
	const all = await db.weightEntries.orderBy("date").toArray();
	return all[all.length - 1];
}

// ---------- Food library ----------

export async function listLibrary(): Promise<FoodLibraryItem[]> {
	const items = await db.foodLibrary.toArray();
	return items.sort(
		(a, b) => b.servingsCount - a.servingsCount || b.lastUsedAt - a.lastUsedAt,
	);
}

export async function getLibraryItem(
	id: string,
): Promise<FoodLibraryItem | undefined> {
	return db.foodLibrary.get(id);
}

export async function upsertLibraryItem(
	data: Omit<
		FoodLibraryItem,
		"id" | "createdAt" | "updatedAt" | "servingsCount" | "lastUsedAt"
	> & {
		id?: string;
	},
): Promise<FoodLibraryItem> {
	const ts = now();
	if (data.id) {
		const existing = await db.foodLibrary.get(data.id);
		if (existing) {
			const updated: FoodLibraryItem = { ...existing, ...data, updatedAt: ts };
			await db.foodLibrary.put(updated);
			return updated;
		}
	}
	const item: FoodLibraryItem = {
		...data,
		id: data.id ?? uid("lib_"),
		servingsCount: 0,
		lastUsedAt: ts,
		createdAt: ts,
		updatedAt: ts,
	};
	await db.foodLibrary.add(item);
	return item;
}

/** 记录某食物被使用一次（servingsCount +1，刷新 lastUsedAt） */
export async function bumpLibraryUsage(id: string): Promise<void> {
	const item = await db.foodLibrary.get(id);
	if (!item) return;
	await db.foodLibrary.update(id, {
		servingsCount: item.servingsCount + 1,
		lastUsedAt: now(),
	});
}

export async function deleteLibraryItem(id: string): Promise<void> {
	await db.foodLibrary.delete(id);
}

// ---------- Agent memory (singleton, id='user-memory') ----------

export async function getUserMemory(): Promise<UserMemorySnapshot> {
	const memory = await db.userMemory.get("user-memory");
	return memory
		? {
				content: memory.content,
				version: memory.version,
				updatedAt: memory.updatedAt,
			}
		: { content: "", version: 0, updatedAt: null };
}

/** Replace the full Markdown memory document with optimistic concurrency protection. */
export async function updateUserMemory(
	content: string,
	expectedVersion: number,
): Promise<UserMemorySnapshot> {
	if (content.length > MAX_USER_MEMORY_LENGTH) {
		throw new Error(`用户记忆不能超过 ${MAX_USER_MEMORY_LENGTH} 个字符`);
	}
	return db.transaction("rw", db.userMemory, async () => {
		const existing = await db.userMemory.get("user-memory");
		const currentVersion = existing?.version ?? 0;
		if (currentVersion !== expectedVersion) {
			throw new Error(
				`用户记忆已更新（当前版本 ${currentVersion}），请先重新读取后再修改`,
			);
		}
		if ((existing?.content ?? "") === content) {
			return existing
				? {
						content: existing.content,
						version: existing.version,
						updatedAt: existing.updatedAt,
					}
				: { content: "", version: 0, updatedAt: null };
		}
		const memory: UserMemory = {
			id: "user-memory",
			content,
			version: currentVersion + 1,
			updatedAt: now(),
		};
		await db.userMemory.put(memory);
		return {
			content: memory.content,
			version: memory.version,
			updatedAt: memory.updatedAt,
		};
	});
}

export async function markSessionMemoryVersion(
	sessionId: string,
	version: number,
): Promise<void> {
	await db.sessions.update(sessionId, { memoryVersion: version });
}

// ---------- Sessions ----------

export async function createSession(
	title?: string,
	mode: SessionMode = "standard",
): Promise<Session> {
	const ts = now();
	const resolvedTitle =
		title ?? (getLocale() === "en-us" ? "New chat" : "新对话");
	const session: Session = {
		id: uid("sess_"),
		title: resolvedTitle,
		mode,
		createdAt: ts,
		updatedAt: ts,
		lastMessageAt: ts,
	};
	await db.sessions.add(session);
	return session;
}

export async function updateSessionMode(
	id: string,
	mode: SessionMode,
): Promise<Session> {
	return db.transaction("rw", [db.sessions, db.messages], async () => {
		const session = await db.sessions.get(id);
		if (!session) throw new Error("对话不存在或已被删除");
		if (
			session.modeLockedAt !== undefined ||
			(await db.messages.where("sessionId").equals(id).count()) > 0
		) {
			throw new Error("对话已有内容，模式不能再修改");
		}
		const updated: Session = { ...session, mode, updatedAt: now() };
		await db.sessions.put(updated);
		return updated;
	});
}

export async function getSession(id: string): Promise<Session | undefined> {
	return db.sessions.get(id);
}

export async function listSessions(): Promise<Session[]> {
	return db.sessions.orderBy("updatedAt").reverse().toArray();
}

export async function renameSession(id: string, title: string): Promise<void> {
	await db.sessions.update(id, { title, updatedAt: now() });
}

export async function touchSession(id: string): Promise<void> {
	const ts = now();
	await db.sessions.update(id, { updatedAt: ts, lastMessageAt: ts });
}

export async function deleteSession(id: string): Promise<void> {
	await db.transaction(
		"rw",
		[db.sessions, db.messages, db.pluginDrafts, db.pluginDraftRevisions],
		async () => {
			const drafts = await db.pluginDrafts
				.where("sessionId")
				.equals(id)
				.toArray();
			for (const draft of drafts) {
				await db.pluginDraftRevisions
					.where("draftId")
					.equals(draft.id)
					.delete();
			}
			await db.pluginDrafts.where("sessionId").equals(id).delete();
			await db.messages.where("sessionId").equals(id).delete();
			await db.sessions.delete(id);
		},
	);
}

// ---------- Messages ----------

export async function listMessages(sessionId: string): Promise<Message[]> {
	return db.messages
		.where("[sessionId+order]")
		.between([sessionId, 0], [sessionId, Infinity])
		.toArray();
}

export async function addMessage(
	data: Omit<Message, "id" | "createdAt" | "order"> & { order?: number },
): Promise<Message> {
	return db.transaction("rw", db.sessions, db.messages, async () => {
		const session = await db.sessions.get(data.sessionId);
		if (!session) throw new Error("对话不存在或已被删除");
		const order =
			data.order ??
			(await db.messages.where("sessionId").equals(data.sessionId).count());
		const ts = now();
		const msg: Message = {
			...data,
			order,
			id: uid("msg_"),
			localTimestamp:
				data.localTimestamp ?? localMessageTimestamp(new Date(ts)),
			createdAt: ts,
		};
		await db.messages.add(msg);
		await db.sessions.update(data.sessionId, {
			mode: session.mode ?? "standard",
			modeLockedAt: session.modeLockedAt ?? ts,
			updatedAt: ts,
			lastMessageAt: ts,
		});
		return msg;
	});
}

/**
 * Persist a real user message and, when global memory changed, append a synthetic
 * readUserMemory call/result before the first provider request. The whole boundary
 * is atomic so retries never observe a half-written memory refresh.
 */
export async function addUserMessageWithMemorySync(data: {
	sessionId: string;
	content: Message["content"];
	localTimestamp?: string;
}): Promise<Message> {
	return db.transaction(
		"rw",
		db.sessions,
		db.messages,
		db.userMemory,
		async () => {
			const session = await db.sessions.get(data.sessionId);
			if (!session) throw new Error("对话不存在或已被删除");
			let order = await db.messages
				.where("sessionId")
				.equals(data.sessionId)
				.count();
			const ts = now();
			const timestamp =
				data.localTimestamp ?? localMessageTimestamp(new Date(ts));
			const userMessage: Message = {
				id: uid("msg_"),
				sessionId: data.sessionId,
				order: order++,
				role: "user",
				content: data.content,
				localTimestamp: timestamp,
				createdAt: ts,
			};
			await db.messages.add(userMessage);

			const mode = session.mode ?? "standard";
			const memory = await db.userMemory.get("user-memory");
			const snapshot: UserMemorySnapshot = memory
				? {
						content: memory.content,
						version: memory.version,
						updatedAt: memory.updatedAt,
					}
				: { content: "", version: 0, updatedAt: null };
			if (mode === "standard" && session.memoryVersion !== snapshot.version) {
				const toolCallId = uid("memory_");
				await db.messages.bulkAdd([
					{
						id: uid("msg_"),
						sessionId: data.sessionId,
						order: order++,
						role: "assistant",
						content: [
							{
								type: "toolCall",
								id: toolCallId,
								name: "readUserMemory",
								arguments: {},
							},
						],
						synthetic: true,
						localTimestamp: timestamp,
						createdAt: ts,
					},
					{
						id: uid("msg_"),
						sessionId: data.sessionId,
						order: order++,
						role: "toolResult",
						content: [{ type: "text", text: JSON.stringify(snapshot) }],
						toolCallId,
						toolName: "readUserMemory",
						isError: false,
						synthetic: true,
						localTimestamp: timestamp,
						createdAt: ts,
					},
				]);
			}
			await db.sessions.update(data.sessionId, {
				mode,
				modeLockedAt: session.modeLockedAt ?? ts,
				updatedAt: ts,
				lastMessageAt: ts,
				memoryVersion:
					mode === "standard" ? snapshot.version : session.memoryVersion,
			});
			return userMessage;
		},
	);
}

export async function deleteMessagesFrom(
	sessionId: string,
	order: number,
): Promise<void> {
	await db.transaction("rw", [db.sessions, db.messages], async () => {
		const session = await db.sessions.get(sessionId);
		if (!session) throw new Error("对话不存在或已被删除");
		await db.messages
			.where("[sessionId+order]")
			.between([sessionId, order], [sessionId, Infinity])
			.delete();
		const lastMessage = await db.messages
			.where("[sessionId+order]")
			.between([sessionId, 0], [sessionId, Infinity])
			.last();
		await db.sessions.update(sessionId, {
			updatedAt: now(),
			lastMessageAt: lastMessage?.createdAt ?? session.createdAt,
			// A deleted range may have contained the latest synthetic memory snapshot.
			// Force the next real user send to append a fresh one.
			memoryVersion: undefined,
		});
	});
}

// ---------- 聚合 / 工具 ----------

export async function todayDateStr(): Promise<string> {
	return localDateISO();
}

/** 清空全部数据，包括本地保存的 API Key。 */
export async function clearAllData(): Promise<void> {
	await db.transaction(
		"rw",
		[
			db.user,
			db.aiConfig,
			db.userMemory,
			db.foodEntries,
			db.exerciseEntries,
			db.trainingPlans,
			db.plannedWorkouts,
			db.pluginConfigs,
			db.pluginData,
			db.pluginInstallations,
			db.pluginModules,
			db.pluginDrafts,
			db.pluginDraftRevisions,
			db.weightEntries,
			db.foodLibrary,
			db.sessions,
			db.messages,
		],
		async () => {
			await Promise.all([
				db.user.clear(),
				db.aiConfig.clear(),
				db.userMemory.clear(),
				db.foodEntries.clear(),
				db.exerciseEntries.clear(),
				db.trainingPlans.clear(),
				db.plannedWorkouts.clear(),
				db.pluginConfigs.clear(),
				db.pluginData.clear(),
				db.pluginInstallations.clear(),
				db.pluginModules.clear(),
				db.pluginDrafts.clear(),
				db.pluginDraftRevisions.clear(),
				db.weightEntries.clear(),
				db.foodLibrary.clear(),
				db.sessions.clear(),
				db.messages.clear(),
			]);
		},
	);
}

/** Validate and atomically replace all app data from a Kalo backup. */
export async function importAll(value: unknown): Promise<void> {
	const data = parseKaloBackup(value, MAX_USER_MEMORY_LENGTH);
	const {
		user,
		aiConfig,
		userMemory,
		trainingPlans,
		plannedWorkouts,
		pluginConfigs,
		pluginData,
		pluginInstallations,
		pluginModules,
		pluginDrafts,
		pluginDraftRevisions,
	} = data;
	for (const module of pluginModules) {
		const analyzed = await analyzePluginModuleSource(module.source);
		if (analyzed.sha256 !== module.sha256 || analyzed.size !== module.size) {
			throw new Error(`插件模块 ${module.pluginId} 的 hash 或大小无效`);
		}
	}
	const safePluginDrafts: PluginDraft[] = [];
	for (const draft of pluginDrafts) {
		if ((await sha256Text(draft.source)) !== draft.sha256) {
			throw new Error(`插件草稿 ${draft.id} 的 hash 无效`);
		}
		try {
			await analyzePluginModuleSource(draft.source);
			safePluginDrafts.push({
				...draft,
				status: "valid" as const,
				diagnostics: [
					{
						level: "warning" as const,
						code: "restore-reinspect",
						message:
							"Restored draft source must pass zero-permission sandbox inspection again.",
					},
				],
				inspection: undefined,
				lastTest: undefined,
			});
		} catch (error) {
			safePluginDrafts.push({
				...draft,
				status: "invalid" as const,
				diagnostics: [
					{
						level: "error" as const,
						code: "static-invalid",
						message: error instanceof Error ? error.message : String(error),
					},
				],
				inspection: undefined,
				lastTest: undefined,
			});
		}
	}
	for (const revision of pluginDraftRevisions) {
		if ((await sha256Text(revision.source)) !== revision.sha256) {
			throw new Error(`插件草稿 ${revision.draftId} 的 revision hash 无效`);
		}
	}
	for (const installation of pluginInstallations) {
		if (!installation.descriptor) continue;
		const expected = await descriptorSnapshotHash(
			installation.manifest,
			installation.descriptor,
		);
		if (expected !== installation.descriptor.sha256) {
			throw new Error(`插件 ${installation.pluginId} 的 descriptor hash 无效`);
		}
	}
	const installedPluginIds = new Set(
		pluginInstallations.map((installation) => installation.pluginId),
	);
	const safePluginConfigs = pluginConfigs.map((config) =>
		installedPluginIds.has(config.pluginId)
			? { ...config, enabled: false }
			: config,
	);

	await db.transaction(
		"rw",
		[
			db.user,
			db.aiConfig,
			db.userMemory,
			db.foodEntries,
			db.exerciseEntries,
			db.trainingPlans,
			db.plannedWorkouts,
			db.pluginConfigs,
			db.pluginData,
			db.pluginInstallations,
			db.pluginModules,
			db.pluginDrafts,
			db.pluginDraftRevisions,
			db.weightEntries,
			db.foodLibrary,
			db.sessions,
			db.messages,
		],
		async () => {
			await Promise.all([
				db.user.clear(),
				db.aiConfig.clear(),
				db.userMemory.clear(),
				db.foodEntries.clear(),
				db.exerciseEntries.clear(),
				db.trainingPlans.clear(),
				db.plannedWorkouts.clear(),
				db.pluginConfigs.clear(),
				db.pluginData.clear(),
				db.pluginInstallations.clear(),
				db.pluginModules.clear(),
				db.pluginDrafts.clear(),
				db.pluginDraftRevisions.clear(),
				db.weightEntries.clear(),
				db.foodLibrary.clear(),
				db.sessions.clear(),
				db.messages.clear(),
			]);
			await db.user.bulkPut(user);
			await db.aiConfig.bulkPut(aiConfig);
			await db.userMemory.bulkPut(userMemory);
			await db.foodEntries.bulkPut(data.foodEntries);
			await db.exerciseEntries.bulkPut(data.exerciseEntries);
			await db.trainingPlans.bulkPut(trainingPlans);
			await db.plannedWorkouts.bulkPut(plannedWorkouts);
			await db.pluginConfigs.bulkPut(safePluginConfigs);
			await db.pluginData.bulkPut(pluginData);
			await db.pluginInstallations.bulkPut(pluginInstallations);
			await db.pluginModules.bulkPut(pluginModules);
			await db.pluginDrafts.bulkPut(safePluginDrafts);
			await db.pluginDraftRevisions.bulkPut(pluginDraftRevisions);
			await db.weightEntries.bulkPut(data.weightEntries);
			await db.foodLibrary.bulkPut(data.foodLibrary);
			await db.sessions.bulkPut(data.sessions);
			await db.messages.bulkPut(data.messages);
		},
	);
}

/** 导出全部数据为可序列化对象 */
export async function exportAll(): Promise<KaloBackupV7> {
	const [
		user,
		aiConfig,
		userMemory,
		foodEntries,
		exerciseEntries,
		trainingPlans,
		plannedWorkouts,
		pluginConfigs,
		pluginData,
		pluginInstallations,
		pluginModules,
		pluginDrafts,
		pluginDraftRevisions,
		weightEntries,
		foodLibrary,
		sessions,
		messages,
	] = await Promise.all([
		db.user.toArray(),
		db.aiConfig.toArray(),
		db.userMemory.toArray(),
		db.foodEntries.toArray(),
		db.exerciseEntries.toArray(),
		db.trainingPlans.toArray(),
		db.plannedWorkouts.toArray(),
		db.pluginConfigs.toArray(),
		db.pluginData.toArray(),
		db.pluginInstallations.toArray(),
		db.pluginModules.toArray(),
		db.pluginDrafts.toArray(),
		db.pluginDraftRevisions.toArray(),
		db.weightEntries.toArray(),
		db.foodLibrary.toArray(),
		db.sessions.toArray(),
		db.messages.toArray(),
	]);
	return {
		version: 7,
		exportedAt: now(),
		user,
		aiConfig,
		userMemory,
		foodEntries,
		exerciseEntries,
		trainingPlans,
		plannedWorkouts,
		pluginConfigs,
		pluginData,
		pluginInstallations,
		pluginModules,
		pluginDrafts,
		pluginDraftRevisions,
		weightEntries,
		foodLibrary,
		sessions,
		messages,
	};
}
