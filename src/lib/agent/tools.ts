import { Type, StringEnum, type Tool } from '@earendil-works/pi-ai';
import { app } from '$lib/context/appContext.svelte';
import {
	addExerciseEntry,
	addFoodEntry,
	addWeightEntry,
	updateFoodEntry,
	getExerciseEntriesByDate,
	getExerciseEntriesSince,
	getFoodEntriesByDate,
	getFoodEntriesSince,
	getUser,
	getWeightEntries,
	getWeightEntriesByDate,
	listLibrary,
	updateUser,
	upsertLibraryItem,
	deleteLibraryItem,
	saveUser
} from '$lib/db/repositories';
import { syncFoodToLibrary } from '$lib/utils/librarySync';
import { recomputeAdaptiveTDEE } from '$lib/utils/adaptiveTDEE';
import {
	calculateBMR,
	calculateGoalPlan,
	calculateTDEE,
	effectiveTDEE,
	healthWeightRange
} from '$lib/utils/calculations';
import type { FoodCategory, Gender, ActivityLevel } from '$lib/db/schema';
import { localDateISO, localDateOffset } from '$lib/utils/date';
import { buildTrendSummary } from '$lib/utils/trends';

// ---------- 工具 schema ----------

const dateParam = Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD，默认今天' }));

export const toolDefs: Tool[] = [
	{
		name: 'getProfile',
		description:
			'获取用户的完整画像：基础信息、BMR、TDEE（公式值与自适应值）、当前目标与健康判定、健康体重推荐区间。回答任何关于用户身体数据或目标的问题前先调用。',
		parameters: Type.Object({})
	},
	{
		name: 'getTodayLog',
		description: '获取某日的全部记录（饮食/运动/体重）及当日热量汇总与剩余预算。',
		parameters: Type.Object({ date: dateParam })
	},
	{
		name: 'getTrends',
		description: '获取指定范围的体重/摄入/运动趋势，并附带自动检测的洞察（平台期、摄入异常、目标达成预测、趋势方向）。',
		parameters: Type.Object({
			range: StringEnum(['7d', '30d', '90d'], { default: '30d' })
		})
	},
	{
		name: 'listLibrary',
		description: '列出用户食物库的全部条目（按使用频率/最近使用排序）。用户提到常吃食物或「跟昨天一样」时用来匹配。',
		parameters: Type.Object({})
	},
	{
		name: 'logFood',
		description:
			'新增或修正一条饮食。修正已有记录时先用 getTodayLog 找到 id，并传 replaceEntryId，禁止重复新增。会自动沉淀到食物库。',
		parameters: Type.Object({
			replaceEntryId: Type.Optional(Type.String({ description: '要修正的已有 FoodEntry id；新增时不传' })),
			name: Type.String({ description: '食物名称，如「牛肉面」' }),
			calories: Type.Number({ minimum: 0, maximum: 10000, description: '热量 kcal' }),
			protein: Type.Number({ minimum: 0, maximum: 1000, description: '蛋白质 g' }),
			carbs: Type.Number({ minimum: 0, maximum: 2000, description: '碳水 g' }),
			fat: Type.Number({ minimum: 0, maximum: 1000, description: '脂肪 g' }),
			time: Type.Optional(Type.String({ description: 'HH:mm，默认现在' })),
			date: dateParam
		})
	},
	{
		name: 'logExercise',
		description: '记录一条运动。',
		parameters: Type.Object({
			description: Type.String({ description: '运动描述，如「跑步」' }),
			duration: Type.Number({ minimum: 1, maximum: 1440, description: '时长（分钟）' }),
			caloriesBurned: Type.Number({ minimum: 0, maximum: 10000, description: '消耗热量 kcal' }),
			time: Type.Optional(Type.String({ description: 'HH:mm，默认现在' })),
			date: dateParam
		})
	},
	{
		name: 'logWeight',
		description: '记录一次体重，会触发自适应 TDEE 重算。',
		parameters: Type.Object({
			weight: Type.Number({ minimum: 25, maximum: 400, description: '体重 kg' }),
			date: dateParam
		})
	},
	{
		name: 'updateProfile',
		description:
			'更新用户资料或目标（任意子集）。改目标体重/日期后会实时重算每周减重与每日缺口。首次填写也可用。',
		parameters: Type.Object({
			age: Type.Optional(Type.Number({ minimum: 13, maximum: 120 })),
			gender: Type.Optional(StringEnum(['male', 'female'])),
			height: Type.Optional(Type.Number({ minimum: 100, maximum: 250, description: 'cm' })),
			currentWeight: Type.Optional(Type.Number({ minimum: 25, maximum: 400, description: 'kg' })),
			activityLevel: Type.Optional(
				StringEnum(['sedentary', 'light', 'moderate', 'active', 'very_active'])
			),
			targetWeight: Type.Optional(Type.Number({ minimum: 25, maximum: 400, description: 'kg' })),
			targetDate: Type.Optional(Type.String({ description: 'YYYY-MM-DD' }))
		})
	},
	{
		name: 'editLibrary',
		description: '手动管理食物库：增/改/删条目。',
		parameters: Type.Object({
			action: StringEnum(['add', 'update', 'remove']),
			item: Type.Object({
				id: Type.Optional(Type.String()),
				name: Type.String(),
				category: Type.Optional(StringEnum(['meal', 'snack', 'drink', 'fruit', 'other'])),
				calories: Type.Number(),
				protein: Type.Optional(Type.Number()),
				carbs: Type.Optional(Type.Number()),
				fat: Type.Optional(Type.Number())
			})
		})
	}
];

