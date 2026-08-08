<script lang="ts">
	import { onMount } from "svelte";
	import AppHeader from "$lib/components/AppHeader.svelte";
	import { app } from "$lib/context/appContext.svelte";
	import {
		deleteLibraryItem,
		listLibrary,
		upsertLibraryItem,
	} from "$lib/db/repositories";
	import type { FoodCategory, FoodLibraryItem } from "$lib/db/schema";
	import * as m from "$lib/paraglide/messages";

	let items = $state<FoodLibraryItem[]>([]);
	let query = $state("");
	let editing = $state<Partial<FoodLibraryItem> | null>(null);
	let saving = $state(false);

	const categories: FoodCategory[] = [
		"meal",
		"snack",
		"drink",
		"fruit",
		"other",
	];
	const categoryLabel = (value: FoodCategory) =>
		({
			meal: m.category_meal(),
			snack: m.category_snack(),
			drink: m.category_drink(),
			fruit: m.category_fruit(),
			other: m.category_other(),
		})[value];

	onMount(reload);
	async function reload() {
		items = await listLibrary();
	}

	let filtered = $derived(
		query.trim()
			? items.filter((i) =>
					i.name.toLowerCase().includes(query.trim().toLowerCase()),
				)
			: items,
	);

	function startNew() {
		editing = { category: "meal", calories: 0, name: "" };
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
				category: (editing.category as FoodCategory) ?? "meal",
				calories: +editing.calories,
				protein: editing.protein != null ? +editing.protein : undefined,
				carbs: editing.carbs != null ? +editing.carbs : undefined,
				fat: editing.fat != null ? +editing.fat : undefined,
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

<div class="flex h-full min-h-0 flex-col overflow-hidden pb-16">
	<AppHeader
		title={m.library_title()}
		subtitle={m.library_subtitle()}
		backHref="/settings"
		actionLabel={m.common_add()}
		onaction={startNew}
	/>
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
	<div class="mx-auto max-w-md px-4 py-5">
		<p class="text-xs text-gray-400">{m.library_intro()}</p>

		<!-- 搜索 -->
		<input
			bind:value={query}
			placeholder={m.library_search()}
			class="mt-4 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
		/>

		<!-- 编辑/新增表单 -->
		{#if editing}
			<div class="mt-4 rounded-2xl bg-white p-4 shadow-sm">
				<div class="mb-3 text-sm font-semibold">{editing.id ? m.library_edit() : m.library_add()}</div>
				<div class="space-y-2">
					<input bind:value={editing.name} placeholder={m.library_name()} class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
					<div class="grid grid-cols-2 gap-2">
						<input bind:value={editing.calories} type="number" inputmode="decimal" placeholder={m.library_calories()} class="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
						<select bind:value={editing.category} class="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400">
							{#each categories as c (c)}
								<option value={c}>{categoryLabel(c)}</option>
							{/each}
						</select>
					</div>
					<div class="grid grid-cols-3 gap-2">
						<input bind:value={editing.protein} type="number" inputmode="decimal" placeholder={m.library_protein()} class="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
						<input bind:value={editing.carbs} type="number" inputmode="decimal" placeholder={m.library_carbs()} class="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
						<input bind:value={editing.fat} type="number" inputmode="decimal" placeholder={m.library_fat()} class="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
					</div>
				</div>
				<div class="mt-3 flex gap-2">
					<button onclick={cancel} class="flex-1 rounded-full border border-gray-300 py-2 text-sm font-medium">{m.common_cancel()}</button>
					<button onclick={save} disabled={saving || !editing.name} class="flex-1 rounded-full bg-emerald-500 py-2 text-sm font-medium text-white disabled:opacity-50">{m.common_save()}</button>
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
									{categoryLabel(i.category)} · {m.library_count({ value: i.servingsCount })}
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
						<button onclick={() => remove(i.id)} class="text-xs text-red-400 hover:text-red-500">{m.common_delete()}</button>
					</div>
				</li>
			{:else}
				<li class="rounded-2xl bg-white p-6 text-center text-sm text-gray-400 shadow-sm">
					{query ? m.library_no_match() : m.library_empty()}
				</li>
			{/each}
		</ul>
	</div>
	</div>
</div>
