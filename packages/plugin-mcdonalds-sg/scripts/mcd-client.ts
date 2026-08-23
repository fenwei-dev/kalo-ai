/**
 * Server-side downloader adapted from the sibling mcd-nutrition project.
 * This module is used only by update-data.ts and is not exported to the Web App.
 */
const DEFAULT_BASE_URL = "https://www.mcdonalds.com.sg/";
const DEFAULT_TIMEOUT_MS = 20_000;

export type FetchLike = typeof globalThis.fetch;

export interface McDonaldsSGNutritionClientOptions {
	/** Override this mainly for tests or a compatible mirror. */
	baseUrl?: string | URL;
	/** Custom fetch implementation. Defaults to globalThis.fetch. */
	fetch?: FetchLike;
	/** Timeout applied to each HTTP request. Set to 0 to disable it. */
	timeoutMs?: number;
	/** Extra headers sent with every request. */
	headers?: RequestInit["headers"];
}

export interface RequestOptions {
	signal?: AbortSignal;
}

export interface ProductSearchResult {
	/** Drupal node ID used by McDonald's Singapore. */
	id: string;
	/** Display name returned by the official autocomplete endpoint. */
	name: string;
	/** Exact value accepted by the official nutrition calculator form. */
	value: string;
}

export interface MenuProduct {
	name: string;
	/** Last URL path segment. Most, but not all, products live under /food-menu/. */
	slug: string;
	/** Official path exactly as linked from the Full Menu page. */
	path: string;
	url: string;
	imageUrl: string | null;
}

/** All numbers are for the standard serving represented by the product page. */
export interface NutritionFacts {
	energyKcal: number;
	proteinG: number;
	totalFatG: number;
	saturatedFatG: number;
	cholesterolMg: number;
	carbohydratesG: number;
	dietaryFibreG: number;
	sodiumMg: number;
}

export interface ProductNutrition {
	id: string;
	name: string;
	description: string | null;
	imageUrl: string | null;
	/** Canonical official McDonald's Singapore product URL. */
	url: string;
	nutrition: NutritionFacts;
}

export interface NutritionProgress {
	completed: number;
	total: number;
	product: MenuProduct;
	result: ProductNutrition;
}

export interface GetAllMenuNutritionOptions extends RequestOptions {
	/** Number of simultaneous product-page requests. Defaults to 4, max 20. */
	concurrency?: number;
	onProgress?: (progress: NutritionProgress) => void;
}

export class McDonaldsNutritionError extends Error {
	override readonly name: string = "McDonaldsNutritionError";
}

export class McDonaldsHttpError extends McDonaldsNutritionError {
	override readonly name: string = "McDonaldsHttpError";

	constructor(
		message: string,
		public readonly status: number,
		public readonly url: string,
		options?: ErrorOptions,
	) {
		super(message, options);
	}
}

export class McDonaldsResponseError extends McDonaldsNutritionError {
	override readonly name: string = "McDonaldsResponseError";
}

export class ProductNotFoundError extends McDonaldsNutritionError {
	override readonly name: string = "ProductNotFoundError";

	constructor(public readonly query: string) {
		super(`No McDonald's Singapore product matched ${JSON.stringify(query)}.`);
	}
}

export class AmbiguousProductError extends McDonaldsNutritionError {
	override readonly name: string = "AmbiguousProductError";

	constructor(
		public readonly query: string,
		public readonly candidates: readonly ProductSearchResult[],
	) {
		const choices = candidates
			.map(({ id, name }) => `${name} (${id})`)
			.join(", ");
		super(
			`More than one McDonald's Singapore product matched ${JSON.stringify(query)}: ${choices}`,
		);
	}
}

interface TextResponse {
	body: string;
	responseUrl: string;
}

interface ParsedNutrient {
	value: number;
	unit: string;
}

export class McDonaldsSGNutritionClient {
	readonly baseUrl: string;
	readonly timeoutMs: number;

