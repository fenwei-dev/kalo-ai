<script lang="ts">
	import { List, ListInput, Block, BlockTitle, Segmented, SegmentedButton } from 'konsta/svelte';
	import { app } from '$lib/context/appContext.svelte';
	import { saveUser, updateUser } from '$lib/db/repositories';
	import { ACTIVITY_LABELS, calculateBMR, calculateGoalPlan, calculateTDEE } from '$lib/utils/calculations';
	import type { ActivityLevel, Gender } from '$lib/db/schema';

	const activities: ActivityLevel[] = ['sedentary', 'light', 'moderate', 'active', 'very_active'];

	const u = app.user;
	let gender = $state<Gender>(u?.gender ?? 'male');
	let age = $state<string>(u ? String(u.age) : '');
	let height = $state<string>(u ? String(u.height) : '');
	let currentWeight = $state<string>(u ? String(u.currentWeight) : '');
	let targetWeight = $state<string>(u?.targetWeight ? String(u.targetWeight) : '');
	let targetDate = $state<string>(u?.targetDate ?? '');
	let activityLevel = $state<ActivityLevel>(u?.activityLevel ?? 'moderate');

	let saving = $state(false);
	let saved = $state(false);

	let valid = $derived(
		Number.isFinite(+age) && +age >= 13 && +age <= 120 &&
		Number.isFinite(+height) && +height >= 100 && +height <= 250 &&
		Number.isFinite(+currentWeight) && +currentWeight >= 25 && +currentWeight <= 400
	);

	const liveBMR = $derived(valid ? calculateBMR(+currentWeight, +height, +age, gender) : 0);
	const liveTDEE = $derived(valid ? calculateTDEE(liveBMR, activityLevel) : 0);
	const goal = $derived(calculateGoalPlan({
		currentWeight: +currentWeight,
		targetWeight: targetWeight ? +targetWeight : undefined,
		targetDate: targetDate || undefined,
		bmr: liveBMR,
		tdee: liveTDEE
	}));

	async function save() {
		if (!valid) return;
		saving = true;
		try {
			const data = {
				age: +age,
				gender,
				height: +height,
				currentWeight: +currentWeight,
				targetWeight: targetWeight ? +targetWeight : undefined,
				targetDate: targetDate || undefined,
				activityLevel,
				calculatedBMR: liveBMR
			};
			if (app.user) {
				app.user = (await updateUser(data)) ?? null;
			} else {
				app.user = await saveUser(data);
			}
			saved = true;
			setTimeout(() => (saved = false), 1500);
		} finally {
			saving = false;
		}
	}
</script>

<BlockTitle>个人资料</BlockTitle>

<Block inset>
	<div class="mb-2 text-xs text-gray-500">性别</div>
	<Segmented>
		<SegmentedButton active={gender === 'male'} onclick={() => (gender = 'male')}>男</SegmentedButton>
		<SegmentedButton active={gender === 'female'} onclick={() => (gender = 'female')}
			>女</SegmentedButton
		>
	</Segmented>
</Block>

<List inset strong>
	<ListInput label="年龄" type="number" inputmode="numeric" placeholder="岁" bind:value={age} />
	<ListInput label="身高" type="number" inputmode="numeric" placeholder="cm" bind:value={height} />
	<ListInput
		label="当前体重"
		type="number"
		inputmode="decimal"
		placeholder="kg"
		bind:value={currentWeight}
	/>
	<ListInput label="活动水平" type="select" bind:value={activityLevel}>
		{#each activities as a (a)}
			<option value={a}>{ACTIVITY_LABELS[a]}</option>
		{/each}
	</ListInput>
</List>

{#if valid}
	<Block inset>
		<div class="grid grid-cols-2 gap-3">
			<div class="rounded-xl bg-gray-100 p-3 text-center">
				<div class="text-2xl font-bold text-gray-900">{liveBMR || '—'}</div>
				<div class="text-xs text-gray-500">基础代谢 (BMR)</div>
			</div>
			<div class="rounded-xl bg-emerald-50 p-3 text-center">
				<div class="text-2xl font-bold text-emerald-700">{liveTDEE || '—'}</div>
				<div class="text-xs text-emerald-600">每日消耗 (TDEE)</div>
			</div>
		</div>
		{#if app.user?.adaptiveTDEE != null}
			<div class="mt-2 text-center text-xs text-gray-500">
				自适应 TDEE：{Math.round(app.user.adaptiveTDEE)} kcal（置信度
				{Math.round((app.user.adaptiveConfidence ?? 0) * 100)}%）
			</div>
		{/if}
	</Block>
{/if}

<BlockTitle>减重目标（可选）</BlockTitle>
<List inset strong>
	<ListInput
		label="目标体重"
		type="number"
		inputmode="decimal"
		placeholder="kg"
		bind:value={targetWeight}
	/>
	<ListInput label="目标日期" type="date" bind:value={targetDate} />
</List>

{#if targetWeight && targetDate}
	<Block inset>
		<div class="grid grid-cols-2 gap-3 text-center">
			<div class="rounded-xl bg-gray-100 p-3">
				<div class="text-xl font-bold">
					{goal.weeklyRate != null ? `${goal.weeklyRate} kg` : '—'}
				</div>
				<div class="text-xs text-gray-500">每周减重</div>
			</div>
			<div class="rounded-xl bg-gray-100 p-3">
				<div class="text-xl font-bold">
					{goal.dailyDeficit != null ? `${goal.dailyDeficit} kcal` : '—'}
				</div>
				<div class="text-xs text-gray-500">每日热量缺口</div>
			</div>
		</div>
		{#if goal.warning && goal.safety !== 'danger'}
			<div class="mt-2 rounded-lg bg-amber-50 p-2 text-center text-xs text-amber-700">
				⚠️ {goal.warning}
			</div>
		{:else if goal.safety === 'danger'}
			<div class="mt-2 rounded-lg bg-red-50 p-2 text-center text-xs text-red-600">
				⚠️ {goal.warning}
			</div>
		{:else if goal.safety === 'ok' && goal.weeklyRate != null}
			<div class="mt-2 rounded-lg bg-emerald-50 p-2 text-center text-xs text-emerald-600">
				✓ 节奏合理（推荐每周 0.5–1kg）
			</div>
		{/if}
	</Block>
{/if}

<Block inset>
	{#if !valid && (age || height || currentWeight)}
		<p class="mb-2 text-center text-xs text-red-500">请填写合理范围：年龄 13–120、身高 100–250cm、体重 25–400kg</p>
	{/if}
	<button
		onclick={save}
		disabled={!valid || saving}
		class="w-full rounded-full bg-emerald-500 py-3 font-medium text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
	>
		{saving ? '保存中…' : app.user ? (saved ? '已保存 ✓' : '保存') : '开始使用'}
	</button>
</Block>