// ---------- handlers ----------

export interface ToolOutcome {
	ok: boolean;
	data: unknown;
	error?: string;
}

function profileSnapshot() {
	const u = app.user;
	if (!u) return { onboarded: false, message: '用户尚未填写基础信息' };
	const bmr = calculateBMR(u.currentWeight, u.height, u.age, u.gender);
	const formulaTDEE = calculateTDEE(bmr, u.activityLevel);
	const tdee = effectiveTDEE({
		adaptiveTDEE: u.adaptiveTDEE,
		adaptiveConfidence: u.adaptiveConfidence,
		formulaTDEE
	});
	const goal = calculateGoalPlan({
		currentWeight: u.currentWeight,
		targetWeight: u.targetWeight,
		targetDate: u.targetDate,
		bmr,
		tdee
	});
	const range = healthWeightRange(u.height);
	return {
		onboarded: true,
		age: u.age,
		gender: u.gender,
		height: u.height,
		currentWeight: u.currentWeight,
		activityLevel: u.activityLevel,
		bmr,
		tdee,
		adaptiveTDEE: u.adaptiveTDEE,
		adaptiveConfidence: u.adaptiveConfidence,
		target: u.targetWeight
			? { targetWeight: u.targetWeight, targetDate: u.targetDate, ...goal }
			: null,
		healthWeightRange: range
	};
}

function summarizeDay(entries: { calories: number; protein: number; carbs: number; fat: number; tef: number }[]) {
	const intake = entries.reduce((s, e) => s + e.calories, 0);
	const protein = entries.reduce((s, e) => s + e.protein, 0);
	const carbs = entries.reduce((s, e) => s + e.carbs, 0);
	const fat = entries.reduce((s, e) => s + e.fat, 0);
	const tef = entries.reduce((s, e) => s + e.tef, 0);
	return { intake, protein, carbs, fat, tef };
}

