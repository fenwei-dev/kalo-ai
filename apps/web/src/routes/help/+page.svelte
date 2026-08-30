<script lang="ts">
	import { Block, BlockTitle } from "konsta/svelte";
	import AppHeader from "$lib/components/AppHeader.svelte";
	import ExternalLink from "$lib/components/ExternalLink.svelte";
	import * as m from "$lib/paraglide/messages";

	const links = {
		openRouterModels: "https://openrouter.ai/collections/free-models",
		openRouterFree: "https://openrouter.ai/openrouter/free",
		ollama: "https://github.com/ollama/ollama",
		llamaCpp: "https://github.com/ggml-org/llama.cpp",
		termux: "https://github.com/termux/termux-app",
		mnnChat:
			"https://github.com/alibaba/MNN/tree/master/apps/Android/MnnLlmChat",
	};
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden">
	<AppHeader title={m.help_title()} subtitle={m.help_subtitle()} backHref="/settings" />
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
		<div class="mx-auto max-w-md py-4">
			<BlockTitle>{m.help_overview_title()}</BlockTitle>
			<Block inset strong><p class="text-sm leading-relaxed text-gray-600">{m.help_overview_body()}</p></Block>

			<BlockTitle>{m.help_training_title()}</BlockTitle>
			<Block inset strong>
				<p class="text-sm leading-relaxed text-gray-600">{m.help_training_body()}</p>
			</Block>

			<BlockTitle>{m.help_api_title()}</BlockTitle>
			<Block inset strong><p class="text-sm leading-relaxed text-gray-600">{m.help_api_body()}</p></Block>

			<BlockTitle>{m.help_plugins_title()}</BlockTitle>
			<Block inset strong>
				<p class="text-sm leading-relaxed text-gray-600">{m.help_plugins_body()}</p>
			</Block>

			<BlockTitle>{m.help_voice_title()}</BlockTitle>
			<Block inset strong>
				<p class="text-sm leading-relaxed text-emerald-700">{m.help_voice_body()}</p>
			</Block>

			<BlockTitle>{m.help_images_title()}</BlockTitle>
			<Block inset strong>
				<p class="text-sm leading-relaxed text-amber-700">{m.help_images_body()}</p>
			</Block>

			<BlockTitle>{m.help_cloud_title()}</BlockTitle>
			<Block inset strong>
				<p class="text-sm leading-relaxed text-gray-600">{m.help_cloud_body()}</p>
				<div class="mt-4 space-y-2">
					<ExternalLink href={links.openRouterModels} label={m.help_openrouter_models()} />
					<ExternalLink href={links.openRouterFree} label={m.help_openrouter_router()} />
				</div>
			</Block>

			<BlockTitle>{m.help_local_title()}</BlockTitle>
			<Block inset strong><p class="text-sm leading-relaxed text-gray-600">{m.help_local_body()}</p></Block>

			<BlockTitle>{m.help_desktop_title()}</BlockTitle>
			<Block inset strong>
				<p class="text-sm leading-relaxed text-gray-600">{m.help_desktop_body()}</p>
				<div class="mt-4 grid grid-cols-2 gap-2">
					<ExternalLink href={links.ollama} label="Ollama" />
					<ExternalLink href={links.llamaCpp} label="llama.cpp" />
				</div>
			</Block>

			<BlockTitle>{m.help_android_title()}</BlockTitle>
			<Block inset strong>
				<p class="text-sm leading-relaxed text-gray-600">{m.help_android_body()}</p>
				<div class="mt-4 grid grid-cols-2 gap-2">
					<ExternalLink href={links.termux} label={m.help_termux()} />
					<ExternalLink href={links.mnnChat} label="MNN Chat" />
				</div>
			</Block>

			<BlockTitle>{m.help_ios_title()}</BlockTitle>
			<Block inset strong><p class="text-sm leading-relaxed text-gray-600">{m.help_ios_body()}</p></Block>

			<BlockTitle>{m.help_tdee_title()}</BlockTitle>
			<Block inset strong>
				<p class="text-sm leading-relaxed text-gray-600">{m.help_tdee_intro()}</p>
				<div class="mt-3 space-y-2">
					<div class="rounded-xl bg-gray-50 px-3 py-2.5">
						<p class="text-sm font-medium text-gray-800">{m.help_tdee_formula_name()}</p>
						<p class="mt-0.5 text-xs leading-relaxed text-gray-500">{m.help_tdee_formula_body()}</p>
					</div>
					<div class="rounded-xl bg-violet-50 px-3 py-2.5">
						<p class="text-sm font-medium text-violet-800">{m.help_tdee_adaptive_name()}</p>
						<p class="mt-0.5 text-xs leading-relaxed text-violet-700">{m.help_tdee_adaptive_body()}</p>
					</div>
					<div class="rounded-xl bg-emerald-50 px-3 py-2.5">
						<p class="text-sm font-medium text-emerald-800">{m.help_tdee_effective_name()}</p>
						<p class="mt-0.5 text-xs leading-relaxed text-emerald-700">{m.help_tdee_effective_body()}</p>
					</div>
				</div>
				<p class="mt-3 text-xs leading-relaxed text-amber-700">{m.help_tdee_caution()}</p>
			</Block>

			<BlockTitle>{m.help_security_title()}</BlockTitle>
			<Block inset strong><p class="text-sm leading-relaxed text-amber-700">{m.help_security_body()}</p></Block>

			<BlockTitle>{m.disclaimer_title()}</BlockTitle>
			<Block inset strong><p class="text-sm leading-relaxed text-amber-700">{m.disclaimer_body()}</p></Block>
		</div>
	</div>
</div>
