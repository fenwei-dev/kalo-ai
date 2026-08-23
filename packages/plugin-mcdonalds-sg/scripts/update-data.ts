import { resolve } from "node:path";
import {
	McDonaldsSGNutritionClient,
	type ProductNutrition,
} from "./mcd-client.ts";

const SOURCE_URL = "https://www.mcdonalds.com.sg/full-menu";
const MIN_EXPECTED_PRODUCTS = 20;
const CATEGORIES = [
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
type Category = (typeof CATEGORIES)[number];
const dataPath = resolve(import.meta.dir, "../data/products.json");

interface StaticProduct {
	id: string;
	name: string;
	description: string | null;
	url: string;
	categories: Category[];
	nutrition: ProductNutrition["nutrition"];
}

interface StaticDataset {
	schemaVersion: 2;
	sourceUrl: string;
	retrievedAt: string;
	products: StaticProduct[];
}

function canonicalProduct(
	product: ProductNutrition,
	categoriesByPath: ReadonlyMap<string, ReadonlySet<Category>>,
): StaticProduct {
	const path = new URL(product.url).pathname.replace(/\/$/, "");
	return {
		id: product.id,
		name: product.name,
		description: product.description,
		url: product.url,
		categories: [...(categoriesByPath.get(path) ?? [])].sort(),
		nutrition: product.nutrition,
	};
}

function validateProducts(products: StaticProduct[]): void {
	if (products.length < MIN_EXPECTED_PRODUCTS) {
		throw new Error(
			`Only ${products.length} products were parsed; refusing to replace a likely-valid snapshot.`,
		);
	}
	const ids = new Set<string>();
	for (const product of products) {
		if (!/^\d+$/.test(product.id))
			throw new Error(`Invalid product id: ${product.id}`);
		if (ids.has(product.id))
			throw new Error(`Duplicate product id: ${product.id}`);
		ids.add(product.id);
		if (!product.name.trim())
			throw new Error(`Product ${product.id} has no name.`);
		if (product.categories.some((category) => !CATEGORIES.includes(category))) {
			throw new Error(`Product ${product.name} has an unknown category.`);
		}
		const url = new URL(product.url);
		if (url.origin !== "https://www.mcdonalds.com.sg") {
			throw new Error(`Unexpected product origin: ${product.url}`);
		}
		for (const [nutrient, value] of Object.entries(product.nutrition)) {
			if (!Number.isFinite(value) || value < 0) {
				throw new Error(`Invalid ${nutrient} for ${product.name}: ${value}`);
			}
		}
	}
	for (const category of CATEGORIES) {
		if (!products.some((product) => product.categories.includes(category))) {
			throw new Error(
				`Category ${category} did not match any Full Menu product.`,
			);
		}
	}
}

async function readExisting(): Promise<StaticDataset | null> {
	const file = Bun.file(dataPath);
	if (!(await file.exists())) return null;
	return file.json();
}

const concurrency = Number(Bun.env.MCD_CONCURRENCY ?? 3);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
	throw new Error("MCD_CONCURRENCY must be an integer from 1 to 8.");
}

const client = new McDonaldsSGNutritionClient({
	timeoutMs: 30_000,
	headers: {
		"user-agent":
			"kalo-ai-nutrition-updater/1.0 (+https://github.com/lirc572/kalo-ai)",
	},
});

console.error("Fetching McDonald's Singapore category membership...");
const categoriesByPath = new Map<string, Set<Category>>();
for (const category of CATEGORIES) {
	const categoryProducts = await client.listProductsByCategory(category);
	console.error(`[category] ${category}: ${categoryProducts.length} products`);
	for (const product of categoryProducts) {
		const path = new URL(product.url).pathname.replace(/\/$/, "");
		const memberships = categoriesByPath.get(path) ?? new Set<Category>();
		memberships.add(category);
		categoriesByPath.set(path, memberships);
	}
}

console.error(
	`Fetching McDonald's Singapore menu with concurrency ${concurrency}...`,
);
const fetched = await client.getAllMenuNutrition({
	concurrency,
	onProgress: ({ completed, total, product }) => {
		console.error(`[${completed}/${total}] ${product.name}`);
	},
});

const byId = new Map<string, StaticProduct>();
for (const product of fetched) {
	const candidate = canonicalProduct(product, categoriesByPath);
	const existing = byId.get(candidate.id);
	if (existing && JSON.stringify(existing) !== JSON.stringify(candidate)) {
		throw new Error(`Conflicting duplicate product id ${candidate.id}.`);
	}
	byId.set(candidate.id, candidate);
}
const products = [...byId.values()].sort(
	(a, b) => a.name.localeCompare(b.name, "en-SG") || a.id.localeCompare(b.id),
);
validateProducts(products);

const previous = await readExisting();
if (
	previous?.schemaVersion === 2 &&
	previous.sourceUrl === SOURCE_URL &&
	JSON.stringify(previous.products) === JSON.stringify(products)
) {
	console.log(
		`McDonald's Singapore nutrition data is unchanged (${products.length} products).`,
	);
	process.exit(0);
}

const next: StaticDataset = {
	schemaVersion: 2,
	sourceUrl: SOURCE_URL,
	retrievedAt: new Date().toISOString(),
	products,
};
await Bun.write(dataPath, `${JSON.stringify(next, null, "\t")}\n`);
console.log(
	`Updated ${dataPath} with ${products.length} products (retrieved ${next.retrievedAt}).`,
);
