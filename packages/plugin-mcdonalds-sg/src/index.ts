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
	category: Type.Optional(StringEnum(MCDONALDS_SG_CATEGORIES)),
});
const getParameters = Type.Object({
	id: Type.String({ pattern: "^[0-9]+$" }),
});

export interface McDonaldsSGProductListItem {
	id: string;
	name: string;
}

export function listMcDonaldsSGProducts(
	category?: McDonaldsSGCategory,
): McDonaldsSGProductListItem[] {
	return dataset.products
		.filter((product) => !category || product.categories.includes(category))
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
				"List every bundled McDonald's Singapore product as exact {id, name} pairs. Optionally filter by one official category. Use this before nutrition lookup; never guess an ID, size, or variant.",
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
								category: params.category ?? null,
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
			? `Use mcdonalds_sg tools only for McDonald's Singapore products. Call mcdonalds_sg_listProducts first, optionally with an official category, then choose the exact ID and call mcdonalds_sg_getNutrition. Preserve product size and variant and ask when the user's wording does not identify one exact list item. Values are for the official standard serving in the bundled snapshot dated ${snapshot}; actual preparation and current recipes may differ. Use energyKcal, proteinG, carbohydratesG, and totalFatG when the user explicitly asks to log the food through the core logFood tool. Never log automatically.`
			: `mcdonalds_sg 工具仅适用于新加坡麦当劳产品。先调用 mcdonalds_sg_listProducts（可按官网分类筛选），再选择准确 ID 并调用 mcdonalds_sg_getNutrition。必须严格区分尺寸与产品变体；用户描述无法对应唯一列表项时要先询问。数值来自日期为 ${snapshot} 的官网标准份量静态快照，实际制作和当前配方可能不同。只有用户明确要求记录时，才把 energyKcal、proteinG、carbohydratesG 和 totalFatG 传给核心 logFood 工具；不得自动记录。`;
	},
});
