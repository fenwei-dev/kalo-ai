import "fake-indexeddb/auto";
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";

let repositories: typeof import("../src/lib/db/repositories");
let database: typeof import("../src/lib/db/schema");
let plugins: typeof import("../src/lib/plugins/manager");
let dates: typeof import("../src/lib/utils/date");

beforeAll(async () => {
	database = await import("../src/lib/db/schema");
	repositories = await import("../src/lib/db/repositories");
	plugins = await import("../src/lib/plugins/manager");
	dates = await import("../src/lib/utils/date");
});

beforeEach(async () => {
	await repositories.clearAllData();
});

afterAll(() => database.db.close());

test("memory uses monotonic versions and optimistic locking", async () => {
	const { getUserMemory, updateUserMemory } = repositories;
	expect(await getUserMemory()).toEqual({
		content: "",
		version: 0,
		updatedAt: null,
	});

	const first = await updateUserMemory("## Preferences\n- No cilantro", 0);
	expect(first.version).toBe(1);
	expect(first.content).toContain("No cilantro");

	await expect(updateUserMemory("stale overwrite", 0)).rejects.toThrow(
		"当前版本 1",
	);

	const cleared = await updateUserMemory("", 1);
	expect(cleared.version).toBe(2);
	expect(cleared.content).toBe("");
});

test("a changed memory snapshot is appended after the user message only once per version", async () => {
	const {
		addUserMessageWithMemorySync,
		createSession,
		getSession,
		listMessages,
		updateUserMemory,
	} = repositories;
	const session = await createSession();

	const firstUser = await addUserMessageWithMemorySync({
		sessionId: session.id,
		content: [{ type: "text", text: "Hello" }],
	});
	let messages = await listMessages(session.id);
	expect(messages.map((message) => message.role)).toEqual([
		"user",
		"assistant",
		"toolResult",
	]);
	expect(messages[0].id).toBe(firstUser.id);
	expect(messages[1].content[0]).toMatchObject({
		type: "toolCall",
		name: "readUserMemory",
	});
	expect(messages[1].synthetic).toBe(true);
	const initialMemoryContent = messages[2].content[0];
	if (initialMemoryContent?.type !== "text") {
		throw new Error("Expected an initial text memory tool result");
	}
	expect(JSON.parse(initialMemoryContent.text)).toMatchObject({
		content: "",
		version: 0,
	});
	expect((await getSession(session.id))?.memoryVersion).toBe(0);

	await addUserMessageWithMemorySync({
		sessionId: session.id,
		content: [{ type: "text", text: "Again" }],
	});
	messages = await listMessages(session.id);
	expect(messages.map((message) => message.role)).toEqual([
		"user",
		"assistant",
		"toolResult",
		"user",
	]);

	await updateUserMemory("## Routine\n- Runs on Friday", 0);
	await addUserMessageWithMemorySync({
		sessionId: session.id,
		content: [{ type: "text", text: "What should I do today?" }],
	});
	messages = await listMessages(session.id);
	expect(messages.slice(-3).map((message) => message.role)).toEqual([
		"user",
		"assistant",
		"toolResult",
	]);
	const latestMessage = messages.at(-1);
	const latestContent = latestMessage?.content[0];
	if (latestContent?.type !== "text") {
		throw new Error("Expected a text memory tool result");
	}
	expect(JSON.parse(latestContent.text)).toMatchObject({
		content: "## Routine\n- Runs on Friday",
		version: 1,
	});
	expect((await getSession(session.id))?.memoryVersion).toBe(1);
});

