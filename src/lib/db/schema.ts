import Dexie, { type Table } from "dexie";

// ---------- 基础枚举 / 类型 ----------

export type Gender = "male" | "female";
export type BMRMethod = "mifflin-st-jeor" | "katch-mcardle";
export type ActivityLevel =
	| "sedentary"
	| "light"
	| "moderate"
	| "active"
	| "very_active";

/** AI provider 的 API 协议类型，用户在设置页自配 */
export type ApiType =
	| "openai-completions"
	| "openai-responses"
	| "anthropic-messages";

export type FoodCategory = "meal" | "snack" | "drink" | "fruit" | "other";
export type FoodSource = "ai" | "library" | "manual";
export type ExerciseCategory =
	| "walking"
	| "running"
	| "cycling"
	| "strength"
	| "swimming"
	| "sports"
	| "other";
export type ExerciseIntensity = "light" | "moderate" | "vigorous";
export type ExerciseSource = "manual" | "third_party";

// ---------- 实体 ----------

/** 单例：整个 app 只有一条 User 记录，id 固定为 'me' */
export interface User {
	id: "me";
	age: number;
	gender: Gender;
	height: number; // cm
	currentWeight: number; // kg
	targetWeight?: number; // kg
	targetDate?: string; // ISO date YYYY-MM-DD
	activityLevel: ActivityLevel;
	/** 旧数据库未设置时默认使用 Mifflin–St Jeor。 */
	bmrMethod?: BMRMethod;
	/** Katch–McArdle 所需；选择 Mifflin 时也可作为可选资料保留。 */
	bodyFatPercentage?: number;
	calculatedBMR: number;
	adaptiveTDEE?: number;
	adaptiveConfidence?: number; // 0..1
	createdAt: number;
	updatedAt: number;
}

/** 单例：id 固定为 'singleton' */
export interface AIConfig {
	id: "singleton";
	apiType: ApiType;
	baseUrl?: string; // 留空 = 各 API 官方端点
	apiKey: string;
	model: string; // 模型 id，自由输入
	updatedAt: number;
}

/** 单例：Agent 跨会话使用的自由格式 Markdown 用户记忆。 */
export interface UserMemory {
	id: "user-memory";
	content: string;
	version: number;
	updatedAt: number;
}

export interface FoodEntry {
	id: string;
	date: string; // YYYY-MM-DD
	time: string; // HH:mm
	name: string;
	calories: number;
	protein: number; // g
	carbs: number; // g
	fat: number; // g
	tef: number; // 食物热效应 kcal
	source: FoodSource;
	libraryItemId?: string; // 命中食物库时的来源
	createdAt: number;
}

export interface ExerciseEntry {
	id: string;
	date: string;
	time: string;
	description: string;
	category?: ExerciseCategory;
	intensity?: ExerciseIntensity;
	duration: number; // 分钟
	caloriesBurned: number;
	source: ExerciseSource;
	createdAt: number;
}

export interface WeightEntry {
	id: string;
	date: string;
	weight: number; // kg
	createdAt: number;
}

export interface FoodLibraryItem {
	id: string;
	name: string;
	category: FoodCategory;
	calories: number;
	protein?: number;
	carbs?: number;
	fat?: number;
	servingsCount: number; // 累计记录次数
	lastUsedAt: number;
	createdAt: number;
	updatedAt: number;
}

export interface Session {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	lastMessageAt: number;
	/** 此会话最近读取或写入成功的全局用户记忆版本。 */
	memoryVersion?: number;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
	[key: string]: JsonValue;
}

/** pi-ai 风格的内容块；所有持久化字段都必须可结构化克隆。 */
export type ContentBlock =
	| { type: "text"; text: string; textSignature?: string }
	| {
			type: "thinking";
			thinking: string;
			thinkingSignature?: string;
			redacted?: boolean;
	  }
	| {
			type: "toolCall";
			id: string;
			name: string;
			arguments: JsonObject;
			thoughtSignature?: string;
	  }
	| { type: "image"; data: string; mimeType: string };

export type MessageRole = "user" | "assistant" | "toolResult";

export interface Message {
	id: string;
	sessionId: string;
	order: number; // 会话内自增序号，用于排序
	role: MessageRole;
	content: ContentBlock[];
	toolCallId?: string; // role='toolResult' 时关联的 toolCall id
	toolName?: string;
	isError?: boolean;
	/** 由应用在发送边界自动插入，而非模型实际生成。 */
	synthetic?: boolean;
	/** Local wall-clock time captured when the message was created. */
	localTimestamp?: string; // YYYY-MM-DD HH:mm
	createdAt: number;
}

// ---------- Dexie ----------

class KaloDB extends Dexie {
	user!: Table<User, string>;
	aiConfig!: Table<AIConfig, string>;
	userMemory!: Table<UserMemory, string>;
	foodEntries!: Table<FoodEntry, string>;
	exerciseEntries!: Table<ExerciseEntry, string>;
	weightEntries!: Table<WeightEntry, string>;
	foodLibrary!: Table<FoodLibraryItem, string>;
	sessions!: Table<Session, string>;
	messages!: Table<Message, string>;

	constructor() {
		super("kalo-ai");
		this.version(1).stores({
			user: "id",
			aiConfig: "id",
			foodEntries: "id, date, [date+time], source",
			exerciseEntries: "id, date, source",
			weightEntries: "id, date",
			foodLibrary: "id, name, category, lastUsedAt",
			sessions: "id, updatedAt, lastMessageAt",
			messages: "id, sessionId, [sessionId+order], order",
		});
		this.version(2).stores({
			user: "id",
			aiConfig: "id",
			userMemory: "id",
			foodEntries: "id, date, [date+time], source",
			exerciseEntries: "id, date, source",
			weightEntries: "id, date",
			foodLibrary: "id, name, category, lastUsedAt",
			sessions: "id, updatedAt, lastMessageAt",
			messages: "id, sessionId, [sessionId+order], order",
		});
		this.version(3)
			.stores({
				user: "id",
				aiConfig: "id",
				userMemory: "id",
				foodEntries: "id, date, [date+time], source",
				exerciseEntries: "id, date, source",
				weightEntries: "id, date",
				foodLibrary: "id, name, category, lastUsedAt",
				sessions: "id, updatedAt, lastMessageAt",
				messages: "id, sessionId, [sessionId+order], order",
			})
			.upgrade((transaction) =>
				transaction
					.table("exerciseEntries")
					.toCollection()
					.modify((entry: { source?: string }) => {
						entry.source =
							entry.source === "health_app" || entry.source === "watch"
								? "third_party"
								: "manual";
					}),
			);
	}
}

export const db = new KaloDB();
