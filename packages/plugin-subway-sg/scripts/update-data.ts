import { resolve } from "node:path";

const MENU_URL = "https://subwayisfresh.com.sg/menu/";
const CATEGORIES = ["sandwich", "breakfast", "energy-bowls", "sides"] as const;
type Category = (typeof CATEGORIES)[number];
const MIN_EXPECTED_PRODUCTS = 20;
const dataPath = resolve(import.meta.dir, "../data/products.json");

interface NutritionFacts {
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

interface StaticProduct {
	id: string;
	name: string;
	description: string | null;
	url: string;
	category: Category;
	servingSizeG: number;
	nutrition: NutritionFacts;
}

interface StaticDataset {
	schemaVersion: 1;
	sourceUrl: string;
	retrievedAt: string;
	products: StaticProduct[];
}

interface MenuEntry {
	id: string;
	name: string;
	url: string;
	category: Category;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeHtml(value: string): string {
	const named: Record<string, string> = {
		amp: "&",
		quot: '"',
		apos: "'",
		lt: "<",
		gt: ">",
		nbsp: " ",
	};
	return value.replace(
		/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
		(_match, entity: string) => {
			if (entity.startsWith("#x")) {
				return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
			}
			if (entity.startsWith("#")) {
				return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
			}
			return named[entity.toLowerCase()] ?? `&${entity};`;
		},
	);
}

function htmlToText(value: string): string {
	return decodeHtml(
		value
			.replace(/<br\s*\/?>/gi, " ")
			.replace(/<[^>]*>/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
	);
}

async function fetchText(url: string): Promise<string> {
	const response = await fetch(url, {
		headers: {
			accept: "text/html,application/json",
			"user-agent":
				"kalo-ai-nutrition-updater/1.0 (+https://github.com/lirc572/kalo-ai)",
		},
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
	return response.text();
}

function parseMenu(html: string): MenuEntry[] {
	const entries: MenuEntry[] = [];
	const seen = new Set<string>();
	const articlePattern =
		/<article\b[^>]*id="post-(\d+)"[^>]*class="([^"]*\bmenu_item\b[^"]*)"[^>]*>[\s\S]*?<\/article>/gi;
	for (const match of html.matchAll(articlePattern)) {
		const id = match[1];
		const classes = match[2]?.split(/\s+/) ?? [];
		if (!id || classes.includes("category-nonutriinfopage")) continue;
		const category = CATEGORIES.find((candidate) =>
			classes.includes(`category-${candidate}`),
		);
		if (!category || seen.has(id)) continue;
		const article = match[0];
		const linkAttribute = /data-ha-element-link="([^"]+)"/i.exec(article)?.[1];
		const nameHtml =
			/elementor-widget-text-editor[\s\S]*?elementor-widget-container">\s*([\s\S]*?)<\/div><\/div>/i.exec(
				article,
			)?.[1];
		if (!linkAttribute || !nameHtml) continue;
		const linkData = JSON.parse(decodeHtml(linkAttribute));
		if (!isRecord(linkData) || typeof linkData.url !== "string") continue;
		const url = new URL(linkData.url.replaceAll("\\/", "/"));
		if (url.origin !== "https://subwayisfresh.com.sg") continue;
		seen.add(id);
		entries.push({ id, name: htmlToText(nameHtml), url: url.href, category });
	}
	if (entries.length < MIN_EXPECTED_PRODUCTS) {
		throw new Error(`Only ${entries.length} nutrition menu items were parsed.`);
	}
	for (const category of CATEGORIES) {
		if (!entries.some((entry) => entry.category === category)) {
			throw new Error(`Subway category ${category} had no nutrition products.`);
		}
	}
	return entries;
}

function parseNumber(
	rows: ReadonlyMap<string, string>,
	label: string,
	unit: string,
): number {
	const raw = rows.get(label.toLowerCase());
	if (!raw) throw new Error(`Missing Subway nutrient ${label}.`);
	const match = raw
		.replaceAll(",", "")
		.match(/^([0-9]+(?:\.[0-9]+)?)\s*([a-z]+)$/i);
	if (!match || match[2]?.toLowerCase() !== unit) {
		throw new Error(`Unexpected Subway ${label} value: ${raw}`);
	}
	return Number(match[1]);
}

function parseOptionalNumber(
	rows: ReadonlyMap<string, string>,
	label: string,
	unit: string,
): number | undefined {
	const raw = rows.get(label.toLowerCase());
	return !raw || /^(?:-|n\.?\/?a\.?)$/i.test(raw.trim())
		? undefined
		: parseNumber(rows, label, unit);
}

function parseProduct(entry: MenuEntry, content: string): StaticProduct | null {
	const textWidgets = [
		...content.matchAll(
			/elementor-widget-text-editor[\s\S]*?elementor-widget-container">\s*([\s\S]*?)<\/div><\/div>/gi,
		),
	]
		.map((match) => htmlToText(match[1] ?? ""))
		.filter(Boolean);
	const nameIndex = textWidgets.findIndex(
		(text) => text.toLowerCase() === entry.name.toLowerCase(),
	);
	const descriptionCandidate =
		nameIndex >= 0 ? textWidgets[nameIndex + 1] : undefined;
	const description =
		descriptionCandidate &&
		!descriptionCandidate.toLowerCase().startsWith("order now")
			? descriptionCandidate
			: null;
	const tables = [...content.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
	const nutritionTable = tables.find((match) =>
		match[0].includes("Nutrition Calculator"),
	)?.[1];
	if (!nutritionTable) return null;
	const rows = new Map<string, string>();
	for (const row of nutritionTable.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
		const cells = [
			...(row[1] ?? "").matchAll(
				/<td\b[^>]*>[\s\S]*?<div class="td-content">([\s\S]*?)<\/div>[\s\S]*?<\/td>/gi,
			),
		];
		const label = cells[0]?.[1];
		const value = cells[1]?.[1];
		if (label !== undefined && value !== undefined) {
			rows.set(htmlToText(label).toLowerCase(), htmlToText(value));
		}
	}
	return {
		id: entry.id,
		name: entry.name,
		description,
		url: entry.url,
		category: entry.category,
		servingSizeG: parseNumber(rows, "Serving Size", "g"),
		nutrition: {
			energyKcal: parseNumber(rows, "Energy", "kcal"),
			proteinG: parseNumber(rows, "Protein", "g"),
			totalFatG: parseNumber(rows, "Total Fat", "g"),
			saturatedFatG: parseNumber(rows, "Sat. Fat", "g"),
			transFatG: parseOptionalNumber(rows, "Trans Fatty Acid", "g"),
			cholesterolMg: parseOptionalNumber(rows, "Cholesterol", "mg"),
			carbohydratesG: parseNumber(rows, "Carbohydrates", "g"),
			dietaryFibreG: parseNumber(rows, "Dietary Fibre", "g"),
			sugarG: parseNumber(rows, "Sugar", "g"),
			sodiumMg: parseNumber(rows, "Sodium", "mg"),
		},
	};
}

function validateProducts(products: readonly StaticProduct[]): void {
	if (products.length < MIN_EXPECTED_PRODUCTS) {
		throw new Error(
			`Only ${products.length} Subway nutrition products were parsed.`,
		);
	}
	if (new Set(products.map((product) => product.id)).size !== products.length) {
		throw new Error("Duplicate Subway product IDs.");
	}
	for (const category of CATEGORIES) {
		if (!products.some((product) => product.category === category)) {
			throw new Error(
				`Subway category ${category} had no parsed nutrition products.`,
			);
		}
	}
	for (const product of products) {
		if (!product.name || !/^\d+$/.test(product.id)) {
			throw new Error(`Invalid Subway product identity: ${product.id}`);
		}
		if (new URL(product.url).origin !== "https://subwayisfresh.com.sg") {
			throw new Error(`Unexpected Subway product URL: ${product.url}`);
		}
		if (!Number.isFinite(product.servingSizeG) || product.servingSizeG <= 0) {
			throw new Error(`Invalid Subway serving size for ${product.id}.`);
		}
		for (const value of Object.values(product.nutrition)) {
			if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
				throw new Error(`Invalid Subway nutrition value for ${product.id}.`);
			}
		}
	}
}

async function mapConcurrent<T, R>(
	values: readonly T[],
	concurrency: number,
	mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(values.length);
	let next = 0;
	const worker = async () => {
		while (true) {
			const index = next++;
			if (index >= values.length) return;
			const value = values[index];
			if (value === undefined) return;
			results[index] = await mapper(value, index);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(concurrency, values.length) }, worker),
	);
	return results;
}

async function readExisting(): Promise<StaticDataset | null> {
	const file = Bun.file(dataPath);
	return (await file.exists()) ? file.json() : null;
}

const concurrency = Number(Bun.env.SUBWAY_CONCURRENCY ?? 3);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6) {
	throw new Error("SUBWAY_CONCURRENCY must be an integer from 1 to 6.");
}

