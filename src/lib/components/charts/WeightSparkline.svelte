<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	let { weights, height = 48 }: { weights: number[]; height?: number } = $props();

	let points = $derived.by(() => {
		const w = weights;
		if (w.length < 2) return '';
		const min = Math.min(...w);
		const max = Math.max(...w);
		const span = max - min || 1;
		const W = 100;
		const H = height;
		return w
			.map((val, i) => {
				const x = (i / (w.length - 1)) * W;
				const y = H - ((val - min) / span) * (H - 8) - 4;
				return `${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ');
	});

	let delta = $derived(weights.length >= 2 ? +(weights[weights.length - 1] - weights[0]).toFixed(1) : 0);
</script>

{#if weights.length >= 2}
	<div class="flex items-center gap-3">
		<svg viewBox="0 0 100 {height}" preserveAspectRatio="none" class="h-{height} flex-1" style="height:{height}px">
			<polyline
				fill="none"
				stroke={delta <= 0 ? '#10b981' : '#f59e0b'}
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				points={points}
				vector-effect="non-scaling-stroke"
			/>
		</svg>
		<span class="shrink-0 text-sm font-medium {delta <= 0 ? 'text-emerald-600' : 'text-amber-600'}">
			{delta > 0 ? '+' : ''}{delta} kg
		</span>
	</div>
{:else}
	<p class="text-xs text-gray-400">{m.weight_need_more()}</p>
{/if}
