export interface ScrollPosition {
	scrollHeight: number;
	scrollTop: number;
	clientHeight: number;
}

export const SCROLL_BOTTOM_THRESHOLD_PX = 8;

/** Treat tiny sub-pixel/layout differences as the bottom of a scroll container. */
export function isScrollAtBottom(
	position: ScrollPosition,
	threshold = SCROLL_BOTTOM_THRESHOLD_PX,
): boolean {
	const distance =
		position.scrollHeight - position.scrollTop - position.clientHeight;
	return distance <= Math.max(0, threshold);
}
