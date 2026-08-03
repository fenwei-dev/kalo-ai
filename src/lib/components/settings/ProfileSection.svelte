<script lang="ts">
	import { List, ListInput, Block, BlockTitle, Segmented, SegmentedButton } from 'konsta/svelte';
	import { goto } from '$app/navigation';
	import { app } from '$lib/context/appContext.svelte';
	import AppDialog from '$lib/components/AppDialog.svelte';
	import {
		addMessage, addUserMessageWithMemorySync, createSession, saveUser, updateUser, upsertWeightEntryForDate, getUser,
		getWeightEntriesByDate
	} from '$lib/db/repositories';
	import { calculateBMR, calculateGoalPlan, calculateTDEE } from '$lib/utils/calculations';
	import type { ActivityLevel, Gender } from '$lib/db/schema';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { localDateISO } from '$lib/utils/date';
	import { recomputeAdaptiveTDEE } from '$lib/utils/adaptiveTDEE';

	const activities: ActivityLevel[] = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
	const activityLabel = (value: ActivityLevel) => ({
		sedentary: m.activity_sedentary(), light: m.activity_light(), moderate: m.activity_moderate(),
		active: m.activity_active(), very_active: m.activity_very_active()
	})[value];

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
	let weightConfirmOpen = $state(false);
	let weightConfirmMode = $state<'create' | 'update'>('create');

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
		if (app.user && +currentWeight !== app.user.currentWeight) {
			weightConfirmMode = (await getWeightEntriesByDate(localDateISO())).length ? 'update' : 'create';
			weightConfirmOpen = true;
			return;
		}
		await persistProfile();
	}

	async function persistProfile() {
		if (!valid) return;
		const firstSave = !app.user;
		const weightChanged = firstSave || +currentWeight !== app.user?.currentWeight;
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
			if (app.user) app.user = (await updateUser(data)) ?? null;
			else app.user = await saveUser(data);
			if (weightChanged) {
				await upsertWeightEntryForDate({ date: localDateISO(), weight: +currentWeight });
				await recomputeAdaptiveTDEE();
				app.user = (await getUser()) ?? app.user;
				await app.refreshToday();
			}
			if (firstSave) {
				const english = getLocale() === 'en-us';
				const session = await createSession(english ? 'Meet Kalo' : '认识卡卡');
				const target = targetWeight ? (english ? `I see you want to reach ${targetWeight} kg. ` : `看到你想减到 ${targetWeight}kg，`) : '';
				await addMessage({
					sessionId: session.id,
					role: 'assistant',
					content: [{ type: 'text', text: english
						? `Hi, I'm Kalo! ${target}I've calculated your BMR and daily expenditure. Would you like to discuss your goal or log today's food first?`
						: `你好，我是卡卡！${target}基础代谢和每日消耗已经算好了。接下来想先聊目标，还是记录今天吃了什么？` }]
				});
				await app.refreshSessions();
				await goto(`/chat/${session.id}`);
				return;
			}
			saved = true;
			setTimeout(() => (saved = false), 1500);
		} finally {
			saving = false;
		}
	}
</script>

<BlockTitle>{m.profile_title()}</BlockTitle>

<Block inset>
	<div class="mb-2 text-xs text-gray-500">{m.profile_gender()}</div>
	<Segmented>
		<SegmentedButton active={gender === 'male'} onclick={() => (gender = 'male')}>{m.profile_male()}</SegmentedButton>
		<SegmentedButton active={gender === 'female'} onclick={() => (gender = 'female')}
			>{m.profile_female()}</SegmentedButton
		>
	</Segmented>
</Block>

