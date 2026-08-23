import { resolve } from "node:path";
import JSON5 from "json5";

const SOURCE_URL = "https://www.kfc.com.sg/nutritionandallergen";
const MIN_EXPECTED_PRODUCTS = 50;
const CATEGORIES = [
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
type Category = (typeof CATEGORIES)[number];
const dataPath = resolve(import.meta.dir, "../data/products.json");

interface NutritionFacts {
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

interface StaticProduct {
	id: string;
	name: string;
	categories: Category[];
	sourceGroups: string[];
	servingSize: number;
	servingUnit: "g" | "ml";
	allergens: string[];
	nutrition: NutritionFacts;
}

interface StaticDataset {
	schemaVersion: 1;
	sourceUrl: string;
	retrievedAt: string;
	products: StaticProduct[];
}

interface RawItem {
	ItemName: string;
	Servings: string;
	Energy: string;
	Protein: string;
	TotalFat: string;
	SaturatedFat: string;
	Carbohydrate: string;
	Sodium: string;
	Allergen: string[];
	TotalSugar?: string;
	Lactose?: string;
	AddedSugar?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchText(url: string): Promise<string> {
	const response = await fetch(url, {
		headers: {
			accept: "text/html,application/javascript",
			"user-agent":
				"kalo-ai-nutrition-updater/1.0 (+https://github.com/lirc572/kalo-ai)",
		},
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
	return response.text();
}

function scriptUrl(html: string, prefix: string): string {
	const match = new RegExp(
		`<script[^>]+src=["']([^"']*${prefix}[^"']*)`,
		"i",
	).exec(html);
	if (!match?.[1]) throw new Error(`Could not locate ${prefix} script.`);
	const url = new URL(match[1], SOURCE_URL);
	if (url.origin !== "https://www.kfc.com.sg") {
		throw new Error(`Unexpected KFC script origin: ${url.href}`);
	}
	return url.href;
}

function nutritionChunkId(mainScript: string): string {
	const route = /path:"nutritionandallergen"([\s\S]{0,800})/.exec(
		mainScript,
	)?.[1];
	const id = route
		? /\.bind\([a-zA-Z_$][\w$]*,(\d+)\)/.exec(route)?.[1]
		: undefined;
	if (!id) throw new Error("Could not locate KFC nutrition chunk ID.");
	return id;
}

function chunkHash(runtimeScript: string, chunkId: string): string {
	const match = new RegExp(`(?:^|[,{}])${chunkId}:"([a-f0-9]+)"`).exec(
		runtimeScript,
	);
	if (!match?.[1])
		throw new Error(`Could not locate hash for KFC chunk ${chunkId}.`);
	return match[1];
}

function extractObjectLiteral(source: string, marker: string): string {
	const markerIndex = source.indexOf(marker);
	if (markerIndex < 0) throw new Error(`Could not locate ${marker}.`);
	const start = source.indexOf("{", markerIndex + marker.length);
	if (start < 0) throw new Error(`Could not locate object after ${marker}.`);
	let depth = 0;
	let quote = "";
	let escaped = false;
	for (let index = start; index < source.length; index += 1) {
		const character = source[index] ?? "";
		if (quote) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === quote) quote = "";
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		else if (character === "{") depth += 1;
		else if (character === "}") {
			depth -= 1;
			if (depth === 0) return source.slice(start, index + 1);
		}
	}
	throw new Error(`Unterminated object after ${marker}.`);
}

function parseRawItem(value: unknown, group: string, index: number): RawItem {
	if (!isRecord(value)) throw new Error(`Invalid ${group}[${index}].`);
	const requiredString = (key: string): string => {
		const field = value[key];
		if (typeof field !== "string") {
			throw new Error(`Missing ${group}[${index}].${key}.`);
		}
		return field;
	};
	const allergens = value.Allergen;
	if (
		!Array.isArray(allergens) ||
		!allergens.every((item) => typeof item === "string")
	) {
		throw new Error(`Invalid allergens for ${group}[${index}].`);
	}
	return {
		ItemName: requiredString("ItemName"),
		Servings: requiredString("Servings"),
		Energy: requiredString("Energy"),
		Protein: requiredString("Protein"),
		TotalFat: requiredString("TotalFat"),
		SaturatedFat: requiredString("SaturatedFat"),
		Carbohydrate: requiredString("Carbohydrate"),
		Sodium: requiredString("Sodium"),
		Allergen: allergens,
		TotalSugar:
			typeof value.TotalSugar === "string" ? value.TotalSugar : undefined,
		Lactose: typeof value.Lactose === "string" ? value.Lactose : undefined,
		AddedSugar:
			typeof value.AddedSugar === "string" ? value.AddedSugar : undefined,
	};
}

function numberValue(raw: string, label: string, product: string): number {
	const normalized = raw.replaceAll(",", "").trim();
	if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) {
		throw new Error(`Invalid ${label} for ${product}: ${raw}`);
	}
	const value = Number(normalized);
	if (!Number.isFinite(value) || value < 0) {
		throw new Error(`Invalid ${label} for ${product}: ${raw}`);
	}
	return value;
}

function servingValue(
	raw: string,
	product: string,
): {
	value: number;
	unit: "g" | "ml";
} {
	const match = raw.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(g|ml)?$/i);
	if (!match?.[1]) throw new Error(`Invalid Servings for ${product}: ${raw}`);
	return {
		value: Number(match[1]),
		unit: match[2]?.toLowerCase() === "ml" ? "ml" : "g",
	};
}

function optionalNumberValue(
	raw: string | undefined,
	label: string,
	product: string,
): number | undefined {
	return raw === undefined || /^(?:-|n\.?\/?a\.?)$/i.test(raw.trim())
		? undefined
		: numberValue(raw, label, product);
}

function categoryForGroup(group: string): Category {
	if (
		/^Nutrition(?:AM|Waffle|Hearty|ChickenBacon|FriedYoutiao|MushroomTwister|OriginalRecipeRiser)/i.test(
			group,
		)
	)
		return "breakfast";
	if (/Sauce/i.test(group)) return "sauces";
	if (
		/^Nutrition(?:Drinks|AppleJuice|BlackCoffee|Cappuccino|CocaCola|Coffeewith|Dasani|Fanta|HeavenEarth|HotMilo|HotTea|IcedMilo|Latte|Magnolia|MineralWater|MinuteMaid|Mocha|Pokka|RedBull|Sjora|Sprite)/i.test(
			group,
		)
	)
		return "beverages";
	if (/Lil|MiniEggy|MiniTender/i.test(group)) return "kids";
	if (/Bowl/i.test(group)) return "bowls";
	if (/Wrap|Twister|Pockett/i.test(group)) return "wraps";
	if (/Burger|Zinger|Stacker|ETC|OCBurger|OCStacker/i.test(group))
		return "burgers";
	if (/KFCFroyo|PortugueseEggTart/i.test(group)) return "desserts";
	if (
		/^Nutrition(?:Chicken(?:Original|HotCrispy)|HotCrispyChickenBites|Dessert(?:Nuggets|HotCrispy|PopcornChicken))$/i.test(
			group,
		)
	)
		return "chicken";
	if (/Dessert|Side|CornCup|SaladCup|ChickenMacaroniSoup/i.test(group))
		return "sides";
	throw new Error(`Unclassified KFC nutrition group: ${group}`);
}

function slugify(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function normalizeAllergen(value: string): string | null {
	const normalized = value.trim();
	if (!normalized || /^(?:-|n\.?\/?a\.?)$/i.test(normalized)) return null;
	switch (normalized.toLowerCase()) {
		case "egg":
		case "eggs":
			return "Eggs";
		case "dairy":
		case "milk":
			return "Milk";
		case "soy":
		case "soy beans":
		case "soybean":
			return "Soy";
		case "cereals contain gluten":
		case "cereals containing gluten":
		case "gluten":
			return "Cereals containing gluten";
		case "crustacean":
			return "Crustaceans";
		default:
			return normalized;
	}
}

function canonicalProduct(group: string, item: RawItem): StaticProduct {
	const serving = servingValue(item.Servings, item.ItemName);
	const nutrition: NutritionFacts = {
		energyKcal: numberValue(item.Energy, "Energy", item.ItemName),
		proteinG: numberValue(item.Protein, "Protein", item.ItemName),
		carbohydratesG: numberValue(
			item.Carbohydrate,
			"Carbohydrate",
			item.ItemName,
		),
	};
	const totalFatG = optionalNumberValue(
		item.TotalFat,
		"TotalFat",
		item.ItemName,
	);
	const saturatedFatG = optionalNumberValue(
		item.SaturatedFat,
		"SaturatedFat",
		item.ItemName,
	);
	const sodiumMg = optionalNumberValue(item.Sodium, "Sodium", item.ItemName);
	const totalSugarG = optionalNumberValue(
		item.TotalSugar,
		"TotalSugar",
		item.ItemName,
	);
	const lactoseG = optionalNumberValue(item.Lactose, "Lactose", item.ItemName);
	const addedSugarG = optionalNumberValue(
		item.AddedSugar,
		"AddedSugar",
		item.ItemName,
	);
	if (totalFatG !== undefined) nutrition.totalFatG = totalFatG;
	if (saturatedFatG !== undefined) nutrition.saturatedFatG = saturatedFatG;
	if (sodiumMg !== undefined) nutrition.sodiumMg = sodiumMg;
	if (totalSugarG !== undefined) nutrition.totalSugarG = totalSugarG;
	if (lactoseG !== undefined) nutrition.lactoseG = lactoseG;
	if (addedSugarG !== undefined) nutrition.addedSugarG = addedSugarG;
	return {
		id: slugify(item.ItemName),
		name: item.ItemName.trim(),
		categories: [categoryForGroup(group)],
		sourceGroups: [group],
		servingSize: serving.value,
		servingUnit: serving.unit,
		allergens: [
			...new Set(
				item.Allergen.map(normalizeAllergen).filter(
					(allergen): allergen is string => allergen !== null,
				),
			),
		].sort(),
		nutrition,
	};
}

function productSignature(product: StaticProduct): string {
	return JSON.stringify({
		name: product.name,
		servingSize: product.servingSize,
		servingUnit: product.servingUnit,
		allergens: product.allergens,
		nutrition: product.nutrition,
	});
}

function mergeProducts(
	entries: { group: string; item: RawItem }[],
): StaticProduct[] {
	const productGroups = new Map<string, StaticProduct[]>();
	for (const { group, item } of entries.sort(
		(a, b) =>
			a.item.ItemName.localeCompare(b.item.ItemName, "en-SG") ||
			a.group.localeCompare(b.group),
	)) {
		const candidate = canonicalProduct(group, item);
		const baseId = candidate.id;
		const variants = productGroups.get(baseId) ?? [];
		const signature = productSignature(candidate);
		const existing = variants.find(
			(product) => productSignature(product) === signature,
		);
		if (existing) {
			existing.categories = [
				...new Set([...existing.categories, ...candidate.categories]),
			].sort();
			existing.sourceGroups = [
				...new Set([...existing.sourceGroups, group]),
			].sort();
		} else {
			variants.push(candidate);
		}
		productGroups.set(baseId, variants);
	}

	const products: StaticProduct[] = [];
	for (const [baseId, variants] of productGroups) {
		for (const product of variants) {
			if (variants.length === 1) {
				products.push(product);
				continue;
			}
			const servingKey = `${String(product.servingSize).replace(".", "-")}${product.servingUnit}`;
			const matchingServingCount = variants.filter(
				(variant) =>
					variant.servingSize === product.servingSize &&
					variant.servingUnit === product.servingUnit,
			).length;
			const sourceKey = product.sourceGroups
				.map((sourceGroup) => slugify(sourceGroup.replace(/^Nutrition/, "")))
				.join("-");
			products.push({
				...product,
				id: `${baseId}-${servingKey}${matchingServingCount > 1 ? `-${sourceKey}` : ""}`,
			});
		}
	}
	products.sort(
		(a, b) => a.name.localeCompare(b.name, "en-SG") || a.id.localeCompare(b.id),
	);
	if (new Set(products.map((product) => product.id)).size !== products.length) {
		throw new Error(
			"KFC duplicate variants could not be assigned unique stable IDs.",
		);
	}
	return products;
}

function validateProducts(products: StaticProduct[]): void {
	if (products.length < MIN_EXPECTED_PRODUCTS)
		throw new Error(`Only ${products.length} KFC products were parsed.`);
	if (new Set(products.map((product) => product.id)).size !== products.length)
		throw new Error("Duplicate KFC product IDs.");
	for (const category of CATEGORIES) {
		if (!products.some((product) => product.categories.includes(category)))
			throw new Error(`KFC category ${category} had no products.`);
	}
	for (const product of products) {
		if (!product.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.id)) {
			throw new Error(`Invalid KFC product identity: ${product.id}`);
		}
		if (
			product.categories.length === 0 ||
			!product.categories.every((category) => CATEGORIES.includes(category))
		) {
			throw new Error(`Invalid KFC categories for ${product.id}.`);
		}
		if (
			product.sourceGroups.length === 0 ||
			!product.sourceGroups.every((group) => group.startsWith("Nutrition"))
		) {
			throw new Error(`Invalid KFC source groups for ${product.id}.`);
		}
		if (!Number.isFinite(product.servingSize) || product.servingSize <= 0) {
			throw new Error(`Invalid KFC serving size for ${product.id}.`);
		}
		for (const value of Object.values(product.nutrition)) {
			if (!Number.isFinite(value) || value < 0) {
				throw new Error(`Invalid KFC nutrition value for ${product.id}.`);
			}
		}
		if (product.allergens.some((allergen) => !allergen)) {
			throw new Error(`Invalid KFC allergen label for ${product.id}.`);
		}
	}
}

async function readExisting(): Promise<StaticDataset | null> {
	const file = Bun.file(dataPath);
	return (await file.exists()) ? file.json() : null;
}

console.error("Fetching KFC Singapore application metadata...");
const page = await fetchText(SOURCE_URL);
const runtimeUrl = scriptUrl(page, "runtime.");
const mainUrl = scriptUrl(page, "main.");
const [runtimeScript, mainScript] = await Promise.all([
	fetchText(runtimeUrl),
	fetchText(mainUrl),
]);
const chunkId = nutritionChunkId(mainScript);
const hash = chunkHash(runtimeScript, chunkId);
const chunkUrl = new URL(`${chunkId}.${hash}.js`, SOURCE_URL);
chunkUrl.search = new URL(mainUrl).search;
console.error(`Fetching KFC Singapore nutrition chunk ${chunkId}...`);
const chunk = await fetchText(chunkUrl.href);
const parsed = JSON5.parse(extractObjectLiteral(chunk, "jsonData="));
if (!isRecord(parsed)) throw new Error("KFC jsonData was not an object.");
const rawEntries: { group: string; item: RawItem }[] = [];
for (const [group, value] of Object.entries(parsed)) {
	if (!group.startsWith("Nutrition") || !Array.isArray(value)) continue;
	value.forEach((item, index) => {
		rawEntries.push({ group, item: parseRawItem(item, group, index) });
	});
}
const products = mergeProducts(rawEntries);
validateProducts(products);

const previous = await readExisting();
if (
	previous?.schemaVersion === 1 &&
	previous.sourceUrl === SOURCE_URL &&
	JSON.stringify(previous.products) === JSON.stringify(products)
) {
	console.log(
		`KFC Singapore nutrition data is unchanged (${products.length} products).`,
	);
	process.exit(0);
}
const next: StaticDataset = {
	schemaVersion: 1,
	sourceUrl: SOURCE_URL,
	retrievedAt: new Date().toISOString(),
	products,
};
await Bun.write(dataPath, `${JSON.stringify(next, null, "\t")}\n`);
console.log(`Updated ${dataPath} with ${products.length} products.`);