export async function executeTool(name: string, args: Record<string, any>): Promise<ToolOutcome> {
	try {
		switch (name) {
			case 'getProfile':
				return { ok: true, data: profileSnapshot() };

			case 'getTodayLog': {
				const date = (args.date as string) || localDateISO();
				const [food, exercise, weights] = await Promise.all([
					getFoodEntriesByDate(date),
					getExerciseEntriesByDate(date),
					getWeightEntriesByDate(date)
				]);
				const summary = summarizeDay(food);
				const burned = exercise.reduce((s, e) => s + e.caloriesBurned, 0);
				const budget = app.tdee ? app.tdee - (app.goalPlan.dailyDeficit ?? 500) : 0;
				return {
					ok: true,
					data: {
						date,
						food,
						exercise,
						weights,
						summary: { ...summary, burned, net: summary.intake - summary.tef - burned },
						tdee: app.tdee,
						dailyBudget: budget,
						remaining: budget ? budget - summary.intake : null
					}
				};
			}

			case 'getTrends': {
				const days = args.range === '7d' ? 7 : args.range === '90d' ? 90 : 30;
				const since = localDateOffset(-days);
				const [food, exercise, allWeights] = await Promise.all([
					getFoodEntriesSince(since),
					getExerciseEntriesSince(since),
					getWeightEntries()
				]);
				const weights = allWeights.filter((entry) => entry.date >= since);
				return {
					ok: true,
					data: { range: args.range, days, ...buildTrendSummary({ food, exercise, weights, days }) }
				};
			}

			case 'listLibrary': {
				return { ok: true, data: await listLibrary() };
			}

			case 'logFood': {
				const { replaceEntryId, name: fname, calories, protein, carbs, fat, time, date } = args;
				const librarySync = await syncFoodToLibrary({ name: fname, calories, protein, carbs, fat });
				const values = {
					date: date || localDateISO(),
					time: time || new Date().toTimeString().slice(0, 5),
					name: fname,
					calories,
					protein,
					carbs,
					fat,
					tef: Math.round(protein * 4 * 0.25 + carbs * 4 * 0.08 + fat * 9 * 0.03),
					source: librarySync.status === 'matched' ? 'library' as const : 'ai' as const,
					libraryItemId: librarySync.itemId
				};
				if (replaceEntryId) {
					await updateFoodEntry(replaceEntryId, values);
					await app.refreshToday();
					return { ok: true, data: { entry: { id: replaceEntryId, ...values }, corrected: true, library: librarySync } };
				}
				const entry = await addFoodEntry(values);
				await app.refreshToday();
				return { ok: true, data: { entry, corrected: false, library: librarySync } };
			}

			case 'logExercise': {
				const entry = await addExerciseEntry({
					date: (args.date as string) || localDateISO(),
					time: args.time || new Date().toTimeString().slice(0, 5),
					description: args.description,
					duration: args.duration,
					caloriesBurned: args.caloriesBurned,
					source: 'manual'
				});
				await app.refreshToday();
				return { ok: true, data: { entry } };
			}

						case 'logWeight': {
				const date = (args.date as string) || localDateISO();
				const entry = await addWeightEntry({ date, weight: args.weight });
				if (app.user) {
					app.user = (await updateUser({ currentWeight: args.weight })) ?? app.user;
				}
				await recomputeAdaptiveTDEE();
				// 重新读取最新的 user（含自适应 TDEE）到全局状态
				const fresh = await getUser();
				if (fresh) app.user = fresh;
				return { ok: true, data: { entry } };
			}

			case 'updateProfile': {
				const patch: Record<string, any> = { ...args };
				if (app.user) {
					const merged = { ...app.user, ...patch };
					patch.calculatedBMR = calculateBMR(
						merged.currentWeight,
						merged.height,
						merged.age,
						merged.gender
					);
					app.user = (await updateUser(patch)) ?? app.user;
				} else {
					// 首次填写：补全必填字段后创建
					const required = {
						age: patch.age ?? 30,
						gender: (patch.gender as Gender) ?? 'male',
						height: patch.height ?? 170,
						currentWeight: patch.currentWeight ?? 70,
						activityLevel: (patch.activityLevel as ActivityLevel) ?? 'moderate',
						calculatedBMR: calculateBMR(
							patch.currentWeight ?? 70,
							patch.height ?? 170,
							patch.age ?? 30,
							(patch.gender as Gender) ?? 'male'
						)
					};
					app.user = await saveUser({
						...required,
						targetWeight: patch.targetWeight,
						targetDate: patch.targetDate
					});
				}
				return { ok: true, data: profileSnapshot() };
			}

			case 'editLibrary': {
				const { action, item } = args;
				if (action === 'remove') {
					if (!item.id) return { ok: false, data: null, error: 'remove 需要提供 item.id' };
					await deleteLibraryItem(item.id);
					return { ok: true, data: { removed: item.id } };
				}
				const result = await upsertLibraryItem({
					id: item.id,
					name: item.name,
					category: (item.category as FoodCategory) ?? 'meal',
					calories: item.calories,
					protein: item.protein,
					carbs: item.carbs,
					fat: item.fat
				});
				return { ok: true, data: { item: result } };
			}

			default:
				return { ok: false, data: null, error: `未知工具：${name}` };
		}
	} catch (e) {
		return { ok: false, data: null, error: e instanceof Error ? e.message : String(e) };
	}
}
