<script lang="ts">
	import { page } from '$app/state';

	let { unread = 0 }: { unread?: number } = $props();

	let pathname = $derived(page.url.pathname);

	const isActive = (href: string) =>
		href === '/' ? pathname === '/' : pathname.startsWith(href);
</script>

<nav
	class="fixed inset-x-0 bottom-0 z-50 h-16 bg-white border-t border-black/5 pb-[env(safe-area-inset-bottom)]"
>
	<div class="relative mx-auto flex h-16 max-w-md items-center justify-around">
		<!-- 首页 -->
		<a
			href="/"
			class="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors
				{isActive('/') ? 'text-emerald-600' : 'text-gray-400'}"
		>
			<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1V9.5z" stroke-linejoin="round" />
			</svg>
			<span>首页</span>
		</a>

		<!-- AI（凸起） -->
		<a
			href="/chat"
			class="flex flex-col items-center justify-center"
			aria-label="和卡卡聊聊"
		>
			<span
				class="-mt-8 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white
					shadow-lg shadow-emerald-500/40 ring-4 ring-white transition-transform active:scale-95
					{isActive('/chat') ? 'scale-105 bg-emerald-600' : ''}"
			>
				<svg class="h-7 w-7" viewBox="0 0 24 24" fill="currentColor">
					<path
						d="M12 2l1.8 4.6L18.5 8l-3.5 3.3.8 4.9L12 14l-3.8 2.2.8-4.9L5.5 8l4.7-1.4L12 2z"
					/>
					<path d="M9 18.5l1.5 2.5 1-1.6 1 1.6 1.5-2.5-1.5-.9H10.5l-1.5.9z" opacity=".7" />
				</svg>
			</span>
			<span class="mt-0.5 text-[11px] font-medium {isActive('/chat') ? 'text-emerald-600' : 'text-gray-400'}"
				>卡卡</span
			>
			{#if unread > 0}
				<span
					class="absolute right-[28%] top-1 h-4 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] leading-4 text-white"
				>
					{unread > 9 ? '9+' : unread}
				</span>
			{/if}
		</a>

		<!-- 设置 -->
		<a
			href="/settings"
			class="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors
				{isActive('/settings') ? 'text-emerald-600' : 'text-gray-400'}"
		>
			<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="12" cy="12" r="3" />
				<path
					d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
					stroke-linejoin="round"
				/>
			</svg>
			<span>设置</span>
		</a>
	</div>
</nav>
