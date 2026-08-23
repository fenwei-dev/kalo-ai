# @kalo-ai/plugin-mcdonalds-sg

Build-time Kalo plugin providing McDonald's Singapore product nutrition to the Agent from a bundled static snapshot.

## Agent tools

- `mcdonalds_sg_listProducts` — returns every exact `{ id, name }` pair, optionally filtered by one official category.
- `mcdonalds_sg_getNutrition` — returns the complete nutrition table for one exact listed ID.

The plugin is enabled by default and performs no browser network requests. Data comes from `data/products.json`.

Supported category filters:

```text
beverages
breakfast
burgers
chicken
desserts
eat-light-under-500-calories
for-the-family
sharing
salads-and-wraps
sides
```

Omitting `category` returns the Full Menu, including products such as sauces that are not listed under one of those category pages.

## Updating data

```bash
bun run --filter @kalo-ai/plugin-mcdonalds-sg update-data
```

The updater:

1. reads the official Full Menu from <https://www.mcdonalds.com.sg/full-menu>;
2. fetches each official product page with low controlled concurrency;
3. reads all 10 official category pages and records multi-category membership;
4. validates product count, IDs, origin, categories, and non-negative nutrient values;
5. normalizes and sorts products deterministically;
6. writes the snapshot only when normalized product data changed.

Set `MCD_CONCURRENCY` to an integer from 1 to 8 to override the default of 3.

The scheduled GitHub Actions workflow runs this command and opens a pull request only when the snapshot changes.

## Data notice

Nutrition values represent the standard product serving published by McDonald's Singapore. Actual preparation, suppliers, seasonal availability, and recipes may differ. This project is not affiliated with or endorsed by McDonald's; names and trademarks belong to their respective owners.