<List inset strong>
	<ListInput label={m.profile_age()} type="number" inputmode="numeric" placeholder={m.profile_age_unit()} bind:value={age} />
	<ListInput label={m.profile_height()} type="number" inputmode="numeric" placeholder="cm" bind:value={height} />
	<ListInput
		label={m.profile_weight()}
		type="number"
		inputmode="decimal"
		placeholder="kg"
		bind:value={currentWeight}
	/>
	<ListInput label={m.profile_activity()} type="select" bind:value={activityLevel}>
		{#each activities as a (a)}
			<option value={a}>{activityLabel(a)}</option>
		{/each}
	</ListInput>
</List>

{#if valid}
	<Block inset>
		<div class="grid grid-cols-2 gap-3">
			<div class="rounded-xl bg-gray-100 p-3 text-center">
				<div class="text-2xl font-bold text-gray-900">{liveBMR || '—'}</div>
				<div class="text-xs text-gray-500">{m.profile_bmr()}</div>
			</div>
			<div class="rounded-xl bg-emerald-50 p-3 text-center">
				<div class="text-2xl font-bold text-emerald-700">{liveTDEE || '—'}</div>
				<div class="text-xs text-emerald-600">{m.profile_tdee()}</div>
			</div>
		</div>
		{#if app.user?.adaptiveTDEE != null}
			<div class="mt-2 text-center text-xs text-gray-500">
				{m.profile_adaptive_tdee({ value: Math.round(app.user.adaptiveTDEE), confidence: Math.round((app.user.adaptiveConfidence ?? 0) * 100) })}
			</div>
		{/if}
	</Block>
{/if}

<BlockTitle>{m.profile_goal_title()}</BlockTitle>
<List inset strong>
	<ListInput
		label={m.profile_target_weight()}
		type="number"
		inputmode="decimal"
		placeholder="kg"
		bind:value={targetWeight}
	/>
	<ListInput label={m.profile_target_date()} type="date" bind:value={targetDate} />
</List>

{#if app.user}
	<Block inset>
		<button
			onclick={async () => {
				const english = getLocale() === 'en-us';
				const session = await createSession(english ? 'Set a weight-loss goal' : '制定减脂目标');
				await addUserMessageWithMemorySync({
					sessionId: session.id,
					content: [{ type: 'text', text: english
						? 'Based on my profile and healthy weight range, help me set a safe and practical weight-loss goal.'
						: '请根据我的资料和健康体重区间，帮我制定一个安全、可执行的减脂目标。' }]
				});
				await app.refreshSessions();
				await goto(`/chat/${session.id}`);
			}}
			class="w-full rounded-full border border-emerald-500 py-2.5 text-sm font-medium text-emerald-600"
		>
			{m.profile_ask_kaka()}
		</button>
	</Block>
{/if}

{#if targetWeight && targetDate}
	<Block inset>
		<div class="grid grid-cols-2 gap-3 text-center">
			<div class="rounded-xl bg-gray-100 p-3">
				<div class="text-xl font-bold">
					{goal.weeklyRate != null ? `${goal.weeklyRate} kg` : '—'}
				</div>
				<div class="text-xs text-gray-500">{m.profile_weekly_loss()}</div>
			</div>
			<div class="rounded-xl bg-gray-100 p-3">
				<div class="text-xl font-bold">
					{goal.dailyDeficit != null ? `${goal.dailyDeficit} kcal` : '—'}
				</div>
				<div class="text-xs text-gray-500">{m.profile_daily_deficit()}</div>
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
				{m.profile_safe_pace()}
			</div>
		{/if}
	</Block>
{/if}

<Block inset>
	{#if !valid && (age || height || currentWeight)}
		<p class="mb-2 text-center text-xs text-red-500">{m.profile_invalid()}</p>
	{/if}
	<button
		onclick={save}
		disabled={!valid || saving}
		class="w-full rounded-full bg-emerald-500 py-3 font-medium text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
	>
		{saving ? m.common_saving() : app.user ? (saved ? m.common_saved() : m.common_save()) : m.common_start()}
	</button>
</Block>

<AppDialog
	bind:open={weightConfirmOpen}
	title={weightConfirmMode === 'create' ? m.profile_weight_create_title() : m.profile_weight_update_title()}
	message={weightConfirmMode === 'create'
		? m.profile_weight_create_body({ date: localDateISO(), weight: +currentWeight })
		: m.profile_weight_update_body({ date: localDateISO(), weight: +currentWeight })}
	kind="confirm"
	confirmLabel={weightConfirmMode === 'create' ? m.profile_weight_create_confirm() : m.profile_weight_update_confirm()}
	onconfirm={persistProfile}
/>
