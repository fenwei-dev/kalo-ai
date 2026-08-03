<script lang="ts">
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';

	let { unread = 0 }: { unread?: number } = $props();

	let pathname = $derived(page.url.pathname);
	let hidden = $derived(
		pathname === '/about' ||
		pathname === '/help' ||
		pathname === '/weight' ||
		pathname.startsWith('/onboarding')
	);

	const isActive = (href: string) =>
		href === '/' ? pathname === '/' : pathname.startsWith(href);
</script>

{#if !hidden}
<nav
	class="fixed inset-x-0 bottom-0 z-50 h-16 bg-white border-t border-black/5 pb-[env(safe-area-inset-bottom)]"
>
	<div class="relative mx-auto flex h-16 max-w-md items-center justify-around">
		<!-- Home -->
		<a
			href="/"
			class="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors
				{isActive('/') ? 'text-emerald-600' : 'text-gray-400'}"
		>
			<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1V9.5z" stroke-linejoin="round" />
			</svg>
			<span>{m.nav_home()}</span>
		</a>

		<!-- AI -->
		<a
			href="/chat"
			class="flex flex-col items-center justify-center"
			aria-label={m.nav_chat_aria()}
		>
			<span
				class="-mt-6 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white
					ring-4 ring-white transition-transform active:scale-95
					{isActive('/chat') ? 'scale-105 bg-emerald-600' : ''}"
			>
				<svg
					class="h-7 w-7"
					viewBox="0 0 28 28"
					fill="none"
					aria-hidden="true"
				>
					<path
						d="M23.5 17.5a4 4 0 01-4 4H10l-5.5 3 1.7-4.7A6 6 0 014.5 15.5V9a4 4 0 014-4h11a4 4 0 014 4v8.5z"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linejoin="round"
					/>
					<path
						d="M14 7.2l1.35 3.45 3.5 1.05-2.6 2.48.6 3.67L14 16.2l-2.85 1.65.6-3.67-2.6-2.48 3.5-1.05L14 7.2z"
						fill="currentColor"
					/>
				</svg>
			</span>
			<span class="mt-0.5 text-[11px] font-medium {isActive('/chat') ? 'text-emerald-600' : 'text-gray-400'}"
				>{m.nav_chat()}</span
			>
			{#if unread > 0}
				<span
					class="absolute right-[28%] top-1 h-4 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] leading-4 text-white"
				>
					{unread > 9 ? '9+' : unread}
				</span>
			{/if}
		</a>

		<!-- Settings -->
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
			<span>{m.nav_settings()}</span>
		</a>
	</div>
</nav>
{/if}
