import { expect, test } from "bun:test";
import {
	getKFCSGProduct,
	KFC_SG_CATEGORIES,
	kfcSGDatasetMetadata,
	kfcSGProducts,
	listKFCSGProducts,
} from "../src/index.ts";

test("bundled nutrition snapshot is complete and internally valid", () => {
	expect(kfcSGDatasetMetadata.schemaVersion).toBe(1);
	expect(kfcSGDatasetMetadata.productCount).toBeGreaterThanOrEqual(50);
	expect(new Set(kfcSGProducts.map((product) => product.id)).size).toBe(
		kfcSGProducts.length,
	);
	for (const product of kfcSGProducts) {
		expect(product.name.length).toBeGreaterThan(0);
		expect(product.servingSize).toBeGreaterThan(0);
		expect(["g", "ml"]).toContain(product.servingUnit);
		expect(
			product.categories.every((category) =>
				KFC_SG_CATEGORIES.includes(category),
			),
		).toBe(true);
		for (const value of Object.values(product.nutrition)) {
			expect(Number.isFinite(value)).toBe(true);
			expect(value).toBeGreaterThanOrEqual(0);
		}
	}
});

test("full list returns exact IDs, names, and serving details", () => {
	const products = listKFCSGProducts();
	expect(products).toHaveLength(kfcSGProducts.length);
	expect(products).toEqual(
		kfcSGProducts.map((product) => ({
			id: product.id,
			name: product.name,
			servingSize: product.servingSize,
			servingUnit: product.servingUnit,
		})),
	);
	const first = products[0];
	if (!first) throw new Error("Nutrition snapshot is empty");
	expect(getKFCSGProduct(first.id)?.name).toBe(first.name);
});

test("each normalized category filters to products carrying that category", () => {
	for (const category of KFC_SG_CATEGORIES) {
		const listed = listKFCSGProducts(category);
		expect(listed.length).toBeGreaterThan(0);
		expect(
			listed.every((item) =>
				getKFCSGProduct(item.id)?.categories.includes(category),
			),
		).toBe(true);
	}
});

test("allergen placeholders and known aliases are normalized", () => {
	const allergens = new Set(
		kfcSGProducts.flatMap((product) => product.allergens),
	);
	expect(allergens.size).toBeGreaterThan(0);
	for (const placeholder of ["NA", "N/A", "Egg", "Dairy", "Soybean"]) {
		expect(allergens).not.toContain(placeholder);
	}
});
