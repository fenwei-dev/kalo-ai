<script lang="ts">
	let {
		current,
		target,
		label,
		sublabel = '',
		color = '#10b981'
	}: {
		current: number;
		target: number;
		label: string;
		sublabel?: string;
		color?: string;
	} = $props();

	const R = 52;
	const C = 2 * Math.PI * R;

	let pct = $derived(target > 0 ? Math.min(1, Math.max(0, current / target)) : 0);
	let dash = $derived(pct * C);
</script>

<div class="flex flex-col items-center">
	<svg width="128" height="128" viewBox="0 0 128 128" class="-rotate-90">
		<circle cx="64" cy="64" r={R} fill="none" stroke="#e5e7eb" stroke-width="10" />
		<circle
			cx="64"
			cy="64"
			r={R}
			fill="none"
			stroke={color}
			stroke-width="10"
			stroke-linecap="round"
			stroke-dasharray="{dash} {C}"
			style="transition: stroke-dasharray .5s ease"
		/>
	</svg>
	<div class="-mt-[88px] flex h-[88px] flex-col items-center justify-center">
		<span class="text-xl font-bold text-gray-900">{Math.round(current)}</span>
		<span class="text-[10px] text-gray-400">/ {target}</span>
	</div>
	<span class="mt-2 text-xs font-medium text-gray-600">{label}</span>
	{#if sublabel}<span class="text-[10px] text-gray-400">{sublabel}</span>{/if}
</div>
