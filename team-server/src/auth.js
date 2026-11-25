import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

const N = 16384;

export function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = scryptSync(pw, salt, 32, { N });
  return `s1$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function checkPassword(pw, stored) {
  const [v, salt, key] = String(stored).split('$');
  if (v !== 's1') return false;
  const want = Buffer.from(key, 'base64');
  const got = scryptSync(pw, Buffer.from(salt, 'base64'), want.length, { N });
  return timingSafeEqual(want, got);
}

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');

const COLORS = ['#e8835a', '#2f76e4', '#7c4fd6', '#23946a', '#d9822b', '#c4528f', '#1fa2c4', '#8a6d3b', '#dc4c3f', '#5b6bd6'];
export const pickColor = (seed) => COLORS[[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];

// Simple in-memory brake for password guessing.
const attempts = new Map();
export function rateLimit(key, max = 10, windowMs = 10 * 60 * 1000) {
  const t = Date.now();
  const a = (attempts.get(key) || []).filter((x) => t - x < windowMs);
  a.push(t);
  attempts.set(key, a);
  return a.length <= max;
}