test("enabled plugin contributes tools and a bounded system prompt", async () => {
	const mcdonalds = await plugins.getPluginState("mcdonalds_sg");
	expect(mcdonalds).toMatchObject({ enabled: true, status: "ready" });
	const initial = await plugins.getPluginState("example");
	expect(initial).toMatchObject({ enabled: false, status: "disabled" });
	const disabledRuntime = await plugins.loadPluginRuntime("en-us", [
		"getProfile",
	]);
	expect(disabledRuntime.tools.map((tool) => tool.name)).toEqual([
		"mcdonalds_sg_listProducts",
		"mcdonalds_sg_getNutrition",
	]);
	expect(disabledRuntime.promptSections).toHaveLength(1);
	expect(disabledRuntime.promptSections[0]).toContain(
		"### Plugin: mcdonalds_sg",
	);
	const mcdList = disabledRuntime.tools.find(
		(tool) => tool.name === "mcdonalds_sg_listProducts",
	);
	if (!mcdList)
		throw new Error("McDonald's Singapore list tool was not loaded");
	const listResult = await mcdList.execute("mcd-list", {
		category: "burgers",
	});
	expect(listResult.content[0]?.type).toBe("text");
	if (listResult.content[0]?.type === "text") {
		expect(listResult.content[0].text).toContain("Big Mac");
		expect(listResult.content[0].text).toContain("burgers");
	}

	await plugins.savePluginSettings(
		"example",
		{
			prefix: "Plugin test",
			apiKey: "secret",
			repeatCount: 2,
			mode: "bracketed",
			uppercase: true,
		},
		true,
	);
	const runtime = await plugins.loadPluginRuntime("en-us", ["getProfile"]);
	expect(runtime.promptSections).toHaveLength(2);
	expect(runtime.promptSections[1]).toContain("### Plugin: example");
	const echo = runtime.tools.find((tool) => tool.name === "example_echo");
	if (!echo) throw new Error("example_echo was not loaded");
	const result = await echo.execute("echo-call", { text: "hello" });
	expect(result.content).toEqual([
		{
			type: "text",
			text: JSON.stringify({ echoed: "Plugin test: [HELLO] [HELLO]" }),
		},
	]);
});

test("plugin configuration migrates to the package config version", async () => {
	await repositories.savePluginConfig({
		pluginId: "example",
		enabled: true,
		configVersion: 1,
		config: { prefix: "Legacy", uppercase: true },
	});
	const migrated = await plugins.getPluginState("example");
	expect(migrated).toMatchObject({
		enabled: true,
		status: "ready",
		config: {
			prefix: "Legacy",
			apiKey: "",
			repeatCount: 1,
			mode: "plain",
			uppercase: true,
		},
	});
	expect(await repositories.getPluginConfig("example")).toMatchObject({
		configVersion: 2,
	});
});

test("resetting a plugin removes its configuration and scoped data", async () => {
	await plugins.savePluginSettings(
		"example",
		{
			prefix: "Stored",
			apiKey: "",
			repeatCount: 1,
			mode: "plain",
			uppercase: false,
		},
		true,
	);
	await repositories.setPluginData({
		pluginId: "example",
		key: "cache",
		value: { hit: true },
	});
	await repositories.setPluginData({
		pluginId: "other_plugin",
		key: "cache",
		value: { retained: true },
	});
	const reset = await plugins.resetPluginSettings("example");
	expect(reset).toMatchObject({ enabled: false, status: "disabled" });
	expect(await repositories.getPluginConfig("example")).toBeUndefined();
	expect(await repositories.getPluginData("example", "cache")).toBeUndefined();
	expect(
		await repositories.getPluginData("other_plugin", "cache"),
	).toMatchObject({
		value: { retained: true },
	});
});

test("Katch-McArdle profiles require body fat at the repository boundary", async () => {
	await expect(
		repositories.saveUser({
			age: 30,
			gender: "male",
			height: 175,
			currentWeight: 80,
			activityLevel: "moderate",
			bmrMethod: "katch-mcardle",
			calculatedBMR: 1666,
		}),
	).rejects.toThrow("体脂率");

	const user = await repositories.saveUser({
		age: 30,
		gender: "male",
		height: 175,
		currentWeight: 80,
		activityLevel: "moderate",
		bmrMethod: "katch-mcardle",
		bodyFatPercentage: 25,
		calculatedBMR: 1666,
	});
	expect(user).toMatchObject({
		bmrMethod: "katch-mcardle",
		bodyFatPercentage: 25,
	});
	await expect(
		repositories.updateUser({ bodyFatPercentage: undefined }),
	).rejects.toThrow("体脂率");
});

