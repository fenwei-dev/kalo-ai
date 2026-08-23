import type {
	AIConfig,
	ContentBlock,
	ExerciseEntry,
	FoodEntry,
	FoodLibraryItem,
	JsonObject,
	JsonValue,
	Message,
	Session,
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

export type KaloBackup = KaloBackupV1 | KaloBackupV2;
export type ParsedKaloBackup = Omit<KaloBackupV2, "version" | "exportedAt">;

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

function isExerciseEntry(value: unknown): value is ExerciseEntry {
	return (
		isRecord(value) &&
		isString(value.id) &&
		isString(value.date) &&
		isString(value.time) &&
		isString(value.description) &&
		isFiniteNumber(value.duration) &&
		isFiniteNumber(value.caloriesBurned) &&
		isOneOf(value.source, ["manual", "health_app", "watch"] as const) &&
		isFiniteNumber(value.createdAt)
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
	if (value.version !== 1 && value.version !== 2)
		throw new Error("备份版本不受支持");
	if (!isFiniteNumber(value.exportedAt))
		throw new Error("备份导出时间格式无效");

	const user = requireArray(value, "user", isUser);
	const aiConfig = requireArray(value, "aiConfig", isAIConfig);
	const userMemory =
		value.version === 2
			? requireArray(value, "userMemory", (item): item is UserMemory =>
					isUserMemory(item, maxMemoryLength),
				)
			: [];
	if (user.length > 1) throw new Error("用户资料格式无效");
	if (aiConfig.length > 1) throw new Error("AI 配置格式无效");
	if (userMemory.length > 1) throw new Error("用户记忆格式无效");

	return {
		user,
		aiConfig,
		userMemory,
		foodEntries: requireArray(value, "foodEntries", isFoodEntry),
		exerciseEntries: requireArray(value, "exerciseEntries", isExerciseEntry),
		weightEntries: requireArray(value, "weightEntries", isWeightEntry),
		foodLibrary: requireArray(value, "foodLibrary", isFoodLibraryItem),
		sessions: requireArray(value, "sessions", isSession),
		messages: requireArray(value, "messages", isMessage),
	};
}