	private readonly fetchImpl: FetchLike;
	private readonly headers: Headers;

	constructor(options: McDonaldsSGNutritionClientOptions = {}) {
		const baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
		if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") {
			throw new TypeError("baseUrl must use http: or https:.");
		}

		if (
			options.timeoutMs !== undefined &&
			(!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)
		) {
			throw new RangeError("timeoutMs must be a finite non-negative number.");
		}

		const fetchImpl = options.fetch ?? globalThis.fetch;
		if (typeof fetchImpl !== "function") {
			throw new TypeError("No fetch implementation is available.");
		}

		this.baseUrl = baseUrl.href.endsWith("/")
			? baseUrl.href
			: `${baseUrl.href}/`;
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.fetchImpl = fetchImpl;
		this.headers = new Headers(options.headers);
	}

	/**
	 * Search the official nutrition-calculator autocomplete endpoint.
	 * The official endpoint currently returns at most 10 entries.
	 */
	async searchProducts(
		query: string,
		options: RequestOptions = {},
	): Promise<ProductSearchResult[]> {
		const normalizedQuery = query.trim();
		if (!normalizedQuery) {
			throw new TypeError("query must not be empty.");
		}

		const url = this.makeUrl(
			"/mcdonalds_nutrition_calculator/autocomplete/articles",
		);
		url.searchParams.set("q", normalizedQuery);

		const { body } = await this.requestText(url, "application/json", options);
		let payload: unknown;
		try {
			payload = JSON.parse(body);
		} catch (cause) {
			throw new McDonaldsResponseError(
				"The McDonald's autocomplete endpoint returned invalid JSON.",
				{ cause },
			);
		}

		if (!Array.isArray(payload)) {
			throw new McDonaldsResponseError(
				"The McDonald's autocomplete response was not an array.",
			);
		}

		return payload.map((item, index) => parseSearchResult(item, index));
	}

	/**
	 * Resolve a query to one product. An exact normalized name wins; otherwise a
	 * single search result is accepted. Ambiguous queries are never guessed.
	 */
	async findProduct(
		query: string,
		options: RequestOptions = {},
	): Promise<ProductSearchResult> {
		const products = await this.searchProducts(query, options);
		if (products.length === 0) {
			throw new ProductNotFoundError(query);
		}

		const wanted = normalizeProductName(query);
		const exactMatches = products.filter(
			({ name }) => normalizeProductName(name) === wanted,
		);

		const exactMatch = exactMatches[0];
		if (exactMatches.length === 1 && exactMatch) {
			return exactMatch;
		}
		const onlyProduct = products[0];
		if (products.length === 1 && onlyProduct) {
			return onlyProduct;
		}

		throw new AmbiguousProductError(
			query,
			exactMatches.length > 1 ? exactMatches : products,
		);
	}

	/** Fetch nutrition by a search result, Drupal node ID, or numeric node ID. */
	async getNutrition(
		product:
			| ProductSearchResult
			| Pick<ProductSearchResult, "id">
			| string
			| number,
		options: RequestOptions = {},
	): Promise<ProductNutrition> {
		const id = parseProductId(
			typeof product === "object" ? product.id : product,
		);
		const url = this.makeUrl(`/node/${id}`);
		const page = await this.requestText(url, "text/html", options);
		return parseProductPage(page.body, page.responseUrl, this.baseUrl, id);
	}

	async getNutritionById(
		id: string | number,
		options: RequestOptions = {},
	): Promise<ProductNutrition> {
		return this.getNutrition(id, options);
	}

	/** Search by name, require an unambiguous result, then fetch its nutrition. */
	async getNutritionByName(
		query: string,
		options: RequestOptions = {},
	): Promise<ProductNutrition> {
		const product = await this.findProduct(query, options);
		return this.getNutrition(product, options);
	}

	/** Fetch a current menu product using the slug from /food-menu/{slug}. */
	async getNutritionBySlug(
		slug: string,
		options: RequestOptions = {},
	): Promise<ProductNutrition> {
		const normalizedSlug = slug.trim();
		if (
			!normalizedSlug ||
			normalizedSlug.includes("/") ||
			normalizedSlug === "." ||
			normalizedSlug === ".."
		) {
			throw new TypeError("slug must be one non-empty URL path segment.");
		}

		return this.getNutritionByPath(
			`/food-menu/${encodeURIComponent(normalizedSlug)}`,
			options,
		);
	}

	/**
	 * Fetch nutrition from an official same-origin product path. This also
	 * supports the few current products whose URLs are outside /food-menu/.
	 */
	async getNutritionByPath(
		path: string,
		options: RequestOptions = {},
	): Promise<ProductNutrition> {
		const normalizedPath = path.trim();
		if (!normalizedPath.startsWith("/") || normalizedPath.startsWith("//")) {
			throw new TypeError("path must be an absolute same-origin URL path.");
		}

		const url = this.makeUrl(normalizedPath);
		if (url.origin !== new URL(this.baseUrl).origin) {
			throw new TypeError(
				"path must resolve to the configured McDonald's origin.",
			);
		}

		const page = await this.requestText(url, "text/html", options);
		return parseProductPage(page.body, page.responseUrl, this.baseUrl);
	}

	/** List products currently rendered on the official Full Menu page. */
	async listProducts(options: RequestOptions = {}): Promise<MenuProduct[]> {
		const url = this.makeUrl("/full-menu");
		const { body } = await this.requestText(url, "text/html", options);
		return parseMenuPage(body, this.baseUrl);
	}

	/** List products rendered on one official /food-category/{slug} page. */
	async listProductsByCategory(
		categorySlug: string,
		options: RequestOptions = {},
	): Promise<MenuProduct[]> {
		const slug = categorySlug.trim();
		if (!slug || slug.includes("/") || slug === "." || slug === "..") {
			throw new TypeError(
				"categorySlug must be one non-empty URL path segment.",
			);
		}
		const url = this.makeUrl(`/food-category/${encodeURIComponent(slug)}`);
		const { body } = await this.requestText(url, "text/html", options);
		return parseMenuPage(body, this.baseUrl);
	}

	/**
	 * Fetch nutrition for every product currently on the Full Menu page.
	 * Results preserve menu order. Keep concurrency modest to be considerate to
	 * the official website.
	 */
	async getAllMenuNutrition(
		options: GetAllMenuNutritionOptions = {},
	): Promise<ProductNutrition[]> {
		const concurrency = options.concurrency ?? 4;
		if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
			throw new RangeError("concurrency must be an integer from 1 to 20.");
		}

		const products = await this.listProducts({ signal: options.signal });
		const results = new Array<ProductNutrition>(products.length);
		let nextIndex = 0;
		let completed = 0;

		const worker = async (): Promise<void> => {
			while (true) {
				if (options.signal?.aborted) {
					throw (
						options.signal.reason ?? new Error("The operation was aborted.")
					);
				}

				const index = nextIndex++;
				if (index >= products.length) {
					return;
				}

				const product = products[index];
				if (!product) return;
				const result = await this.getNutritionByPath(product.path, {
					signal: options.signal,
				});
				results[index] = result;
				completed += 1;
				options.onProgress?.({
					completed,
					total: products.length,
					product,
					result,
				});
			}
		};

		const workerCount = Math.min(concurrency, products.length);
		await Promise.all(Array.from({ length: workerCount }, () => worker()));
		return results;
	}

	private makeUrl(path: string): URL {
		return new URL(path, this.baseUrl);
	}

	private async requestText(
		url: URL,
		accept: string,
		options: RequestOptions,
	): Promise<TextResponse> {
		const controller = new AbortController();
		let timedOut = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const abortFromCaller = (): void => {
			controller.abort(options.signal?.reason);
		};

		if (options.signal?.aborted) {
			abortFromCaller();
		} else {
			options.signal?.addEventListener("abort", abortFromCaller, {
				once: true,
			});
		}

		if (this.timeoutMs > 0) {
			timer = setTimeout(() => {
				timedOut = true;
				controller.abort(
					new Error(`Request timed out after ${this.timeoutMs} ms.`),
				);
			}, this.timeoutMs);
		}

		const headers = new Headers(this.headers);
		if (!headers.has("accept")) {
			headers.set("accept", accept);
		}

		try {
			const response = await this.fetchImpl(url, {
				method: "GET",
				headers,
				signal: controller.signal,
			});
			const body = await response.text();

			if (!response.ok) {
				throw new McDonaldsHttpError(
					`McDonald's Singapore returned HTTP ${response.status} for ${url.href}.`,
					response.status,
					url.href,
				);
			}

			return {
				body,
				responseUrl: response.url || url.href,
			};
		} catch (cause) {
			if (cause instanceof McDonaldsNutritionError) {
				throw cause;
			}
			if (timedOut) {
				throw new McDonaldsNutritionError(
					`Request to ${url.href} timed out after ${this.timeoutMs} ms.`,
					{ cause },
				);
			}
			throw new McDonaldsNutritionError(`Unable to request ${url.href}.`, {
				cause,
			});
		} finally {
			if (timer !== undefined) {
				clearTimeout(timer);
			}
			options.signal?.removeEventListener("abort", abortFromCaller);
		}
	}
}

