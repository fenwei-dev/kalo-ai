<script lang="ts">
	import { Block, BlockTitle, Segmented, SegmentedButton } from "konsta/svelte";
	import * as m from "$lib/paraglide/messages";
	import { getLocale, type Locale, setLocale } from "$lib/paraglide/runtime";

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
