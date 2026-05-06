import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPin,
  verifyPin,
  createAuth,
  TOKEN_TTL_MS,
  LOCKOUT_ATTEMPTS,
  LOCKOUT_DURATION_MS,
} from '../../server/auth.js';

describe('hashPin', () => {
  test('returns hex hash and salt', () => {
    const result = hashPin('1234');
    assert.equal(typeof result.hash, 'string');
    assert.equal(typeof result.salt, 'string');
    assert.match(result.hash, /^[0-9a-f]+$/);
    assert.match(result.salt, /^[0-9a-f]+$/);
  });

  test('produces different salts on each invocation', () => {
    const a = hashPin('1234');
    const b = hashPin('1234');
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.hash, b.hash);
  });
});

describe('verifyPin', () => {
  test('accepts correct PIN', () => {
    const stored = hashPin('1234');
    assert.equal(verifyPin('1234', stored), true);
  });

  test('rejects wrong PIN', () => {
    const stored = hashPin('1234');
    assert.equal(verifyPin('1235', stored), false);
  });

  test('rejects empty PIN', () => {
    const stored = hashPin('1234');
    assert.equal(verifyPin('', stored), false);
  });

  test('rejects malformed stored object', () => {
    assert.equal(verifyPin('1234', { hash: 'abc', salt: 'xyz' }), false);
  });
});

describe('createAuth — token issuance', () => {
  test('issueToken returns base64url token and expiresAt', () => {
    const auth = createAuth();
    const { token, expiresAt } = auth.issueToken();
    assert.equal(typeof token, 'string');
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.ok(token.length >= 32);
    assert.ok(expiresAt > Date.now());
  });

  test('expiresAt = now + TOKEN_TTL_MS', () => {
    const fixedNow = 1_700_000_000_000;
    const auth = createAuth({ now: () => fixedNow });
    const { expiresAt } = auth.issueToken();
    assert.equal(expiresAt, fixedNow + TOKEN_TTL_MS);
  });

  test('issued tokens are unique', () => {
    const auth = createAuth();
    const a = auth.issueToken();
    const b = auth.issueToken();
    assert.notEqual(a.token, b.token);
  });
});

describe('createAuth — token validation', () => {
  test('validateToken returns true for fresh token', () => {
    const auth = createAuth();
    const { token } = auth.issueToken();
    assert.equal(auth.validateToken(token), true);
  });

  test('validateToken returns false for unknown token', () => {
    const auth = createAuth();
    assert.equal(auth.validateToken('bogus-token'), false);
  });

  test('validateToken returns false for expired token', () => {
    let now = 1000;
    const auth = createAuth({ now: () => now });
    const { token } = auth.issueToken();
    now += TOKEN_TTL_MS + 1;
    assert.equal(auth.validateToken(token), false);
  });

  test('invalidateToken removes the token', () => {
    const auth = createAuth();
    const { token } = auth.issueToken();
    auth.invalidateToken(token);
    assert.equal(auth.validateToken(token), false);
  });
});

describe('createAuth — token GC', () => {
  test('gcExpiredTokens removes only expired tokens', () => {
    let now = 1000;
    const auth = createAuth({ now: () => now });
    const a = auth.issueToken();
    now += TOKEN_TTL_MS + 1;
    const b = auth.issueToken();
    const removed = auth.gcExpiredTokens();
    assert.equal(removed, 1);
    assert.equal(auth.validateToken(a.token), false);
    assert.equal(auth.validateToken(b.token), true);
  });

  test('gcExpiredTokens returns 0 when nothing expired', () => {
    const auth = createAuth();
    auth.issueToken();
    assert.equal(auth.gcExpiredTokens(), 0);
  });
});

describe('createAuth — lockout', () => {
  test('isLocked is false initially', () => {
    const auth = createAuth();
    const result = auth.isLocked();
    assert.equal(result.locked, false);
    assert.equal(result.unlockAt, null);
  });

  test('recordFailure decrements remainingAttempts', () => {
    const auth = createAuth();
    for (let i = 1; i < LOCKOUT_ATTEMPTS; i++) {
      const result = auth.recordFailure();
      assert.equal(result.remainingAttempts, LOCKOUT_ATTEMPTS - i);
      assert.equal(result.lockedUntil, null);
    }
  });

  test('Nth failure (LOCKOUT_ATTEMPTS) triggers lockout', () => {
    const fixedNow = 1_700_000_000_000;
    const auth = createAuth({ now: () => fixedNow });
    for (let i = 0; i < LOCKOUT_ATTEMPTS - 1; i++) auth.recordFailure();
    const result = auth.recordFailure();
    assert.equal(result.remainingAttempts, 0);
    assert.equal(result.lockedUntil, fixedNow + LOCKOUT_DURATION_MS);
    assert.equal(auth.isLocked().locked, true);
    assert.equal(auth.isLocked().unlockAt, fixedNow + LOCKOUT_DURATION_MS);
  });

  test('lockout clears once duration elapses', () => {
    let now = 1000;
    const auth = createAuth({ now: () => now });
    for (let i = 0; i < LOCKOUT_ATTEMPTS; i++) auth.recordFailure();
    assert.equal(auth.isLocked().locked, true);
    now += LOCKOUT_DURATION_MS + 1;
    assert.equal(auth.isLocked().locked, false);
  });

  test('after lockout clears, recordFailure starts fresh', () => {
    let now = 1000;
    const auth = createAuth({ now: () => now });
    for (let i = 0; i < LOCKOUT_ATTEMPTS; i++) auth.recordFailure();
    now += LOCKOUT_DURATION_MS + 1;
    auth.isLocked();
    const result = auth.recordFailure();
    assert.equal(result.remainingAttempts, LOCKOUT_ATTEMPTS - 1);
  });

  test('clearFailures resets failure count', () => {
    const auth = createAuth();
    auth.recordFailure();
    auth.recordFailure();
    auth.clearFailures();
    const result = auth.recordFailure();
    assert.equal(result.remainingAttempts, LOCKOUT_ATTEMPTS - 1);
  });
});
