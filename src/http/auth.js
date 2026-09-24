import { createHmac, timingSafeEqual } from 'node:crypto';

const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

export class InitDataError extends Error {
  constructor(reason) {
    super(`Invalid initData: ${reason}`);
    this.reason = reason;
  }
}

const parseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const validateInitData = (initData, botToken, { maxAgeSec = 86_400, now = Date.now() } = {}) => {
  if (!initData || !botToken) throw new InitDataError('missing');

  const params = new URLSearchParams(initData);
  const hashes = params.getAll('hash');
  if (hashes.length !== 1) throw new InitDataError('hash');
  params.delete('hash');

  const checkString = [...params.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const expected = hmac(hmac('WebAppData', botToken), checkString);
  const received = Buffer.from(hashes[0], 'hex');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new InitDataError('signature');
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || now / 1000 - authDate > maxAgeSec) {
    throw new InitDataError('expired');
  }

  const user = parseJson(params.get('user') ?? '');
  if (!user?.id) throw new InitDataError('user');

  return {
    user,
    chat: parseJson(params.get('chat') ?? '') ?? undefined,
    startParam: params.get('start_param') ?? undefined,
    authDate,
  };
};
