import { DEMO_GROUP, demoLessons } from './demo-service.js';
import { sameGroup } from '../universities/identity.js';
import { addDays, startOfWeek } from '../lib/date.js';
export const resetDemo = async ({ community, preferences, now = new Date(), ids = (process.env.DEMO_MAX_IDS || '').split(',').map((id) => id.trim()).filter(Boolean), chatId = process.env.DEMO_CHAT_ID }) => {
  if (!ids.length || !ids.every((id) => /^[1-9]\d*$/.test(String(id))) || !/^-?\d+$/.test(String(chatId ?? ''))) throw new Error('demo_ids_and_chat_required');
  await community.resetGroup(DEMO_GROUP.id);
  for (const [id, profile] of await preferences.entries()) {
    if (profile.selection?.kind === 'group' && sameGroup(profile.selection.id, DEMO_GROUP.id)) await preferences.set(id, { ...profile,
      homeworkReminders: {}, announcementReminders: {}, sentScheduled: [], sentReminders: [], examReminders: [], summarySentFor: null });
  }
  await community.setChat(Number(chatId), { group: DEMO_GROUP, headman: { userId: Number(ids[0]), name: 'Староста демо' }, editors: ids.slice(2).map((id) => ({ userId: Number(id), name: 'Редактор демо' })), homeworkMode: 'editors' });
  const lesson = demoLessons(addDays(startOfWeek(now), 7))[0];
  await community.upsertHomework({ groupId: DEMO_GROUP.id, groupTitle: DEMO_GROUP.title, lessonDate: lesson.date, lessonNumber: lesson.lessonNumber,
    lessonTime: lesson.time, subject: lesson.subject, subgroup: null, text: 'Решить задачи 1–3', authorId: Number(ids[0]), authorName: 'Староста демо', deadline: { kind: 'lesson' }, submission: { kind: 'class', label: '', url: null } });
};
