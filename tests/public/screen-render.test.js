import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { splitIntoSections } from '../../public/screen-render.js';

describe('splitIntoSections', () => {
  test('returns single plain section when no boxes', () => {
    const text = 'hello\nworld';
    const sections = splitIntoSections(text);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].type, 'plain');
  });

  test('detects rounded box block and extracts content', () => {
    const text = [
      'before',
      '╭─────────────────╮',
      '│ npm test        │',
      '│ vitest run      │',
      '╰─────────────────╯',
      'after',
    ].join('\n');
    const sections = splitIntoSections(text);
    assert.equal(sections.length, 3);
    assert.equal(sections[0].type, 'plain');
    assert.equal(sections[1].type, 'block');
    assert.equal(sections[1].content, 'npm test\nvitest run');
    assert.equal(sections[2].type, 'plain');
  });

  test('detects square box block', () => {
    const text = [
      '┌──────┐',
      '│ ls   │',
      '└──────┘',
    ].join('\n');
    const sections = splitIntoSections(text);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].type, 'block');
    assert.equal(sections[0].content, 'ls');
  });

  test('falls back to plain when block is malformed (no bottom)', () => {
    const text = [
      '╭───╮',
      '│ x │',
      'no bottom',
      'after',
    ].join('\n');
    const sections = splitIntoSections(text);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].type, 'plain');
    assert.deepEqual(sections[0].lines, ['╭───╮', '│ x │', 'no bottom', 'after']);
  });

  test('handles ANSI escape codes inside box lines', () => {
    const text = [
      '╭───────╮',
      '│ \x1b[1mhello\x1b[0m │',
      '╰───────╯',
    ].join('\n');
    const sections = splitIntoSections(text);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].type, 'block');
    // ANSI is preserved in content (will be parsed when rendered)
    assert.match(sections[0].content, /hello/);
  });

  test('multiple consecutive blocks', () => {
    const text = [
      '╭───╮',
      '│ a │',
      '╰───╯',
      '╭───╮',
      '│ b │',
      '╰───╯',
    ].join('\n');
    const sections = splitIntoSections(text);
    assert.equal(sections.length, 2);
    assert.equal(sections[0].type, 'block');
    assert.equal(sections[1].type, 'block');
    assert.equal(sections[0].content, 'a');
    assert.equal(sections[1].content, 'b');
  });
});
