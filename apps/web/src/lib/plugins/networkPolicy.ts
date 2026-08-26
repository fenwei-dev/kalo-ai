const IPV4_PART_PATTERN = /^\d{1,3}$/;
const HEX_PART_PATTERN = /^[0-9a-f]{1,4}$/i;

function parseIpv4(value: string): number[] | null {
	const parts = value.split(".");
	if (
		parts.length !== 4 ||
		!parts.every(
			(part) =>
				IPV4_PART_PATTERN.test(part) &&
				Number(part) >= 0 &&
				Number(part) <= 255,
		)
	) {
		return null;
	}
	return parts.map(Number);
}

function parseIpv6(value: string): number[] | null {
	let input = value.toLowerCase();
	if (input.startsWith("[") && input.endsWith("]")) input = input.slice(1, -1);
	const zoneIndex = input.indexOf("%");
	if (zoneIndex >= 0) input = input.slice(0, zoneIndex);
	let ipv4Tail: number[] | null = null;
	const lastColon = input.lastIndexOf(":");
	const tail = input.slice(lastColon + 1);
	if (tail.includes(".")) {
		ipv4Tail = parseIpv4(tail);
		if (!ipv4Tail) return null;
		input = `${input.slice(0, lastColon)}:${(
			(ipv4Tail[0] << 8) | ipv4Tail[1]
		).toString(16)}:${((ipv4Tail[2] << 8) | ipv4Tail[3]).toString(16)}`;
	}
	if ((input.match(/::/g) ?? []).length > 1) return null;
	const [leftRaw, rightRaw] = input.split("::");
	const left = leftRaw ? leftRaw.split(":") : [];
	const right = rightRaw ? rightRaw.split(":") : [];
	if (
		![...left, ...right].every((part) => HEX_PART_PATTERN.test(part)) ||
		(input.includes("::") ? left.length + right.length >= 8 : left.length !== 8)
	) {
		return null;
	}
	const missing = input.includes("::") ? 8 - left.length - right.length : 0;
	const words = [
		...left.map((part) => Number.parseInt(part, 16)),
		...Array.from({ length: missing }, () => 0),
		...right.map((part) => Number.parseInt(part, 16)),
	];
	if (words.length !== 8) return null;
	return words.flatMap((word) => [word >> 8, word & 0xff]);
}

function prefixMatches(
	bytes: readonly number[],
	prefix: readonly number[],
	bits: number,
): boolean {
	const wholeBytes = Math.floor(bits / 8);
	for (let index = 0; index < wholeBytes; index += 1) {
		if (bytes[index] !== (prefix[index] ?? 0)) return false;
	}
	const remainder = bits % 8;
	if (remainder === 0) return true;
	const mask = (0xff << (8 - remainder)) & 0xff;
	return (
		((bytes[wholeBytes] ?? 0) & mask) === ((prefix[wholeBytes] ?? 0) & mask)
	);
}

const BLOCKED_IPV4: readonly [readonly number[], number][] = [
	[[0, 0, 0, 0], 8],
	[[10, 0, 0, 0], 8],
	[[100, 64, 0, 0], 10],
	[[127, 0, 0, 0], 8],
	[[169, 254, 0, 0], 16],
	[[172, 16, 0, 0], 12],
	[[192, 0, 0, 0], 24],
	[[192, 0, 2, 0], 24],
	[[192, 88, 99, 0], 24],
	[[192, 168, 0, 0], 16],
	[[198, 18, 0, 0], 15],
	[[198, 51, 100, 0], 24],
	[[203, 0, 113, 0], 24],
	[[224, 0, 0, 0], 4],
	[[240, 0, 0, 0], 4],
];

const BLOCKED_IPV6: readonly [readonly number[], number][] = [
	[[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 128],
	[[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 128],
	[[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff], 96],
	[[0x01, 0x00], 64],
	[[0x20, 0x01, 0x0d, 0xb8], 32],
	[[0xfc], 7],
	[[0xfe, 0x80], 10],
	[[0xff], 8],
];

export function isBlockedPluginHostname(hostname: string): boolean {
	let normalized = hostname.trim().toLowerCase();
	if (normalized.endsWith(".")) normalized = normalized.slice(0, -1);
	if (
		normalized === "localhost" ||
		normalized.endsWith(".localhost") ||
		normalized.endsWith(".local")
	) {
		return true;
	}
	const ipv4 = parseIpv4(normalized);
	if (ipv4)
		return BLOCKED_IPV4.some(([prefix, bits]) =>
			prefixMatches(ipv4, prefix, bits),
		);
	const ipv6 = parseIpv6(normalized);
	if (!ipv6) return false;
	if (prefixMatches(ipv6, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff], 96)) {
		return BLOCKED_IPV4.some(([prefix, bits]) =>
			prefixMatches(ipv6.slice(12), prefix, bits),
		);
	}
	return BLOCKED_IPV6.some(([prefix, bits]) =>
		prefixMatches(ipv6, prefix, bits),
	);
}

export function validatePluginNetworkUrl(
	input: unknown,
	appOrigin: string,
): URL {
	if (typeof input !== "string")
		throw new Error("插件网络请求 URL 必须是字符串");
	const url = new URL(input);
	if (url.protocol !== "https:") throw new Error("插件网络请求只允许 HTTPS");
	if (url.username || url.password)
		throw new Error("插件网络请求 URL 不能包含用户凭据");
	if (url.origin === appOrigin || isBlockedPluginHostname(url.hostname)) {
		throw new Error("插件网络请求不能访问 Kalo origin、本机、私有或保留网络");
	}
	return url;
}
