const snapshotLabel = (snapshot, field, en) => {
  if (field === 'deadline') { const value = snapshot?.deadline; return value?.kind === 'date' ? `${value.local} (${value.timeZone ?? 'Asia/Irkutsk'})` : value?.kind === 'next' ? (en ? 'next lesson in subject' : 'к следующей паре по предмету') : (en ? 'this lesson' : 'к этой паре'); }
  const value = snapshot?.submission;
  const labels = en ? { class: 'in class', moodle: 'Moodle', system: 'another system', email: 'email', other: 'other' } : { class: 'на паре', moodle: 'Moodle', system: 'другая система', email: 'почта', other: 'другое' };
  return value ? [labels[value.kind], value.label, value.url].filter(Boolean).join(' · ') : (en ? 'not specified' : 'не указано');
};
export const historyText = (history = [], lang = 'ru', timeZone = 'Asia/Irkutsk') => {
  const en = lang === 'en';
  history = history.filter((event) => event.type !== 'attachments' || !history.some((other) => other.after && other.at === event.at));
  return history.slice(-5).reverse().map((event) => {
    const stamp = new Intl.DateTimeFormat(en ? 'en-GB' : 'ru-RU', { timeZone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(event.at));
    const lines = [`${event.version ? `v${event.version} · ` : ''}${event.authorName ?? (event.by === 'schedule' ? (en ? 'University schedule' : 'Расписание вуза') : event.by === 'headman' ? (en ? 'Headman' : 'Староста') : event.by ?? '—')} · ${stamp}`];
    if (event.type === 'moved' || event.type === 'orphaned') lines.push(`${en ? 'Moved with lesson' : 'Перенесено вместе с парой'}: ${event.from?.date ?? ''} ${event.from?.time ?? ''} / ${event.to?.date ?? (en ? 'cancelled' : 'отменена')}${event.by === 'headman' ? (en ? ' · marked by headman' : ' · отмечено старостой') : ''}`);
    if (event.restoredFrom) lines.push(`${en ? 'Restored version' : 'Возврат версии'} ${event.restoredFrom}`);
    if (event.after) {
      if (event.before?.text !== event.after.text) lines.push(`${en ? 'Was' : 'Было'}: ${(event.before?.text ?? '—').slice(0, 180)}\n${en ? 'Now' : 'Стало'}: ${event.after.text.slice(0, 180)}`);
      for (const field of ['deadline', 'submission']) if (snapshotLabel(event.before, field, en) !== snapshotLabel(event.after, field, en)) lines.push(`${field === 'deadline' ? (en ? 'Due' : 'Срок') : (en ? 'Submit' : 'Сдача')}: ${snapshotLabel(event.before, field, en)} / ${snapshotLabel(event.after, field, en)}`);
      const before = event.before?.attachments ?? []; const after = event.after.attachments ?? [];
      for (const file of after.filter((file) => !before.some((old) => old.id === file.id))) lines.push(`+ ${file.name}`);
      for (const file of before.filter((file) => !after.some((next) => next.id === file.id))) lines.push(`− ${file.name}`);
    } else if (event.type === 'attachments') {
      for (const file of event.added ?? []) lines.push(`+ ${file.name}`);
      for (const file of event.removed ?? []) lines.push(`− ${file.name}`);
    }
    const text = lines.join('\n');
    return text.length > 650 ? `${text.slice(0, 649)}…` : text;
  }).join('\n\n') || (en ? 'No recorded changes' : 'Изменений пока нет');
};
