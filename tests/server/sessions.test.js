import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractCwdFromHead,
  parseFirstUserMessage,
  listRecentSessions,
} from '../../server/sessions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = join(__dirname, '..', 'fixtures', 'claude-projects');
const FS_MIRROR = join(__dirname, '..', 'fixtures', 'fs-mirror');

// existsSync mock that scopes to fs-mirror prefix (/Users/test/... → fs-mirror/Users/test/...)
function makeFsCheck(prefix) {
  return (absPath) => existsSync(join(prefix, absPath));
}

describe('extractCwdFromHead', () => {
  test('returns cwd from the first JSONL line that contains it', () => {
    const text = [
      '{"type":"permission-mode","cwd":"/Users/x/foo"}',
      '{"type":"user","message":{"content":"hi"}}',
    ].join('\n');
    assert.equal(extractCwdFromHead(text), '/Users/x/foo');
  });

  test('skips lines without cwd, finds it later', () => {
    const text = [
      '{"type":"permission-mode"}',
      '{"type":"file-history-snapshot","cwd":"/Users/x/bar"}',
    ].join('\n');
    assert.equal(extractCwdFromHead(text), '/Users/x/bar');
  });

  test('returns null when no line has cwd', () => {
    const text = '{"type":"permission-mode"}\n{"type":"user"}';
    assert.equal(extractCwdFromHead(text), null);
  });

  test('skips malformed lines without breaking', () => {
    const text = 'not json\n{"type":"x","cwd":"/Users/x/baz"}';
    assert.equal(extractCwdFromHead(text), '/Users/x/baz');
  });

  test('returns null for empty input', () => {
    assert.equal(extractCwdFromHead(''), null);
  });
});

describe('parseFirstUserMessage', () => {
  test('extracts string content from first user message', () => {
    const text = [
      '{"type":"permission-mode"}',
      '{"type":"file-history-snapshot"}',
      '{"type":"user","message":{"role":"user","content":"hello world"}}',
      '{"type":"assistant","message":{"content":"reply"}}',
    ].join('\n');
    assert.equal(parseFirstUserMessage(text), 'hello world');
  });

  test('extracts text from array content', () => {
    const text = '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"x"},{"type":"text","text":"actual user text"}]}}';
    assert.equal(parseFirstUserMessage(text), 'actual user text');
  });

  test('truncates message to 80 chars', () => {
    const long = 'x'.repeat(150);
    const text = `{"type":"user","message":{"role":"user","content":"${long}"}}`;
    assert.equal(parseFirstUserMessage(text).length, 80);
  });

  test('skips assistant messages and returns first user', () => {
    const text = [
      '{"type":"assistant","message":{"role":"assistant","content":"hi"}}',
      '{"type":"user","message":{"role":"user","content":"actual user"}}',
    ].join('\n');
    assert.equal(parseFirstUserMessage(text), 'actual user');
  });

  test('returns null when no user message found', () => {
    const text = '{"type":"permission-mode"}\n{"type":"file-history-snapshot"}';
    assert.equal(parseFirstUserMessage(text), null);
  });

  test('skips malformed lines without breaking', () => {
    const text = 'not json\n{"type":"user","message":{"role":"user","content":"recovered"}}';
    assert.equal(parseFirstUserMessage(text), 'recovered');
  });

  test('returns null for empty input', () => {
    assert.equal(parseFirstUserMessage(''), null);
  });

  test('returns null when content is empty string', () => {
    const text = '{"type":"user","message":{"role":"user","content":""}}';
    assert.equal(parseFirstUserMessage(text), null);
  });

  test('returns null when content array has no text type', () => {
    const text = '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"x"}]}}';
    assert.equal(parseFirstUserMessage(text), null);
  });
});

describe('listRecentSessions', () => {
  test('returns sessions sorted by mtime descending', async () => {
    const result = await listRecentSessions({
      projectsDir: PROJECTS_DIR,
      limit: 10,
      existsSync: makeFsCheck(FS_MIRROR),
    });
    assert.ok(result.length >= 2);
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i - 1].mtime >= result[i].mtime, 'must be desc by mtime');
    }
  });

  test('respects limit parameter', async () => {
    const result = await listRecentSessions({
      projectsDir: PROJECTS_DIR,
      limit: 1,
      existsSync: makeFsCheck(FS_MIRROR),
    });
    assert.equal(result.length, 1);
  });

  test('omits sessions whose cwd does not exist on disk', async () => {
    const result = await listRecentSessions({
      projectsDir: PROJECTS_DIR,
      limit: 10,
      existsSync: makeFsCheck(FS_MIRROR),
    });
    // /Users/test/never-existed not in fs-mirror → that session should be filtered
    assert.ok(!result.some((s) => s.projectPath.includes('never-existed')));
  });

  test('extracts firstUserMessage and projectPath from cwd', async () => {
    const result = await listRecentSessions({
      projectsDir: PROJECTS_DIR,
      limit: 10,
      existsSync: makeFsCheck(FS_MIRROR),
    });
    const session = result.find((s) => s.sessionId === 'aaaaaaaa-bbbb-cccc-dddd-111111111111');
    assert.ok(session, 'expected session to be present');
    assert.equal(session.firstUserMessage, 'こんにちは Claude');
    assert.equal(session.projectPath, '/Users/test/foo/bar');
    assert.equal(session.projectName, 'bar');
  });

  test('disambiguates foo-bar/baz from foo/bar via cwd field', async () => {
    const result = await listRecentSessions({
      projectsDir: PROJECTS_DIR,
      limit: 10,
      existsSync: makeFsCheck(FS_MIRROR),
    });
    const session = result.find((s) => s.sessionId === 'cccccccc-bbbb-aaaa-dddd-333333333333');
    assert.ok(session);
    assert.equal(session.projectPath, '/Users/test/foo-bar/baz');
  });

  test('returns empty array when projectsDir does not exist', async () => {
    const result = await listRecentSessions({
      projectsDir: '/nonexistent/dir',
      limit: 10,
      existsSync: () => false,
    });
    assert.deepEqual(result, []);
  });
});
