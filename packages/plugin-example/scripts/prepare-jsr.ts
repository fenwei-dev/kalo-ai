import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const outputRoot = resolve(packageRoot, ".jsr-publish");
const packageJson = JSON.parse(
	await readFile(resolve(packageRoot, "package.json"), "utf8"),
);
const sdkRange = packageJson.dependencies?.["@kalo-ai/plugin-sdk"];
if (typeof sdkRange !== "string" || !/^\^?\d+\.\d+\.\d+/.test(sdkRange)) {
	throw new Error("@kalo-ai/plugin-sdk must use an explicit semver range");
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await Promise.all([
	cp(resolve(packageRoot, "src"), resolve(outputRoot, "src"), {
		recursive: true,
	}),
	cp(resolve(packageRoot, "README.md"), resolve(outputRoot, "README.md")),
	cp(resolve(packageRoot, "LICENSE"), resolve(outputRoot, "LICENSE")),
	cp(resolve(packageRoot, "jsr.json"), resolve(outputRoot, "jsr.json")),
]);

let replacements = 0;
async function rewriteDirectory(directory: string): Promise<void> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const filePath = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			await rewriteDirectory(filePath);
			continue;
		}
		if (!entry.name.endsWith(".ts")) continue;
		const source = await readFile(filePath, "utf8");
		const rewritten = source.replaceAll(
			'"@kalo-ai/plugin-sdk"',
			`"jsr:@kalo-ai/plugin-sdk@${sdkRange}"`,
		);
		if (rewritten !== source) {
			replacements += 1;
			await writeFile(filePath, rewritten);
		}
	}
}
await rewriteDirectory(resolve(outputRoot, "src"));
if (replacements === 0) {
	throw new Error("No @kalo-ai/plugin-sdk imports were rewritten for JSR");
}
console.log(`Prepared JSR source in ${outputRoot}`);
