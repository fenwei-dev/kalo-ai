import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
	type Static,
	StringEnum,
	type Tool,
	Type,
} from "@earendil-works/pi-ai";
import { app } from "$lib/context/appContext.svelte";
import {
	addExerciseEntry,
	addFoodEntry,
	addWeightEntry,
	deleteExerciseEntry,
	deleteFoodEntry,
	deleteLibraryItem,
	deleteWeightEntry,
	getExerciseEntriesByDate,
	getExerciseEntriesSince,
	getExerciseEntry,
	getFoodEntriesByDate,
	getFoodEntriesSince,
	getFoodEntry,
	getLibraryItem,
	getUser,
	getUserMemory,
	getWeightEntries,
	getWeightEntriesByDate,
	getWeightEntry,
	listLibrary,
	saveUser,
	syncCurrentWeightFromLatest,
	updateFoodEntry,
	updateUser,
	updateUserMemory,
	upsertLibraryItem,
	upsertWeightEntryForDate,
} from "$lib/db/repositories";
import { recomputeAdaptiveTDEE } from "$lib/utils/adaptiveTDEE";
import {
	calculateBMR,
	calculateGoalPlan,
	calculateTDEE,
	effectiveTDEE,
	healthWeightRange,
} from "$lib/utils/calculations";
import { localDateISO, localDateOffset } from "$lib/utils/date";
import { buildTrendSummary } from "$lib/utils/trends";

// ---------- 工具 schema ----------

const dateParam = Type.Optional(
	Type.String({
		pattern: "^\\d{4}-\\d{2}-\\d{2}$",
		description: "YYYY-MM-DD，默认今天",
	}),
);

