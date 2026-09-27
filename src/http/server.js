import { createServer } from 'node:http';
import { parseDateKey, toDateKey } from '../lib/date.js';
import { serveStatic } from './static.js';
import { InitDataError, validateInitData } from './auth.js';
import { HttpError, deleteMe, getMe, updateMe } from './routes/me.js';
import { getHomework, putHomework } from './routes/homework.js';
import { getAbsenceHistory, getAbsences, getGroupMembers, postAbsence, putDeputy } from './routes/absence.js';
import {
  deleteAnnouncement, getAnnouncements, postAnnouncement, putAnnouncementReminder,
} from './routes/announcements.js';

const MAX_BODY_BYTES = 64 * 1024;

const sendJson = (response, status, body) => {
  const data = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  });
  response.end(data);
};

const readJson = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body_too_large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
  } catch {
    throw new HttpError(400, 'invalid_json', 'Тело запроса должно быть JSON');
  }
};

const authenticate = (request, { botToken, initDataMaxAgeSec, devUserId }) => {
  const header = request.headers.authorization ?? '';
  if (header.startsWith('tma ')) {
    try {
      return validateInitData(header.slice(4), botToken, { maxAgeSec: initDataMaxAgeSec }).user;
    } catch (error) {
      if (error instanceof InitDataError) return null;
      throw error;
    }
  }
  if (devUserId) return { id: devUserId, first_name: 'Dev' };
  return null;
};

const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const scheduleOptions = (url) => {
  const week = url.searchParams.get('week');
  const subgroup = url.searchParams.get('subgroup');
  return {
    week: week ? parseDateKey(week) : undefined,
    subgroup: subgroup ? positiveInteger(subgroup) : undefined,
  };
};

const serializeSchedule = (schedule) => ({
  ...schedule,
  period: {
    from: toDateKey(schedule.period.from),
    to: toDateKey(schedule.period.to),
  },
});

