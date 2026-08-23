import { expect, test } from "bun:test";
import exampleDefault, {
	kaloPlugin as exampleKaloPlugin,
	examplePlugin,
} from "@kalo-ai/plugin-example";
import kfcDefault, {
	kaloPlugin as kfcKaloPlugin,
	kfcSGPlugin,
} from "@kalo-ai/plugin-kfc-sg";
import mcdonaldsDefault, {
	kaloPlugin as mcdonaldsKaloPlugin,
	mcdonaldsSGPlugin,
} from "@kalo-ai/plugin-mcdonalds-sg";
import subwayDefault, {
	kaloPlugin as subwayKaloPlugin,
	subwaySGPlugin,
} from "@kalo-ai/plugin-subway-sg";
import examplePackage from "../../../packages/plugin-example/package.json";
import kfcPackage from "../../../packages/plugin-kfc-sg/package.json";
import mcdonaldsPackage from "../../../packages/plugin-mcdonalds-sg/package.json";
import sdkJsrPackage from "../../../packages/plugin-sdk/deno.json";
import sdkNpmPackage from "../../../packages/plugin-sdk/package.json";
import subwayPackage from "../../../packages/plugin-subway-sg/package.json";

test("bundled plugin packages expose the standard remote package entry points", () => {
	expect(exampleDefault).toBe(examplePlugin);
	expect(exampleKaloPlugin).toBe(examplePlugin);
	expect(mcdonaldsDefault).toBe(mcdonaldsSGPlugin);
	expect(mcdonaldsKaloPlugin).toBe(mcdonaldsSGPlugin);
	expect(subwayDefault).toBe(subwaySGPlugin);
	expect(subwayKaloPlugin).toBe(subwaySGPlugin);
	expect(kfcDefault).toBe(kfcSGPlugin);
	expect(kfcKaloPlugin).toBe(kfcSGPlugin);
});

test("plugin manifests and dual SDK registry metadata keep matching versions", () => {
	expect(examplePlugin.manifest.version).toBe(examplePackage.version);
	expect(mcdonaldsSGPlugin.manifest.version).toBe(mcdonaldsPackage.version);
	expect(subwaySGPlugin.manifest.version).toBe(subwayPackage.version);
	expect(kfcSGPlugin.manifest.version).toBe(kfcPackage.version);
	expect(sdkNpmPackage.version).toBe(sdkJsrPackage.version);
});
