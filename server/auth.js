import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;

export const TOKEN_TTL_MS = 86_400_000;
export const LOCKOUT_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 600_000;

export function hashPin(pin) {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const hash = scryptSync(pin, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS).toString('hex');
  return { hash, salt };
}

export function verifyPin(pin, stored) {
  if (!stored || typeof stored.hash !== 'string' || typeof stored.salt !== 'string') {
    return false;
  }
  const computed = scryptSync(pin, stored.salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  let storedBuf;
  try {
    storedBuf = Buffer.from(stored.hash, 'hex');
  } catch {
    return false;
  }
  if (computed.length !== storedBuf.length) return false;
  return timingSafeEqual(computed, storedBuf);
}

export function createAuth({ now = () => Date.now() } = {}) {
  const tokens = new Map();
  let lockState = { failedAttempts: 0, lockedUntil: null };

  function issueToken() {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const createdAt = now();
    const expiresAt = createdAt + TOKEN_TTL_MS;
    tokens.set(token, { createdAt, expiresAt });
    return { token, expiresAt };
  }

  function validateToken(token) {
    const entry = tokens.get(token);
    if (!entry) return false;
    if (entry.expiresAt <= now()) {
      tokens.delete(token);
      return false;
    }
    return true;
  }

  function invalidateToken(token) {
    tokens.delete(token);
  }

  function gcExpiredTokens() {
    const cutoff = now();
    let removed = 0;
    for (const [token, entry] of tokens) {
      if (entry.expiresAt <= cutoff) {
        tokens.delete(token);
        removed += 1;
      }
    }
    return removed;
  }

  function isLocked() {
    if (lockState.lockedUntil && lockState.lockedUntil > now()) {
      return { locked: true, unlockAt: lockState.lockedUntil };
    }
    if (lockState.lockedUntil) {
      lockState = { failedAttempts: 0, lockedUntil: null };
    }
    return { locked: false, unlockAt: null };
  }

  function recordFailure() {
    const failedAttempts = lockState.failedAttempts + 1;
    if (failedAttempts >= LOCKOUT_ATTEMPTS) {
      const lockedUntil = now() + LOCKOUT_DURATION_MS;
      lockState = { failedAttempts, lockedUntil };
      return { remainingAttempts: 0, lockedUntil };
    }
    lockState = { failedAttempts, lockedUntil: null };
    return { remainingAttempts: LOCKOUT_ATTEMPTS - failedAttempts, lockedUntil: null };
  }

  function clearFailures() {
    lockState = { failedAttempts: 0, lockedUntil: null };
  }

  return {
    issueToken,
    validateToken,
    invalidateToken,
    gcExpiredTokens,
    isLocked,
    recordFailure,
    clearFailures,
  };
}