export const toolDefs = [
	{
		name: "getProfile",
		description:
			"获取用户的完整画像：基础信息、BMR、公式 TDEE、趋势自适应 TDEE、置信度、当前实际采用的混合 TDEE、目标与健康判定、健康体重推荐区间。回答任何关于用户身体数据、热量预算或目标的问题前先调用；必须区分 formulaTDEE、adaptiveTDEE 与 effectiveTDEE，不要把趋势估算说成简单公式结果。",
		parameters: Type.Object({}),
	},
	{
		name: "getTodayLog",
		description:
			"获取某日的全部记录（饮食/运动/体重）及当日热量汇总、剩余预算，并明确返回公式 TDEE、趋势自适应 TDEE、置信度和当前采用值。",
		parameters: Type.Object({ date: dateParam }),
	},
	{
		name: "getTrends",
		description:
			"获取指定范围的体重/摄入/运动趋势，并附带自动检测的洞察（平台期、摄入异常、目标达成预测、趋势方向）。",
		parameters: Type.Object({
			range: StringEnum(["7d", "30d", "90d"] as const, { default: "30d" }),
		}),
	},
	{
		name: "listLibrary",
		description:
			"列出用户食物库的全部条目（按使用频率/最近使用排序）。用户提到常吃食物或「跟昨天一样」时用来匹配。",
		parameters: Type.Object({}),
	},
	{
		name: "readUserMemory",
		description:
			"读取跨会话持久化的 Markdown 用户记忆及版本。新用户消息前通常已自动同步；仅在需要确认其他会话或设置页是否刚更新记忆、或写入发生版本冲突时主动调用。",
		parameters: Type.Object({}),
	},
	{
		name: "updateUserMemory",
		description:
			"替换完整的跨会话 Markdown 用户记忆。只保存用户明确要求记住或确认的长期偏好、限制、生活节奏和沟通约定；保留仍有效的旧内容，删除过时和重复项。禁止保存 API Key、密码、短期状态、已有结构化工具覆盖的数据或未经确认的推测。写入前必须基于最新记忆版本。",
		parameters: Type.Object({
			content: Type.String({
				maxLength: 8000,
				description: "完整 Markdown 文档；清空时传空字符串",
			}),
			expectedVersion: Type.Integer({
				minimum: 0,
				description: "最近一次 readUserMemory 或 updateUserMemory 返回的版本",
			}),
		}),
	},
	{
		name: "logFood",
		description:
			"新增或修正一条饮食。修正已有记录时先用 getTodayLog 找到 id，并传 replaceEntryId，禁止重复新增。此工具永远不会创建、更新或匹配食物库；只有用户明确要求保存常用食物时才调用 editLibrary。若用户描述的是早餐/午餐/晚餐/昨晚等非当前时刻，必须传入推断出的合理 time/date；无法合理确定时先询问用户，不要省略时间。",
		parameters: Type.Object({
			replaceEntryId: Type.Optional(
				Type.String({ description: "要修正的已有 FoodEntry id；新增时不传" }),
			),
			name: Type.String({ description: "食物名称，如「牛肉面」" }),
			calories: Type.Number({
				minimum: 0,
				maximum: 10000,
				description: "热量 kcal",
			}),
			protein: Type.Number({
				minimum: 0,
				maximum: 1000,
				description: "蛋白质 g",
			}),
			carbs: Type.Number({ minimum: 0, maximum: 2000, description: "碳水 g" }),
			fat: Type.Number({ minimum: 0, maximum: 1000, description: "脂肪 g" }),
			time: Type.Optional(
				Type.String({
					pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
					description:
						"HH:mm。仅当用户确实在描述当前刚吃的食物时可省略；早餐/午餐/晚餐等必须传合理时间",
				}),
			),
			date: dateParam,
		}),
	},
	{
		name: "logExercise",
		description: "记录一条运动。",
		parameters: Type.Object({
			description: Type.String({ description: "运动描述，如「跑步」" }),
			duration: Type.Number({
				minimum: 1,
				maximum: 1440,
				description: "时长（分钟）",
			}),
			caloriesBurned: Type.Number({
				minimum: 0,
				maximum: 10000,
				description: "消耗热量 kcal",
			}),
			time: Type.Optional(Type.String({ description: "HH:mm，默认现在" })),
			date: dateParam,
		}),
	},
	{
		name: "logWeight",
		description:
			"日常称重必须使用此工具。记录某日体重并触发自适应 TDEE 重算；不允许未来日期。每个日期只允许一条记录，已有记录时返回错误且不覆盖。需要更正时先 getTodayLog，调用 deleteLog 删除后再记录。updateProfile.currentWeight 只用于首次建档或用户明确修改资料基线。",
		parameters: Type.Object({
			weight: Type.Number({
				minimum: 25,
				maximum: 400,
				description: "体重 kg",
			}),
			date: dateParam,
		}),
	},
	{
		name: "updateProfile",
		description:
			"更新用户资料或目标（任意子集）。日常称重应使用 logWeight；currentWeight 仅用于首次建档或用户明确修改资料基线。传 currentWeight 时会创建或更新今天的体重记录，并同步最新记录到 Profile。改目标后会实时重算计划。",
		parameters: Type.Object({
			age: Type.Optional(Type.Number({ minimum: 13, maximum: 120 })),
			gender: Type.Optional(StringEnum(["male", "female"] as const)),
			height: Type.Optional(
				Type.Number({ minimum: 100, maximum: 250, description: "cm" }),
			),
			currentWeight: Type.Optional(
				Type.Number({ minimum: 25, maximum: 400, description: "kg" }),
			),
			activityLevel: Type.Optional(
				StringEnum([
					"sedentary",
					"light",
					"moderate",
					"active",
					"very_active",
				] as const),
			),
			targetWeight: Type.Optional(
				Type.Number({ minimum: 25, maximum: 400, description: "kg" }),
			),
			targetDate: Type.Optional(Type.String({ description: "YYYY-MM-DD" })),
		}),
	},
	{
		name: "deleteLog",
		description:
			'删除一条饮食、运动或体重记录。必须先调用 getTodayLog 找到准确记录，并传入 id 及用于二次核对的 expectedLabel。饮食填食物名称，运动填运动描述，体重填数值字符串（如 "72.5"）。不匹配时会拒绝删除。',
		parameters: Type.Object({
			type: StringEnum(["food", "exercise", "weight"] as const),
			id: Type.String({ description: "getTodayLog 返回的准确记录 id" }),
			expectedLabel: Type.String({
				description: "用于防误删：食物名称、运动描述或体重数值",
			}),
			date: dateParam,
		}),
	},
	{
		name: "editLibrary",
		description:
			"仅在用户明确要求保存、修改或删除常用食物时管理食物库。删除前必须先调用 listLibrary，并同时提供准确的 id 和 name；两者不匹配会拒绝删除。",
		parameters: Type.Object({
			action: StringEnum(["add", "update", "remove"] as const),
			item: Type.Object({
				id: Type.Optional(Type.String()),
				name: Type.String(),
				category: Type.Optional(
					StringEnum(["meal", "snack", "drink", "fruit", "other"] as const),
				),
				calories: Type.Optional(Type.Number()),
				protein: Type.Optional(Type.Number()),
				carbs: Type.Optional(Type.Number()),
				fat: Type.Optional(Type.Number()),
			}),
		}),
	},
] as const satisfies readonly Tool[];

