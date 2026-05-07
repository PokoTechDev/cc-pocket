import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDetector, stripAnsi, extractOptions } from '../../server/detector.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_EDIT = readFileSync(join(__dirname, '..', 'fixtures', 'approval_edit.txt'), 'utf8');
const FIXTURE_FETCH = readFileSync(join(__dirname, '..', 'fixtures', 'approval_fetch.txt'), 'utf8');
const FIXTURE_RESUME_PICKER = readFileSync(join(__dirname, '..', 'fixtures', 'approval_resume_picker.txt'), 'utf8');

const NUMBERED_PATTERN = {
  id: 'claude_code_numbered_v4',
  description: 'generic 3-option picker (dynamic label extraction)',
  regex: '❯\\s+1\\.[\\s\\S]{1,500}?^\\s+2\\.[\\s\\S]{1,500}?^\\s+3\\.',
  flags: 'm',
  options: [
    { label: '1', keystroke: '1', isDefault: true },
    { label: '2', keystroke: '2', isDefault: false },
    { label: '3', keystroke: '3', isDefault: false },
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

describe('createDetector — fixture: Edit prompt', () => {
  const det = createDetector({ patterns: [NUMBERED_PATTERN], now: () => 1_700_000_000_000 });

  test('detects approval in raw ANSI fixture', () => {
    const result = det.detect(FIXTURE_EDIT);
    assert.ok(result, 'expected detection');
    assert.equal(result.patternId, 'claude_code_numbered_v4');
    assert.equal(result.detectedAt, 1_700_000_000_000);
  });

  test('extracts dynamic Yes/No labels from Edit prompt', () => {
    const result = det.detect(FIXTURE_EDIT);
    assert.equal(result.options.length, 3);
    assert.match(result.options[0].label, /^Yes$/);
    assert.match(result.options[2].label, /^No$/);
  });

  test('extracts prompt context (last 500 ANSI-stripped chars max)', () => {
    const result = det.detect(FIXTURE_EDIT);
    assert.ok(result.prompt.length <= 500);
    assert.match(result.prompt, /Do you want to make this edit/);
    assert.doesNotMatch(result.prompt, /\x1b\[/, 'prompt must be ANSI-stripped');
  });
});

describe('createDetector — fixture: Web Fetch prompt (different footer)', () => {
  const det = createDetector({ patterns: [NUMBERED_PATTERN] });

  test('detects fetch approval despite missing "Esc · Tab" footer', () => {
    const result = det.detect(FIXTURE_FETCH);
    assert.ok(result, 'expected detection on fetch fixture');
    assert.equal(result.patternId, 'claude_code_numbered_v4');
  });

  test('prompt context includes fetch question', () => {
    const result = det.detect(FIXTURE_FETCH);
    assert.match(result.prompt, /allow Claude to fetch/);
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
    assert.equal(result.patternId, 'claude_code_numbered_v4');
  });
});

describe('createDetector — non-matching content', () => {
  const det = createDetector({ patterns: [NUMBERED_PATTERN] });

  test('returns null on plain output', () => {
    assert.equal(det.detect('just normal claude output\nno approval here'), null);
  });

  test('returns null on bare ❯ marker (zsh prompt) without numbered options', () => {
    assert.equal(det.detect('❯ ls -la\n  total 0\n  some output'), null);
  });

  test('returns null on numbered list without ❯ marker', () => {
    assert.equal(det.detect(' 1. one\n 2. two\n 3. three'), null);
  });
});

describe('createDetector — fixture: Resume picker (generic detection)', () => {
  const det = createDetector({ patterns: [NUMBERED_PATTERN] });

  test('matches resume picker (3 numbered options after ❯)', () => {
    const result = det.detect(FIXTURE_RESUME_PICKER);
    assert.ok(result, 'expected resume picker to match generic 3-option detector');
  });

  test('extracts dynamic labels from screen text', () => {
    const result = det.detect(FIXTURE_RESUME_PICKER);
    assert.equal(result.options.length, 3);
    assert.match(result.options[0].label, /Resume from summary/);
    assert.match(result.options[1].label, /Resume full session/);
    assert.match(result.options[2].label, /Don't ask me again/);
    assert.equal(result.options[0].keystroke, '1');
    assert.equal(result.options[0].isDefault, true);
  });
});

describe('extractOptions — pure label parser', () => {
  test('extracts ❯ marker + 3 numbered options', () => {
    const text = ' ❯ 1. Yes\n   2. Yes, allow all\n   3. No';
    const opts = extractOptions(text);
    assert.equal(opts.length, 3);
    assert.equal(opts[0].label, 'Yes');
    assert.equal(opts[0].isDefault, true);
    assert.equal(opts[1].label, 'Yes, allow all');
    assert.equal(opts[1].isDefault, false);
    assert.equal(opts[2].label, 'No');
  });

  test('returns empty when no numbered options found', () => {
    assert.deepEqual(extractOptions('just text'), []);
  });

  test('handles trailing whitespace on each option', () => {
    const text = ' ❯ 1. Yes   \n   2. Maybe   \n   3. No   ';
    const opts = extractOptions(text);
    assert.equal(opts[0].label, 'Yes');
    assert.equal(opts[1].label, 'Maybe');
    assert.equal(opts[2].label, 'No');
  });

  test('reverse-scans only consecutive numbered lines (ignores earlier text)', () => {
    const text = 'Some prose. 1. inline numbered list\n\nthen prompt\n ❯ 1. A\n   2. B\n   3. C';
    const opts = extractOptions(text);
    assert.equal(opts.length, 3);
    assert.equal(opts[0].label, 'A');
  });
});

describe('createDetector — windowSize trimming', () => {
  test('detects approval at the end of large input', () => {
    const big = 'x'.repeat(100_000) + '\n ❯ 1. Yes\n   2. Always\n   3. No';
    const det = createDetector({ patterns: [NUMBERED_PATTERN] });
    const result = det.detect(big);
    assert.ok(result);
  });

  test('match outside window is ignored', () => {
    const pattern = { ...NUMBERED_PATTERN, windowSize: 30 };
    const det = createDetector({ patterns: [pattern] });
    const big = ' ❯ 1. Yes\n   2. Always\n   3. No' + 'x'.repeat(200);
    assert.equal(det.detect(big), null);
  });
});
