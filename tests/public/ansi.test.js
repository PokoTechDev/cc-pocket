import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnsi } from '../../public/ansi.js';

const ESC = '\x1b';

describe('parseAnsi — plain text', () => {
  test('returns single segment with empty style', () => {
    const segs = parseAnsi('hello world');
    assert.deepEqual(segs, [{ text: 'hello world', style: '' }]);
  });

  test('preserves newlines', () => {
    const segs = parseAnsi('a\nb\nc');
    assert.equal(segs.length, 1);
    assert.equal(segs[0].text, 'a\nb\nc');
  });
});

describe('parseAnsi — SGR colors', () => {
  test(`${ESC}[31m red ${ESC}[0m → red segment then reset`, () => {
    const segs = parseAnsi(`${ESC}[31mred${ESC}[0m`);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].text, 'red');
    assert.match(segs[0].style, /color:#cd3131/);
  });

  test(`${ESC}[32m+text+${ESC}[39m default fg returns to none`, () => {
    const segs = parseAnsi(`${ESC}[32mok${ESC}[39mdefault`);
    assert.equal(segs.length, 2);
    assert.match(segs[0].style, /color:#0dbc79/);
    assert.equal(segs[1].style, '');
  });

  test('bright variants 90-97 supported', () => {
    const segs = parseAnsi(`${ESC}[91mlight-red${ESC}[0m`);
    assert.match(segs[0].style, /color:#f14c4c/);
  });
});

describe('parseAnsi — bold', () => {
  test('bold + color combine', () => {
    const segs = parseAnsi(`${ESC}[1;32mboldgreen${ESC}[0m`);
    assert.match(segs[0].style, /color:#0dbc79/);
    assert.match(segs[0].style, /font-weight:bold/);
  });

  test('SGR 22 turns off bold', () => {
    const segs = parseAnsi(`${ESC}[1mbold${ESC}[22mthin`);
    assert.match(segs[0].style, /bold/);
    assert.doesNotMatch(segs[1].style, /bold/);
  });
});

describe('parseAnsi — non-SGR sequences', () => {
  test('cursor movement is stripped', () => {
    const segs = parseAnsi(`a${ESC}[10Db`);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].text, 'ab');
  });

  test('ED erase is stripped', () => {
    const segs = parseAnsi(`x${ESC}[2Jy`);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].text, 'xy');
  });

  test('private mode set/reset is stripped', () => {
    const segs = parseAnsi(`${ESC}[?2004hready${ESC}[?2004l`);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].text, 'ready');
  });
});

describe('parseAnsi — control characters', () => {
  test('CR alone is stripped', () => {
    const segs = parseAnsi('a\rb');
    assert.equal(segs[0].text, 'ab');
  });

  test('BEL is stripped', () => {
    const segs = parseAnsi('hi\x07');
    assert.equal(segs[0].text, 'hi');
  });

  test('BS is stripped', () => {
    const segs = parseAnsi('a\bb');
    assert.equal(segs[0].text, 'ab');
  });
});

describe('parseAnsi — incomplete sequences', () => {
  test('truncated escape at end is dropped', () => {
    const segs = parseAnsi(`hello${ESC}[31`);
    assert.equal(segs[0].text, 'hello');
  });
});

describe('parseAnsi — realistic prompt example', () => {
  test('strips control codes in zsh prompt-like text', () => {
    const input = `${ESC}[1m${ESC}[7m%${ESC}[27m${ESC}[1m${ESC}[0m  text`;
    const segs = parseAnsi(input);
    const combined = segs.map((s) => s.text).join('');
    assert.match(combined, /text/);
    assert.doesNotMatch(combined, /\x1b/);
  });
});
