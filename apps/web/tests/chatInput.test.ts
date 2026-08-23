/// <reference types="bun" />
import { expect, test } from "bun:test";
import { shouldSubmitChatOnEnter } from "../src/lib/utils/chatInput";

const enter = {
	key: "Enter",
	shiftKey: false,
	isComposing: false,
	keyCode: 13,
};

test("plain Enter submits chat", () => {
	expect(shouldSubmitChatOnEnter(enter, false)).toBe(true);
});

test("Shift+Enter inserts a newline instead of submitting", () => {
	expect(shouldSubmitChatOnEnter({ ...enter, shiftKey: true }, false)).toBe(
		false,
	);
});

test("IME Enter never submits while composition is active", () => {
	expect(shouldSubmitChatOnEnter({ ...enter, isComposing: true }, false)).toBe(
		false,
	);
	expect(shouldSubmitChatOnEnter(enter, true)).toBe(false);
});

test("IME keyCode 229 fallback never submits", () => {
	expect(shouldSubmitChatOnEnter({ ...enter, keyCode: 229 }, false)).toBe(
		false,
	);
});

test("non-Enter keys do not submit", () => {
	expect(shouldSubmitChatOnEnter({ ...enter, key: "Process" }, false)).toBe(
		false,
	);
});
