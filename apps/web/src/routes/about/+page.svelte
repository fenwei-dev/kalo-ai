<script lang="ts">
	import { Block, BlockTitle } from "konsta/svelte";
	import AppHeader from "$lib/components/AppHeader.svelte";
	import * as m from "$lib/paraglide/messages";

	const githubUrl = "https://github.com/fenwei-dev/kalo-ai";
	const version = "0.0.1";
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden">
	<AppHeader title={m.about_title()} subtitle={m.about_subtitle()} backHref="/settings" />
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<div class="mx-auto max-w-md py-6">
			<div
				class="mx-4 mb-6 flex flex-col items-center rounded-2xl bg-white px-6 text-center shadow-sm"
				style="padding-top: 3rem; padding-bottom: 3rem;"
			>
				<div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500 text-2xl font-black tracking-tighter text-white shadow-sm shadow-emerald-500/20">K</div>
				<h2 class="mt-3 text-xl font-bold text-gray-900">Kalo AI · 卡卡 AI</h2>
				<p class="mt-1 text-xs text-gray-400">{m.about_version({ version })}</p>
				<p class="mt-4 text-sm leading-relaxed text-gray-600">{m.about_description()}</p>
			</div>

			<BlockTitle>{m.about_privacy_title()}</BlockTitle>
			<Block inset strong>
				<p class="text-sm leading-relaxed text-gray-600">{m.about_privacy_body()}</p>
			</Block>

			<BlockTitle>{m.disclaimer_title()}</BlockTitle>
			<Block inset strong>
				<p class="text-sm leading-relaxed text-amber-700">{m.disclaimer_body()}</p>
			</Block>

			<BlockTitle>{m.about_open_source_title()}</BlockTitle>
			<Block inset strong>
				<p class="text-sm leading-relaxed text-gray-600">{m.about_open_source_body()}</p>
				<a
					href={githubUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-gray-950 px-4 py-3 text-sm font-semibold text-white shadow-sm active:opacity-80"
					style="background-color: #111827; color: #ffffff;"
				>
					<svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path d="M12 .7a11.5 11.5 0 00-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.78 1.2 1.78 1.2 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18A10.95 10.95 0 0112 6.12c.98 0 1.96.13 2.87.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.71 5.39-5.29 5.68.42.36.79 1.07.79 2.16v3.24c0 .31.21.67.8.56A11.5 11.5 0 0012 .7z" />
					</svg>
					{m.about_github()}
				</a>
			</Block>
		</div>
	</div>
</div>
