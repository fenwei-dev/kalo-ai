import {
	getAIConfig,
	getUser,
	listSessions,
	getFoodEntriesByDate,
	getExerciseEntriesByDate,
	getWeightEntries,
	getWeightEntriesByDate
} from '$lib/db/repositories';
import type { AIConfig, ExerciseEntry, FoodEntry, Session, User, WeightEntry } from '$lib/db/schema';
import { localDateISO } from '$lib/utils/date';
import { recomputeAdaptiveTDEE } from '$lib/utils/adaptiveTDEE';
import {
	calculateBMR,
	calculateGoalPlan,
	calculateTDEE,
	effectiveTDEE
} from '$lib/utils/calculations';

export interface TodayData {
	food: FoodEntry[];
	exercise: ExerciseEntry[];
	weights: WeightEntry[];
}

const emptyToday: TodayData = { food: [], exercise: [], weights: [] };

class AppState {
	/** 是否已完成初始化加载 */
	ready = $state(false);

	/** 用户资料（null = 尚未填写，需引导到设置页） */
	user = $state<User | null>(null);

	/** AI 配置（null = 尚未配置） */
	aiConfig = $state<AIConfig | null>(null);

	/** 所有会话（按最近更新排序） */
	sessions = $state<Session[]>([]);

	/** 当前查看日期的数据 */
	today = $state<TodayData>(emptyToday);

	/** 全部体重历史，用于截止查看日期的趋势图 */
	weightHistory = $state<WeightEntry[]>([]);

	/** 选中的查看日期（用于饮食/运动翻页），默认今天 */
	viewDate = $state<string>(localDateISO());

	/** 基础资料是否包含计算代谢所需的有效字段。 */
	profileConfigured = $derived(
		!!this.user &&
		Number.isFinite(this.user.age) && this.user.age >= 13 && this.user.age <= 120 &&
		Number.isFinite(this.user.height) && this.user.height >= 100 && this.user.height <= 250 &&
		Number.isFinite(this.user.currentWeight) && this.user.currentWeight >= 25 && this.user.currentWeight <= 400 &&
		(this.user.gender === 'male' || this.user.gender === 'female') &&
		['sedentary', 'light', 'moderate', 'active', 'very_active'].includes(this.user.activityLevel)
	);

	/** AI 配置是否包含发起请求所需的最小字段。 */
	aiConfigured = $derived(
		typeof this.aiConfig?.apiKey === 'string' && this.aiConfig.apiKey.trim().length > 0 &&
		typeof this.aiConfig?.model === 'string' && this.aiConfig.model.trim().length > 0
	);

	/** 必要资料与 AI 配置都齐全后才算完成 onboarding。 */
	onboarded = $derived(this.profileConfigured && this.aiConfigured);

	/** 基础代谢 */
	bmr = $derived(
		this.user ? calculateBMR(this.user.currentWeight, this.user.height, this.user.age, this.user.gender) : 0
	);

	/** 公式 TDEE（未含自适应） */
	formulaTDEE = $derived(this.user ? calculateTDEE(this.bmr, this.user.activityLevel) : 0);

	/** 用于推荐的日消耗（公式值与可靠的趋势估算渐进混合） */
	tdee = $derived(
		effectiveTDEE({
			adaptiveTDEE: this.user?.adaptiveTDEE,
			adaptiveConfidence: this.user?.adaptiveConfidence,
			formulaTDEE: this.formulaTDEE
		})
	);

	/** 减重目标计划（每周减重 / 每日缺口 / 安全判定） */
	goalPlan = $derived(
		this.user
			? calculateGoalPlan({
					currentWeight: this.user.currentWeight,
					targetWeight: this.user.targetWeight,
					targetDate: this.user.targetDate,
					bmr: this.bmr,
					tdee: this.tdee
				})
			: { weeks: null, weeklyRate: null, dailyDeficit: null, safety: 'unknown' as const }
	);

	/** 今日热量预算（TDEE - 目标缺口；无目标则默认 -500 缺口） */
	dailyBudget = $derived(this.tdee ? this.tdee - (this.goalPlan.dailyDeficit ?? 500) : 0);

	// ---------- 加载 ----------

	async init() {
		if (this.ready) return;
		await this.reload();
		this.ready = true;
	}

	/** Reload all global state after an import or destructive operation. */
	async reload() {
		// Re-evaluate estimates produced by older algorithm versions immediately,
		// rather than leaving a potentially inflated calorie budget until the next weigh-in.
		await recomputeAdaptiveTDEE();
		this.user = (await getUser()) ?? null;
		this.aiConfig = (await getAIConfig()) ?? null;
		this.sessions = await listSessions();
		this.viewDate = localDateISO();
		await this.refreshToday();
	}

	async refreshSessions() {
		this.sessions = await listSessions();
	}

	async refreshToday() {
		const [food, exercise, weights, weightHistory] = await Promise.all([
			getFoodEntriesByDate(this.viewDate),
			getExerciseEntriesByDate(this.viewDate),
			getWeightEntriesByDate(this.viewDate),
			getWeightEntries()
		]);
		this.today = { food, exercise, weights };
		this.weightHistory = weightHistory;
	}

	/** 当 viewDate 变化时重新拉取当日数据 */
	setViewDate(date: string) {
		this.viewDate = date;
		return this.refreshToday();
	}
}

export const app = new AppState();
