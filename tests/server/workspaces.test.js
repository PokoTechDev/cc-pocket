import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorkspaces, expandPath, DEFAULT_COMMAND } from '../../server/workspaces.js';

const HOME = '/Users/test';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-pocket-ws-'));
  try { return fn(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('expandPath', () => {
  test('expands leading ~ to homeDir', () => {
    assert.equal(expandPath('~/Projects/foo', HOME), '/Users/test/Projects/foo');
  });

  test('expands bare ~ to homeDir', () => {
    assert.equal(expandPath('~', HOME), '/Users/test');
  });

  test('passes absolute path through unchanged', () => {
    assert.equal(expandPath('/Users/test/x', HOME), '/Users/test/x');
  });

  test('does not expand ~ in middle of path', () => {
    assert.equal(expandPath('/foo/~/bar', HOME), '/foo/~/bar');
  });

  test('rejects relative path by returning as-is (caller validates)', () => {
    assert.equal(expandPath('relative/path', HOME), 'relative/path');
  });
});

describe('loadWorkspaces — file operations', () => {
  test('returns empty array when file does not exist', () => {
    withTempDir((dir) => {
      const result = loadWorkspaces({ filepath: join(dir, 'missing.json'), homeDir: HOME });
      assert.deepEqual(result, []);
    });
  });

  test('returns empty array on malformed JSON', () => {
    withTempDir((dir) => {
      const file = join(dir, 'workspaces.json');
      writeFileSync(file, 'not valid json');
      assert.deepEqual(loadWorkspaces({ filepath: file, homeDir: HOME }), []);
    });
  });

  test('parses valid file', () => {
    withTempDir((dir) => {
      const file = join(dir, 'workspaces.json');
      writeFileSync(file, JSON.stringify({
        workspaces: [
          { name: 'foo', path: '/abs/foo', command: 'claude' },
          { name: 'bar', path: '~/bar' },
        ],
      }));
      const result = loadWorkspaces({ filepath: file, homeDir: HOME });
      assert.equal(result.length, 2);
    });
  });
});

describe('loadWorkspaces — schema validation', () => {
  test('expands ~ in path field', () => {
    withTempDir((dir) => {
      const file = join(dir, 'workspaces.json');
      writeFileSync(file, JSON.stringify({
        workspaces: [{ name: 'home-test', path: '~/Projects/x' }],
      }));
      const result = loadWorkspaces({ filepath: file, homeDir: HOME });
      assert.equal(result[0].path, '/Users/test/Projects/x');
    });
  });

  test('fills default command when missing', () => {
    withTempDir((dir) => {
      const file = join(dir, 'workspaces.json');
      writeFileSync(file, JSON.stringify({
        workspaces: [{ name: 'no-cmd', path: '/abs/path' }],
      }));
      const result = loadWorkspaces({ filepath: file, homeDir: HOME });
      assert.equal(result[0].command, DEFAULT_COMMAND);
      assert.equal(DEFAULT_COMMAND, 'claude --resume');
    });
  });

  test('preserves explicit command', () => {
    withTempDir((dir) => {
      const file = join(dir, 'workspaces.json');
      writeFileSync(file, JSON.stringify({
        workspaces: [{ name: 'x', path: '/abs', command: 'claude --continue' }],
      }));
      const result = loadWorkspaces({ filepath: file, homeDir: HOME });
      assert.equal(result[0].command, 'claude --continue');
    });
  });

  test('skips entries with missing name', () => {
    withTempDir((dir) => {
      const file = join(dir, 'workspaces.json');
      writeFileSync(file, JSON.stringify({
        workspaces: [
          { path: '/abs/no-name' },
          { name: 'ok', path: '/abs/ok' },
        ],
      }));
      const result = loadWorkspaces({ filepath: file, homeDir: HOME });
      assert.equal(result.length, 1);
      assert.equal(result[0].name, 'ok');
    });
  });

  test('skips entries with missing path', () => {
    withTempDir((dir) => {
      const file = join(dir, 'workspaces.json');
      writeFileSync(file, JSON.stringify({
        workspaces: [
          { name: 'no-path' },
          { name: 'ok', path: '/abs/ok' },
        ],
      }));
      const result = loadWorkspaces({ filepath: file, homeDir: HOME });
      assert.equal(result.length, 1);
      assert.equal(result[0].name, 'ok');
    });
  });

  test('rejects relative path entries', () => {
    withTempDir((dir) => {
      const file = join(dir, 'workspaces.json');
      writeFileSync(file, JSON.stringify({
        workspaces: [
          { name: 'rel', path: 'relative/path' },
          { name: 'ok', path: '/abs/ok' },
        ],
      }));
      const result = loadWorkspaces({ filepath: file, homeDir: HOME });
      assert.equal(result.length, 1);
      assert.equal(result[0].name, 'ok');
    });
  });

  test('deduplicates by name (first wins)', () => {
    withTempDir((dir) => {
      const file = join(dir, 'workspaces.json');
      writeFileSync(file, JSON.stringify({
        workspaces: [
          { name: 'dup', path: '/abs/first' },
          { name: 'dup', path: '/abs/second' },
        ],
      }));
      const result = loadWorkspaces({ filepath: file, homeDir: HOME });
      assert.equal(result.length, 1);
      assert.equal(result[0].path, '/abs/first');
    });
  });

  test('returns empty array when workspaces field is not an array', () => {
    withTempDir((dir) => {
      const file = join(dir, 'workspaces.json');
      writeFileSync(file, JSON.stringify({ workspaces: 'not array' }));
      assert.deepEqual(loadWorkspaces({ filepath: file, homeDir: HOME }), []);
    });
  });
});
