import { db } from './schema';
import { localDateISO } from '$lib/utils/date';
import type {
	AIConfig,
	ExerciseEntry,
	FoodEntry,
	FoodLibraryItem,
	Message,
	Session,
	User,
	WeightEntry
} from './schema';

const uid = (prefix = ''): string =>
	prefix + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));

const now = (): number => Date.now();

// ---------- User (singleton, id='me') ----------

export async function getUser(): Promise<User | undefined> {
	return db.user.get('me');
}

export async function saveUser(data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
	const existing = await db.user.get('me');
	const ts = now();
	const user: User = {
		...data,
		id: 'me',
		createdAt: existing?.createdAt ?? ts,
		updatedAt: ts
	};
	await db.user.put(user);
	return user;
}

export async function updateUser(patch: Partial<Omit<User, 'id' | 'createdAt'>>): Promise<User | undefined> {
	const existing = await db.user.get('me');
	if (!existing) return undefined;
	const updated: User = { ...existing, ...patch, updatedAt: now() };
	await db.user.put(updated);
	return updated;
}

// ---------- AIConfig (singleton, id='singleton') ----------

export async function getAIConfig(): Promise<AIConfig | undefined> {
	return db.aiConfig.get('singleton');
}

export async function saveAIConfig(data: Omit<AIConfig, 'id' | 'updatedAt'>): Promise<AIConfig> {
	const cfg: AIConfig = { ...data, id: 'singleton', updatedAt: now() };
	await db.aiConfig.put(cfg);
	return cfg;
}

export async function updateAIConfig(patch: Partial<Omit<AIConfig, 'id'>>): Promise<AIConfig | undefined> {
	const existing = await db.aiConfig.get('singleton');
	const cfg: AIConfig = { ...(existing ?? ({} as AIConfig)), ...patch, id: 'singleton', updatedAt: now() };
	await db.aiConfig.put(cfg);
	return cfg;
}

// ---------- Food entries ----------

export async function addFoodEntry(
	data: Omit<FoodEntry, 'id' | 'createdAt'>
): Promise<FoodEntry> {
	const entry: FoodEntry = { ...data, id: uid('food_'), createdAt: now() };
	await db.foodEntries.add(entry);
	return entry;
}

export async function getFoodEntriesByDate(date: string): Promise<FoodEntry[]> {
	return db.foodEntries.where('date').equals(date).reverse().sortBy('time');
}

export async function getFoodEntriesSince(sinceISO: string): Promise<FoodEntry[]> {
	return db.foodEntries.where('date').aboveOrEqual(sinceISO).toArray();
}

export async function updateFoodEntry(id: string, patch: Partial<FoodEntry>): Promise<void> {
	const updated = await db.foodEntries.update(id, patch);
	if (!updated) throw new Error('要修正的饮食记录不存在');
}

export async function deleteFoodEntry(id: string): Promise<void> {
	await db.foodEntries.delete(id);
}

// ---------- Exercise entries ----------

export async function addExerciseEntry(
	data: Omit<ExerciseEntry, 'id' | 'createdAt'>
): Promise<ExerciseEntry> {
	const entry: ExerciseEntry = { ...data, id: uid('ex_'), createdAt: now() };
	await db.exerciseEntries.add(entry);
	return entry;
}

export async function getExerciseEntriesByDate(date: string): Promise<ExerciseEntry[]> {
	return db.exerciseEntries.where('date').equals(date).reverse().sortBy('time');
}

export async function getExerciseEntriesSince(sinceISO: string): Promise<ExerciseEntry[]> {
	return db.exerciseEntries.where('date').aboveOrEqual(sinceISO).toArray();
}

export async function deleteExerciseEntry(id: string): Promise<void> {
	await db.exerciseEntries.delete(id);
}

// ---------- Weight entries ----------

export async function addWeightEntry(data: Omit<WeightEntry, 'id' | 'createdAt'>): Promise<WeightEntry> {
	const entry: WeightEntry = { ...data, id: uid('w_'), createdAt: now() };
	await db.weightEntries.add(entry);
	return entry;
}

export async function getWeightEntries(): Promise<WeightEntry[]> {
	return db.weightEntries.orderBy('date').toArray();
}

export async function getWeightEntriesByDate(date: string): Promise<WeightEntry[]> {
	return db.weightEntries.where('date').equals(date).toArray();
}

export async function getLatestWeight(): Promise<WeightEntry | undefined> {
	const all = await db.weightEntries.orderBy('date').toArray();
	return all[all.length - 1];
}

// ---------- Food library ----------

export async function listLibrary(): Promise<FoodLibraryItem[]> {
	const items = await db.foodLibrary.toArray();
	return items.sort((a, b) => b.servingsCount - a.servingsCount || b.lastUsedAt - a.lastUsedAt);
}

export async function upsertLibraryItem(
	data: Omit<FoodLibraryItem, 'id' | 'createdAt' | 'updatedAt' | 'servingsCount' | 'lastUsedAt'> & {
		id?: string;
	}
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
		id: data.id ?? uid('lib_'),
		servingsCount: 0,
		lastUsedAt: ts,
		createdAt: ts,
		updatedAt: ts
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
		lastUsedAt: now()
	});
}

export async function deleteLibraryItem(id: string): Promise<void> {
	await db.foodLibrary.delete(id);
}

// ---------- Sessions ----------

export async function createSession(title = '新对话'): Promise<Session> {
	const ts = now();
	const session: Session = {
		id: uid('sess_'),
		title,
		createdAt: ts,
		updatedAt: ts,
		lastMessageAt: ts
	};
	await db.sessions.add(session);
	return session;
}

