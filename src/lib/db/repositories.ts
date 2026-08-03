import { db } from './schema';
import { localDateISO, localMessageTimestamp } from '$lib/utils/date';
import { getLocale } from '$lib/paraglide/runtime';
import type {
	AIConfig,
	ExerciseEntry,
	FoodEntry,
	FoodLibraryItem,
	Message,
	Session,
	User,
	UserMemory,
	WeightEntry
} from './schema';

const uid = (prefix = ''): string =>
	prefix + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));

const now = (): number => Date.now();
export const MAX_USER_MEMORY_LENGTH = 8_000;

export interface UserMemorySnapshot {
	content: string;
	version: number;
	updatedAt: number | null;
}

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

export async function saveUserWithWeightEntry(
	data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>,
	date: string
): Promise<User> {
	assertWeightDate(date);
	return db.transaction('rw', db.user, db.weightEntries, async () => {
		const existingUser = await db.user.get('me');
		const ts = now();
		const user: User = {
			...data,
			id: 'me',
			createdAt: existingUser?.createdAt ?? ts,
			updatedAt: ts
		};
		await db.user.put(user);

		const existingWeights = await db.weightEntries.where('date').equals(date).toArray();
		if (existingWeights.length) {
			const keep = [...existingWeights].sort((a, b) => b.createdAt - a.createdAt)[0];
			await db.weightEntries.put({ ...keep, date, weight: data.currentWeight });
			await db.weightEntries.bulkDelete(existingWeights.filter((item) => item.id !== keep.id).map((item) => item.id));
		} else {
			await db.weightEntries.add({
				id: uid('w_'),
				date,
				weight: data.currentWeight,
				createdAt: ts
			});
		}
		await syncCurrentWeightInTransaction();
		return (await db.user.get('me')) ?? user;
	});
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

export async function getFoodEntry(id: string): Promise<FoodEntry | undefined> {
	return db.foodEntries.get(id);
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

export async function getExerciseEntry(id: string): Promise<ExerciseEntry | undefined> {
	return db.exerciseEntries.get(id);
}

// ---------- Weight entries ----------

function assertWeightDate(date: string): void {
	if (date > localDateISO()) throw new Error('不能记录未来日期的体重');
}

export async function addWeightEntry(data: Omit<WeightEntry, 'id' | 'createdAt'>): Promise<WeightEntry> {
	assertWeightDate(data.date);
	return db.transaction('rw', db.weightEntries, db.user, async () => {
		const existing = await db.weightEntries.where('date').equals(data.date).first();
		if (existing) {
			throw new Error(`日期 ${data.date} 已有体重记录（${existing.weight} kg），每天只能记录一次；如需更正请先删除原记录`);
		}
		const entry: WeightEntry = { ...data, id: uid('w_'), createdAt: now() };
		await db.weightEntries.add(entry);
		await syncCurrentWeightInTransaction();
		return entry;
	});
}

/** 设置资料时使用：当天无记录则创建，有记录则修改，并清理旧版本遗留的同日重复项。 */
export async function upsertWeightEntryForDate(data: Omit<WeightEntry, 'id' | 'createdAt'>): Promise<{
	entry: WeightEntry;
	status: 'created' | 'updated';
}> {
	assertWeightDate(data.date);
	return db.transaction('rw', db.weightEntries, db.user, async () => {
		const existing = await db.weightEntries.where('date').equals(data.date).toArray();
		if (!existing.length) {
			const entry: WeightEntry = { ...data, id: uid('w_'), createdAt: now() };
			await db.weightEntries.add(entry);
			await syncCurrentWeightInTransaction();
			return { entry, status: 'created' as const };
		}
		const keep = [...existing].sort((a, b) => b.createdAt - a.createdAt)[0];
		const entry: WeightEntry = { ...keep, ...data };
		await db.weightEntries.put(entry);
		await db.weightEntries.bulkDelete(existing.filter((item) => item.id !== keep.id).map((item) => item.id));
		await syncCurrentWeightInTransaction();
		return { entry, status: 'updated' as const };
	});
}

async function syncCurrentWeightInTransaction(): Promise<WeightEntry | undefined> {
	const all = await db.weightEntries.orderBy('date').toArray();
	const latest = all.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt).at(-1);
	if (latest && await db.user.get('me')) {
		await db.user.update('me', { currentWeight: latest.weight, updatedAt: now() });
	}
	return latest;
}

/** 当存在体重记录时，让 Profile.currentWeight 始终等于日期最晚的记录。 */
export async function syncCurrentWeightFromLatest(): Promise<WeightEntry | undefined> {
	return db.transaction('rw', db.weightEntries, db.user, syncCurrentWeightInTransaction);
}

export async function getWeightEntries(): Promise<WeightEntry[]> {
	return db.weightEntries.orderBy('date').toArray();
}

export async function getWeightEntriesByDate(date: string): Promise<WeightEntry[]> {
	return db.weightEntries.where('date').equals(date).toArray();
}

export async function getWeightEntry(id: string): Promise<WeightEntry | undefined> {
	return db.weightEntries.get(id);
}

export async function deleteWeightEntry(id: string): Promise<void> {
	await db.transaction('rw', db.weightEntries, db.user, async () => {
		const entry = await db.weightEntries.get(id);
		if (!entry) throw new Error('要删除的体重记录不存在');
		if ((await db.weightEntries.count()) <= 1) throw new Error('不能删除唯一一条体重记录');
		await db.weightEntries.delete(id);
		await syncCurrentWeightInTransaction();
	});
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

export async function getLibraryItem(id: string): Promise<FoodLibraryItem | undefined> {
	return db.foodLibrary.get(id);
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

// ---------- Agent memory (singleton, id='user-memory') ----------

export async function getUserMemory(): Promise<UserMemorySnapshot> {
	const memory = await db.userMemory.get('user-memory');
	return memory
		? { content: memory.content, version: memory.version, updatedAt: memory.updatedAt }
		: { content: '', version: 0, updatedAt: null };
}

/** Replace the full Markdown memory document with optimistic concurrency protection. */
export async function updateUserMemory(content: string, expectedVersion: number): Promise<UserMemorySnapshot> {
	if (content.length > MAX_USER_MEMORY_LENGTH) {
		throw new Error(`用户记忆不能超过 ${MAX_USER_MEMORY_LENGTH} 个字符`);
	}
	return db.transaction('rw', db.userMemory, async () => {
		const existing = await db.userMemory.get('user-memory');
		const currentVersion = existing?.version ?? 0;
		if (currentVersion !== expectedVersion) {
			throw new Error(`用户记忆已更新（当前版本 ${currentVersion}），请先重新读取后再修改`);
		}
		if ((existing?.content ?? '') === content) {
			return existing
				? { content: existing.content, version: existing.version, updatedAt: existing.updatedAt }
				: { content: '', version: 0, updatedAt: null };
		}
		const memory: UserMemory = {
			id: 'user-memory',
			content,
			version: currentVersion + 1,
			updatedAt: now()
		};
		await db.userMemory.put(memory);
		return { content: memory.content, version: memory.version, updatedAt: memory.updatedAt };
	});
}

export async function markSessionMemoryVersion(sessionId: string, version: number): Promise<void> {
	await db.sessions.update(sessionId, { memoryVersion: version });
}

// ---------- Sessions ----------

export async function createSession(title?: string): Promise<Session> {
	const ts = now();
	const resolvedTitle = title ?? (getLocale() === 'en-us' ? 'New chat' : '新对话');
	const session: Session = {
		id: uid('sess_'),
		title: resolvedTitle,
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
		const msg: Message = {
			...data,
			order,
			id: uid('msg_'),
			localTimestamp: data.localTimestamp ?? localMessageTimestamp(new Date(ts)),
			createdAt: ts
		};
		await db.messages.add(msg);
		await db.sessions.update(data.sessionId, { updatedAt: ts, lastMessageAt: ts });
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
	content: Message['content'];
	localTimestamp?: string;
}): Promise<Message> {
	return db.transaction('rw', db.sessions, db.messages, db.userMemory, async () => {
		const session = await db.sessions.get(data.sessionId);
		if (!session) throw new Error('对话不存在或已被删除');
		let order = await db.messages.where('sessionId').equals(data.sessionId).count();
		const ts = now();
		const timestamp = data.localTimestamp ?? localMessageTimestamp(new Date(ts));
		const userMessage: Message = {
			id: uid('msg_'),
			sessionId: data.sessionId,
			order: order++,
			role: 'user',
			content: data.content,
			localTimestamp: timestamp,
			createdAt: ts
		};
		await db.messages.add(userMessage);

		const memory = await db.userMemory.get('user-memory');
		const snapshot: UserMemorySnapshot = memory
			? { content: memory.content, version: memory.version, updatedAt: memory.updatedAt }
			: { content: '', version: 0, updatedAt: null };
		if (session.memoryVersion !== snapshot.version) {
			const toolCallId = uid('memory_');
			await db.messages.bulkAdd([
				{
					id: uid('msg_'),
					sessionId: data.sessionId,
					order: order++,
					role: 'assistant',
					content: [{ type: 'toolCall', id: toolCallId, name: 'readUserMemory', arguments: {} }],
					synthetic: true,
					localTimestamp: timestamp,
					createdAt: ts
				},
				{
					id: uid('msg_'),
					sessionId: data.sessionId,
					order: order++,
					role: 'toolResult',
					content: [{ type: 'text', text: JSON.stringify(snapshot) }],
					toolCallId,
					toolName: 'readUserMemory',
					isError: false,
					synthetic: true,
					localTimestamp: timestamp,
					createdAt: ts
				}
			]);
		}
		await db.sessions.update(data.sessionId, {
			updatedAt: ts,
			lastMessageAt: ts,
			memoryVersion: snapshot.version
		});
		return userMessage;
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
		[db.user, db.aiConfig, db.userMemory, db.foodEntries, db.exerciseEntries, db.weightEntries, db.foodLibrary, db.sessions, db.messages],
		async () => {
			await Promise.all([
				db.user.clear(),
				db.aiConfig.clear(),
				db.userMemory.clear(),
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
	version: 1 | 2;
	exportedAt: number;
	user: User[];
	aiConfig: AIConfig[];
	userMemory?: UserMemory[];
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
	if (data.version !== 1 && data.version !== 2) throw new Error('备份版本不受支持');
	const keys = [
		'user', 'aiConfig', 'foodEntries', 'exerciseEntries', 'weightEntries',
		'foodLibrary', 'sessions', 'messages'
	] as const;
	for (const key of keys) {
		if (!Array.isArray(data[key])) throw new Error(`备份缺少 ${key} 数据`);
	}
	const user = data.user as User[];
	const aiConfig = data.aiConfig as AIConfig[];
	const userMemory = data.version === 2 ? data.userMemory : [];
	if (data.version === 2 && !Array.isArray(userMemory)) throw new Error('备份缺少 userMemory 数据');
	if (user.length > 1 || user.some((item) => item?.id !== 'me')) throw new Error('用户资料格式无效');
	if (aiConfig.length > 1 || aiConfig.some((item) => item?.id !== 'singleton')) throw new Error('AI 配置格式无效');
	if (
		(userMemory?.length ?? 0) > 1 ||
		userMemory?.some((item) =>
			item?.id !== 'user-memory' ||
			typeof item.content !== 'string' ||
			item.content.length > MAX_USER_MEMORY_LENGTH ||
			!Number.isInteger(item.version) || item.version < 1 ||
			!Number.isFinite(item.updatedAt)
		)
	) {
		throw new Error('用户记忆格式无效');
	}

	await db.transaction(
		'rw',
		[db.user, db.aiConfig, db.userMemory, db.foodEntries, db.exerciseEntries, db.weightEntries, db.foodLibrary, db.sessions, db.messages],
		async () => {
			await Promise.all([
				db.user.clear(), db.aiConfig.clear(), db.userMemory.clear(), db.foodEntries.clear(), db.exerciseEntries.clear(),
				db.weightEntries.clear(), db.foodLibrary.clear(), db.sessions.clear(), db.messages.clear()
			]);
			await db.user.bulkPut(user);
			await db.aiConfig.bulkPut(aiConfig);
			await db.userMemory.bulkPut((userMemory ?? []) as UserMemory[]);
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
		userMemory,
		foodEntries,
		exerciseEntries,
		weightEntries,
		foodLibrary,
		sessions,
		messages
	] = await Promise.all([
		db.user.toArray(),
		db.aiConfig.toArray(),
		db.userMemory.toArray(),
		db.foodEntries.toArray(),
		db.exerciseEntries.toArray(),
		db.weightEntries.toArray(),
		db.foodLibrary.toArray(),
		db.sessions.toArray(),
		db.messages.toArray()
	]);
	return {
		version: 2,
		exportedAt: now(),
		user,
		aiConfig,
		userMemory,
		foodEntries,
		exerciseEntries,
		weightEntries,
		foodLibrary,
		sessions,
		messages
	};
}
