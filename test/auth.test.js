import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { InitDataError, validateInitData } from '../src/http/auth.js';

const BOT_TOKEN = 'test-bot-token';
const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);

const sign = (fields, token = BOT_TOKEN) => {
  const params = new URLSearchParams(fields);
  const checkString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
  return params.toString();
};

const fields = {
  auth_date: String(NOW / 1000 - 60),
  query_id: 'query-1',
  user: JSON.stringify({ id: 42, first_name: 'Вячеслав', username: 'slava' }),
  start_param: 'homework',
};

const rejects = (initData, reason, options = {}) => assert.throws(
  () => validateInitData(initData, BOT_TOKEN, { now: NOW, ...options }),
  (error) => error instanceof InitDataError && error.reason === reason,
);

test('accepts initData signed with the bot token', () => {
  const result = validateInitData(sign(fields), BOT_TOKEN, { now: NOW });
  assert.equal(result.user.id, 42);
  assert.equal(result.user.first_name, 'Вячеслав');
  assert.equal(result.startParam, 'homework');
});

test('rejects initData signed with another token', () => {
  rejects(sign(fields, 'another-token'), 'signature');
});

test('rejects tampered initData', () => {
  const tampered = sign(fields).replace('%22id%22%3A42', '%22id%22%3A43');
  rejects(tampered, 'signature');
});

test('rejects expired initData', () => {
  rejects(sign({ ...fields, auth_date: String(NOW / 1000 - 90_000) }), 'expired');
});

test('rejects missing or duplicated hash', () => {
  rejects(new URLSearchParams(fields).toString(), 'hash');
  rejects(`${sign(fields)}&hash=00`, 'hash');
  rejects('', 'missing');
});

test('rejects initData without user', () => {
  const { user, ...withoutUser } = fields;
  rejects(sign(withoutUser), 'user');
});
