import type { PluginJsonObject } from "@kalo-ai/plugin-sdk";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";

const MAX_SCHEMA_BYTES = 64 * 1024;
const MAX_SCHEMA_DEPTH = 16;
const MAX_SCHEMA_NODES = 512;
const MAX_PROPERTIES = 64;
const MAX_REQUIRED = 64;
const MAX_ENUM_VALUES = 100;
const MAX_TEXT_LENGTH = 10_000;
const PROPERTY_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/;
const ALLOWED_KEYS = new Set([
	"type",
	"properties",
	"required",
	"additionalProperties",
	"items",
	"anyOf",
	"oneOf",
	"allOf",
	"enum",
	"const",
	"minimum",
	"maximum",
	"exclusiveMinimum",
	"exclusiveMaximum",
	"multipleOf",
	"minLength",
	"maxLength",
	"minItems",
	"maxItems",
	"minProperties",
	"maxProperties",
	"description",
	"title",
	"default",
]);
const ALLOWED_TYPES = new Set([
	"object",
	"array",
	"string",
	"number",
	"integer",
	"boolean",
	"null",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonBytes(value: unknown): number {
	try {
		return new TextEncoder().encode(JSON.stringify(value)).byteLength;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

function finiteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function nonNegativeInteger(value: unknown): boolean {
	return finiteNumber(value) && Number.isInteger(value) && value >= 0;
}

function validateSchemaNode(
	schema: unknown,
	depth: number,
	counter: { nodes: number },
): void {
	if (!isRecord(schema)) throw new Error("schema node 必须是对象");
	if (depth > MAX_SCHEMA_DEPTH) throw new Error("schema 深度超过限制");
	counter.nodes += 1;
	if (counter.nodes > MAX_SCHEMA_NODES)
		throw new Error("schema 节点数超过限制");
	for (const key of Object.keys(schema)) {
		if (!ALLOWED_KEYS.has(key)) {
			throw new Error(`用户插件 schema 不允许 keyword：${key}`);
		}
	}
	if (schema.type !== undefined) {
		if (typeof schema.type !== "string" || !ALLOWED_TYPES.has(schema.type)) {
			throw new Error("schema type 无效");
		}
	}
	if (schema.description !== undefined) {
		if (
			typeof schema.description !== "string" ||
			schema.description.length > MAX_TEXT_LENGTH
		) {
			throw new Error("schema description 无效或过长");
		}
	}
	if (schema.title !== undefined) {
		if (typeof schema.title !== "string" || schema.title.length > 200) {
			throw new Error("schema title 无效或过长");
		}
	}
	if (schema.properties !== undefined) {
		if (!isRecord(schema.properties)) throw new Error("schema properties 无效");
		const entries = Object.entries(schema.properties);
		if (entries.length > MAX_PROPERTIES)
			throw new Error("schema properties 过多");
		for (const [key, child] of entries) {
			if (!PROPERTY_NAME_PATTERN.test(key)) {
				throw new Error(`schema property 名称无效：${key}`);
			}
			validateSchemaNode(child, depth + 1, counter);
		}
	}
	if (schema.required !== undefined) {
		if (
			!Array.isArray(schema.required) ||
			schema.required.length > MAX_REQUIRED ||
			!schema.required.every(
				(value) =>
					typeof value === "string" && PROPERTY_NAME_PATTERN.test(value),
			) ||
			new Set(schema.required).size !== schema.required.length
		) {
			throw new Error("schema required 无效");
		}
	}
	if (schema.additionalProperties !== undefined) {
		if (typeof schema.additionalProperties !== "boolean") {
			validateSchemaNode(schema.additionalProperties, depth + 1, counter);
		}
	}
	if (schema.items !== undefined) {
		validateSchemaNode(schema.items, depth + 1, counter);
	}
	for (const key of ["anyOf", "oneOf", "allOf"] as const) {
		const branches = schema[key];
		if (branches === undefined) continue;
		if (
			!Array.isArray(branches) ||
			branches.length === 0 ||
			branches.length > 32
		) {
			throw new Error(`schema ${key} 无效`);
		}
		for (const branch of branches)
			validateSchemaNode(branch, depth + 1, counter);
	}
	if (schema.enum !== undefined) {
		if (!Array.isArray(schema.enum) || schema.enum.length > MAX_ENUM_VALUES) {
			throw new Error("schema enum 无效或过大");
		}
		if (jsonBytes(schema.enum) > MAX_TEXT_LENGTH) {
			throw new Error("schema enum 数据过大");
		}
	}
	for (const key of [
		"minimum",
		"maximum",
		"exclusiveMinimum",
		"exclusiveMaximum",
		"multipleOf",
	] as const) {
		if (schema[key] !== undefined && !finiteNumber(schema[key])) {
			throw new Error(`schema ${key} 无效`);
		}
	}
	for (const key of [
		"minLength",
		"maxLength",
		"minItems",
		"maxItems",
		"minProperties",
		"maxProperties",
	] as const) {
		if (schema[key] !== undefined && !nonNegativeInteger(schema[key])) {
			throw new Error(`schema ${key} 无效`);
		}
	}
}

export function assertSafePluginSchema(
	schema: unknown,
): asserts schema is TSchema {
	if (jsonBytes(schema) > MAX_SCHEMA_BYTES) {
		throw new Error("用户插件 schema 超过 64 KiB 限制");
	}
	validateSchemaNode(schema, 0, { nodes: 0 });
}

export function safeCheckPluginConfig(
	schema: TSchema,
	config: PluginJsonObject,
): boolean {
	try {
		assertSafePluginSchema(schema);
		return Value.Check(schema, config);
	} catch {
		return false;
	}
}
