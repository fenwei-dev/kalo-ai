<script lang="ts">
	// /chat 无 sessionId：选择已有会话或新建。占位。
</script>

<div class="mx-auto max-w-md px-4 py-6">
	<h1 class="text-xl font-bold">卡卡</h1>
	<p class="mt-1 text-sm text-gray-500">选择一个对话，或开始新的聊天</p>

	<div class="mt-6 space-y-2">
		<div class="rounded-2xl bg-white p-5 text-center text-sm text-gray-400 shadow-sm">
			还没有会话
		</div>
	</div>

	<a
		href="/chat/new"
		class="mt-4 flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 font-medium text-white shadow-sm hover:bg-emerald-600"
	>
		开始新对话
	</a>
</div>
