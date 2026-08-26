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
	PluginConfigRecord,
	PluginDataRecord,
	PluginDraft,
	PluginDraftRevision,
	PluginInstallation,
	PluginModuleRecord,
	Session,
	SessionMode,
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

export interface KaloBackupV4 extends Omit<KaloBackupV3, "version"> {
	version: 4;
	pluginConfigs: PluginConfigRecord[];
	pluginData: PluginDataRecord[];
}

export interface KaloBackupV5 extends Omit<KaloBackupV4, "version"> {
	version: 5;
	pluginInstallations: PluginInstallation[];
}

export interface KaloBackupV6 extends Omit<KaloBackupV5, "version"> {
	version: 6;
	pluginModules: PluginModuleRecord[];
}

export interface KaloBackupV7 extends Omit<KaloBackupV6, "version"> {
	version: 7;
	pluginDrafts: PluginDraft[];
	pluginDraftRevisions: PluginDraftRevision[];
}

export type KaloBackup =
	| KaloBackupV1
	| KaloBackupV2
	| KaloBackupV3
	| KaloBackupV4
	| KaloBackupV5
	| KaloBackupV6
	| KaloBackupV7;
export type ParsedKaloBackup = Omit<KaloBackupV7, "version" | "exportedAt">;

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

function isPluginConfigRecord(value: unknown): value is PluginConfigRecord {
	return (
		isRecord(value) &&
		isString(value.pluginId) &&
		isBoolean(value.enabled) &&
		isFiniteNumber(value.configVersion) &&
		Number.isInteger(value.configVersion) &&
		value.configVersion >= 1 &&
		isJsonObject(value.config) &&
		isFiniteNumber(value.updatedAt)
	);
}

function isPluginDataRecord(value: unknown): value is PluginDataRecord {
	return (
		isRecord(value) &&
		isString(value.pluginId) &&
		isString(value.key) &&
		isJsonValue(value.value) &&
		isFiniteNumber(value.updatedAt)
	);
}

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const NPM_PACKAGE_PATTERN =
	/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const JSR_PACKAGE_PATTERN = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const EXACT_VERSION_PATTERN =
	/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const LOCAL_PLUGIN_FILE_PATTERN = /^[^/\\\0]{1,200}\.(?:js|mjs)$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_PLUGIN_MODULE_BYTES = 2 * 1024 * 1024;

function isPluginManifest(
	value: unknown,
): value is PluginInstallation["manifest"] {
	return (
		isRecord(value) &&
		isString(value.id) &&
		value.id.length <= 64 &&
		PLUGIN_ID_PATTERN.test(value.id) &&
		value.apiVersion === 1 &&
		isString(value.version) &&
		value.version.length > 0 &&
		value.version.length <= 100 &&
		isFiniteNumber(value.configVersion) &&
		Number.isInteger(value.configVersion) &&
		value.configVersion >= 1 &&
		isRecord(value.name) &&
		isString(value.name["zh-cn"]) &&
		value.name["zh-cn"].trim().length > 0 &&
		value.name["zh-cn"].length <= 200 &&
		isString(value.name["en-us"]) &&
		value.name["en-us"].trim().length > 0 &&
		value.name["en-us"].length <= 200 &&
		isRecord(value.description) &&
		isString(value.description["zh-cn"]) &&
		value.description["zh-cn"].trim().length > 0 &&
		value.description["zh-cn"].length <= 200 &&
		isString(value.description["en-us"]) &&
		value.description["en-us"].trim().length > 0 &&
		value.description["en-us"].length <= 200 &&
		isOptional(value.defaultEnabled, isBoolean) &&
		isOptional(
			value.permissions,
			(
				permissions,
			): permissions is NonNullable<
				PluginInstallation["manifest"]["permissions"]
			> =>
				Array.isArray(permissions) &&
				permissions.every((permission) =>
					isOneOf(permission, [
						"network",
						"profile.read",
						"logs.read",
						"logs.write",
						"storage",
					] as const),
				) &&
				new Set(permissions).size === permissions.length,
		)
	);
}

