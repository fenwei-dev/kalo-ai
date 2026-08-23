import type {
	AIConfig,
	ContentBlock,
	ExerciseEntry,
	FoodEntry,
	FoodLibraryItem,
	JsonObject,
	JsonValue,
	Message,
	PlannedWorkout,
	Session,
	TrainingPlan,
	User,
	UserMemory,
	WeightEntry,
} from "./schema";

interface BackupData {
	exportedAt: number;
	user: User[];
	aiConfig: AIConfig[];
	foodEntries: FoodEntry[];
	exerciseEntries: ExerciseEntry[];
	weightEntries: WeightEntry[];
	foodLibrary: FoodLibraryItem[];
	sessions: Session[];
	messages: Message[];
}

export interface KaloBackupV1 extends BackupData {
	version: 1;
}

export interface KaloBackupV2 extends BackupData {
	version: 2;
	userMemory: UserMemory[];
}

export interface KaloBackupV3 extends Omit<KaloBackupV2, "version"> {
	version: 3;
	trainingPlans: TrainingPlan[];
	plannedWorkouts: PlannedWorkout[];
}

export type KaloBackup = KaloBackupV1 | KaloBackupV2 | KaloBackupV3;
export type ParsedKaloBackup = Omit<KaloBackupV3, "version" | "exportedAt">;

type DataRecord = Record<string, unknown>;
type ValueGuard<T> = (value: unknown) => value is T;

const isRecord = (value: unknown): value is DataRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isBoolean = (value: unknown): value is boolean =>
	typeof value === "boolean";
const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);
const isOptional = <T>(
	value: unknown,
	guard: ValueGuard<T>,
): value is T | undefined => value === undefined || guard(value);
const isOneOf = <T extends string>(
	value: unknown,
	choices: readonly T[],
): value is T =>
	typeof value === "string" && choices.some((choice) => choice === value);

function isJsonValue(value: unknown): value is JsonValue {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		isFiniteNumber(value)
	) {
		return true;
	}
	if (Array.isArray(value)) return value.every(isJsonValue);
	return isJsonObject(value);
}

