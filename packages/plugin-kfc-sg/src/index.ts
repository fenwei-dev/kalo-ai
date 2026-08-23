import {
	type AgentTool,
	definePlugin,
	StringEnum,
	Type,
} from "@kalo-ai/plugin-sdk";
import datasetJson from "../data/products.json";

export const KFC_SG_CATEGORIES = [
	"chicken",
	"burgers",
	"wraps",
	"bowls",
	"sides",
	"desserts",
	"breakfast",
	"kids",
	"beverages",
	"sauces",
] as const;
export type KFCSGCategory = (typeof KFC_SG_CATEGORIES)[number];
export const KFC_SG_CATEGORY_FILTERS = ["all", ...KFC_SG_CATEGORIES] as const;
export type KFCSGCategoryFilter = (typeof KFC_SG_CATEGORY_FILTERS)[number];

export interface KFCSGNutritionFacts {
	energyKcal: number;
	proteinG: number;
	totalFatG?: number;
	saturatedFatG?: number;
	carbohydratesG: number;
	sodiumMg?: number;
	totalSugarG?: number;
	lactoseG?: number;
	addedSugarG?: number;
}

export interface KFCSGProduct {
	id: string;
	name: string;
	categories: KFCSGCategory[];
	sourceGroups: string[];
	servingSize: number;
	servingUnit: "g" | "ml";
	allergens: string[];
	nutrition: KFCSGNutritionFacts;
}

export interface KFCSGDataset {
	schemaVersion: 1;
	sourceUrl: string;
	retrievedAt: string;
	products: KFCSGProduct[];
}

function isCategory(value: string): value is KFCSGCategory {
	return KFC_SG_CATEGORIES.some((category) => category === value);
}

if (datasetJson.schemaVersion !== 1) {
	throw new Error(
		`Unsupported KFC Singapore dataset schema: ${datasetJson.schemaVersion}`,
	);
}
const products: KFCSGProduct[] = datasetJson.products.map((product) => {
	const categories = product.categories.filter(isCategory);
	if (categories.length !== product.categories.length) {
		throw new Error(`Unknown category in KFC Singapore product ${product.id}`);
	}
	if (product.servingUnit !== "g" && product.servingUnit !== "ml") {
		throw new Error(
			`Unknown serving unit in KFC Singapore product ${product.id}`,
		);
	}
	return { ...product, categories, servingUnit: product.servingUnit };
});
const dataset: KFCSGDataset = {
	...datasetJson,
	schemaVersion: 1,
	products,
};

const listParameters = Type.Object({
	category: StringEnum(KFC_SG_CATEGORY_FILTERS, {
		description:
			'Required menu scope. Use "all" to return the complete bundled nutrition-page index in one call, or a category to narrow the result.',
	}),
});
const getParameters = Type.Object({
	id: Type.String({ pattern: "^[a-z0-9-]+$" }),
});

export function listKFCSGProducts(category: KFCSGCategoryFilter) {
	return dataset.products
		.filter(
			(product) => category === "all" || product.categories.includes(category),
		)
		.map((product) => ({
			id: product.id,
			name: product.name,
			servingSize: product.servingSize,
			servingUnit: product.servingUnit,
		}));
}

export function getKFCSGProduct(id: string): KFCSGProduct | undefined {
	return dataset.products.find((product) => product.id === id);
}

export const kfcSGProducts: readonly KFCSGProduct[] = dataset.products;
export const kfcSGDatasetMetadata = {
	schemaVersion: dataset.schemaVersion,
	sourceUrl: dataset.sourceUrl,
	retrievedAt: dataset.retrievedAt,
	productCount: dataset.products.length,
};