function parseSearchResult(item: unknown, index: number): ProductSearchResult {
	if (!isRecord(item)) {
		throw new McDonaldsResponseError(
			`Autocomplete item at index ${index} was not an object.`,
		);
	}

	const { id, label, value } = item;
	if (
		typeof id !== "string" ||
		!/^\d+$/.test(id) ||
		typeof label !== "string" ||
		typeof value !== "string"
	) {
		throw new McDonaldsResponseError(
			`Autocomplete item at index ${index} had an unexpected shape.`,
		);
	}

	return {
		id,
		name: normalizeWhitespace(label),
		value,
	};
}

function parseProductId(id: string | number): string {
	const value = typeof id === "number" ? String(id) : id.trim();
	if (!/^\d+$/.test(value)) {
		throw new TypeError(
			"product ID must contain digits only; use getNutritionByName() for a name.",
		);
	}
	if (typeof id === "number" && (!Number.isSafeInteger(id) || id < 0)) {
		throw new TypeError(
			"numeric product ID must be a non-negative safe integer.",
		);
	}
	return value;
}

function parseProductPage(
	html: string,
	responseUrl: string,
	baseUrl: string,
	expectedId?: string,
): ProductNutrition {
	const titleHtml = extractElementByClass(html, "h1", "product-details__title");
	const name = titleHtml ? htmlToText(titleHtml) : "";
	if (!name) {
		throw new McDonaldsResponseError(
			`The page at ${responseUrl} did not contain a product title.`,
		);
	}

	const idMatch = html.match(/"currentPath"\s*:\s*"node\\?\/(\d+)"/i);
	const id = idMatch?.[1] ?? expectedId;
	if (!id) {
		throw new McDonaldsResponseError(
			`The page at ${responseUrl} did not expose a product node ID.`,
		);
	}

	const canonicalUrl = extractCanonicalUrl(html, baseUrl) ?? responseUrl;
	const descriptionHtml = extractElementByClass(
		html,
		"div",
		"product-details__description",
	);
	const description = descriptionHtml
		? htmlToText(descriptionHtml) || null
		: null;

	const figureHtml = extractElementByClass(
		html,
		"figure",
		"product-details__image",
	);
	const imageTag = figureHtml?.match(/<img\b[^>]*>/i)?.[0];
	const imageSource = imageTag ? getHtmlAttribute(imageTag, "src") : null;
	const imageUrl = imageSource
		? new URL(decodeHtmlEntities(imageSource), baseUrl).href
		: null;

	return {
		id,
		name,
		description,
		imageUrl,
		url: canonicalUrl,
		nutrition: parseNutritionTable(html, responseUrl),
	};
}

