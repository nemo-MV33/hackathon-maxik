import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSchedule } from '../src/irnitu/normalize.js';

const dictionaries = {
  groups: new Map([[10, 'ИСТб-26-1']]),
  teachers: new Map([[20, 'Иванов Иван Иванович']]),
  auditories: new Map([[30, 'Б-307']]),
};

test('normalizes and resolves a regular lesson', () => {
  const payload = {
    week_even: 1,
    queries: [],
    schedule: [{
      id: 1,
      type: 'day',
      dt: '2026-09-21',
      para: 1,
      title: 'Информатика',
      nt: 2,
      ngroup: null,
      groups: [10],
      teachers_ids: [20],
      auditories_ids: [30],
      auditories_verbose: 'Б-307',
    }],
  };

  const result = normalizeSchedule(payload, dictionaries, { groupId: 10 });
  assert.equal(result.weekEven, true);
  assert.equal(result.lessons.length, 1);
  assert.equal(result.lessons[0].time, '08:15–09:45');
  assert.deepEqual(result.lessons[0].teachers, ['Иванов Иван Иванович']);
  assert.deepEqual(result.lessons[0].auditories, ['Б-307']);
});

test('includes an incoming transfer and ignores an outgoing transfer', () => {
  const payload = {
    schedule: [
      { id: 101, type: 'query', nt: 3 },
      { id: 102, type: 'query', nt: 3 },
    ],
    queries: [
      {
        id: 101,
        type: 4,
        status: 1,
        dt: '2026-10-05',
        para: 5,
        title: '2-ая подгруппа «Программирование», перенос с 2026.09.25',
        groups: [10],
        teachers: [20],
        auds: [30],
      },
      {
        id: 102,
        type: 3,
        status: 1,
        dt: '2026-09-25',
        para: 3,
        title: 'Разовый перенос «Программирование» на 2026.10.05',
        groups: [10],
      },
    ],
  };

  const result = normalizeSchedule(payload, dictionaries, { groupId: 10, subgroup: 2 });
  assert.equal(result.lessons.length, 1);
  assert.equal(result.lessons[0].subject, 'Программирование');
  assert.equal(result.lessons[0].subgroup, 2);
  assert.equal(result.lessons[0].transferred, true);
});

test('filters another subgroup', () => {
  const payload = {
    queries: [],
    schedule: [
      { id: 1, type: 'day', dt: '2026-09-21', para: 1, title: 'Первая', ngroup: 1, groups: [10] },
      { id: 2, type: 'day', dt: '2026-09-21', para: 2, title: 'Вторая', ngroup: 2, groups: [10] },
      { id: 3, type: 'day', dt: '2026-09-21', para: 3, title: 'Общая', ngroup: null, groups: [10] },
    ],
  };

  const result = normalizeSchedule(payload, dictionaries, { groupId: 10, subgroup: 1 });
  assert.deepEqual(result.lessons.map((lesson) => lesson.subject), ['Первая', 'Общая']);
});
