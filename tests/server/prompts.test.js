import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPrompts } from '../../server/prompts.js';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-pocket-prompts-'));
  try { return fn(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('loadPrompts', () => {
  test('returns [] when file does not exist', () => {
    assert.deepEqual(loadPrompts({ filepath: '/nonexistent/prompts.json' }), []);
  });

  test('returns [] for invalid JSON', () => {
    withTempDir((dir) => {
      const fp = join(dir, 'p.json');
      writeFileSync(fp, '{ invalid');
      assert.deepEqual(loadPrompts({ filepath: fp }), []);
    });
  });

  test('returns [] when prompts field missing', () => {
    withTempDir((dir) => {
      const fp = join(dir, 'p.json');
      writeFileSync(fp, JSON.stringify({ other: [] }));
      assert.deepEqual(loadPrompts({ filepath: fp }), []);
    });
  });

  test('parses valid prompt entries', () => {
    withTempDir((dir) => {
      const fp = join(dir, 'p.json');
      writeFileSync(fp, JSON.stringify({
        prompts: [
          { name: '/plan', text: '/plan ' },
          { name: 'review', text: 'review last commit' },
        ],
      }));
      const result = loadPrompts({ filepath: fp });
      assert.equal(result.length, 2);
      assert.equal(result[0].name, '/plan');
      assert.equal(result[0].text, '/plan ');
    });
  });

  test('skips invalid entries (missing name or text)', () => {
    withTempDir((dir) => {
      const fp = join(dir, 'p.json');
      writeFileSync(fp, JSON.stringify({
        prompts: [
          { name: 'ok', text: 'foo' },
          { name: '' },
          { text: 'no name' },
          { name: 'no text' },
          null,
          { name: 'ok2', text: 'bar' },
        ],
      }));
      const result = loadPrompts({ filepath: fp });
      assert.equal(result.length, 2);
      assert.equal(result[0].name, 'ok');
      assert.equal(result[1].name, 'ok2');
    });
  });

  test('deduplicates by name (first wins)', () => {
    withTempDir((dir) => {
      const fp = join(dir, 'p.json');
      writeFileSync(fp, JSON.stringify({
        prompts: [
          { name: 'dup', text: 'first' },
          { name: 'dup', text: 'second' },
        ],
      }));
      const result = loadPrompts({ filepath: fp });
      assert.equal(result.length, 1);
      assert.equal(result[0].text, 'first');
    });
  });

  test('rejects entries with text exceeding 4000 chars', () => {
    withTempDir((dir) => {
      const fp = join(dir, 'p.json');
      writeFileSync(fp, JSON.stringify({
        prompts: [{ name: 'big', text: 'x'.repeat(5000) }],
      }));
      assert.deepEqual(loadPrompts({ filepath: fp }), []);
    });
  });

  test('caps total at 50 entries', () => {
    withTempDir((dir) => {
      const fp = join(dir, 'p.json');
      const arr = Array.from({ length: 60 }, (_, i) => ({ name: `p${i}`, text: 'x' }));
      writeFileSync(fp, JSON.stringify({ prompts: arr }));
      assert.equal(loadPrompts({ filepath: fp }).length, 50);
    });
  });
});