test("exercise records support correction and reject future dates", async () => {
	const entry = await repositories.addExerciseEntry({
		date: "2020-01-01",
		time: "18:00",
		description: "Run",
		category: "running",
		intensity: "moderate",
		duration: 30,
		caloriesBurned: 300,
		source: "manual",
	});
	const corrected = await repositories.updateExerciseEntry(entry.id, {
		date: "2020-01-01",
		time: "18:00",
		description: "Run",
		category: "running",
		intensity: "vigorous",
		duration: 40,
		caloriesBurned: 420,
		source: "manual",
	});
	expect(corrected).toMatchObject({
		id: entry.id,
		duration: 40,
		caloriesBurned: 420,
	});
	expect(await repositories.getExerciseEntries()).toHaveLength(1);

	await expect(
		repositories.addExerciseEntry({
			date: "2999-01-01",
			time: "12:00",
			description: "Future run",
			duration: 30,
			caloriesBurned: 200,
			source: "manual",
		}),
	).rejects.toThrow("未来日期");
});

test("training plan completion creates exactly one linked exercise record", async () => {
	const today = dates.localDateISO();
	const tomorrow = dates.localDateOffset(1);
	const { plan, workouts } = await repositories.createTrainingPlan({
		title: "Starter plan",
		goal: "Build consistency",
		startDate: today,
		endDate: dates.localDateOffset(7),
		workouts: [
			{
				date: today,
				time: "08:00",
				category: "running",
				description: "Easy run",
				intensity: "light",
				plannedDuration: 30,
				estimatedCalories: 240,
			},
			{
				date: tomorrow,
				category: "strength",
				description: "Strength session",
				intensity: "moderate",
				plannedDuration: 40,
			},
		],
	});
	expect(plan.status).toBe("active");
	expect(workouts).toHaveLength(2);

	const first = await repositories.completePlannedWorkout(workouts[0].id, {
		date: today,
		time: "08:10",
		duration: 32,
		caloriesBurned: 250,
	});
	const repeated = await repositories.completePlannedWorkout(workouts[0].id, {
		date: today,
		time: "09:00",
		duration: 60,
		caloriesBurned: 500,
	});
	expect(repeated.exercise.id).toBe(first.exercise.id);
	expect(await repositories.getExerciseEntries()).toHaveLength(1);
	expect(first.exercise).toMatchObject({
		plannedWorkoutId: workouts[0].id,
		duration: 32,
		source: "manual",
	});

	await repositories.deleteExerciseEntry(first.exercise.id);
	const restoredWorkout = await repositories.getPlannedWorkout(workouts[0].id);
	expect(restoredWorkout?.status).toBe("planned");
	expect(restoredWorkout?.exerciseEntryId).toBeUndefined();
});

test("training plans enforce one current plan and preserve logs when archived", async () => {
	const today = dates.localDateISO();
	const created = await repositories.createTrainingPlan({
		title: "Current plan",
		startDate: today,
		workouts: [
			{
				date: today,
				category: "walking",
				description: "Walk",
				intensity: "moderate",
				plannedDuration: 20,
			},
		],
	});
	await expect(
		repositories.createTrainingPlan({
			title: "Another plan",
			startDate: today,
		}),
	).rejects.toThrow("已有当前训练计划");

	const completed = await repositories.completePlannedWorkout(
		created.workouts[0].id,
		{
			date: today,
			duration: 20,
			caloriesBurned: 80,
		},
	);
	const repeated = await repositories.completePlannedWorkout(
		created.workouts[0].id,
		{
			date: today,
			duration: 99,
			caloriesBurned: 999,
		},
	);
	expect(repeated.exercise.id).toBe(completed.exercise.id);
	const completedPlan = await repositories.getTrainingPlan(created.plan.id);
	expect(completedPlan?.status).toBe("completed");
	await repositories.archiveTrainingPlan(created.plan.id, created.plan.title);
	expect(await repositories.getExerciseEntries()).toHaveLength(1);
	expect((await repositories.getTrainingPlan(created.plan.id))?.status).toBe(
		"archived",
	);
});