export const kfcSGPlugin = definePlugin({
	manifest: {
		id: "kfc_sg",
		apiVersion: 1,
		version: "0.1.0",
		configVersion: 1,
		name: {
			"zh-cn": "新加坡肯德基营养",
			"en-us": "KFC Singapore nutrition",
		},
		description: {
			"zh-cn": "查询新加坡肯德基官网营养与过敏原页面公布的数据。",
			"en-us":
				"Looks up nutrition and allergen data published by KFC Singapore.",
		},
		defaultEnabled: true,
	},
	configSchema: Type.Object({}),
	defaultConfig: {},
	createTools: () => {
		const listTool: AgentTool<typeof listParameters> = {
			name: "kfc_sg_listProducts",
			label: "List KFC SG products",
			description:
				'Return bundled KFC Singapore nutrition-product index entries as exact {id, name, servingSize, servingUnit} records. category is required: use "all" to return the complete bundled index in one call, or chicken, burgers, wraps, bowls, sides, desserts, breakfast, kids, beverages, or sauces to narrow the result. Never call every category separately to construct the full index. Use serving details to distinguish duplicate official names and variants.',
			parameters: listParameters,
			executionMode: "parallel",
			execute: async (_toolCallId, params, signal) => {
				if (signal?.aborted) throw new Error("Request cancelled");
				const listed = listKFCSGProducts(params.category);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								category: params.category,
								retrievedAt: dataset.retrievedAt,
								products: listed,
							}),
						},
					],
					details: { ok: true, data: { count: listed.length } },
				};
			},
		};
		const getTool: AgentTool<typeof getParameters> = {
			name: "kfc_sg_getNutrition",
			label: "Get KFC SG nutrition",
			description:
				"Get the complete official KFC Singapore nutrition and allergen snapshot for one exact product ID returned by kfc_sg_listProducts.",
			parameters: getParameters,
			executionMode: "parallel",
			execute: async (_toolCallId, params, signal) => {
				if (signal?.aborted) throw new Error("Request cancelled");
				const product = getKFCSGProduct(params.id);
				if (!product)
					throw new Error(`Unknown KFC Singapore product id: ${params.id}`);
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
			? `Use kfc_sg tools only for KFC Singapore. category is required for kfc_sg_listProducts. When the user asks for the complete, full, or all-product bundled index, call kfc_sg_listProducts exactly once with {"category":"all"} and do not call categories separately. Use a concrete category only to narrow the index. Use the exact listed ID with kfc_sg_getNutrition when nutrition is needed. Preserve cut, piece count, drink size, meal, and product variant; use serving details to distinguish repeated official names. This is the complete bundled nutrition-page index and may not equal KFC's current sales menu. Values are from KFC Singapore's bundled nutrition and allergen snapshot dated ${snapshot}; current availability and preparation may differ. An absent nutrient field was unavailable in the source and must not be invented. Allergen arrays are informational and shared kitchens can cause cross-contact; never present them as a medical guarantee. Only call the core logFood tool when the user explicitly asks to record food.`
			: `kfc_sg 工具仅适用于新加坡肯德基。kfc_sg_listProducts 的 category 是必填参数；用户要求完整、全部或全量 bundled 索引时，只调用一次 kfc_sg_listProducts({"category":"all"})，不得拆分分类调用。只有需要缩小索引范围时才传具体分类；需要营养信息时再把准确 ID 传给 kfc_sg_getNutrition。必须区分鸡块部位、数量、饮料尺寸、套餐和产品变体，并用份量信息区分官网重名项。这里返回的是营养页面静态快照的完整索引，不一定等于肯德基当前销售菜单。数值来自日期为 ${snapshot} 的新加坡肯德基营养与过敏原静态快照，当前供应和实际制作可能不同。缺少的营养字段表示来源未提供，不得编造。过敏原数组仅供参考，共用厨房可能交叉接触，不得把它当作医疗保证。只有用户明确要求记录时才调用核心 logFood。`;
	},
});

/** Standard registry-package exports; the named alias keeps bundled imports stable. */
export const kaloPlugin = kfcSGPlugin;
export default kaloPlugin;
