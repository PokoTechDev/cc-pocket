import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileTailer, CHUNK_MAX_LEN } from '../../server/tailer.js';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-pocket-tailer-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('createFileTailer — initial position', () => {
  test('does not replay existing file content', () => {
    withTempDir((dir) => {
      const file = join(dir, 'a.log');
      writeFileSync(file, 'pre-existing content');
      const chunks = [];
      const tailer = createFileTailer(file, (c) => chunks.push(c));
      tailer.sync();
      assert.deepEqual(chunks, []);
      tailer.stop();
    });
  });

  test('positions at 0 when file does not exist yet', () => {
    withTempDir((dir) => {
      const file = join(dir, 'new.log');
      const chunks = [];
      const tailer = createFileTailer(file, (c) => chunks.push(c));
      tailer.sync(); // file missing — no-op
      writeFileSync(file, 'first content');
      tailer.sync();
      assert.deepEqual(chunks, ['first content']);
      tailer.stop();
    });
  });
});

describe('createFileTailer — append detection', () => {
  test('emits exactly the appended text', () => {
    withTempDir((dir) => {
      const file = join(dir, 'a.log');
      writeFileSync(file, 'initial');
      const chunks = [];
      const tailer = createFileTailer(file, (c) => chunks.push(c));
      appendFileSync(file, 'A');
      tailer.sync();
      appendFileSync(file, 'BC');
      tailer.sync();
      assert.deepEqual(chunks, ['A', 'BC']);
      tailer.stop();
    });
  });

  test('multiple syncs without changes emit nothing', () => {
    withTempDir((dir) => {
      const file = join(dir, 'a.log');
      writeFileSync(file, '');
      const chunks = [];
      const tailer = createFileTailer(file, (c) => chunks.push(c));
      appendFileSync(file, 'data');
      tailer.sync();
      tailer.sync();
      tailer.sync();
      assert.deepEqual(chunks, ['data']);
      tailer.stop();
    });
  });
});

describe('createFileTailer — file rotation/truncation', () => {
  test('detects truncation and resumes from new EOF when shorter', () => {
    withTempDir((dir) => {
      const file = join(dir, 'a.log');
      writeFileSync(file, 'long initial content');
      const chunks = [];
      const tailer = createFileTailer(file, (c) => chunks.push(c));
      // Truncate then write smaller new content
      writeFileSync(file, 'new');
      tailer.sync();
      assert.deepEqual(chunks, ['new']);
      tailer.stop();
    });
  });
});

describe('createFileTailer — chunk size enforcement', () => {
  test('splits content longer than CHUNK_MAX_LEN', () => {
    withTempDir((dir) => {
      const file = join(dir, 'a.log');
      writeFileSync(file, '');
      const chunks = [];
      const tailer = createFileTailer(file, (c) => chunks.push(c));
      const huge = 'x'.repeat(CHUNK_MAX_LEN + 100);
      appendFileSync(file, huge);
      tailer.sync();
      assert.equal(chunks.length, 2);
      assert.equal(chunks[0].length, CHUNK_MAX_LEN);
      assert.equal(chunks[1].length, 100);
      tailer.stop();
    });
  });

  test('exact CHUNK_MAX_LEN emits a single chunk', () => {
    withTempDir((dir) => {
      const file = join(dir, 'a.log');
      writeFileSync(file, '');
      const chunks = [];
      const tailer = createFileTailer(file, (c) => chunks.push(c));
      appendFileSync(file, 'x'.repeat(CHUNK_MAX_LEN));
      tailer.sync();
      assert.equal(chunks.length, 1);
      assert.equal(chunks[0].length, CHUNK_MAX_LEN);
      tailer.stop();
    });
  });
});

describe('createFileTailer — lifecycle', () => {
  test('start() and stop() are idempotent and safe with missing file', () => {
    withTempDir((dir) => {
      const file = join(dir, 'never.log');
      const tailer = createFileTailer(file, () => {});
      assert.doesNotThrow(() => tailer.start());
      assert.doesNotThrow(() => tailer.start());
      assert.doesNotThrow(() => tailer.stop());
      assert.doesNotThrow(() => tailer.stop());
    });
  });

  test('after stop(), sync() still works (does not throw)', () => {
    withTempDir((dir) => {
      const file = join(dir, 'a.log');
      writeFileSync(file, '');
      const chunks = [];
      const tailer = createFileTailer(file, (c) => chunks.push(c));
      tailer.stop();
      assert.doesNotThrow(() => tailer.sync());
    });
  });
});