test("any exercise can be linked, moved, or unlinked from a plan item", async () => {
	const today = dates.localDateISO();
	const created = await repositories.createTrainingPlan({
		title: "Linkable plan",
		startDate: today,
		workouts: [
			{
				date: today,
				category: "running",
				description: "Run A",
				intensity: "light",
				plannedDuration: 20,
			},
			{
				date: today,
				category: "running",
				description: "Run B",
				intensity: "moderate",
				plannedDuration: 30,
			},
		],
	});
	const exercise = await repositories.addExerciseEntry({
		date: today,
		time: "09:00",
		description: "Actual run",
		category: "running",
		intensity: "moderate",
		duration: 28,
		caloriesBurned: 240,
		source: "third_party",
	});

	await repositories.linkExerciseToPlannedWorkout(
		exercise.id,
		created.workouts[0].id,
	);
	expect(
		await repositories.getPlannedWorkout(created.workouts[0].id),
	).toMatchObject({
		status: "completed",
		exerciseEntryId: exercise.id,
	});
	expect(
		(await repositories.getExerciseEntry(exercise.id))?.plannedWorkoutId,
	).toBe(created.workouts[0].id);

	await repositories.linkExerciseToPlannedWorkout(
		exercise.id,
		created.workouts[1].id,
	);
	expect(
		(await repositories.getPlannedWorkout(created.workouts[0].id))?.status,
	).toBe("planned");
	expect(
		(await repositories.getPlannedWorkout(created.workouts[1].id))?.status,
	).toBe("completed");

	await repositories.linkExerciseToPlannedWorkout(exercise.id, null);
	expect(
		(await repositories.getExerciseEntry(exercise.id))?.plannedWorkoutId,
	).toBeUndefined();
	expect(
		(await repositories.getPlannedWorkout(created.workouts[1].id))?.status,
	).toBe("planned");
});

test("a planned workout cannot link to two exercise records", async () => {
	const today = dates.localDateISO();
	const created = await repositories.createTrainingPlan({
		title: "One-to-one plan",
		startDate: today,
		workouts: [
			{
				date: today,
				category: "walking",
				description: "Walk",
				intensity: "light",
				plannedDuration: 20,
			},
		],
	});
	const makeExercise = (id: string) =>
		repositories.addExerciseEntry({
			date: today,
			time: "09:00",
			description: id,
			duration: 20,
			caloriesBurned: 70,
			source: "manual",
		});
	const first = await makeExercise("First");
	const second = await makeExercise("Second");
	await repositories.linkExerciseToPlannedWorkout(
		first.id,
		created.workouts[0].id,
	);
	await expect(
		repositories.linkExerciseToPlannedWorkout(
			second.id,
			created.workouts[0].id,
		),
	).rejects.toThrow("已经关联另一条运动记录");
});

test("deleting an old plan completion never creates two current plans", async () => {
	const today = dates.localDateISO();
	const firstPlan = await repositories.createTrainingPlan({
		title: "First",
		startDate: today,
		workouts: [
			{
				date: today,
				category: "walking",
				description: "Walk",
				intensity: "light",
				plannedDuration: 20,
			},
		],
	});
	const completion = await repositories.completePlannedWorkout(
		firstPlan.workouts[0].id,
		{ date: today, duration: 20, caloriesBurned: 70 },
	);
	const secondPlan = await repositories.createTrainingPlan({
		title: "Second",
		startDate: today,
	});
	await repositories.deleteExerciseEntry(completion.exercise.id);
	expect((await repositories.getTrainingPlan(firstPlan.plan.id))?.status).toBe(
		"archived",
	);
	expect((await repositories.getCurrentTrainingPlan())?.id).toBe(
		secondPlan.plan.id,
	);
});

test("legacy health and watch exercise sources import as third party", async () => {
	await repositories.importAll({
		version: 1,
		exportedAt: Date.now(),
		user: [],
		aiConfig: [],
		foodEntries: [],
		exerciseEntries: [
			{
				id: "legacy-watch",
				date: "2020-01-01",
				time: "08:00",
				description: "Walk",
				duration: 20,
				caloriesBurned: 80,
				source: "watch",
				createdAt: 1,
			},
		],
		weightEntries: [],
		foodLibrary: [],
		sessions: [],
		messages: [],
	});
	expect(await repositories.getExerciseEntries()).toEqual([
		expect.objectContaining({ id: "legacy-watch", source: "third_party" }),
	]);
});

test("backup imports reject malformed entity arrays", async () => {
	await expect(
		repositories.importAll({
			version: 1,
			exportedAt: Date.now(),
			user: [],
			aiConfig: [],
			foodEntries: [{ date: "2026-01-01", calories: 500 }],
			exerciseEntries: [],
			weightEntries: [],
			foodLibrary: [],
			sessions: [],
			messages: [],
		}),
	).rejects.toThrow("foodEntries 数据格式无效");
});

