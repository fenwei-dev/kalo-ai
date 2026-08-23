import {
	type AgentTool,
	definePlugin,
	StringEnum,
	Type,
} from "@kalo-ai/plugin-sdk";
import datasetJson from "../data/products.json";

export const MCDONALDS_SG_CATEGORIES = [
	"beverages",
	"breakfast",
	"burgers",
	"chicken",
	"desserts",
	"eat-light-under-500-calories",
	"for-the-family",
	"sharing",
	"salads-and-wraps",
	"sides",
] as const;
export type McDonaldsSGCategory = (typeof MCDONALDS_SG_CATEGORIES)[number];
export const MCDONALDS_SG_CATEGORY_FILTERS = [
	"all",
	...MCDONALDS_SG_CATEGORIES,
] as const;
export type McDonaldsSGCategoryFilter =
	(typeof MCDONALDS_SG_CATEGORY_FILTERS)[number];

export interface McDonaldsSGNutritionFacts {
	energyKcal: number;
	proteinG: number;
	totalFatG: number;
	saturatedFatG: number;
	cholesterolMg: number;
	carbohydratesG: number;
	dietaryFibreG: number;
	sodiumMg: number;
}

export interface McDonaldsSGProduct {
	id: string;
	name: string;
	description: string | null;
	url: string;
	categories: McDonaldsSGCategory[];
	nutrition: McDonaldsSGNutritionFacts;
}

export interface McDonaldsSGDataset {
	schemaVersion: 2;
	sourceUrl: string;
	retrievedAt: string;
	products: McDonaldsSGProduct[];
}

function isCategory(value: string): value is McDonaldsSGCategory {
	return MCDONALDS_SG_CATEGORIES.some((category) => category === value);
}

if (datasetJson.schemaVersion !== 2) {
	throw new Error(
		`Unsupported McDonald's Singapore dataset schema: ${datasetJson.schemaVersion}`,
	);
}
const products: McDonaldsSGProduct[] = datasetJson.products.map((product) => {
	const categories = product.categories.filter(isCategory);
	if (categories.length !== product.categories.length) {
		throw new Error(
			`Unknown category in McDonald's Singapore product ${product.id}`,
		);
	}
	return { ...product, categories };
});
const dataset: McDonaldsSGDataset = {
	...datasetJson,
	schemaVersion: 2,
	products,
};

const listParameters = Type.Object({
	category: StringEnum(MCDONALDS_SG_CATEGORY_FILTERS, {
		description:
			'Required menu scope. Use "all" to return the complete bundled menu index in one call, or an official category to narrow the result.',
	}),
});
const getParameters = Type.Object({
	id: Type.String({ pattern: "^[0-9]+$" }),
});

export interface McDonaldsSGProductListItem {
	id: string;
	name: string;
}

export function listMcDonaldsSGProducts(
	category: McDonaldsSGCategoryFilter,
): McDonaldsSGProductListItem[] {
	return dataset.products
		.filter(
			(product) => category === "all" || product.categories.includes(category),
		)
		.map((product) => ({ id: product.id, name: product.name }));
}

export function getMcDonaldsSGProduct(
	id: string,
): McDonaldsSGProduct | undefined {
	return dataset.products.find((product) => product.id === id);
}

export const mcdonaldsSGProducts: readonly McDonaldsSGProduct[] =
	dataset.products;

export const mcdonaldsSGDatasetMetadata = {
	schemaVersion: dataset.schemaVersion,
	sourceUrl: dataset.sourceUrl,
	retrievedAt: dataset.retrievedAt,
	productCount: dataset.products.length,
};

export const mcdonaldsSGPlugin = definePlugin({
	manifest: {
		id: "mcdonalds_sg",
		apiVersion: 1,
		version: "0.1.0",
		configVersion: 1,
		name: {
			"zh-cn": "新加坡麦当劳营养",
			"en-us": "McDonald's Singapore nutrition",
		},
		description: {
			"zh-cn": "查询新加坡麦当劳官网公布的产品标准份量营养数据。",
			"en-us":
				"Looks up standard-serving nutrition published by McDonald's Singapore.",
		},
		defaultEnabled: true,
	},
	configSchema: Type.Object({}),
	defaultConfig: {},
	createTools: () => {
		const listTool: AgentTool<typeof listParameters> = {
			name: "mcdonalds_sg_listProducts",
			label: "List McDonald's SG products",
			description:
				'Return McDonald\'s Singapore product index entries as exact {id, name} pairs. category is required: use "all" to return the complete bundled menu index in one call, or an official category to narrow the result. Never call every category separately to construct the full index. Use this before nutrition lookup and never guess an ID, size, or variant.',
			parameters: listParameters,
			executionMode: "parallel",
			execute: async (_toolCallId, params, signal) => {
				if (signal?.aborted) throw new Error("Request cancelled");
				const products = listMcDonaldsSGProducts(params.category);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								category: params.category,
								retrievedAt: dataset.retrievedAt,
								products,
							}),
						},
					],
					details: { ok: true, data: { count: products.length } },
				};
			},
		};

		const getTool: AgentTool<typeof getParameters> = {
			name: "mcdonalds_sg_getNutrition",
			label: "Get McDonald's SG nutrition",
			description:
				"Get the complete official nutrition snapshot for one exact McDonald's Singapore product ID returned by mcdonalds_sg_listProducts.",
			parameters: getParameters,
			executionMode: "parallel",
			execute: async (_toolCallId, params, signal) => {
				if (signal?.aborted) throw new Error("Request cancelled");
				const product = getMcDonaldsSGProduct(params.id);
				if (!product) {
					throw new Error(
						`Unknown McDonald's Singapore product id: ${params.id}`,
					);
				}
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								...product,
								retrievedAt: dataset.retrievedAt,
								sourceUrl: dataset.sourceUrl,
							}),
						},
					],
					details: { ok: true, data: { id: product.id, name: product.name } },
				};
			},
		};
		return [listTool, getTool];
	},
	systemPrompt: ({ locale }) => {
		const snapshot = dataset.retrievedAt.slice(0, 10);
		return locale === "en-us"
			? `Use mcdonalds_sg tools only for McDonald's Singapore products. category is required for mcdonalds_sg_listProducts. When the user asks for the complete, full, or all-product menu index, call mcdonalds_sg_listProducts exactly once with {"category":"all"} and do not call categories separately. Use an official category only to narrow the index. Then choose the exact ID and call mcdonalds_sg_getNutrition when nutrition is needed. Preserve product size and variant and ask when the user's wording does not identify one exact list item. Values are for the official standard serving in the bundled snapshot dated ${snapshot}; actual preparation and current recipes may differ. Use energyKcal, proteinG, carbohydratesG, and totalFatG when the user explicitly asks to log the food through the core logFood tool. Never log automatically.`
			: `mcdonalds_sg 工具仅适用于新加坡麦当劳产品。mcdonalds_sg_listProducts 的 category 是必填参数；用户要求完整、全部或全量菜单索引时，只调用一次 mcdonalds_sg_listProducts({"category":"all"})，不得拆分分类调用。只有需要缩小索引范围时才传具体官网分类；需要营养信息时再选择准确 ID 并调用 mcdonalds_sg_getNutrition。必须严格区分尺寸与产品变体；用户描述无法对应唯一列表项时要先询问。数值来自日期为 ${snapshot} 的官网标准份量静态快照，实际制作和当前配方可能不同。只有用户明确要求记录时，才把 energyKcal、proteinG、carbohydratesG 和 totalFatG 传给核心 logFood 工具；不得自动记录。`;
	},
});
