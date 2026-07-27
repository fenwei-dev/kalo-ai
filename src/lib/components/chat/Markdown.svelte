<script lang="ts">
	import DOMPurify from 'dompurify';
	import { marked } from 'marked';

	let { content, class: className = '' }: { content: string; class?: string } = $props();

	marked.setOptions({ breaks: true, gfm: true });
	const html = $derived(DOMPurify.sanitize(marked.parse(content, { async: false }) as string));
</script>

<div class="markdown {className}">{@html html}</div>

<style>
	.markdown :global(p) { margin: 0.35rem 0; }
	.markdown :global(p:first-child) { margin-top: 0; }
	.markdown :global(p:last-child) { margin-bottom: 0; }
	.markdown :global(ul), .markdown :global(ol) { margin: 0.45rem 0; padding-left: 1.25rem; }
	.markdown :global(ul) { list-style: disc; }
	.markdown :global(ol) { list-style: decimal; }
	.markdown :global(li) { margin: 0.15rem 0; }
	.markdown :global(h1), .markdown :global(h2), .markdown :global(h3) { margin: 0.65rem 0 0.3rem; font-weight: 700; line-height: 1.3; }
	.markdown :global(h1) { font-size: 1.15rem; }
	.markdown :global(h2) { font-size: 1.05rem; }
	.markdown :global(h3) { font-size: 1rem; }
	.markdown :global(strong) { font-weight: 700; }
	.markdown :global(a) { color: #059669; text-decoration: underline; overflow-wrap: anywhere; }
	.markdown :global(blockquote) { margin: 0.5rem 0; border-left: 3px solid #a7f3d0; padding-left: 0.65rem; color: #6b7280; }
	.markdown :global(code) { border-radius: 0.25rem; background: #f3f4f6; padding: 0.08rem 0.25rem; font-size: 0.85em; }
	.markdown :global(pre) { margin: 0.5rem 0; overflow-x: auto; border-radius: 0.6rem; background: #111827; padding: 0.7rem; color: #f9fafb; }
	.markdown :global(pre code) { background: transparent; padding: 0; color: inherit; }
	.markdown :global(hr) { margin: 0.65rem 0; border-color: #e5e7eb; }
	.markdown :global(table) {
		display: block;
		max-width: 100%;
		overflow-x: auto;
		border-collapse: collapse;
		white-space: nowrap;
		-webkit-overflow-scrolling: touch;
	}
	.markdown :global(th), .markdown :global(td) {
		border: 1px solid #d1d5db;
		padding: 0.4rem 0.6rem;
		text-align: left;
		white-space: nowrap;
	}
	.markdown :global(th) { background: #f3f4f6; font-weight: 700; }
</style>
