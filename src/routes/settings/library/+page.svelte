<script lang="ts">
	import { onMount } from 'svelte';
	import { app } from '$lib/context/appContext.svelte';
	import {
		listLibrary,
		upsertLibraryItem,
		deleteLibraryItem
	} from '$lib/db/repositories';
	import { CATEGORY_LABELS } from '$lib/utils/librarySync';
	import type { FoodCategory, FoodLibraryItem } from '$lib/db/schema';

	let items = $state<FoodLibraryItem[]>([]);
	let query = $state('');
	let editing = $state<Partial<FoodLibraryItem> | null>(null);
	let saving = $state(false);

	const categories: FoodCategory[] = ['meal', 'snack', 'drink', 'fruit', 'other'];

	onMount(reload);
	async function reload() {
		items = await listLibrary();
	}

	let filtered = $derived(
		query.trim()
			? items.filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase()))
			: items
	);

	function startNew() {
		editing = { category: 'meal', calories: 0, name: '' };
	}
	function startEdit(i: FoodLibraryItem) {
		editing = { ...i };
	}
	function cancel() {
		editing = null;
	}

	async function save() {
		if (!editing?.name || editing.calories == null) return;
		saving = true;
		try {
			await upsertLibraryItem({
				id: editing.id,
				name: editing.name,
				category: (editing.category as FoodCategory) ?? 'meal',
				calories: +editing.calories,
				protein: editing.protein != null ? +editing.protein : undefined,
				carbs: editing.carbs != null ? +editing.carbs : undefined,
				fat: editing.fat != null ? +editing.fat : undefined
			});
			editing = null;
			await reload();
		} finally {
			saving = false;
		}
	}

	async function remove(id: string) {
		await deleteLibraryItem(id);
		await reload();
	}
</script>

<div class="h-full overflow-y-auto pb-20">
	<div class="mx-auto max-w-md px-4 py-5">
		<a href="/settings" class="text-sm text-emerald-600">← 返回设置</a>
		<div class="mt-2 flex items-center justify-between">
			<h1 class="text-xl font-bold">食物库</h1>
			<button onclick={startNew} class="rounded-full bg-emerald-500 px-4 py-1.5 text-sm font-medium text-white">
				+ 新增
			</button>
		</div>
		<p class="mt-1 text-xs text-gray-400">卡卡会自动沉淀你记录过的食物，这里用于纠偏。</p>

		<!-- 搜索 -->
		<input
			bind:value={query}
			placeholder="搜索食物…"
			class="mt-4 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
		/>

		<!-- 编辑/新增表单 -->
		{#if editing}
			<div class="mt-4 rounded-2xl bg-white p-4 shadow-sm">
				<div class="mb-3 text-sm font-semibold">{editing.id ? '编辑食物' : '新增食物'}</div>
				<div class="space-y-2">
					<input bind:value={editing.name} placeholder="名称" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
					<div class="grid grid-cols-2 gap-2">
						<input bind:value={editing.calories} type="number" inputmode="decimal" placeholder="热量 kcal" class="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
						<select bind:value={editing.category} class="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400">
							{#each categories as c (c)}
								<option value={c}>{CATEGORY_LABELS[c]}</option>
							{/each}
						</select>
					</div>
					<div class="grid grid-cols-3 gap-2">
						<input bind:value={editing.protein} type="number" inputmode="decimal" placeholder="蛋白 g" class="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
						<input bind:value={editing.carbs} type="number" inputmode="decimal" placeholder="碳水 g" class="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
						<input bind:value={editing.fat} type="number" inputmode="decimal" placeholder="脂肪 g" class="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
					</div>
				</div>
				<div class="mt-3 flex gap-2">
					<button onclick={cancel} class="flex-1 rounded-full border border-gray-300 py-2 text-sm font-medium">取消</button>
					<button onclick={save} disabled={saving || !editing.name} class="flex-1 rounded-full bg-emerald-500 py-2 text-sm font-medium text-white disabled:opacity-50">保存</button>
				</div>
			</div>
		{/if}

		<!-- 列表 -->
		<ul class="mt-4 space-y-2">
			{#each filtered as i (i.id)}
				<li class="rounded-2xl bg-white p-3.5 shadow-sm">
					<button class="w-full text-left" onclick={() => startEdit(i)}>
						<div class="flex items-center justify-between">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{i.name}</p>
								<p class="text-[11px] text-gray-400">
									{CATEGORY_LABELS[i.category]} · 记录 {i.servingsCount} 次
								</p>
							</div>
							<div class="text-right">
								<p class="text-sm font-semibold">{i.calories} kcal</p>
								<p class="text-[11px] text-gray-400">
									{i.protein != null ? `P${i.protein}` : ''} {i.carbs != null ? `C${i.carbs}` : ''} {i.fat != null ? `F${i.fat}` : ''}
								</p>
							</div>
						</div>
					</button>
					<div class="mt-2 text-right">
						<button onclick={() => remove(i.id)} class="text-xs text-red-400 hover:text-red-500">删除</button>
					</div>
				</li>
			{:else}
				<li class="rounded-2xl bg-white p-6 text-center text-sm text-gray-400 shadow-sm">
					{query ? '没有匹配的食物' : '食物库还是空的，记几顿饭卡卡就会帮你填满'}
				</li>
			{/each}
		</ul>
	</div>
</div>
