import { db, type FoodCategory } from '$lib/db/schema';
import { upsertLibraryItem, bumpLibraryUsage } from '$lib/db/repositories';

/**
 * logFood 后自动沉淀到食物库：按名字（大小写不敏感）去重，
 * 命中则累计使用次数并刷新 lastUsedAt；否则新建一条。
 * 返回关联条目及是新建还是命中，供 FoodEntry 正确标记来源。
 */
export async function syncFoodToLibrary(opts: {
	name: string;
	calories: number;
	protein?: number;
	carbs?: number;
	fat?: number;
}): Promise<{ itemId?: string; status: 'created' | 'matched' | 'skipped' }> {
	const name = opts.name.trim();
	if (!name) return { status: 'skipped' };

	const existing = await db.foodLibrary.where('name').equalsIgnoreCase(name).first();
	if (existing) {
		await bumpLibraryUsage(existing.id);
		return { itemId: existing.id, status: 'matched' };
	}

	const item = await upsertLibraryItem({
		name,
		category: 'meal',
		calories: opts.calories,
		protein: opts.protein,
		carbs: opts.carbs,
		fat: opts.fat
	});
	await bumpLibraryUsage(item.id);
	return { itemId: item.id, status: 'created' };
}

export const CATEGORY_LABELS: Record<FoodCategory, string> = {
	meal: '正餐',
	snack: '零食',
	drink: '饮料',
	fruit: '水果',
	other: '其他'
};
