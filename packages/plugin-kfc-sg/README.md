# @kalo-ai/plugin-kfc-sg

Build-time Kalo plugin providing KFC Singapore nutrition and allergen data to the Agent from a bundled static snapshot.

## Agent tools

- `kfc_sg_listProducts` — returns exact `{ id, name, servingSize, servingUnit }` records for the required category scope; use `all` for the complete bundled nutrition-page index. Serving details distinguish official duplicate names and variants.
- `kfc_sg_getNutrition` — returns the complete nutrition and allergen record for one exact listed ID.

The plugin is enabled by default and performs no browser network requests. Data comes from `data/products.json`.

`category` is required. Use `all` to return the complete bundled nutrition-page index in one call, or one of the concrete normalized categories to narrow the result:

```text
all
chicken
burgers
wraps
bowls
sides
desserts
breakfast
kids
beverages
sauces
```

## Updating data

```bash
bun run --filter @kalo-ai/plugin-kfc-sg update-data
```

The updater:

1. reads the official page at <https://www.kfc.com.sg/nutritionandallergen>;
2. discovers the current Angular runtime, main bundle, and lazy nutrition-page chunk;
3. extracts the nutrition dataset embedded in that public application chunk (the separate content API rejects unauthenticated requests);
4. parses serving units, optional fields, and published allergens;
5. creates stable IDs, merges identical duplicate records, and normalizes broad categories and allergen labels;
6. validates product count, unique IDs, category coverage, and non-negative numeric values;
7. sorts deterministically and writes the snapshot only when normalized data changed.

The scheduled GitHub Actions workflow runs this command and opens a pull request only when the snapshot changes.

## Data notice

Values and allergen labels represent the information published by KFC Singapore. Actual preparation, shared-kitchen cross-contact, suppliers, recipes, portions, and availability may differ. Allergen data is informational and is not a medical guarantee; people with allergies should confirm directly with KFC Singapore. This project is not affiliated with or endorsed by KFC; names and trademarks belong to their respective owners.
