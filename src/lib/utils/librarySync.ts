import type { FoodCategory } from "$lib/db/schema";

/** UI labels only. Food logs never synchronize into the library automatically. */
export const CATEGORY_LABELS: Record<FoodCategory, string> = {
	meal: "正餐",
	snack: "零食",
	drink: "饮料",
	fruit: "水果",
	other: "其他",
};