function isPluginDescriptorSnapshot(
	value: unknown,
): value is NonNullable<PluginInstallation["descriptor"]> {
	return (
		isRecord(value) &&
		isJsonObject(value.configSchema) &&
		isJsonObject(value.defaultConfig) &&
		isOptional(value.settings, isJsonObject) &&
		isString(value.sha256) &&
		SHA256_PATTERN.test(value.sha256)
	);
}

function isPluginInstallation(value: unknown): value is PluginInstallation {
	return (
		isRecord(value) &&
		isString(value.pluginId) &&
		value.pluginId.length <= 64 &&
		PLUGIN_ID_PATTERN.test(value.pluginId) &&
		isOneOf(value.registry, ["npm", "jsr", "local"] as const) &&
		isString(value.packageName) &&
		value.packageName.length <= 214 &&
		(value.registry === "npm"
			? NPM_PACKAGE_PATTERN.test(value.packageName)
			: value.registry === "jsr"
				? JSR_PACKAGE_PATTERN.test(value.packageName)
				: LOCAL_PLUGIN_FILE_PATTERN.test(value.packageName)) &&
		isString(value.packageVersion) &&
		EXACT_VERSION_PATTERN.test(value.packageVersion) &&
		isOptional(
			value.moduleSha256,
			(item): item is string => isString(item) && SHA256_PATTERN.test(item),
		) &&
		isOptional(
			value.moduleSize,
			(item): item is number =>
				isFiniteNumber(item) &&
				Number.isInteger(item) &&
				item > 0 &&
				item <= MAX_PLUGIN_MODULE_BYTES,
		) &&
		((value.moduleSha256 === undefined && value.moduleSize === undefined) ||
			(isString(value.moduleSha256) && isFiniteNumber(value.moduleSize))) &&
		(value.registry !== "local" ||
			(isString(value.moduleSha256) && isFiniteNumber(value.moduleSize))) &&
		isPluginManifest(value.manifest) &&
		isOptional(value.descriptor, isPluginDescriptorSnapshot) &&
		value.manifest.id === value.pluginId &&
		value.manifest.version === value.packageVersion &&
		isFiniteNumber(value.installedAt) &&
		isFiniteNumber(value.updatedAt)
	);
}

function isPluginModuleRecord(value: unknown): value is PluginModuleRecord {
	return (
		isRecord(value) &&
		isString(value.pluginId) &&
		value.pluginId.length <= 64 &&
		PLUGIN_ID_PATTERN.test(value.pluginId) &&
		isString(value.source) &&
		value.source.length > 0 &&
		isString(value.sha256) &&
		SHA256_PATTERN.test(value.sha256) &&
		isFiniteNumber(value.size) &&
		Number.isInteger(value.size) &&
		value.size > 0 &&
		value.size <= MAX_PLUGIN_MODULE_BYTES &&
		new TextEncoder().encode(value.source).byteLength === value.size &&
		isString(value.fileName) &&
		LOCAL_PLUGIN_FILE_PATTERN.test(value.fileName) &&
		isOptional(value.sourceUrl, isString) &&
		isFiniteNumber(value.createdAt) &&
		isFiniteNumber(value.updatedAt)
	);
}

const isSessionMode = (value: unknown): value is SessionMode =>
	isOneOf(value, ["standard", "plugin_development"] as const);

function parseSession(value: unknown, legacy: boolean): Session | null {
	if (
		!isRecord(value) ||
		!isString(value.id) ||
		!isString(value.title) ||
		(!legacy && !isSessionMode(value.mode)) ||
		(legacy && !isOptional(value.mode, isSessionMode)) ||
		!isOptional(value.modeLockedAt, isFiniteNumber) ||
		!isFiniteNumber(value.createdAt) ||
		!isFiniteNumber(value.updatedAt) ||
		!isFiniteNumber(value.lastMessageAt) ||
		!isOptional(value.memoryVersion, isFiniteNumber)
	) {
		return null;
	}
	return {
		id: value.id,
		title: value.title,
		mode: isSessionMode(value.mode) ? value.mode : "standard",
		modeLockedAt: value.modeLockedAt,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
		lastMessageAt: value.lastMessageAt,
		memoryVersion: value.memoryVersion,
	};
}

