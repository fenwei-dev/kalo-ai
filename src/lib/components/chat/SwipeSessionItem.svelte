<script lang="ts">
	import type { Session } from "$lib/db/schema";
	import * as m from "$lib/paraglide/messages";

	const DELETE_WIDTH = 80;
	const DIRECTION_THRESHOLD = 6;

	let {
		session,
		timeLabel,
		active = false,
		compact = false,
		revealed = false,
		onreveal,
		onselect,
		ondelete,
	}: {
		session: Session;
		timeLabel: string;
		active?: boolean;
		compact?: boolean;
		revealed?: boolean;
		onreveal: (id: string | null) => void;
		onselect: (id: string) => void;
		ondelete: (id: string) => void | Promise<void>;
	} = $props();

	let offset = $state(0);
	let dragging = $state(false);
	let deleting = $state(false);
	let startX = 0;
	let startY = 0;
	let startOffset = 0;
	let gesture: "pending" | "horizontal" | "vertical" = "pending";
	let suppressClick = false;

	$effect(() => {
		if (!dragging) offset = revealed ? -DELETE_WIDTH : 0;
	});

	function settle(open: boolean) {
		dragging = false;
		offset = open ? -DELETE_WIDTH : 0;
		onreveal(open ? session.id : null);
	}

	function pointerDown(event: PointerEvent) {
		if (event.button !== 0 || deleting) return;
		if (!(event.currentTarget instanceof HTMLButtonElement)) return;
		dragging = true;
		gesture = "pending";
		suppressClick = false;
		startX = event.clientX;
		startY = event.clientY;
		startOffset = revealed ? -DELETE_WIDTH : 0;
		offset = startOffset;
		event.currentTarget.setPointerCapture(event.pointerId);
	}

	function pointerMove(event: PointerEvent) {
		if (!dragging) return;
		const deltaX = event.clientX - startX;
		const deltaY = event.clientY - startY;
		if (gesture === "pending") {
			if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < DIRECTION_THRESHOLD)
				return;
			gesture = Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
		}
		if (gesture !== "horizontal") return;
		event.preventDefault();
		suppressClick = true;
		offset = Math.max(-DELETE_WIDTH, Math.min(0, startOffset + deltaX));
	}

	function pointerEnd() {
		if (!dragging) return;
		if (gesture === "horizontal") settle(offset <= -DELETE_WIDTH * 0.4);
		else settle(revealed);
	}

	function activate() {
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		if (revealed) settle(false);
		else onselect(session.id);
	}

	function keydown(event: KeyboardEvent) {
		if (event.key === "ArrowLeft") {
			event.preventDefault();
			settle(true);
		} else if (event.key === "ArrowRight" || event.key === "Escape") {
			event.preventDefault();
			settle(false);
		}
	}

	async function remove() {
		if (deleting) return;
		deleting = true;
		try {
			await ondelete(session.id);
		} finally {
			deleting = false;
		}
	}
</script>

<div class="relative overflow-hidden {compact ? 'rounded-lg' : 'rounded-2xl shadow-sm'}">
	<button
		type="button"
		disabled={deleting}
		tabindex={revealed ? 0 : -1}
		aria-hidden={!revealed}
		aria-label={m.chat_delete_session({ title: session.title })}
		onclick={remove}
		class="absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-red-500 text-sm font-medium text-white disabled:opacity-60"
	>
		{deleting ? m.chat_deleting_session() : m.common_delete()}
	</button>

	<button
		type="button"
		disabled={deleting}
		aria-current={active ? "page" : undefined}
		onpointerdown={pointerDown}
		onpointermove={pointerMove}
		onpointerup={pointerEnd}
		onpointercancel={pointerEnd}
		onclick={activate}
		onkeydown={keydown}
		style:transform="translateX({offset}px)"
		class="relative flex w-full touch-pan-y items-center justify-between text-left disabled:opacity-60 {compact
			? `px-3 py-2.5 ${active ? 'bg-emerald-50' : 'bg-white hover:bg-gray-50'}`
			: 'bg-white p-4'} {dragging ? '' : 'transition-transform duration-200 ease-out'}"
	>
		<span class="min-w-0 flex-1">
			<span class="block truncate text-sm font-medium">{session.title}</span>
			<span class="block text-xs text-gray-400">{timeLabel}</span>
		</span>
	</button>
</div>
