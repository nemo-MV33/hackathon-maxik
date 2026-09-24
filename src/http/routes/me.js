export class HttpError extends Error {
  constructor(status, error, message) {
    super(message ?? error);
    this.status = status;
    this.error = error;
  }
}

const publicProfile = (saved) => ({
  group: saved.selection?.kind === 'group'
    ? { id: saved.selection.id, title: saved.selection.title }
    : null,
  institute: saved.institute ?? null,
  course: saved.course ?? null,
  subgroup: saved.subgroup ?? null,
  remindersEnabled: saved.remindersEnabled !== false,
});

const parseSubgroup = (value) => {
  if (value === null || value === undefined) return null;
  if (value === 1 || value === 2) return value;
  throw new HttpError(400, 'invalid_subgroup', 'Подгруппа должна быть 1, 2 или null');
};

export const getMe = async ({ user, preferences }) => ({
  user: {
    id: user.id,
    firstName: user.first_name ?? null,
    lastName: user.last_name ?? null,
    username: user.username ?? null,
  },
  profile: publicProfile(await preferences.get(user.id)),
});

export const updateMe = async ({ user, preferences, service, body }) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_body', 'Ожидался JSON-объект');
  }

  const saved = await preferences.get(user.id);
  const patch = {};

  if ('groupId' in body) {
    const groups = await service.groups();
    const group = groups.find((item) => item.id === Number(body.groupId));
    if (!group) throw new HttpError(400, 'unknown_group', 'Такой группы нет в расписании ИРНИТУ');
    patch.selection = { kind: 'group', id: group.id, title: group.title };
    patch.institute = group.institute;
    patch.course = group.course;
    patch.subgroup = null;
  }
  if ('subgroup' in body) patch.subgroup = parseSubgroup(body.subgroup);
  if ('remindersEnabled' in body) {
    if (typeof body.remindersEnabled !== 'boolean') {
      throw new HttpError(400, 'invalid_reminders', 'remindersEnabled должен быть true или false');
    }
    patch.remindersEnabled = body.remindersEnabled;
  }

  const value = await preferences.set(user.id, { ...saved, ...patch });
  return { profile: publicProfile(value) };
};
