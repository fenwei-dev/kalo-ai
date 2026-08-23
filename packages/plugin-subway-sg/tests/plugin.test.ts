import { expect, test } from "bun:test";
import {
	getSubwaySGProduct,
	listSubwaySGProducts,
	SUBWAY_SG_CATEGORIES,
	subwaySGDatasetMetadata,
	subwaySGProducts,
} from "../src/index.ts";

test("bundled nutrition snapshot is complete and internally valid", () => {
	expect(subwaySGDatasetMetadata.schemaVersion).toBe(1);
	expect(subwaySGDatasetMetadata.productCount).toBeGreaterThanOrEqual(20);
	expect(new Set(subwaySGProducts.map((product) => product.id)).size).toBe(
		subwaySGProducts.length,
	);
	for (const product of subwaySGProducts) {
		expect(product.name.length).toBeGreaterThan(0);
		expect(product.url.startsWith("https://subwayisfresh.com.sg/")).toBe(true);
		expect(SUBWAY_SG_CATEGORIES.includes(product.category)).toBe(true);
		expect(product.servingSizeG).toBeGreaterThan(0);
		for (const value of Object.values(product.nutrition)) {
			expect(Number.isFinite(value)).toBe(true);
			expect(value).toBeGreaterThanOrEqual(0);
		}
	}
});

test("full list returns only exact product names and IDs", () => {
	const products = listSubwaySGProducts();
	expect(products).toHaveLength(subwaySGProducts.length);
	expect(products).toEqual(
		subwaySGProducts.map((product) => ({ id: product.id, name: product.name })),
	);
	const first = products[0];
	if (!first) throw new Error("Nutrition snapshot is empty");
	expect(getSubwaySGProduct(first.id)?.name).toBe(first.name);
});

test("each menu category filters to matching products", () => {
	for (const category of SUBWAY_SG_CATEGORIES) {
		const listed = listSubwaySGProducts(category);
		expect(listed.length).toBeGreaterThan(0);
		expect(
			listed.every(
				(item) => getSubwaySGProduct(item.id)?.category === category,
			),
		).toBe(true);
	}
});

test("every listed product has the core values needed for food logging", () => {
	for (const product of subwaySGProducts) {
		expect(Number.isFinite(product.nutrition.energyKcal)).toBe(true);
		expect(Number.isFinite(product.nutrition.proteinG)).toBe(true);
		expect(Number.isFinite(product.nutrition.totalFatG)).toBe(true);
		expect(Number.isFinite(product.nutrition.carbohydratesG)).toBe(true);
	}
});