function parseNutritionTable(
	html: string,
	responseUrl: string,
): NutritionFacts {
	const headingMatch = /<h3\b[^>]*>\s*Nutrition Facts\s*<\/h3>/i.exec(html);
	if (!headingMatch || headingMatch.index === undefined) {
		throw new McDonaldsResponseError(
			`The page at ${responseUrl} did not contain a Nutrition Facts section.`,
		);
	}

	const afterHeading = html.slice(headingMatch.index + headingMatch[0].length);
	const tableHtml = afterHeading.match(
		/<table\b[^>]*>([\s\S]*?)<\/table>/i,
	)?.[1];
	if (!tableHtml) {
		throw new McDonaldsResponseError(
			`The page at ${responseUrl} did not contain a nutrition table.`,
		);
	}

	const nutrients = new Map<string, ParsedNutrient>();
	for (const rowMatch of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
		const rowHtml = rowMatch[1];
		if (!rowHtml) continue;
		const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
		const labelHtml = cells[0]?.[1];
		const valueHtml = cells[1]?.[1];
		if (labelHtml === undefined || valueHtml === undefined) continue;

		const label = htmlToText(labelHtml).toLocaleLowerCase("en");
		const rawValue = htmlToText(valueHtml).replaceAll(",", "");
		const valueMatch = rawValue.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/);
		if (!valueMatch) {
			throw new McDonaldsResponseError(
				`The ${label || "unknown"} nutrient at ${responseUrl} was not numeric.`,
			);
		}

		const value = Number(valueMatch[0]);
		const unit = rawValue
			.slice((valueMatch.index ?? 0) + valueMatch[0].length)
			.trim()
			.toLowerCase();
		nutrients.set(label, { value, unit });
	}

	const read = (labels: readonly string[], expectedUnit: string): number => {
		const nutrient = labels
			.map((label) => nutrients.get(label))
			.find((entry): entry is ParsedNutrient => entry !== undefined);
		if (!nutrient) {
			throw new McDonaldsResponseError(
				`The page at ${responseUrl} was missing ${labels[0]}.`,
			);
		}
		if (nutrient.unit !== expectedUnit) {
			throw new McDonaldsResponseError(
				`The page at ${responseUrl} used unexpected unit ${JSON.stringify(nutrient.unit)} for ${labels[0]}.`,
			);
		}
		return nutrient.value;
	};

	return {
		energyKcal: read(["energy"], "kcal"),
		proteinG: read(["protein"], "g"),
		totalFatG: read(["total fat"], "g"),
		saturatedFatG: read(["saturated fat"], "g"),
		cholesterolMg: read(["cholesterol"], "mg"),
		carbohydratesG: read(["carbohydrates", "carbohydrate"], "g"),
		dietaryFibreG: read(
			["dietary fibres", "dietary fibre", "dietary fibers", "dietary fiber"],
			"g",
		),
		sodiumMg: read(["sodium"], "mg"),
	};
}

