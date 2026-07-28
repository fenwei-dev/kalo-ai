<script lang="ts">
	import { Block, BlockTitle, Segmented, SegmentedButton } from 'konsta/svelte';
	import { getLocale, setLocale, type Locale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';

	let locale = $state<Locale>(getLocale());

	function change(next: Locale) {
		if (next === locale) return;
		locale = next;
		document.documentElement.lang = next;
		setLocale(next, { reload: true });
	}
</script>

<BlockTitle>{m.language()}</BlockTitle>
<Block inset>
	<Segmented>
		<SegmentedButton active={locale === 'zh-cn'} onclick={() => change('zh-cn')}>
			{m.language_zh()}
		</SegmentedButton>
		<SegmentedButton active={locale === 'en-us'} onclick={() => change('en-us')}>
			{m.language_en()}
		</SegmentedButton>
	</Segmented>
</Block>
