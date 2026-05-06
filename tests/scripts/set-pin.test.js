import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isValidPinFormat, savePin } from '../../scripts/set-pin.js';
import { verifyPin } from '../../server/auth.js';

describe('isValidPinFormat', () => {
  test('accepts exactly 4 digits', () => {
    assert.equal(isValidPinFormat('1234'), true);
    assert.equal(isValidPinFormat('0000'), true);
    assert.equal(isValidPinFormat('9999'), true);
  });

  test('rejects wrong length', () => {
    assert.equal(isValidPinFormat('123'), false);
    assert.equal(isValidPinFormat('12345'), false);
    assert.equal(isValidPinFormat(''), false);
  });

  test('rejects non-digit characters', () => {
    assert.equal(isValidPinFormat('abcd'), false);
    assert.equal(isValidPinFormat('12 4'), false);
    assert.equal(isValidPinFormat('1.34'), false);
    assert.equal(isValidPinFormat('-123'), false);
  });

  test('rejects non-string input', () => {
    assert.equal(isValidPinFormat(1234), false);
    assert.equal(isValidPinFormat(null), false);
    assert.equal(isValidPinFormat(undefined), false);
  });
});

describe('savePin', () => {
  function withTempDir(fn) {
    const dir = mkdtempSync(join(tmpdir(), 'cc-pocket-test-'));
    try {
      return fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('writes pin.json with hash/salt that verify correctly', () => {
    withTempDir((dir) => {
      const pinFile = join(dir, 'pin.json');
      savePin('1234', pinFile);
      const stored = JSON.parse(readFileSync(pinFile, 'utf8'));
      assert.equal(typeof stored.hash, 'string');
      assert.equal(typeof stored.salt, 'string');
      assert.equal(verifyPin('1234', stored), true);
      assert.equal(verifyPin('5678', stored), false);
    });
  });

  test('writes file with mode 0600', () => {
    withTempDir((dir) => {
      const pinFile = join(dir, 'pin.json');
      savePin('1234', pinFile);
      const mode = statSync(pinFile).mode & 0o777;
      assert.equal(mode, 0o600);
    });
  });

  test('creates parent directory if missing', () => {
    withTempDir((dir) => {
      const pinFile = join(dir, 'nested', 'subdir', 'pin.json');
      savePin('1234', pinFile);
      const stored = JSON.parse(readFileSync(pinFile, 'utf8'));
      assert.equal(verifyPin('1234', stored), true);
    });
  });

  test('throws on invalid PIN format', () => {
    withTempDir((dir) => {
      const pinFile = join(dir, 'pin.json');
      assert.throws(() => savePin('abc', pinFile), /4 digits/);
      assert.throws(() => savePin('12345', pinFile), /4 digits/);
      assert.throws(() => savePin('', pinFile), /4 digits/);
    });
  });

  test('overwrites existing pin.json', () => {
    withTempDir((dir) => {
      const pinFile = join(dir, 'pin.json');
      savePin('1234', pinFile);
      const first = JSON.parse(readFileSync(pinFile, 'utf8'));
      savePin('5678', pinFile);
      const second = JSON.parse(readFileSync(pinFile, 'utf8'));
      assert.notEqual(first.hash, second.hash);
      assert.equal(verifyPin('5678', second), true);
      assert.equal(verifyPin('1234', second), false);
    });
  });
});
