'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stripAnsi, visibleLen, splitVisible, clipAnsi } = require('../src/ui/ansi');
const { parseBlocks, renderCodeBlock, renderMarkdownLine, wrapText, prepare, highlightCode } = require('../src/ui/render');

const palette = { muted: 244, tool: 51, accent: 33, user: 214, error: 203, ok: 78 };

test('parseBlocks preserves code indentation', () => {
  const src = '```java\npublic class A {\n  public static void main() {\n    System.out.println("x");\n  }\n}\n```';
  const blocks = parseBlocks(src);
  assert.equal(blocks[0].type, 'code');
  assert.match(blocks[0].content, /  public static void main/);
  assert.match(blocks[0].content, /    System\.out\.println/);
});

test('highlightCode does not treat # inside python string as comment', () => {
  const line = highlightCode('s = "not # comment"', 'python');
  assert.ok(!line.includes('244m# comment'));
  assert.ok(line.includes('114m"not # comment"'));
});

test('highlightCode uses placeholders safe from number regex', () => {
  const line = highlightCode('print("Nilai: ")', 'python');
  assert.ok(line.includes('114m"Nilai: "'));
  assert.ok(!line.includes('\x00'));
});

test('renderCodeBlock clips long lines with ANSI-aware ellipsis', () => {
  const block = { lang: 'java', content: 'public static void main(String[] args) { System.out.println("very very very long"); }' };
  const lines = renderCodeBlock(block, 30, palette);
  const joined = lines.join('\n');
  assert.ok(joined.includes('…'));
  assert.ok(!joined.includes('very very very long'));
});

test('splitVisible keeps blessed tags balanced', () => {
  const s = '{underline}{33-fg}https://example.com/' + 'a'.repeat(50) + '{/33-fg}{/underline}';
  const parts = splitVisible(s, 20);
  assert.ok(parts.length > 1);
  for (const p of parts) {
    assert.equal((p.match(/\{underline\}/g) || []).length, (p.match(/\{\/underline\}/g) || []).length);
    assert.equal((p.match(/\{33-fg\}/g) || []).length, (p.match(/\{\/33-fg\}/g) || []).length);
  }
});

test('clipAnsi keeps blessed tags balanced', () => {
  const s = '{bold}{33-fg}hello world this is long{/33-fg}{/bold}';
  const out = clipAnsi(s, 10);
  assert.ok(out.includes('…'));
  assert.equal((out.match(/\{bold\}/g) || []).length, (out.match(/\{\/bold\}/g) || []).length);
});

test('wrapText preserves indentation on wrapped lines', () => {
  const lines = wrapText('  - item panjang sekali yang harus wrap dan tetap indented dengan baik', 24);
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(l.startsWith('  '));
});

test('visibleLen ignores ANSI and blessed tags', () => {
  assert.equal(visibleLen('\x1b[38;5;141mhello\x1b[39m'), 5);
  assert.equal(visibleLen('{bold}hello{/bold}'), 5);
  assert.equal(visibleLen('{open}x{close}'), 3);
});

test('renderMarkdownLine linkifies URL', () => {
  const out = renderMarkdownLine('lihat https://example.com ya', palette);
  assert.ok(out.includes('{underline}'));
  assert.ok(out.includes('https://example.com'));
});