function parseMenuPage(html: string, baseUrl: string): MenuProduct[] {
	const products: MenuProduct[] = [];
	const seenPaths = new Set<string>();
	const itemPattern =
		/<li\b[^>]*class=(['"])[^'"]*\bcategory-item\b[^'"]*\1[^>]*>([\s\S]*?)<\/li>/gi;

	for (const itemMatch of html.matchAll(itemPattern)) {
		const itemHtml = itemMatch[2];
		if (!itemHtml) continue;
		const nameMatch =
			/<span\b[^>]*class=(['"])[^'"]*\bcategory-item__name\b[^'"]*\1[^>]*>[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>[\s\S]*?<\/span>/i.exec(
				itemHtml,
			);
		if (!nameMatch) {
			continue;
		}

		const nameAttributes = nameMatch[2];
		const nameHtml = nameMatch[3];
		if (nameAttributes === undefined || nameHtml === undefined) continue;
		const rawPath = getHtmlAttribute(`<a ${nameAttributes}>`, "href");
		if (!rawPath) {
			continue;
		}

		const productUrl = new URL(decodeHtmlEntities(rawPath), baseUrl);
		if (productUrl.origin !== new URL(baseUrl).origin) {
			continue;
		}

		const path = productUrl.pathname;
		if (seenPaths.has(path)) {
			continue;
		}

		const encodedSlug = path.replace(/\/$/, "").split("/").at(-1) ?? "";
		if (!encodedSlug) {
			continue;
		}

		let slug: string;
		try {
			slug = decodeURIComponent(encodedSlug);
		} catch {
			slug = encodedSlug;
		}

		const imageTag = itemHtml.match(/<img\b[^>]*>/i)?.[0];
		const imageSource = imageTag ? getHtmlAttribute(imageTag, "src") : null;

		seenPaths.add(path);
		products.push({
			name: htmlToText(nameHtml),
			slug,
			path,
			url: productUrl.href,
			imageUrl: imageSource
				? new URL(decodeHtmlEntities(imageSource), baseUrl).href
				: null,
		});
	}

	if (products.length === 0) {
		throw new McDonaldsResponseError(
			"The McDonald's Full Menu page did not contain any products.",
		);
	}

	return products;
}

function extractElementByClass(
	html: string,
	tagName: string,
	className: string,
): string | null {
	const escapedTag = escapeRegExp(tagName);
	const escapedClass = escapeRegExp(className);
	const pattern = new RegExp(
		`<${escapedTag}\\b[^>]*class=["'][^"']*\\b${escapedClass}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${escapedTag}>`,
		"i",
	);
	return pattern.exec(html)?.[1] ?? null;
}

function extractCanonicalUrl(html: string, baseUrl: string): string | null {
	for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
		const tag = match[0];
		const rel = getHtmlAttribute(tag, "rel");
		if (rel?.toLowerCase().split(/\s+/).includes("canonical")) {
			const href = getHtmlAttribute(tag, "href");
			if (href) {
				return new URL(decodeHtmlEntities(href), baseUrl).href;
			}
		}
	}
	return null;
}

function getHtmlAttribute(tag: string, name: string): string | null {
	const pattern = new RegExp(
		`\\b${escapeRegExp(name)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`,
		"i",
	);
	return pattern.exec(tag)?.[2] ?? null;
}

function htmlToText(value: string): string {
	return normalizeWhitespace(
		decodeHtmlEntities(value.replace(/<[^>]*>/g, " ")),
	);
}

function decodeHtmlEntities(value: string): string {
	const namedEntities: Readonly<Record<string, string>> = {
		amp: "&",
		apos: "'",
		gt: ">",
		lt: "<",
		nbsp: " ",
		quot: '"',
		reg: "®",
		trade: "™",
	};

	return value.replace(
		/&(#(?:x[\da-f]+|\d+)|[a-z][\da-z]+);/gi,
		(entity, body: string) => {
			if (body[0] === "#") {
				const hexadecimal = body[1]?.toLowerCase() === "x";
				const digits = body.slice(hexadecimal ? 2 : 1);
				const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
				if (
					Number.isInteger(codePoint) &&
					codePoint >= 0 &&
					codePoint <= 0x10ffff
				) {
					try {
						return String.fromCodePoint(codePoint);
					} catch {
						return entity;
					}
				}
				return entity;
			}
			return namedEntities[body.toLowerCase()] ?? entity;
		},
	);
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function normalizeProductName(value: string): string {
	return normalizeWhitespace(
		value
			.normalize("NFKD")
			.replace(/\p{Mark}/gu, "")
			.replace(/[®™©]/g, "")
			.replace(/[^\p{Letter}\p{Number}]+/gu, " ")
			.toLocaleLowerCase("en"),
	);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