function isJsonObject(value: unknown): value is JsonObject {
	return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isContentBlock(value: unknown): value is ContentBlock {
	if (!isRecord(value) || typeof value.type !== "string") return false;
	switch (value.type) {
		case "text":
			return isString(value.text) && isOptional(value.textSignature, isString);
		case "thinking":
			return (
				isString(value.thinking) &&
				isOptional(value.thinkingSignature, isString) &&
				isOptional(value.redacted, isBoolean)
			);
		case "toolCall":
			return (
				isString(value.id) &&
				isString(value.name) &&
				isJsonObject(value.arguments) &&
				isOptional(value.thoughtSignature, isString)
			);
		case "image":
			return isString(value.data) && isString(value.mimeType);
		default:
			return false;
	}
}

const isGender = (value: unknown): value is User["gender"] =>
	isOneOf(value, ["male", "female"] as const);
const isActivityLevel = (value: unknown): value is User["activityLevel"] =>
	isOneOf(value, [
		"sedentary",
		"light",
		"moderate",
		"active",
		"very_active",
	] as const);
const isBMRMethod = (value: unknown): value is NonNullable<User["bmrMethod"]> =>
	isOneOf(value, ["mifflin-st-jeor", "katch-mcardle"] as const);

function isUser(value: unknown): value is User {
	return (
		isRecord(value) &&
		value.id === "me" &&
		isFiniteNumber(value.age) &&
		isGender(value.gender) &&
		isFiniteNumber(value.height) &&
		isFiniteNumber(value.currentWeight) &&
		isOptional(value.targetWeight, isFiniteNumber) &&
		isOptional(value.targetDate, isString) &&
		isActivityLevel(value.activityLevel) &&
		isOptional(value.bmrMethod, isBMRMethod) &&
		isOptional(value.bodyFatPercentage, isFiniteNumber) &&
		(value.bodyFatPercentage === undefined ||
			(value.bodyFatPercentage >= 2 && value.bodyFatPercentage <= 70)) &&
		(value.bmrMethod !== "katch-mcardle" ||
			isFiniteNumber(value.bodyFatPercentage)) &&
		isFiniteNumber(value.calculatedBMR) &&
		isOptional(value.adaptiveTDEE, isFiniteNumber) &&
		isOptional(value.adaptiveConfidence, isFiniteNumber) &&
		isFiniteNumber(value.createdAt) &&
		isFiniteNumber(value.updatedAt)
	);
}

function isAIConfig(value: unknown): value is AIConfig {
	return (
		isRecord(value) &&
		value.id === "singleton" &&
		isOneOf(value.apiType, [
			"openai-completions",
			"openai-responses",
			"anthropic-messages",
		] as const) &&
		isOptional(value.baseUrl, isString) &&
		isString(value.apiKey) &&
		isString(value.model) &&
		isFiniteNumber(value.updatedAt)
	);
}

function isUserMemory(value: unknown, maxLength: number): value is UserMemory {
	return (
		isRecord(value) &&
		value.id === "user-memory" &&
		isString(value.content) &&
		value.content.length <= maxLength &&
		isFiniteNumber(value.version) &&
		Number.isInteger(value.version) &&
		value.version >= 1 &&
		isFiniteNumber(value.updatedAt)
	);
}

function isFoodEntry(value: unknown): value is FoodEntry {
	return (
		isRecord(value) &&
		isString(value.id) &&
		isString(value.date) &&
		isString(value.time) &&
		isString(value.name) &&
		isFiniteNumber(value.calories) &&
		isFiniteNumber(value.protein) &&
		isFiniteNumber(value.carbs) &&
		isFiniteNumber(value.fat) &&
		isFiniteNumber(value.tef) &&
		isOneOf(value.source, ["ai", "library", "manual"] as const) &&
		isOptional(value.libraryItemId, isString) &&
		isFiniteNumber(value.createdAt)
	);
}

function parseExerciseEntry(value: unknown): ExerciseEntry | null {
	if (
		!isRecord(value) ||
		!isString(value.id) ||
		!isString(value.date) ||
		!isString(value.time) ||
		!isString(value.description) ||
		!isOptional(
			value.category,
			(item): item is NonNullable<ExerciseEntry["category"]> =>
				isOneOf(item, [
					"walking",
					"running",
					"cycling",
					"strength",
					"swimming",
					"sports",
					"other",
				] as const),
		) ||
		!isOptional(
			value.intensity,
			(item): item is NonNullable<ExerciseEntry["intensity"]> =>
				isOneOf(item, ["light", "moderate", "vigorous"] as const),
		) ||
		!isFiniteNumber(value.duration) ||
		!isFiniteNumber(value.caloriesBurned) ||
		!isOneOf(value.source, [
			"manual",
			"third_party",
			"health_app",
			"watch",
		] as const) ||
		!isOptional(value.plannedWorkoutId, isString) ||
		!isFiniteNumber(value.createdAt)
	) {
		return null;
	}
	return {
		id: value.id,
		date: value.date,
		time: value.time,
		description: value.description,
		category: value.category,
		intensity: value.intensity,
		duration: value.duration,
		caloriesBurned: value.caloriesBurned,
		source:
			value.source === "health_app" || value.source === "watch"
				? "third_party"
				: value.source,
		plannedWorkoutId: value.plannedWorkoutId,
		createdAt: value.createdAt,
	};
}

function isTrainingPlan(value: unknown): value is TrainingPlan {
	return (
		isRecord(value) &&
		isString(value.id) &&
		isString(value.title) &&
		isOptional(value.goal, isString) &&
		isString(value.startDate) &&
		isOptional(value.endDate, isString) &&
		isOneOf(value.status, [
			"active",
			"paused",
			"completed",
			"archived",
		] as const) &&
		isFiniteNumber(value.createdAt) &&
		isFiniteNumber(value.updatedAt)
	);
}

function isPlannedWorkout(value: unknown): value is PlannedWorkout {
	return (
		isRecord(value) &&
		isString(value.id) &&
		isString(value.planId) &&
		isString(value.date) &&
		isOptional(value.time, isString) &&
		isOneOf(value.category, [
			"walking",
			"running",
			"cycling",
			"strength",
			"swimming",
			"sports",
			"other",
		] as const) &&
		isString(value.description) &&
		isOneOf(value.intensity, ["light", "moderate", "vigorous"] as const) &&
		isFiniteNumber(value.plannedDuration) &&
		isOptional(value.estimatedCalories, isFiniteNumber) &&
		isOptional(value.notes, isString) &&
		isOneOf(value.status, ["planned", "completed", "skipped"] as const) &&
		isOptional(value.exerciseEntryId, isString) &&
		(value.status !== "completed" || isString(value.exerciseEntryId)) &&
		isFiniteNumber(value.createdAt) &&
		isFiniteNumber(value.updatedAt)
	);
}

function isWeightEntry(value: unknown): value is WeightEntry {
	return (
		isRecord(value) &&
		isString(value.id) &&
		isString(value.date) &&
		isFiniteNumber(value.weight) &&
		isFiniteNumber(value.createdAt)
	);
}

function isFoodLibraryItem(value: unknown): value is FoodLibraryItem {
	return (
		isRecord(value) &&
		isString(value.id) &&
		isString(value.name) &&
		isOneOf(value.category, [
			"meal",
			"snack",
			"drink",
			"fruit",
			"other",
		] as const) &&
		isFiniteNumber(value.calories) &&
		isOptional(value.protein, isFiniteNumber) &&
		isOptional(value.carbs, isFiniteNumber) &&
		isOptional(value.fat, isFiniteNumber) &&
		isFiniteNumber(value.servingsCount) &&
		isFiniteNumber(value.lastUsedAt) &&
		isFiniteNumber(value.createdAt) &&
		isFiniteNumber(value.updatedAt)
	);
}

function isSession(value: unknown): value is Session {
	return (
		isRecord(value) &&
		isString(value.id) &&
		isString(value.title) &&
		isFiniteNumber(value.createdAt) &&
		isFiniteNumber(value.updatedAt) &&
		isFiniteNumber(value.lastMessageAt) &&
		isOptional(value.memoryVersion, isFiniteNumber)
	);
}

function isMessage(value: unknown): value is Message {
	return (
		isRecord(value) &&
		isString(value.id) &&
		isString(value.sessionId) &&
		isFiniteNumber(value.order) &&
		isOneOf(value.role, ["user", "assistant", "toolResult"] as const) &&
		Array.isArray(value.content) &&
		value.content.every(isContentBlock) &&
		isOptional(value.toolCallId, isString) &&
		isOptional(value.toolName, isString) &&
		isOptional(value.isError, isBoolean) &&
		isOptional(value.synthetic, isBoolean) &&
		isOptional(value.localTimestamp, isString) &&
		isFiniteNumber(value.createdAt)
	);
}

function requireExerciseEntries(data: DataRecord): ExerciseEntry[] {
	const value = data.exerciseEntries;
	if (!Array.isArray(value))
		throw new Error("备份中的 exerciseEntries 数据格式无效");
	const entries = value.map(parseExerciseEntry);
	if (entries.some((entry) => entry === null)) {
		throw new Error("备份中的 exerciseEntries 数据格式无效");
	}
	return entries.filter((entry): entry is ExerciseEntry => entry !== null);
}

function requireArray<T>(
	data: DataRecord,
	key: string,
	guard: ValueGuard<T>,
): T[] {
	const value = data[key];
	if (!Array.isArray(value) || !value.every(guard)) {
		throw new Error(`备份中的 ${key} 数据格式无效`);
	}
	return value;
}

/** Parse untrusted JSON into fully validated application entities. */
export function parseKaloBackup(
	value: unknown,
	maxMemoryLength: number,
): ParsedKaloBackup {
	if (!isRecord(value)) throw new Error("备份文件不是有效对象");
	if (value.version !== 1 && value.version !== 2 && value.version !== 3)
		throw new Error("备份版本不受支持");
	if (!isFiniteNumber(value.exportedAt))
		throw new Error("备份导出时间格式无效");

	const user = requireArray(value, "user", isUser);
	const aiConfig = requireArray(value, "aiConfig", isAIConfig);
	const userMemory =
		value.version >= 2
			? requireArray(value, "userMemory", (item): item is UserMemory =>
					isUserMemory(item, maxMemoryLength),
				)
			: [];
	const trainingPlans =
		value.version === 3
			? requireArray(value, "trainingPlans", isTrainingPlan)
			: [];
	const plannedWorkouts =
		value.version === 3
			? requireArray(value, "plannedWorkouts", isPlannedWorkout)
			: [];
	if (user.length > 1) throw new Error("用户资料格式无效");
	if (aiConfig.length > 1) throw new Error("AI 配置格式无效");
	if (userMemory.length > 1) throw new Error("用户记忆格式无效");
	if (
		trainingPlans.filter(
			(plan) => plan.status === "active" || plan.status === "paused",
		).length > 1
	) {
		throw new Error("备份包含多个当前训练计划");
	}
	const planIds = new Set(trainingPlans.map((plan) => plan.id));
	if (plannedWorkouts.some((workout) => !planIds.has(workout.planId))) {
		throw new Error("计划训练关联了不存在的训练计划");
	}
	const exerciseEntries = requireExerciseEntries(value);
	const workoutIds = new Set(plannedWorkouts.map((workout) => workout.id));
	if (
		exerciseEntries.some(
			(exercise) =>
				exercise.plannedWorkoutId && !workoutIds.has(exercise.plannedWorkoutId),
		)
	) {
		throw new Error("运动记录关联了不存在的计划训练");
	}
	const exercisesById = new Map(
		exerciseEntries.map((exercise) => [exercise.id, exercise]),
	);
	const workoutsById = new Map(
		plannedWorkouts.map((workout) => [workout.id, workout]),
	);
	if (
		plannedWorkouts.some((workout) => {
			if (workout.status !== "completed" || !workout.exerciseEntryId)
				return false;
			return (
				exercisesById.get(workout.exerciseEntryId)?.plannedWorkoutId !==
				workout.id
			);
		}) ||
		exerciseEntries.some((exercise) => {
			if (!exercise.plannedWorkoutId) return false;
			const workout = workoutsById.get(exercise.plannedWorkoutId);
			return (
				workout?.status !== "completed" ||
				workout.exerciseEntryId !== exercise.id
			);
		})
	) {
		throw new Error("计划训练与运动记录的关联不一致");
	}

	return {
		user,
		aiConfig,
		userMemory,
		trainingPlans,
		plannedWorkouts,
		foodEntries: requireArray(value, "foodEntries", isFoodEntry),
		exerciseEntries,
		weightEntries: requireArray(value, "weightEntries", isWeightEntry),
		foodLibrary: requireArray(value, "foodLibrary", isFoodLibraryItem),
		sessions: requireArray(value, "sessions", isSession),
		messages: requireArray(value, "messages", isMessage),
	};
}
