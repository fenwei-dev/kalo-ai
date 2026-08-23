import {
	type AgentTool,
	definePlugin,
	StringEnum,
	Type,
} from "@kalo-ai/plugin-sdk";
import datasetJson from "../data/products.json";

export const SUBWAY_SG_CATEGORIES = [
	"sandwich",
	"breakfast",
	"energy-bowls",
	"sides",
] as const;
export type SubwaySGCategory = (typeof SUBWAY_SG_CATEGORIES)[number];
export const SUBWAY_SG_CATEGORY_FILTERS = [
	"all",
	...SUBWAY_SG_CATEGORIES,
] as const;
export type SubwaySGCategoryFilter =
	(typeof SUBWAY_SG_CATEGORY_FILTERS)[number];

export interface SubwaySGNutritionFacts {
	energyKcal: number;
	proteinG: number;
	totalFatG: number;
	saturatedFatG: number;
	transFatG?: number;
	cholesterolMg?: number;
	carbohydratesG: number;
	dietaryFibreG: number;
	sugarG: number;
	sodiumMg: number;
}

export interface SubwaySGProduct {
	id: string;
	name: string;
	description: string | null;
	url: string;
	category: SubwaySGCategory;
	servingSizeG: number;
	nutrition: SubwaySGNutritionFacts;
}

export interface SubwaySGDataset {
	schemaVersion: 1;
	sourceUrl: string;
	retrievedAt: string;
	products: SubwaySGProduct[];
}

function isCategory(value: string): value is SubwaySGCategory {
	return SUBWAY_SG_CATEGORIES.some((category) => category === value);
}

if (datasetJson.schemaVersion !== 1) {
	throw new Error(
		`Unsupported Subway Singapore dataset schema: ${datasetJson.schemaVersion}`,
	);
}
const products: SubwaySGProduct[] = datasetJson.products.map((product) => {
	if (!isCategory(product.category)) {
		throw new Error(
			`Unknown category in Subway Singapore product ${product.id}`,
		);
	}
	return { ...product, category: product.category };
});
const dataset: SubwaySGDataset = {
	...datasetJson,
	schemaVersion: 1,
	products,
};

const listParameters = Type.Object({
	category: StringEnum(SUBWAY_SG_CATEGORY_FILTERS, {
		description:
			'Required menu scope. Use "all" to return the complete bundled nutrition-product index in one call, or a category to narrow the result.',
	}),
});
const getParameters = Type.Object({
	id: Type.String({ pattern: "^[0-9]+$" }),
});

export function listSubwaySGProducts(category: SubwaySGCategoryFilter) {
	return dataset.products
		.filter((product) => category === "all" || product.category === category)
		.map((product) => ({ id: product.id, name: product.name }));
}

export function getSubwaySGProduct(id: string): SubwaySGProduct | undefined {
	return dataset.products.find((product) => product.id === id);
}

export const subwaySGProducts: readonly SubwaySGProduct[] = dataset.products;
export const subwaySGDatasetMetadata = {
	schemaVersion: dataset.schemaVersion,
	sourceUrl: dataset.sourceUrl,
	retrievedAt: dataset.retrievedAt,
	productCount: dataset.products.length,
};

export const subwaySGPlugin = definePlugin({
	manifest: {
		id: "subway_sg",
		apiVersion: 1,
		version: "0.1.0",
		configVersion: 1,
		name: {
			"zh-cn": "新加坡赛百味营养",
			"en-us": "Subway Singapore nutrition",
		},
		description: {
			"zh-cn": "查询新加坡赛百味官网公布的标准配方营养数据。",
			"en-us": "Looks up nutrition published by Subway Singapore.",
		},
		defaultEnabled: true,
	},
	configSchema: Type.Object({}),
	defaultConfig: {},
	createTools: () => {
		const listTool: AgentTool<typeof listParameters> = {
			name: "subway_sg_listProducts",
			label: "List Subway SG products",
			description:
				'Return bundled Subway Singapore nutrition-product index entries as exact {id, name} pairs. category is required: use "all" to return the complete bundled index in one call, or sandwich, breakfast, energy-bowls, or sides to narrow the result. Never call every category separately to construct the full index. Products without an official nutrition table are excluded.',
			parameters: listParameters,
			executionMode: "parallel",
			execute: async (_toolCallId, params, signal) => {
				if (signal?.aborted) throw new Error("Request cancelled");
				const listed = listSubwaySGProducts(params.category);
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
			name: "subway_sg_getNutrition",
			label: "Get Subway SG nutrition",
			description:
				"Get the complete official Subway Singapore nutrition snapshot for one exact product ID returned by subway_sg_listProducts.",
			parameters: getParameters,
			executionMode: "parallel",
			execute: async (_toolCallId, params, signal) => {
				if (signal?.aborted) throw new Error("Request cancelled");
				const product = getSubwaySGProduct(params.id);
				if (!product)
					throw new Error(`Unknown Subway Singapore product id: ${params.id}`);
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
			? `Use subway_sg tools only for Subway Singapore. category is required for subway_sg_listProducts. When the user asks for the complete, full, or all-product bundled index, call subway_sg_listProducts exactly once with {"category":"all"} and do not call categories separately. Use a concrete category only to narrow the index. Use the exact listed ID with subway_sg_getNutrition when nutrition is needed. Products without an official nutrition table are not listed, so this is the complete bundled nutrition-product index rather than every item sold by Subway. Values are based on the standard recipe and serving shown by Subway Singapore in the bundled snapshot dated ${snapshot}; custom bread, cheese, vegetables, sauces, add-ons, and portion changes alter nutrition. An absent nutrient field was unavailable in the source and must not be invented. Subway states Footlong sandwich values are approximately double the listed standard sub values. Only use the core logFood tool when the user explicitly asks to record food.`
			: `subway_sg 工具仅适用于新加坡赛百味。subway_sg_listProducts 的 category 是必填参数；用户要求完整、全部或全量 bundled 索引时，只调用一次 subway_sg_listProducts({"category":"all"})，不得拆分分类调用。只有需要缩小索引范围时才传具体分类；需要营养信息时再把准确 ID 传给 subway_sg_getNutrition。官网没有营养表的产品不会列出，因此这里的完整索引是插件内全部营养产品，并非赛百味所有在售商品。数值来自日期为 ${snapshot} 的官网标准配方与份量快照；面包、芝士、蔬菜、酱料、加料和份量自定义都会改变营养；缺少的营养字段表示来源未提供，不得编造。赛百味说明 Footlong 三明治可近似按所列标准 Sub 数值的两倍估算。只有用户明确要求记录时才调用核心 logFood。`;
	},
});

/** Standard registry-package exports; the named alias keeps bundled imports stable. */
export const kaloPlugin = subwaySGPlugin;
export default kaloPlugin;
