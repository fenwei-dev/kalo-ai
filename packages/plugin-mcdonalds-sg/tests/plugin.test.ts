import { expect, test } from "bun:test";
import {
	getMcDonaldsSGProduct,
	listMcDonaldsSGProducts,
	MCDONALDS_SG_CATEGORIES,
	mcdonaldsSGDatasetMetadata,
	mcdonaldsSGProducts,
} from "../src/index.ts";

test("bundled nutrition snapshot is complete and internally valid", () => {
	expect(mcdonaldsSGDatasetMetadata.schemaVersion).toBe(2);
	expect(mcdonaldsSGDatasetMetadata.productCount).toBeGreaterThanOrEqual(20);
	expect(new Set(mcdonaldsSGProducts.map((product) => product.id)).size).toBe(
		mcdonaldsSGProducts.length,
	);
	for (const product of mcdonaldsSGProducts) {
		expect(product.name.length).toBeGreaterThan(0);
		expect(product.url.startsWith("https://www.mcdonalds.com.sg/")).toBe(true);
		expect(
			product.categories.every((category) =>
				MCDONALDS_SG_CATEGORIES.includes(category),
			),
		).toBe(true);
		for (const value of Object.values(product.nutrition)) {
			expect(Number.isFinite(value)).toBe(true);
			expect(value).toBeGreaterThanOrEqual(0);
		}
	}
});

test("full list returns only exact product names and IDs", () => {
	const products = listMcDonaldsSGProducts("all");
	expect(products).toHaveLength(mcdonaldsSGProducts.length);
	expect(products).toEqual(
		mcdonaldsSGProducts.map((product) => ({
			id: product.id,
			name: product.name,
		})),
	);
	const first = products[0];
	if (!first) throw new Error("Nutrition snapshot is empty");
	expect(getMcDonaldsSGProduct(first.id)?.name).toBe(first.name);
});

test("each official category filters to products carrying that category", () => {
	for (const category of MCDONALDS_SG_CATEGORIES) {
		const listed = listMcDonaldsSGProducts(category);
		expect(listed.length).toBeGreaterThan(0);
		expect(
			listed.every((item) =>
				getMcDonaldsSGProduct(item.id)?.categories.includes(category),
			),
		).toBe(true);
	}
});

test("list preserves size variants instead of guessing one", () => {
	const fries = listMcDonaldsSGProducts("sides").filter((product) =>
		product.name.includes("French Fries"),
	);
	expect(fries.length).toBeGreaterThanOrEqual(2);
	expect(new Set(fries.map((product) => product.id)).size).toBe(fries.length);
});