function isPluginDraftDiagnostic(
	value: unknown,
): value is PluginDraft["diagnostics"][number] {
	return (
		isRecord(value) &&
		isOneOf(value.level, ["info", "warning", "error"] as const) &&
		isString(value.code) &&
		isString(value.message)
	);
}

function isPluginDraft(value: unknown): value is PluginDraft {
	return (
		isRecord(value) &&
		isString(value.id) &&
		isString(value.sessionId) &&
		isString(value.fileName) &&
		LOCAL_PLUGIN_FILE_PATTERN.test(value.fileName) &&
		isString(value.source) &&
		value.source.length > 0 &&
		isFiniteNumber(value.size) &&
		Number.isInteger(value.size) &&
		value.size > 0 &&
		value.size <= 256 * 1024 &&
		new TextEncoder().encode(value.source).byteLength === value.size &&
		isString(value.sha256) &&
		SHA256_PATTERN.test(value.sha256) &&
		isOneOf(value.status, ["draft", "valid", "invalid"] as const) &&
		isFiniteNumber(value.revision) &&
		Number.isInteger(value.revision) &&
		value.revision >= 1 &&
		Array.isArray(value.diagnostics) &&
		value.diagnostics.every(isPluginDraftDiagnostic) &&
		isFiniteNumber(value.createdAt) &&
		isFiniteNumber(value.updatedAt)
	);
}