export async function getSession(id: string): Promise<Session | undefined> {
	return db.sessions.get(id);
}

export async function listSessions(): Promise<Session[]> {
	return db.sessions.orderBy('updatedAt').reverse().toArray();
}

export async function renameSession(id: string, title: string): Promise<void> {
	await db.sessions.update(id, { title, updatedAt: now() });
}

export async function touchSession(id: string): Promise<void> {
	const ts = now();
	await db.sessions.update(id, { updatedAt: ts, lastMessageAt: ts });
}

export async function deleteSession(id: string): Promise<void> {
	await db.transaction('rw', db.sessions, db.messages, async () => {
		await db.messages.where('sessionId').equals(id).delete();
		await db.sessions.delete(id);
	});
}

// ---------- Messages ----------

export async function listMessages(sessionId: string): Promise<Message[]> {
	return db.messages.where('[sessionId+order]').between([sessionId, 0], [sessionId, Infinity]).toArray();
}

export async function addMessage(
	data: Omit<Message, 'id' | 'createdAt' | 'order'> & { order?: number }
): Promise<Message> {
	return db.transaction('rw', db.sessions, db.messages, async () => {
		const session = await db.sessions.get(data.sessionId);
		if (!session) throw new Error('对话不存在或已被删除');
		const order = data.order ?? (await db.messages.where('sessionId').equals(data.sessionId).count());
		const ts = now();
		const msg: Message = { ...data, order, id: uid('msg_'), createdAt: ts };
		await db.messages.add(msg);
		await db.sessions.update(data.sessionId, { updatedAt: ts, lastMessageAt: ts });
		return msg;
	});
}

export async function deleteMessagesFrom(sessionId: string, order: number): Promise<void> {
	await db.messages.where('[sessionId+order]').between([sessionId, order], [sessionId, Infinity]).delete();
}

// ---------- 聚合 / 工具 ----------

export async function todayDateStr(): Promise<string> {
	return localDateISO();
}

/** 清空全部数据，包括本地保存的 API Key。 */
export async function clearAllData(): Promise<void> {
	await db.transaction(
		'rw',
		[db.user, db.aiConfig, db.foodEntries, db.exerciseEntries, db.weightEntries, db.foodLibrary, db.sessions, db.messages],
		async () => {
			await Promise.all([
				db.user.clear(),
				db.aiConfig.clear(),
				db.foodEntries.clear(),
				db.exerciseEntries.clear(),
				db.weightEntries.clear(),
				db.foodLibrary.clear(),
				db.sessions.clear(),
				db.messages.clear()
			]);
		}
	);
}

export interface KaloBackup {
	version: 1;
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

/** Validate and atomically replace all app data from a Kalo backup. */
export async function importAll(value: unknown): Promise<void> {
	if (!value || typeof value !== 'object') throw new Error('备份文件不是有效对象');
	const data = value as Partial<KaloBackup>;
	const keys: (keyof Omit<KaloBackup, 'version' | 'exportedAt'>)[] = [
		'user', 'aiConfig', 'foodEntries', 'exerciseEntries', 'weightEntries',
		'foodLibrary', 'sessions', 'messages'
	];
	for (const key of keys) {
		if (!Array.isArray(data[key])) throw new Error(`备份缺少 ${key} 数据`);
	}
	const user = data.user as User[];
	const aiConfig = data.aiConfig as AIConfig[];
	if (user.length > 1 || user.some((item) => item?.id !== 'me')) throw new Error('用户资料格式无效');
	if (aiConfig.length > 1 || aiConfig.some((item) => item?.id !== 'singleton')) throw new Error('AI 配置格式无效');

	await db.transaction(
		'rw',
		[db.user, db.aiConfig, db.foodEntries, db.exerciseEntries, db.weightEntries, db.foodLibrary, db.sessions, db.messages],
		async () => {
			await Promise.all([
				db.user.clear(), db.aiConfig.clear(), db.foodEntries.clear(), db.exerciseEntries.clear(),
				db.weightEntries.clear(), db.foodLibrary.clear(), db.sessions.clear(), db.messages.clear()
			]);
			await db.user.bulkPut(user);
			await db.aiConfig.bulkPut(aiConfig);
			await db.foodEntries.bulkPut(data.foodEntries as FoodEntry[]);
			await db.exerciseEntries.bulkPut(data.exerciseEntries as ExerciseEntry[]);
			await db.weightEntries.bulkPut(data.weightEntries as WeightEntry[]);
			await db.foodLibrary.bulkPut(data.foodLibrary as FoodLibraryItem[]);
			await db.sessions.bulkPut(data.sessions as Session[]);
			await db.messages.bulkPut(data.messages as Message[]);
		}
	);
}

/** 导出全部数据为可序列化对象 */
export async function exportAll(): Promise<Record<string, unknown>> {
	const [
		user,
		aiConfig,
		foodEntries,
		exerciseEntries,
		weightEntries,
		foodLibrary,
		sessions,
		messages
	] = await Promise.all([
		db.user.toArray(),
		db.aiConfig.toArray(),
		db.foodEntries.toArray(),
		db.exerciseEntries.toArray(),
		db.weightEntries.toArray(),
		db.foodLibrary.toArray(),
		db.sessions.toArray(),
		db.messages.toArray()
	]);
	return {
		version: 1,
		exportedAt: now(),
		user,
		aiConfig,
		foodEntries,
		exerciseEntries,
		weightEntries,
		foodLibrary,
		sessions,
		messages
	};
}
