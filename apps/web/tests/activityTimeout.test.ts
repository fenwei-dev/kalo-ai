import { expect, test } from "bun:test";
import {
	type ActivityTimeoutScheduler,
	createActivityTimeout,
} from "../src/lib/utils/activityTimeout";

function fakeScheduler() {
	let nextId = 0;
	const callbacks = new Map<number, () => void>();
	const scheduler: ActivityTimeoutScheduler = {
		set(callback) {
			const id = ++nextId;
			callbacks.set(id, () => {
				callbacks.delete(id);
				callback();
			});
			return id;
		},
		clear(handle) {
			if (typeof handle === "number") callbacks.delete(handle);
		},
	};
	return { scheduler, callbacks };
}

test("activity extends the inactivity timeout and only the latest deadline fires", () => {
	const { scheduler, callbacks } = fakeScheduler();
	let timedOut = 0;
	const timeout = createActivityTimeout(
		300_000,
		() => {
			timedOut += 1;
		},
		scheduler,
	);
	expect([...callbacks.keys()]).toEqual([1]);

	timeout.touch();
	expect([...callbacks.keys()]).toEqual([2]);
	timeout.touch();
	expect([...callbacks.keys()]).toEqual([3]);

	callbacks.get(3)?.();
	expect(timedOut).toBe(1);
	expect(callbacks.size).toBe(0);
	timeout.touch();
	expect(callbacks.size).toBe(0);
});

test("stopping an activity timeout prevents a later callback", () => {
	const { scheduler, callbacks } = fakeScheduler();
	let timedOut = false;
	const timeout = createActivityTimeout(
		1,
		() => {
			timedOut = true;
		},
		scheduler,
	);
	timeout.stop();
	expect(callbacks.size).toBe(0);
	expect(timedOut).toBe(false);
	expect(() => createActivityTimeout(0, () => undefined, scheduler)).toThrow(
		"positive finite",
	);
});
