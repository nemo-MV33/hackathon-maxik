import { createServer } from 'node:http';
import { parseDateKey, toDateKey } from '../lib/date.js';

const sendJson = (response, status, body) => {
  const data = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  });
  response.end(data);
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

const route = async (request, response, service, apiAccessKey) => {
  if (request.method === 'OPTIONS') return sendJson(response, 204, null);
  if (request.method !== 'GET') return sendJson(response, 405, { error: 'method_not_allowed' });

  const url = new URL(request.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  if (url.pathname === '/health') {
    return sendJson(response, 200, { status: 'ok' });
  }

  if (apiAccessKey && request.headers.authorization !== `Bearer ${apiAccessKey}`) {
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

export const createHttpServer = ({ service, apiAccessKey }) =>
  createServer((request, response) => {
    route(request, response, service, apiAccessKey).catch((error) => {
      console.error('HTTP request failed:', error);
      sendJson(response, 502, {
        error: 'schedule_unavailable',
        message: 'Не удалось получить расписание ИРНИТУ',
      });
    });
  });