console.error("Fetching Subway Singapore menu...");
const menu = parseMenu(await fetchText(MENU_URL));
const fetchedProducts = await mapConcurrent(
	menu,
	concurrency,
	async (entry, index) => {
		const product = parseProduct(entry, await fetchText(entry.url));
		console.error(
			product
				? `[${index + 1}/${menu.length}] ${product.name}`
				: `[${index + 1}/${menu.length}] skipped ${entry.id} (no nutrition table)`,
		);
		return product;
	},
);
const products = fetchedProducts.filter(
	(product): product is StaticProduct => product !== null,
);
validateProducts(products);
products.sort(
	(a, b) => a.name.localeCompare(b.name, "en-SG") || a.id.localeCompare(b.id),
);

const previous = await readExisting();
if (
	previous?.schemaVersion === 1 &&
	previous.sourceUrl === MENU_URL &&
	JSON.stringify(previous.products) === JSON.stringify(products)
) {
	console.log(
		`Subway Singapore nutrition data is unchanged (${products.length} products).`,
	);
	process.exit(0);
}

const next: StaticDataset = {
	schemaVersion: 1,
	sourceUrl: MENU_URL,
	retrievedAt: new Date().toISOString(),
	products,
};
await Bun.write(dataPath, `${JSON.stringify(next, null, "\t")}\n`);
console.log(`Updated ${dataPath} with ${products.length} products.`);
