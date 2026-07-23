<script lang="ts">
	import { Block, BlockTitle, List, ListItem, Button } from 'konsta/svelte';
	import ProfileSection from '$lib/components/settings/ProfileSection.svelte';
	import AIConfigSection from '$lib/components/settings/AIConfigSection.svelte';
	import { app } from '$lib/context/appContext.svelte';
	import { exportAll, clearAllData, saveUser } from '$lib/db/repositories';
	import type { User } from '$lib/db/schema';

	let importing = $state(false);
	let confirmingClear = $state(false);

	async function handleExport() {
		const data = await exportAll();
		const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `kalo-backup-${new Date().toISOString().slice(0, 10)}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function handleImport(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importing = true;
		try {
			const text = await file.text();
			const data = JSON.parse(text);
			if (data.user?.[0]) {
				const { id, createdAt, updatedAt, ...rest } = data.user[0] as User;
				app.user = await saveUser(rest);
			}
			await app.init();
			alert('导入成功');
		} catch {
			alert('导入失败，请检查备份文件格式');
		} finally {
			importing = false;
			input.value = '';
		}
	}

	async function handleClear() {
		await clearAllData();
		app.user = null;
		app.aiConfig = null;
		app.sessions = [];
		await app.refreshToday();
		confirmingClear = false;
	}
</script>

<div class="h-full overflow-y-auto pb-20">
	<div class="mx-auto max-w-md">
		<div class="px-4 pt-6 pb-2">
			<h1 class="text-2xl font-bold">设置</h1>
			{#if !app.onboarded}
				<p class="mt-1 text-sm text-emerald-600">先填写基础信息，卡卡才能为你计算代谢和目标。</p>
			{/if}
		</div>

		<ProfileSection />
		<AIConfigSection />

		<BlockTitle>食物库</BlockTitle>
		<List inset strong>
			<ListItem href="/settings/library" title="管理食物库" after="卡卡会自动沉淀你记录过的食物" chevron />
		</List>

		<BlockTitle>数据</BlockTitle>
		<Block inset>
			<div class="grid grid-cols-2 gap-3">
				<Button outline rounded onclick={handleExport}>导出</Button>
				<label
					class="flex cursor-pointer items-center justify-center rounded-full border border-gray-300 py-2 text-sm font-medium"
				>
					{importing ? '导入中…' : '导入'}
					<input type="file" accept=".json" class="hidden" onchange={handleImport} />
				</label>
			</div>
			{#if confirmingClear}
				<div class="mt-3 rounded-xl bg-red-50 p-3 text-center">
					<p class="mb-2 text-xs text-red-600">确定清空所有数据？此操作不可恢复。</p>
					<div class="grid grid-cols-2 gap-3">
						<Button small outline rounded onclick={() => (confirmingClear = false)}>取消</Button>
						<button
							onclick={handleClear}
							class="rounded-full bg-red-500 py-2 text-sm font-medium text-white">确认清空</button
						>
					</div>
				</div>
			{:else}
				<Button clear class="mt-2 !text-red-500" onclick={() => (confirmingClear = true)}
					>清空所有数据</Button
				>
			{/if}
		</Block>

		<p class="px-4 pb-4 pt-2 text-center text-xs text-gray-400">Kalo AI · 数据仅存于本地</p>
	</div>
</div>
