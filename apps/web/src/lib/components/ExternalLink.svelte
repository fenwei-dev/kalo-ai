<script lang="ts">
	let { href, label }: { href: string; label: string } = $props();
</script>

<a
	{href}
	target="_blank"
	rel="noopener noreferrer"
	class="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-medium text-emerald-700 active:bg-gray-100"
>
	<span>{label}</span>
	<svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
		<path d="M14 3h7v7M10 14L21 3M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5" stroke-linecap="round" stroke-linejoin="round" />
	</svg>
</a>