type ToolDefinition = (typeof toolDefs)[number];
type ToolRequestFor<D extends ToolDefinition> = D extends ToolDefinition
	? { name: D["name"]; args: Static<D["parameters"]> }
	: never;
type ToolRequest = ToolRequestFor<ToolDefinition>;

// ---------- handlers ----------

function tdeeBreakdown(
	formulaTDEE: number,
	effectiveValue: number,
	adaptiveTDEE?: number,
	adaptiveConfidence?: number,
) {
	const usesAdaptive =
		typeof adaptiveTDEE === "number" &&
		Number.isFinite(adaptiveTDEE) &&
		(adaptiveConfidence ?? 0) >= 0.45;
	return {
		formulaTDEE,
		formulaTDEEMethod: "mifflin_st_jeor_bmr_times_activity_multiplier",
		adaptiveTDEE: adaptiveTDEE ?? null,
		adaptiveConfidence: adaptiveConfidence ?? null,
		adaptiveTDEEMethod:
			adaptiveTDEE != null
				? "empirical_14_day_intake_and_theil_sen_weight_trend_estimate"
				: null,
		effectiveTDEE: effectiveValue,
		tdeeMethod: usesAdaptive
			? "confidence_weighted_adaptive_blend"
			: "formula_only",
	};
}

export interface ToolOutcome {
	ok: boolean;
	data: object | string | null;
	error?: string;
}

function profileSnapshot() {
	const u = app.user;
	if (!u) return { onboarded: false, message: "用户尚未填写基础信息" };
	const bmr = calculateBMR(u.currentWeight, u.height, u.age, u.gender);
	const formulaTDEE = calculateTDEE(bmr, u.activityLevel);
	const tdee = effectiveTDEE({
		adaptiveTDEE: u.adaptiveTDEE,
		adaptiveConfidence: u.adaptiveConfidence,
		formulaTDEE,
	});
	const goal = calculateGoalPlan({
		currentWeight: u.currentWeight,
		targetWeight: u.targetWeight,
		targetDate: u.targetDate,
		bmr,
		tdee,
	});
	const range = healthWeightRange(u.height);
	const tdeeDetails = tdeeBreakdown(
		formulaTDEE,
		tdee,
		u.adaptiveTDEE,
		u.adaptiveConfidence,
	);
	return {
		onboarded: true,
		age: u.age,
		gender: u.gender,
		height: u.height,
		currentWeight: u.currentWeight,
		activityLevel: u.activityLevel,
		bmr,
		tdee,
		...tdeeDetails,
		target: u.targetWeight
			? { targetWeight: u.targetWeight, targetDate: u.targetDate, ...goal }
			: null,
		healthWeightRange: range,
	};
}

async function refreshAfterWeightMutation(): Promise<void> {
	await recomputeAdaptiveTDEE();
	const fresh = await getUser();
	if (fresh) app.user = fresh;
	await app.refreshToday();
}

function summarizeDay(
	entries: {
		calories: number;
		protein: number;
		carbs: number;
		fat: number;
		tef: number;
	}[],
) {
	const intake = entries.reduce((s, e) => s + e.calories, 0);
	const protein = entries.reduce((s, e) => s + e.protein, 0);
	const carbs = entries.reduce((s, e) => s + e.carbs, 0);
	const fat = entries.reduce((s, e) => s + e.fat, 0);
	const tef = entries.reduce((s, e) => s + e.tef, 0);
	return { intake, protein, carbs, fat, tef };
}

