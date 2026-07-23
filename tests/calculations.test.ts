/// <reference types="bun" />
import { test, expect } from 'bun:test';
import {
	calculateBMR,
	calculateTDEE,
	calculateTEF,
	calculateGoalPlan,
	healthWeightRange,
	bmi,
	KCAL_PER_KG,
	ACTIVITY_MULTIPLIERS
} from '../src/lib/utils/calculations';

test('BMR (Mifflin-St Jeor) - male', () => {
	// male 30y, 80kg, 175cm: 10*80 + 6.25*175 - 5*30 + 5 = 800+1093.75-150+5 = 1748.75 → 1749
	expect(calculateBMR(80, 175, 30, 'male')).toBe(1749);
});

test('BMR (Mifflin-St Jeor) - female', () => {
	// female 28y, 60kg, 165cm: 10*60 + 6.25*165 - 5*28 - 161 = 600+1031.25-140-161 = 1330.25 → 1330
	expect(calculateBMR(60, 165, 28, 'female')).toBe(1330);
});

test('TDEE applies activity multiplier', () => {
	const bmr = 1749;
	expect(calculateTDEE(bmr, 'sedentary')).toBe(Math.round(1749 * 1.2));
	expect(calculateTDEE(bmr, 'very_active')).toBe(Math.round(1749 * 1.9));
});

test('TEF uses per-macro coefficients', () => {
	// 100g protein: 100*4*0.25 = 100
	// 200g carbs:   200*4*0.08 = 64
	// 60g fat:      60*9*0.03  = 16.2
	// total 180.2 → 180
	expect(calculateTEF(100, 200, 60)).toBe(180);
});

test('Goal plan flags dangerously fast loss', () => {
	const plan = calculateGoalPlan({
		currentWeight: 80,
		targetWeight: 70,
		targetDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), // ~2 weeks for 10kg
		bmr: 1749
	});
	expect(plan.weeklyRate).toBeGreaterThan(1);
	expect(plan.safety).toBe('danger');
	expect(plan.warning).toBeTruthy();
});

test('Goal plan ok within recommended range', () => {
	const plan = calculateGoalPlan({
		currentWeight: 80,
		targetWeight: 76,
		targetDate: new Date(Date.now() + 56 * 86400000).toISOString().slice(0, 10), // 8 weeks for 4kg = 0.5/wk
		bmr: 1749
	});
	expect(plan.weeklyRate).toBeCloseTo(0.5, 1);
	expect(plan.safety).toBe('ok');
	expect(plan.dailyDeficit).toBe(Math.round((0.5 * KCAL_PER_KG) / 7));
});

test('Health weight range uses BMI 18.5-23.9', () => {
	const r = healthWeightRange(175); // m=1.75, min=18.5*3.0625=56.66→56.7, max=23.9*3.0625=73.19→73.2
	expect(r.min).toBe(56.7);
	expect(r.max).toBe(73.2);
});

test('BMI computation', () => {
	expect(bmi(70, 175)).toBe(22.9); // 70/3.0625 = 22.857 → 22.9
});

test('Activity multipliers are complete', () => {
	expect(ACTIVITY_MULTIPLIERS.sedentary).toBe(1.2);
	expect(ACTIVITY_MULTIPLIERS.very_active).toBe(1.9);
	expect(Object.keys(ACTIVITY_MULTIPLIERS)).toHaveLength(5);
});
