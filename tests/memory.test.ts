import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';

let repositories: typeof import('../src/lib/db/repositories');
let database: typeof import('../src/lib/db/schema');

beforeAll(async () => {
	database = await import('../src/lib/db/schema');
	repositories = await import('../src/lib/db/repositories');
});

beforeEach(async () => {
	await repositories.clearAllData();
});

afterAll(() => database.db.close());

test('memory uses monotonic versions and optimistic locking', async () => {
	const { getUserMemory, updateUserMemory } = repositories;
	expect(await getUserMemory()).toEqual({ content: '', version: 0, updatedAt: null });

	const first = await updateUserMemory('## Preferences\n- No cilantro', 0);
	expect(first.version).toBe(1);
	expect(first.content).toContain('No cilantro');

	await expect(updateUserMemory('stale overwrite', 0)).rejects.toThrow('当前版本 1');

	const cleared = await updateUserMemory('', 1);
	expect(cleared.version).toBe(2);
	expect(cleared.content).toBe('');
});

test('a changed memory snapshot is appended after the user message only once per version', async () => {
	const {
		addUserMessageWithMemorySync,
		createSession,
		getSession,
		listMessages,
		updateUserMemory
	} = repositories;
	const session = await createSession();

	const firstUser = await addUserMessageWithMemorySync({
		sessionId: session.id,
		content: [{ type: 'text', text: 'Hello' }]
	});
	let messages = await listMessages(session.id);
	expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'toolResult']);
	expect(messages[0].id).toBe(firstUser.id);
	expect(messages[1].content[0]).toMatchObject({ type: 'toolCall', name: 'readUserMemory' });
	expect(messages[1].synthetic).toBe(true);
	expect(JSON.parse((messages[2].content[0] as { type: 'text'; text: string }).text)).toMatchObject({
		content: '',
		version: 0
	});
	expect((await getSession(session.id))?.memoryVersion).toBe(0);

	await addUserMessageWithMemorySync({
		sessionId: session.id,
		content: [{ type: 'text', text: 'Again' }]
	});
	messages = await listMessages(session.id);
	expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'toolResult', 'user']);

	await updateUserMemory('## Routine\n- Runs on Friday', 0);
	await addUserMessageWithMemorySync({
		sessionId: session.id,
		content: [{ type: 'text', text: 'What should I do today?' }]
	});
	messages = await listMessages(session.id);
	expect(messages.slice(-3).map((message) => message.role)).toEqual(['user', 'assistant', 'toolResult']);
	expect(JSON.parse((messages.at(-1)!.content[0] as { type: 'text'; text: string }).text)).toMatchObject({
		content: '## Routine\n- Runs on Friday',
		version: 1
	});
	expect((await getSession(session.id))?.memoryVersion).toBe(1);
});

test('backups include memory while version 1 backups remain importable', async () => {
	const { exportAll, getUserMemory, importAll, updateUserMemory } = repositories;
	await updateUserMemory('Remember this', 0);
	const backup = await exportAll();
	expect(backup.version).toBe(2);
	expect(backup.userMemory).toEqual([
		expect.objectContaining({ id: 'user-memory', content: 'Remember this', version: 1 })
	]);
	await repositories.clearAllData();
	await importAll(backup);
	expect(await getUserMemory()).toEqual(expect.objectContaining({ content: 'Remember this', version: 1 }));

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
		messages: []
	});
	expect(await getUserMemory()).toEqual({ content: '', version: 0, updatedAt: null });
});