export async function executeTool(request: ToolRequest): Promise<ToolOutcome> {
	try {
		switch (request.name) {
			case "getProfile":
				return { ok: true, data: profileSnapshot() };

			case "getTodayLog": {
				const args = request.args;
				const date = args.date || localDateISO();
				const [food, exercise, weights] = await Promise.all([
					getFoodEntriesByDate(date),
					getExerciseEntriesByDate(date),
					getWeightEntriesByDate(date),
				]);
				const summary = summarizeDay(food);
				const burned = exercise.reduce((s, e) => s + e.caloriesBurned, 0);
				const budget = app.tdee
					? app.tdee - (app.goalPlan.dailyDeficit ?? 500)
					: 0;
				const tdeeDetails = tdeeBreakdown(
					app.formulaTDEE,
					app.tdee,
					app.user?.adaptiveTDEE,
					app.user?.adaptiveConfidence,
				);
				return {
					ok: true,
					data: {
						date,
						food,
						exercise,
						weights,
						summary: {
							...summary,
							burned,
							net: summary.intake - summary.tef - burned,
						},
						tdee: app.tdee,
						...tdeeDetails,
						dailyBudget: budget,
						remaining: budget ? budget - summary.intake : null,
					},
				};
			}

			case "getTrends": {
				const args = request.args;
				const days = args.range === "7d" ? 7 : args.range === "90d" ? 90 : 30;
				const since = localDateOffset(-days);
				const [food, exercise, allWeights] = await Promise.all([
					getFoodEntriesSince(since),
					getExerciseEntriesSince(since),
					getWeightEntries(),
				]);
				const weights = allWeights.filter((entry) => entry.date >= since);
				return {
					ok: true,
					data: {
						range: args.range,
						days,
						...buildTrendSummary({ food, exercise, weights, days }),
					},
				};
			}

			case "listLibrary": {
				return { ok: true, data: await listLibrary() };
			}

			case "readUserMemory": {
				return { ok: true, data: await getUserMemory() };
			}

			case "updateUserMemory": {
				const args = request.args;
				const memory = await updateUserMemory(
					args.content,
					args.expectedVersion,
				);
				return { ok: true, data: memory };
			}

			case "logFood": {
				const args = request.args;
				const {
					replaceEntryId,
					name: fname,
					calories,
					protein,
					carbs,
					fat,
					time,
					date,
				} = args;
				const values = {
					date: date || localDateISO(),
					time: time || new Date().toTimeString().slice(0, 5),
					name: fname,
					calories,
					protein,
					carbs,
					fat,
					tef: Math.round(
						protein * 4 * 0.25 + carbs * 4 * 0.08 + fat * 9 * 0.03,
					),
					source: "ai" as const,
				};
				if (replaceEntryId) {
					await updateFoodEntry(replaceEntryId, values);
					await app.refreshToday();
					return {
						ok: true,
						data: { entry: { id: replaceEntryId, ...values }, corrected: true },
					};
				}
				const entry = await addFoodEntry(values);
				await app.refreshToday();
				return { ok: true, data: { entry, corrected: false } };
			}

			case "logExercise": {
				const args = request.args;
				const entry = await addExerciseEntry({
					date: args.date || localDateISO(),
					time: args.time || new Date().toTimeString().slice(0, 5),
					description: args.description,
					duration: args.duration,
					caloriesBurned: args.caloriesBurned,
					source: "manual",
				});
				await app.refreshToday();
				return { ok: true, data: { entry } };
			}

			case "logWeight": {
				const args = request.args;
				const date = args.date || localDateISO();
				const entry = await addWeightEntry({ date, weight: args.weight });
				await refreshAfterWeightMutation();
				return { ok: true, data: { entry } };
			}

			case "deleteLog": {
				const args = request.args;
				const { type, id, expectedLabel } = args;
				const expected = expectedLabel.trim().toLocaleLowerCase();
				if (type === "food") {
					const entry = await getFoodEntry(id);
					if (!entry)
						return { ok: false, data: null, error: "要删除的饮食记录不存在" };
					if (entry.name.trim().toLocaleLowerCase() !== expected) {
						return {
							ok: false,
							data: null,
							error: "记录 id 与食物名称不匹配，已拒绝删除",
						};
					}
					await deleteFoodEntry(id);
					await app.refreshToday();
					return {
						ok: true,
						data: {
							deleted: {
								type,
								id,
								name: entry.name,
								date: entry.date,
								time: entry.time,
							},
						},
					};
				}
				if (type === "exercise") {
					const entry = await getExerciseEntry(id);
					if (!entry)
						return { ok: false, data: null, error: "要删除的运动记录不存在" };
					if (entry.description.trim().toLocaleLowerCase() !== expected) {
						return {
							ok: false,
							data: null,
							error: "记录 id 与运动描述不匹配，已拒绝删除",
						};
					}
					await deleteExerciseEntry(id);
					await app.refreshToday();
					return {
						ok: true,
						data: {
							deleted: {
								type,
								id,
								description: entry.description,
								date: entry.date,
								time: entry.time,
							},
						},
					};
				}
				if (type === "weight") {
					const entry = await getWeightEntry(id);
					if (!entry)
						return { ok: false, data: null, error: "要删除的体重记录不存在" };
					if (String(entry.weight) !== expected) {
						return {
							ok: false,
							data: null,
							error: "记录 id 与体重数值不匹配，已拒绝删除",
						};
					}
					await deleteWeightEntry(id);
					await refreshAfterWeightMutation();
					return {
						ok: true,
						data: {
							deleted: { type, id, weight: entry.weight, date: entry.date },
						},
					};
				}
				return { ok: false, data: null, error: `不支持的记录类型：${type}` };
			}

			case "updateProfile": {
				const args = request.args;
				const patch: typeof args & { calculatedBMR?: number } = { ...args };
				let weightRecord:
					| Awaited<ReturnType<typeof upsertWeightEntryForDate>>
					| undefined;
				if (app.user) {
					if (typeof patch.currentWeight === "number") {
						weightRecord = await upsertWeightEntryForDate({
							date: localDateISO(),
							weight: patch.currentWeight,
						});
						const latest = await syncCurrentWeightFromLatest();
						if (latest) patch.currentWeight = latest.weight;
					}
					const merged = { ...app.user, ...patch };
					patch.calculatedBMR = calculateBMR(
						merged.currentWeight,
						merged.height,
						merged.age,
						merged.gender,
					);
					app.user = (await updateUser(patch)) ?? app.user;
				} else {
					const required = {
						age: patch.age ?? 30,
						gender: patch.gender ?? "male",
						height: patch.height ?? 170,
						currentWeight: patch.currentWeight ?? 70,
						activityLevel: patch.activityLevel ?? "moderate",
						calculatedBMR: calculateBMR(
							patch.currentWeight ?? 70,
							patch.height ?? 170,
							patch.age ?? 30,
							patch.gender ?? "male",
						),
					};
					app.user = await saveUser({
						...required,
						targetWeight: patch.targetWeight,
						targetDate: patch.targetDate,
					});
					weightRecord = await upsertWeightEntryForDate({
						date: localDateISO(),
						weight: required.currentWeight,
					});
				}
				if (weightRecord) {
					await refreshAfterWeightMutation();
				} else {
					const fresh = await getUser();
					if (fresh) app.user = fresh;
				}
				return { ok: true, data: { ...profileSnapshot(), weightRecord } };
			}

			case "editLibrary": {
				const args = request.args;
				const { action, item } = args;
				if (action === "remove") {
					if (!item.id)
						return {
							ok: false,
							data: null,
							error: "remove 需要提供 item.id 和准确名称",
						};
					const existing = await getLibraryItem(item.id);
					if (!existing)
						return { ok: false, data: null, error: "要删除的食物库条目不存在" };
					if (
						existing.name.trim().toLocaleLowerCase() !==
						item.name.trim().toLocaleLowerCase()
					) {
						return {
							ok: false,
							data: null,
							error:
								"item.id 与 item.name 不匹配，已拒绝删除；请重新调用 listLibrary 核对",
						};
					}
					await deleteLibraryItem(item.id);
					return {
						ok: true,
						data: { removed: { id: item.id, name: existing.name } },
					};
				}
				if (typeof item.calories !== "number") {
					return {
						ok: false,
						data: null,
						error: `${action} 需要提供 item.calories`,
					};
				}
				const result = await upsertLibraryItem({
					id: item.id,
					name: item.name,
					category: item.category ?? "meal",
					calories: item.calories,
					protein: item.protein,
					carbs: item.carbs,
					fat: item.fat,
				});
				return { ok: true, data: { item: result } };
			}

			default: {
				const unhandled: never = request;
				throw new Error(`未知工具：${String(unhandled)}`);
			}
		}
	} catch (e) {
		return {
			ok: false,
			data: null,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

/** Connect each TypeBox schema directly to its statically inferred execute params. */
function createAgentTool<D extends ToolDefinition>(
	definition: D,
): AgentTool<D["parameters"], ToolOutcome> {
	return {
		...definition,
		label: definition.name,
		// Kalo tools mutate local health data, so preserve the model's source order.
		executionMode: "sequential",
		execute: async (_toolCallId, params, signal) => {
			if (signal?.aborted) throw new Error("请求已取消");
			// AgentTool<D["parameters"]> has already validated params against this
			// exact definition; this assertion only preserves that generic correlation.
			const request = {
				name: definition.name,
				args: params,
			} as ToolRequestFor<D>;
			const outcome = await executeTool(request);
			if (!outcome.ok)
				throw new Error(outcome.error || `${definition.name} 执行失败`);
			return {
				content: [{ type: "text", text: JSON.stringify(outcome.data ?? null) }],
				details: outcome,
			};
		},
	};
}

export const agentTools = toolDefs.map((definition) =>
	createAgentTool(definition),
);
