import "fake-indexeddb/auto";
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";

let repositories: typeof import("../src/lib/db/repositories");
let database: typeof import("../src/lib/db/schema");

beforeAll(async () => {
	database = await import("../src/lib/db/schema");
	repositories = await import("../src/lib/db/repositories");
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
	const backup = await exportAll();
	expect(backup.version).toBe(2);
	expect(backup.user).toEqual([
		expect.objectContaining({
			bmrMethod: "katch-mcardle",
			bodyFatPercentage: 25,
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
});
