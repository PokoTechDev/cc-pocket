import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDetector, stripAnsi } from '../../server/detector.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(__dirname, '..', 'fixtures', 'approval_edit.txt'), 'utf8');

const NUMBERED_PATTERN = {
  id: 'claude_code_numbered_v1',
  description: 'numbered 3-option approval',
  regex: 'Esc\\s+to\\s+cancel\\s*·\\s*Tab\\s+to\\s+amend',
  flags: '',
  options: [
    { label: '許可', keystroke: '1', isDefault: true },
    { label: '常に許可', keystroke: '2', isDefault: false },
    { label: '拒否', keystroke: '3', isDefault: false },
  ],
  windowSize: 4096,
};

describe('stripAnsi', () => {
  test('removes SGR sequences', () => {
    assert.equal(stripAnsi('\x1b[38;5;246mhello\x1b[39m'), 'hello');
  });

  test('removes nested SGR + bold', () => {
    assert.equal(stripAnsi('\x1b[1mfoo\x1b[0m\x1b[31mbar\x1b[0m'), 'foobar');
  });

  test('removes OSC hyperlink sequences', () => {
    const input = '\x1b]8;id=x;file:///x\x07Link\x1b]8;;\x07';
    assert.equal(stripAnsi(input), 'Link');
  });

  test('preserves plain text and newlines', () => {
    assert.equal(stripAnsi('a\nb\nc'), 'a\nb\nc');
  });
});

describe('createDetector — empty patterns', () => {
  test('detect returns null when patterns array is empty', () => {
    const det = createDetector({ patterns: [] });
    assert.equal(det.detect('anything'), null);
  });
});

describe('createDetector — fixture (real Claude Code Edit prompt)', () => {
  const det = createDetector({ patterns: [NUMBERED_PATTERN], now: () => 1_700_000_000_000 });

  test('detects approval in raw ANSI fixture', () => {
    const result = det.detect(FIXTURE);
    assert.ok(result, 'expected detection');
    assert.equal(result.patternId, 'claude_code_numbered_v1');
    assert.equal(result.detectedAt, 1_700_000_000_000);
    assert.deepEqual(result.options, NUMBERED_PATTERN.options);
  });

  test('extracts prompt context (last 500 ANSI-stripped chars max)', () => {
    const result = det.detect(FIXTURE);
    assert.ok(result.prompt.length <= 500);
    assert.match(result.prompt, /Do you want to make this edit/);
    assert.match(result.prompt, /1\.\s*Yes/);
    assert.doesNotMatch(result.prompt, /\x1b\[/, 'prompt must be ANSI-stripped');
  });
});

describe('createDetector — synthetic Bash prompt', () => {
  const det = createDetector({ patterns: [NUMBERED_PATTERN] });
  const synthetic = [
    'Bash command',
    '  say "approval test"',
    '',
    'Do you want to proceed?',
    ' ❯ 1. Yes',
    '   2. Yes, and don\'t ask again for: say *',
    '   3. No',
    '',
    ' Esc to cancel · Tab to amend · ctrl+e to explain',
  ].join('\n');

  test('matches Bash variant with extra footer suffix', () => {
    const result = det.detect(synthetic);
    assert.ok(result);
    assert.equal(result.patternId, 'claude_code_numbered_v1');
  });
});

describe('createDetector — non-matching content', () => {
  const det = createDetector({ patterns: [NUMBERED_PATTERN] });

  test('returns null on plain output', () => {
    assert.equal(det.detect('just normal claude output\nno approval here'), null);
  });

  test('returns null on partial footer (only Esc to cancel)', () => {
    assert.equal(det.detect('something Esc to cancel something else'), null);
  });
});

describe('createDetector — windowSize trimming', () => {
  test('only scans last windowSize bytes for performance', () => {
    const big = 'x'.repeat(100_000) + '\n Esc to cancel · Tab to amend';
    const det = createDetector({ patterns: [NUMBERED_PATTERN] });
    const result = det.detect(big);
    assert.ok(result);
  });

  test('match outside window is ignored', () => {
    const pattern = { ...NUMBERED_PATTERN, windowSize: 100 };
    const det = createDetector({ patterns: [pattern] });
    const big = 'Esc to cancel · Tab to amend' + 'x'.repeat(200);
    assert.equal(det.detect(big), null);
  });
});
