/** Format a Date as YYYY-MM-DD in the user's local timezone. */
export function localDateISO(date = new Date()): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function localTimeHHMM(date = new Date()): string {
	return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function localMessageTimestamp(date = new Date()): string {
	return `${localDateISO(date)} ${localTimeHHMM(date)}`;
}

/** Return a local calendar date offset by a number of days. */
export function localDateOffset(days: number, from = new Date()): string {
	const date = new Date(from);
	date.setHours(12, 0, 0, 0);
	date.setDate(date.getDate() + days);
	return localDateISO(date);
}

/** Parse YYYY-MM-DD as a local date rather than UTC. */
export function parseLocalDate(value: string): Date {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return new Date(Number.NaN);
	return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}
