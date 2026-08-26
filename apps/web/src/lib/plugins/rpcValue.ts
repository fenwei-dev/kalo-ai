const MAX_VISITED_NODES = 10_000;

export function structuredValueSize(value: unknown): number {
	const seen = new Set<object>();
	let nodes = 0;
	function visit(item: unknown): number {
		nodes += 1;
		if (nodes > MAX_VISITED_NODES) throw new Error("RPC 数据结构过于复杂");
		if (item === null || item === undefined) return 1;
		if (typeof item === "boolean") return 1;
		if (typeof item === "number") return 8;
		if (typeof item === "string")
			return new TextEncoder().encode(item).byteLength;
		if (
			typeof item === "bigint" ||
			typeof item === "symbol" ||
			typeof item === "function"
		) {
			throw new Error("RPC 数据包含不支持的类型");
		}
		if (item instanceof ArrayBuffer) return item.byteLength;
		if (ArrayBuffer.isView(item)) return item.byteLength;
		if (typeof Blob !== "undefined" && item instanceof Blob) return item.size;
		if (typeof item !== "object") throw new Error("RPC 数据类型无效");
		if (seen.has(item)) throw new Error("RPC 数据不能包含循环引用");
		seen.add(item);
		let total = 0;
		if (Array.isArray(item)) {
			for (const value of item) total += visit(value);
		} else {
			for (const [key, value] of Object.entries(item)) {
				total += new TextEncoder().encode(key).byteLength + visit(value);
			}
		}
		seen.delete(item);
		return total;
	}
	return visit(value);
}

export function isJsonRpcValue(value: unknown): boolean {
	try {
		if (
			value instanceof ArrayBuffer ||
			ArrayBuffer.isView(value) ||
			(typeof Blob !== "undefined" && value instanceof Blob)
		) {
			return false;
		}
		JSON.stringify(value, (_key, item) => {
			if (
				typeof item === "bigint" ||
				typeof item === "function" ||
				typeof item === "symbol"
			) {
				throw new Error("unsupported");
			}
			if (
				item instanceof ArrayBuffer ||
				ArrayBuffer.isView(item) ||
				(typeof Blob !== "undefined" && item instanceof Blob)
			) {
				throw new Error("binary");
			}
			return item;
		});
		structuredValueSize(value);
		return true;
	} catch {
		return false;
	}
}