test("backups include memory and BMR settings while version 1 backups remain importable", async () => {
	const { exportAll, getUserMemory, importAll, updateUserMemory } =
		repositories;
	await repositories.saveUser({
		age: 30,
		gender: "female",
		height: 165,
		currentWeight: 60,
		activityLevel: "light",
		bmrMethod: "katch-mcardle",
		bodyFatPercentage: 25,
		calculatedBMR: 1342,
	});
	await updateUserMemory("Remember this", 0);
	await plugins.savePluginSettings(
		"example",
		{
			prefix: "Backup plugin",
			apiKey: "backup-secret",
			repeatCount: 3,
			mode: "plain",
			uppercase: false,
		},
		true,
	);
	await repositories.setPluginData({
		pluginId: "example",
		key: "sample",
		value: ["saved", 1],
	});
	const backedPlan = await repositories.createTrainingPlan({
		title: "Backed-up plan",
		startDate: dates.localDateISO(),
		workouts: [
			{
				date: dates.localDateISO(),
				category: "cycling",
				description: "Easy ride",
				intensity: "light",
				plannedDuration: 30,
			},
		],
	});
	await repositories.completePlannedWorkout(backedPlan.workouts[0].id, {
		date: dates.localDateISO(),
		duration: 32,
		caloriesBurned: 180,
	});
	const backup = await exportAll();
	expect(backup.version).toBe(4);
	expect(backup.user).toEqual([
		expect.objectContaining({
			bmrMethod: "katch-mcardle",
			bodyFatPercentage: 25,
		}),
	]);
	expect(backup.trainingPlans).toEqual([
		expect.objectContaining({ title: "Backed-up plan", status: "completed" }),
	]);
	expect(backup.plannedWorkouts).toEqual([
		expect.objectContaining({
			description: "Easy ride",
			status: "completed",
			exerciseEntryId: expect.any(String),
		}),
	]);
	expect(backup.pluginConfigs).toEqual([
		expect.objectContaining({
			pluginId: "example",
			enabled: true,
			config: {
				prefix: "Backup plugin",
				apiKey: "backup-secret",
				repeatCount: 3,
				mode: "plain",
				uppercase: false,
			},
		}),
	]);
	expect(backup.pluginData).toEqual([
		expect.objectContaining({
			pluginId: "example",
			key: "sample",
			value: ["saved", 1],
		}),
	]);
	expect(backup.userMemory).toEqual([
		expect.objectContaining({
			id: "user-memory",
			content: "Remember this",
			version: 1,
		}),
	]);
	const invalidBackup = structuredClone(backup);
	delete invalidBackup.user[0].bodyFatPercentage;
	await expect(importAll(invalidBackup)).rejects.toThrow("user 数据格式无效");

	await repositories.clearAllData();
	await importAll(backup);
	expect(await repositories.getPluginConfig("example")).toMatchObject({
		enabled: true,
		config: {
			prefix: "Backup plugin",
			apiKey: "backup-secret",
			repeatCount: 3,
			mode: "plain",
			uppercase: false,
		},
	});
	expect(await repositories.getPluginData("example", "sample")).toMatchObject({
		value: ["saved", 1],
	});
	expect(await repositories.getTrainingPlans()).toHaveLength(1);
	const restoredWorkouts = await repositories.getPlannedWorkouts(
		backup.trainingPlans[0].id,
	);
	expect(restoredWorkouts).toHaveLength(1);
	expect((await repositories.getExerciseEntries())[0]).toMatchObject({
		plannedWorkoutId: restoredWorkouts[0].id,
	});
	expect(await repositories.getUser()).toMatchObject({
		bmrMethod: "katch-mcardle",
		bodyFatPercentage: 25,
	});
	expect(await getUserMemory()).toEqual(
		expect.objectContaining({ content: "Remember this", version: 1 }),
	);

	await importAll({
		version: 1,
		exportedAt: Date.now(),
		user: [],
		aiConfig: [],
		foodEntries: [],
		exerciseEntries: [],
		weightEntries: [],
		foodLibrary: [],
		sessions: [],
		messages: [],
	});
	expect(await getUserMemory()).toEqual({
		content: "",
		version: 0,
		updatedAt: null,
	});
	expect(await repositories.getTrainingPlans()).toEqual([]);
	expect(await repositories.listPluginConfigs()).toEqual([]);
});
