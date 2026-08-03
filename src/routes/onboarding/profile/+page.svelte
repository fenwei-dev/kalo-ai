<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { app } from '$lib/context/appContext.svelte';
	import { getUser, saveUserWithWeightEntry } from '$lib/db/repositories';
	import type { ActivityLevel, Gender } from '$lib/db/schema';
	import { calculateBMR, calculateTDEE } from '$lib/utils/calculations';
	import { localDateISO } from '$lib/utils/date';
	import { recomputeAdaptiveTDEE } from '$lib/utils/adaptiveTDEE';
	import { onboardingDestination } from '$lib/utils/onboarding';
	import * as m from '$lib/paraglide/messages';

	const activities: ActivityLevel[] = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
	const activityLabel = (value: ActivityLevel) =>
		({
			sedentary: m.activity_sedentary(),
			light: m.activity_light(),
			moderate: m.activity_moderate(),
			active: m.activity_active(),
			very_active: m.activity_very_active()
		})[value];

	const existing = app.user;
	let gender = $state<Gender>(existing?.gender === 'female' ? 'female' : 'male');
	let age = $state(existing?.age != null ? String(existing.age) : '');
	let height = $state(existing?.height != null ? String(existing.height) : '');
	let currentWeight = $state(existing?.currentWeight != null ? String(existing.currentWeight) : '');
	let activityLevel = $state<ActivityLevel>(
		existing && ['sedentary', 'light', 'moderate', 'active', 'very_active'].includes(existing.activityLevel)
			? existing.activityLevel
			: 'moderate'
	);
	let saving = $state(false);
	let errorMsg = $state('');

	let valid = $derived(
		Number.isFinite(+age) &&
		+age >= 13 &&
		+age <= 120 &&
		Number.isFinite(+height) &&
		+height >= 100 &&
		+height <= 250 &&
		Number.isFinite(+currentWeight) &&
		+currentWeight >= 25 &&
		+currentWeight <= 400
	);
	let bmr = $derived(valid ? calculateBMR(+currentWeight, +height, +age, gender) : 0);
	let tdee = $derived(valid ? calculateTDEE(bmr, activityLevel) : 0);

	onMount(() => {
		if (app.profileConfigured) void goto(app.aiConfigured ? '/' : '/onboarding/ai', { replaceState: true });
	});

	async function save() {
		if (!valid || saving) return;
		saving = true;
		errorMsg = '';
		try {
			const savedUser = await saveUserWithWeightEntry({
				age: +age,
				gender,
				height: +height,
				currentWeight: +currentWeight,
				activityLevel,
				calculatedBMR: bmr,
				targetWeight: existing?.targetWeight,
				targetDate: existing?.targetDate,
				adaptiveTDEE: existing?.adaptiveTDEE,
				adaptiveConfidence: existing?.adaptiveConfidence
			}, localDateISO());
			await recomputeAdaptiveTDEE();
			const freshUser = (await getUser()) ?? savedUser;
			await app.refreshToday();
			app.user = freshUser;
			const destination = app.aiConfigured ? await onboardingDestination() : '/onboarding/ai';
			await goto(destination);
		} catch (error) {
			errorMsg = error instanceof Error ? error.message : String(error);
		} finally {
			saving = false;
		}
	}
</script>

<div class="flex flex-1 flex-col pb-8">
	<div class="mb-5">
		<p class="text-xs font-semibold uppercase tracking-wider text-emerald-600">{m.onboarding_profile_step()}</p>
		<h1 class="mt-1 text-2xl font-bold text-gray-900">{m.onboarding_profile_title()}</h1>
		<p class="mt-2 text-sm leading-6 text-gray-500">{m.onboarding_profile_body()}</p>
	</div>

	<div class="space-y-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
		<fieldset>
			<legend class="mb-2 block text-xs font-medium text-gray-600">{m.profile_gender()}</legend>
			<div class="grid grid-cols-2 rounded-xl bg-gray-100 p-1">
				<button type="button" onclick={() => (gender = 'male')} class="rounded-lg py-2.5 text-sm font-medium {gender === 'male' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}">{m.profile_male()}</button>
				<button type="button" onclick={() => (gender = 'female')} class="rounded-lg py-2.5 text-sm font-medium {gender === 'female' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}">{m.profile_female()}</button>
			</div>
		</fieldset>

		<div class="grid grid-cols-2 gap-3">
			<label class="text-xs font-medium text-gray-600">
				{m.profile_age()}
				<input bind:value={age} type="number" inputmode="numeric" min="13" max="120" placeholder={m.profile_age_unit()} class="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-3 text-base outline-none focus:border-emerald-400" />
			</label>
			<label class="text-xs font-medium text-gray-600">
				{m.profile_height()}
				<div class="relative mt-1.5">
					<input bind:value={height} type="number" inputmode="decimal" min="100" max="250" class="w-full rounded-xl border border-gray-200 px-3 py-3 pr-10 text-base outline-none focus:border-emerald-400" />
					<span class="absolute right-3 top-3.5 text-xs text-gray-400">cm</span>
				</div>
			</label>
		</div>

		<label class="block text-xs font-medium text-gray-600">
			{m.profile_weight()}
			<div class="relative mt-1.5">
				<input bind:value={currentWeight} type="number" inputmode="decimal" min="25" max="400" class="w-full rounded-xl border border-gray-200 px-3 py-3 pr-10 text-base outline-none focus:border-emerald-400" />
				<span class="absolute right-3 top-3.5 text-xs text-gray-400">kg</span>
			</div>
		</label>

		<label class="block text-xs font-medium text-gray-600">
			{m.profile_activity()}
			<select bind:value={activityLevel} class="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-400">
				{#each activities as activity}
					<option value={activity}>{activityLabel(activity)}</option>
				{/each}
			</select>
		</label>

		{#if valid}
			<div class="grid grid-cols-2 gap-3 pt-1">
				<div class="rounded-2xl bg-gray-50 p-3 text-center">
					<p class="text-xl font-bold text-gray-900">{bmr}</p>
					<p class="text-[11px] text-gray-400">{m.profile_bmr()}</p>
				</div>
				<div class="rounded-2xl bg-emerald-50 p-3 text-center">
					<p class="text-xl font-bold text-emerald-700">{tdee}</p>
					<p class="text-[11px] text-emerald-600">{m.profile_tdee()}</p>
				</div>
			</div>
		{/if}

		{#if errorMsg}
			<p class="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">⚠️ {errorMsg}</p>
		{:else if !valid && (age || height || currentWeight)}
			<p class="text-center text-xs text-red-500">{m.profile_invalid()}</p>
		{/if}

		<button type="button" onclick={save} disabled={!valid || saving} class="w-full rounded-full bg-emerald-500 py-3.5 text-sm font-semibold text-white shadow-sm disabled:opacity-40">
			{saving ? m.common_saving() : m.onboarding_continue()}
		</button>
	</div>

	<button type="button" onclick={() => goto('/onboarding')} class="mx-auto mt-4 px-4 py-2 text-xs text-gray-400">{m.onboarding_back()}</button>
</div>
