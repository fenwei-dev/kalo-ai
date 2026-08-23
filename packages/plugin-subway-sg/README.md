# @kalo-ai/plugin-subway-sg

Build-time Kalo plugin providing Subway Singapore nutrition to the Agent from a bundled static snapshot.

## Agent tools

- `subway_sg_listProducts` — returns exact `{ id, name }` pairs for the required category scope; use `all` for the complete bundled nutrition-product index.
- `subway_sg_getNutrition` — returns the complete nutrition table for one exact listed ID.

The plugin is enabled by default and performs no browser network requests. Data comes from `data/products.json`. Products for which Subway Singapore does not publish a nutrition table are intentionally excluded.

`category` is required. Use `all` to return the complete bundled nutrition-product index in one call, or one of the concrete categories to narrow the result:

```text
all
sandwich
breakfast
energy-bowls
sides
```

## Updating data

```bash
bun run --filter @kalo-ai/plugin-subway-sg update-data
```

The updater:

1. reads the official menu at <https://subwayisfresh.com.sg/menu/>;
2. excludes menu cards marked as having no nutrition information;
3. fetches each remaining official product page with low controlled concurrency;
4. parses the published serving size and nutrient table;
5. validates product count, IDs, origin, category coverage, and numeric values;
6. normalizes and sorts products deterministically;
7. writes the snapshot only when normalized product data changed.

Set `SUBWAY_CONCURRENCY` to an integer from 1 to 6 to override the default of 3.

The scheduled GitHub Actions workflow runs this command and opens a pull request only when the snapshot changes.

## Data notice

Values represent the standard recipe and serving published by Subway Singapore. Bread, cheese, vegetables, sauces, add-ons, portions, recipes, and availability can change the result. Subway Singapore states that Footlong sandwich values are approximately double the listed standard Sub values. This project is not affiliated with or endorsed by Subway; names and trademarks belong to their respective owners.