const route = async (request, response, options) => {
  const {
    service, preferences, community, apiAccessKey, webappDir, sendAbsence, onHomeworkSaved, publishAnnouncement,
  } = options;
  if (request.method === 'OPTIONS') return sendJson(response, 204, null);

  const url = new URL(request.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  if (url.pathname === '/health') {
    return sendJson(response, 200, { status: 'ok' });
  }

  if (url.pathname === '/api/me') {
    const user = authenticate(request, options);
    if (!user) return sendJson(response, 401, { error: 'unauthorized' });
    if (request.method === 'GET') return sendJson(response, 200, await getMe({ user, preferences, community }));
    if (request.method === 'PUT') {
      const body = await readJson(request);
      return sendJson(response, 200, await updateMe({ user, preferences, service, body }));
    }
    if (request.method === 'DELETE') return sendJson(response, 200, await deleteMe({ user, preferences, community }));
    return sendJson(response, 405, { error: 'method_not_allowed' });
  }

  if (url.pathname === '/api/absence/history' || url.pathname === '/api/group/members' || url.pathname === '/api/deputy') {
    const user = authenticate(request, options);
    if (!user) return sendJson(response, 401, { error: 'unauthorized' });
    if (url.pathname === '/api/absence/history' && request.method === 'GET') {
      return sendJson(response, 200, await getAbsenceHistory({ user, preferences, community, url }));
    }
    if (url.pathname === '/api/group/members' && request.method === 'GET') {
      return sendJson(response, 200, await getGroupMembers({ user, preferences, community }));
    }
    if (url.pathname === '/api/deputy' && request.method === 'PUT') {
      return sendJson(response, 200, await putDeputy({ user, preferences, community, body: await readJson(request) }));
    }
    return sendJson(response, 405, { error: 'method_not_allowed' });
  }

  if (parts[0] === 'api' && parts[1] === 'announcements') {
    const user = authenticate(request, options);
    if (!user) return sendJson(response, 401, { error: 'unauthorized' });
    const id = parts[2];
    if (!id && request.method === 'GET') return sendJson(response, 200, await getAnnouncements({ user, preferences, community }));
    if (!id && request.method === 'POST') {
      const body = await readJson(request);
      return sendJson(response, 200, await postAnnouncement({ user, preferences, community, body, publishAnnouncement }));
    }
    if (id && parts.length === 3 && request.method === 'DELETE') return sendJson(response, 200, await deleteAnnouncement({ user, community, id }));
    if (id && parts[3] === 'reminder' && request.method === 'PUT') {
      const body = await readJson(request);
      return sendJson(response, 200, await putAnnouncementReminder({ user, preferences, community, id, body }));
    }
    return sendJson(response, 405, { error: 'method_not_allowed' });
  }

  if (url.pathname === '/api/homework') {
    const user = authenticate(request, options);
    if (!user) return sendJson(response, 401, { error: 'unauthorized' });
    if (request.method === 'GET') {
      return sendJson(response, 200, await getHomework({ user, preferences, community, url }));
    }
    if (request.method === 'PUT') {
      const body = await readJson(request);
      return sendJson(response, 200, await putHomework({ user, preferences, community, service, body, onHomeworkSaved }));
    }
    return sendJson(response, 405, { error: 'method_not_allowed' });
  }

  if (url.pathname === '/api/absence') {
    const user = authenticate(request, options);
    if (!user) return sendJson(response, 401, { error: 'unauthorized' });
    if (request.method === 'GET') return sendJson(response, 200, await getAbsences({ user, preferences, community, url }));
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'method_not_allowed' });
    const body = await readJson(request);
    return sendJson(response, 200, await postAbsence({ user, preferences, service, sendAbsence, body }));
  }

  if (request.method !== 'GET') return sendJson(response, 405, { error: 'method_not_allowed' });

  if (parts[0] !== 'api') {
    if (webappDir && await serveStatic(webappDir, url.pathname, response)) return undefined;
    return sendJson(response, 404, { error: 'not_found' });
  }

  const hasApiKey = apiAccessKey && request.headers.authorization === `Bearer ${apiAccessKey}`;
  if (apiAccessKey && !hasApiKey && !authenticate(request, options)) {
    return sendJson(response, 401, { error: 'unauthorized' });
  }

  if (url.pathname === '/api/institutes') {
    return sendJson(response, 200, { items: await service.institutes() });
  }

  if (url.pathname === '/api/groups') {
    const items = await service.searchGroups(url.searchParams.get('q'), {
      institute: url.searchParams.get('institute') || undefined,
      course: url.searchParams.get('course') || undefined,
      limit: positiveInteger(url.searchParams.get('limit'), 50),
    });
    return sendJson(response, 200, { items });
  }

  if (url.pathname === '/api/teachers') {
    const items = await service.searchTeachers(url.searchParams.get('q'), {
      limit: positiveInteger(url.searchParams.get('limit'), 50),
    });
    return sendJson(response, 200, { items });
  }

  if (url.pathname === '/api/auditories') {
    const items = await service.searchAuditories(url.searchParams.get('q'), {
      limit: positiveInteger(url.searchParams.get('limit'), 50),
    });
    return sendJson(response, 200, { items });
  }

  if (parts[0] === 'api' && parts[1] === 'schedule' && parts.length === 4) {
    const kind = parts[2];
    const id = positiveInteger(parts[3]);
    if (!id || !['group', 'teacher', 'auditory'].includes(kind)) {
      return sendJson(response, 400, { error: 'invalid_schedule_target' });
    }
    const schedule = await service[`${kind}Schedule`](id, scheduleOptions(url));
    return sendJson(response, 200, serializeSchedule(schedule));
  }

  return sendJson(response, 404, { error: 'not_found' });
};

export const createHttpServer = (options) =>
  createServer((request, response) => {
    route(request, response, options).catch((error) => {
      if (error instanceof HttpError) {
        return sendJson(response, error.status, { error: error.error, message: error.message });
      }
      console.error('HTTP request failed:', error);
      sendJson(response, 502, {
        error: 'schedule_unavailable',
        message: 'Не удалось получить расписание ИРНИТУ',
      });
    });
  });
