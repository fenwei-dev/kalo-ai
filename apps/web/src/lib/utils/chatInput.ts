export interface ChatKeyEvent {
	key: string;
	shiftKey: boolean;
	isComposing: boolean;
	keyCode: number;
}

/** Enter submits only when it is not being handled by an IME composition. */
export function shouldSubmitChatOnEnter(
	event: ChatKeyEvent,
	compositionActive: boolean,
): boolean {
	return (
		event.key === "Enter" &&
		!event.shiftKey &&
		!event.isComposing &&
		!compositionActive &&
		event.keyCode !== 229
	);
}
