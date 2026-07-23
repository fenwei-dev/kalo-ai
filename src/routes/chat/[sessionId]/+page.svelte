<script lang="ts">
	import { page } from '$app/state';
	// /chat/[sessionId]：与卡卡的对话主战场。占位。

	let sessionId = $derived(page.params.sessionId);
</script>

<div class="mx-auto flex h-full max-w-md flex-col">
	<header class="border-b border-black/5 bg-white px-4 py-3">
		<p class="text-sm font-medium">对话 · {sessionId}</p>
	</header>

	<div class="flex-1 px-4 py-6">
		<div class="rounded-2xl bg-white p-5 text-center text-sm text-gray-400 shadow-sm">
			消息流（待实现）
		</div>
	</div>
</div>
