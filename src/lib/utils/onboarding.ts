import { app } from '$lib/context/appContext.svelte';
import { addMessage, createSession } from '$lib/db/repositories';
import { getLocale } from '$lib/paraglide/runtime';

/** Create the first assistant welcome only for a genuinely empty workspace. */
export async function onboardingDestination(): Promise<string> {
	await app.refreshSessions();
	if (app.sessions.length > 0) return '/';
	const english = getLocale() === 'en-us';
	const session = await createSession(english ? 'Meet Kalo' : '认识卡卡');
	const target = app.user?.targetWeight
		? english
			? `I see you want to reach ${app.user.targetWeight} kg. `
			: `看到你想减到 ${app.user.targetWeight}kg，`
		: '';
	await addMessage({
		sessionId: session.id,
		role: 'assistant',
		content: [
			{
				type: 'text',
				text: english
					? `Hi, I'm Kalo! ${target}Your profile and AI connection are ready. Would you like to discuss your goal or log today's food first?`
					: `你好，我是卡卡！${target}你的资料和 AI 连接已经准备好了。接下来想先聊目标，还是记录今天吃了什么？`
			}
		]
	});
	await app.refreshSessions();
	return `/chat/${session.id}`;
}
