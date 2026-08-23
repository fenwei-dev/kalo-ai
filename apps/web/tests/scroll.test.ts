import { expect, test } from "bun:test";
import {
	isScrollAtBottom,
	SCROLL_BOTTOM_THRESHOLD_PX,
} from "../src/lib/utils/scroll";

test("detects an exact or near-bottom scroll position", () => {
	expect(
		isScrollAtBottom({
			scrollHeight: 1_000,
			scrollTop: 600,
			clientHeight: 400,
		}),
	).toBe(true);
	expect(
		isScrollAtBottom({
			scrollHeight: 1_000,
			scrollTop: 600 - SCROLL_BOTTOM_THRESHOLD_PX,
			clientHeight: 400,
		}),
	).toBe(true);
});

test("does not treat browsing older content as being at the bottom", () => {
	expect(
		isScrollAtBottom({
			scrollHeight: 1_000,
			scrollTop: 600 - SCROLL_BOTTOM_THRESHOLD_PX - 1,
			clientHeight: 400,
		}),
	).toBe(false);
});

test("short content is already at the bottom", () => {
	expect(
		isScrollAtBottom({ scrollHeight: 300, scrollTop: 0, clientHeight: 400 }),
	).toBe(true);
});
