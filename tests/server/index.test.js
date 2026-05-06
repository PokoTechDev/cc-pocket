import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPinStore } from '../../server/index.js';
import { hashPin } from '../../server/auth.js';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-pocket-index-'));
  try { return fn(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('createPinStore', () => {
  test('read returns null when file does not exist', () => {
    withTempDir((dir) => {
      const store = createPinStore(join(dir, 'pin.json'));
      assert.equal(store.read(), null);
      assert.equal(store.exists(), false);
    });
  });

  test('read parses valid pin.json', () => {
    withTempDir((dir) => {
      const file = join(dir, 'pin.json');
      const stored = hashPin('1234');
      writeFileSync(file, JSON.stringify(stored));
      const store = createPinStore(file);
      assert.equal(store.exists(), true);
      assert.deepEqual(store.read(), stored);
    });
  });

  test('read returns null on malformed JSON', () => {
    withTempDir((dir) => {
      const file = join(dir, 'pin.json');
      writeFileSync(file, 'not json');
      const store = createPinStore(file);
      assert.equal(store.read(), null);
    });
  });
});
