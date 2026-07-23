import { db, type FoodCategory } from '$lib/db/schema';
import { upsertLibraryItem, bumpLibraryUsage } from '$lib/db/repositories';

/**
 * logFood 后自动沉淀到食物库：按名字（大小写不敏感）去重，
 * 命中则累计使用次数并刷新 lastUsedAt；否则新建一条。
 * 返回关联的 libraryItemId（供 FoodEntry.source='library' 标记）。
 */
export async function syncFoodToLibrary(opts: {
	name: string;
	calories: number;
	protein?: number;
	carbs?: number;
	fat?: number;
}): Promise<string | undefined> {
	const name = opts.name.trim();
	if (!name) return undefined;

	const existing = await db.foodLibrary.where('name').equalsIgnoreCase(name).first();
	if (existing) {
		await bumpLibraryUsage(existing.id);
		return existing.id;
	}

	const item = await upsertLibraryItem({
		name,
		category: 'meal',
		calories: opts.calories,
		protein: opts.protein,
		carbs: opts.carbs,
		fat: opts.fat
	});
	return item.id;
}

export const CATEGORY_LABELS: Record<FoodCategory, string> = {
	meal: '正餐',
	snack: '零食',
	drink: '饮料',
	fruit: '水果',
	other: '其他'
};