function isPluginDraftRevision(value: unknown): value is PluginDraftRevision {
	return (
		isRecord(value) &&
		isString(value.draftId) &&
		isFiniteNumber(value.revision) &&
		Number.isInteger(value.revision) &&
		value.revision >= 1 &&
		isString(value.source) &&
		value.source.length > 0 &&
		isFiniteNumber(value.size) &&
		Number.isInteger(value.size) &&
		value.size > 0 &&
		value.size <= 256 * 1024 &&
		new TextEncoder().encode(value.source).byteLength === value.size &&
		isString(value.sha256) &&
		SHA256_PATTERN.test(value.sha256) &&
		isFiniteNumber(value.createdAt)
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
	const version = value.version;
	if (
		version !== 1 &&
		version !== 2 &&
		version !== 3 &&
		version !== 4 &&
		version !== 5 &&
		version !== 6 &&
		version !== 7
	)
		throw new Error("备份版本不受支持");
	if (!isFiniteNumber(value.exportedAt))
		throw new Error("备份导出时间格式无效");

	const user = requireArray(value, "user", isUser);
	const aiConfig = requireArray(value, "aiConfig", isAIConfig);
	const userMemory =
		version >= 2
			? requireArray(value, "userMemory", (item): item is UserMemory =>
					isUserMemory(item, maxMemoryLength),
				)
			: [];
	const trainingPlans =
		version >= 3 ? requireArray(value, "trainingPlans", isTrainingPlan) : [];
	const plannedWorkouts =
		version >= 3
			? requireArray(value, "plannedWorkouts", isPlannedWorkout)
			: [];
	const pluginConfigs =
		version >= 4
			? requireArray(value, "pluginConfigs", isPluginConfigRecord)
			: [];
	const pluginData =
		version >= 4 ? requireArray(value, "pluginData", isPluginDataRecord) : [];
	const pluginInstallations =
		version >= 5
			? requireArray(value, "pluginInstallations", isPluginInstallation)
			: [];
	const pluginModules =
		version >= 6
			? requireArray(value, "pluginModules", isPluginModuleRecord)
			: [];
	const pluginDrafts =
		version >= 7 ? requireArray(value, "pluginDrafts", isPluginDraft) : [];
	const pluginDraftRevisions =
		version >= 7
			? requireArray(value, "pluginDraftRevisions", isPluginDraftRevision)
			: [];
	if (user.length > 1) throw new Error("用户资料格式无效");
	if (aiConfig.length > 1) throw new Error("AI 配置格式无效");
	if (userMemory.length > 1) throw new Error("用户记忆格式无效");
	if (
		new Set(pluginConfigs.map((record) => record.pluginId)).size !==
		pluginConfigs.length
	) {
		throw new Error("插件配置包含重复 pluginId");
	}
	if (
		new Set(pluginData.map((record) => `${record.pluginId}\u0000${record.key}`))
			.size !== pluginData.length
	) {
		throw new Error("插件数据包含重复 key");
	}
	if (pluginInstallations.length > 10) {
		throw new Error("已安装插件数量超过上限");
	}
	if (
		new Set(pluginInstallations.map((record) => record.pluginId)).size !==
		pluginInstallations.length
	) {
		throw new Error("已安装插件包含重复 pluginId");
	}
	if (
		new Set(
			pluginInstallations.map((record) =>
				record.registry === "local"
					? `local\u0000${record.pluginId}`
					: `${record.registry}\u0000${record.packageName}`,
			),
		).size !== pluginInstallations.length
	) {
		throw new Error("已安装插件包含重复来源");
	}
	if (
		new Set(pluginModules.map((record) => record.pluginId)).size !==
		pluginModules.length
	) {
		throw new Error("插件模块包含重复 pluginId");
	}
	const installationById = new Map(
		pluginInstallations.map((installation) => [
			installation.pluginId,
			installation,
		]),
	);
	if (
		pluginModules.some((module) => !installationById.has(module.pluginId)) ||
		pluginInstallations.some(
			(installation) =>
				installation.registry === "local" &&
				!pluginModules.some(
					(module) => module.pluginId === installation.pluginId,
				),
		)
	) {
		throw new Error("插件安装记录与本地模块不一致");
	}
	if (
		pluginModules.some((module) => {
			const installation = installationById.get(module.pluginId);
			return (
				installation?.moduleSha256 !== module.sha256 ||
				installation.moduleSize !== module.size
			);
		})
	) {
		throw new Error("插件模块 hash 或大小与安装记录不一致");
	}
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

	const messages = requireArray(value, "messages", isMessage);
	const sessionValues = value.sessions;
	if (!Array.isArray(sessionValues)) {
		throw new Error("备份中的 sessions 数据格式无效");
	}
	const sessions = sessionValues.map((session) =>
		parseSession(session, version < 7),
	);
	if (sessions.some((session) => session === null)) {
		throw new Error("备份中的 sessions 数据格式无效");
	}
	const normalizedSessions = sessions.filter(
		(session): session is Session => session !== null,
	);
	const firstMessageAt = new Map<string, number>();
	for (const message of messages) {
		const previous = firstMessageAt.get(message.sessionId);
		if (previous === undefined || message.createdAt < previous) {
			firstMessageAt.set(message.sessionId, message.createdAt);
		}
	}
	for (const session of normalizedSessions) {
		session.modeLockedAt ??= firstMessageAt.get(session.id);
	}
	const sessionById = new Map(
		normalizedSessions.map((session) => [session.id, session]),
	);
	if (messages.some((message) => !sessionById.has(message.sessionId))) {
		throw new Error("聊天消息关联了不存在的会话");
	}
	if (
		pluginDrafts.some(
			(draft) =>
				sessionById.get(draft.sessionId)?.mode !== "plugin_development",
		)
	) {
		throw new Error("插件草稿关联了无效的开发会话");
	}
	const draftById = new Map(pluginDrafts.map((draft) => [draft.id, draft]));
	if (
		new Set(pluginDrafts.map((draft) => draft.id)).size !== pluginDrafts.length
	) {
		throw new Error("插件草稿包含重复 id");
	}
	if (
		pluginDraftRevisions.some((revision) => !draftById.has(revision.draftId)) ||
		new Set(
			pluginDraftRevisions.map(
				(revision) => `${revision.draftId}\u0000${revision.revision}`,
			),
		).size !== pluginDraftRevisions.length
	) {
		throw new Error("插件草稿 revision 关联无效");
	}

	return {
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
		foodEntries: requireArray(value, "foodEntries", isFoodEntry),
		exerciseEntries,
		weightEntries: requireArray(value, "weightEntries", isWeightEntry),
		foodLibrary: requireArray(value, "foodLibrary", isFoodLibraryItem),
		sessions: normalizedSessions,
		messages,
	};
}
