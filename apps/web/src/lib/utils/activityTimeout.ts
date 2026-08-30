export interface ActivityTimeout {
	/** Reset the inactivity window after observable forward progress. */
	touch(): void;
	/** Permanently stop this timeout and release its timer. */
	stop(): void;
}

export interface ActivityTimeoutScheduler {
	set(callback: () => void, timeoutMs: number): unknown;
	clear(handle: unknown): void;
}

const browserScheduler: ActivityTimeoutScheduler = {
	set: (callback, timeoutMs) => setTimeout(callback, timeoutMs),
	clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Fire only after a continuous period without activity. The timeout can be
 * extended indefinitely by real progress, but stop() makes later touches inert.
 */
export function createActivityTimeout(
	timeoutMs: number,
	onTimeout: () => void,
	scheduler: ActivityTimeoutScheduler = browserScheduler,
): ActivityTimeout {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		throw new Error("Activity timeout must be a positive finite duration");
	}
	let timer: unknown;
	let stopped = false;

	const touch = () => {
		if (stopped) return;
		if (timer !== undefined) scheduler.clear(timer);
		timer = scheduler.set(() => {
			timer = undefined;
			if (stopped) return;
			stopped = true;
			onTimeout();
		}, timeoutMs);
	};

	const stop = () => {
		if (stopped) return;
		stopped = true;
		if (timer !== undefined) scheduler.clear(timer);
		timer = undefined;
	};

	touch();
	return { touch, stop };
}
