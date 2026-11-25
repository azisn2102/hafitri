'use strict';

function stripAnsi(s) {
  return String(s == null ? '' : s).replace(/\x1b\[[0-9;]*m/g, '');
}

function charWidth(cp) {
  if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) return 0;
  if (cp >= 0x300 && cp <= 0x36f) return 0; // combining
  if (cp >= 0x200b && cp <= 0x200f) return 0;
  if (cp >= 0xfe00 && cp <= 0xfe0f) return 0; // variation selectors
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) return 2;
  return 1;
}

function stringWidth(s) {
  let w = 0;
  for (const ch of String(s == null ? '' : s)) w += charWidth(ch.codePointAt(0));
  return w;
}

function visibleLen(s) {
  let plain = stripAnsi(String(s == null ? '' : s));
  // Lindungi escaped brace blessed agar tidak ikut ter-strip sebagai tag.
  plain = plain.replace(/\{open\}/g, '\x00LBRACE\x00').replace(/\{close\}/g, '\x00RBRACE\x00');
  plain = plain.replace(/\{\/?[^{}]+\}/g, '');
  plain = plain.replace(/\x00LBRACE\x00/g, '{').replace(/\x00RBRACE\x00/g, '}');
  return stringWidth(plain);
}

function splitVisible(text, width) {
  const w = Math.max(4, width);
  const src = String(text == null ? '' : text);
  const chunks = [];
  let cur = '', vis = 0;
  const bStack = [];
  let ansi = '';
  const flush = () => {
    let out = cur;
    for (let i = bStack.length - 1; i >= 0; i--) out += `{/${bStack[i]}}`;
    if (ansi) out += '\x1b[0m';
    chunks.push(out);
    cur = ansi || '';
    for (const t of bStack) cur += `{${t}}`;
    vis = 0;
  };
  for (let i = 0; i < src.length; ) {
    const esc = src.slice(i).match(/^\x1b\[[0-9;]*m/);
    if (esc) { cur += esc[0]; ansi = esc[0] === '\x1b[0m' || esc[0] === '\x1b[39m' ? '' : esc[0]; i += esc[0].length; continue; }
    const tag = src.slice(i).match(/^\{(\/)?([^{}]+)\}/);
    if (tag) {
      const full = tag[0], close = !!tag[1], name = tag[2];
      if (name === 'open' || name === 'close') {
        const cw = stringWidth(name === 'open' ? '{' : '}');
        if (vis + cw > w && cur) flush();
        cur += full; vis += cw; i += full.length;
        if (vis >= w) flush();
        continue;
      }
      cur += full; i += full.length;
      if (close) { const idx = bStack.lastIndexOf(name); if (idx >= 0) bStack.splice(idx, 1); }
      else bStack.push(name);
      continue;
    }
    const cp = src.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const cw = charWidth(cp);
    if (vis + cw > w && cur) flush();
    cur += ch;
    i += ch.length;
    vis += cw;
    if (vis >= w) flush();
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [''];
}

function clipAnsi(line, max) {
  const limit = Math.max(4, max);
  if (visibleLen(line) <= limit) return line;
  let out = '';
  let vis = 0;
  const src = String(line == null ? '' : line);
  const bStack = [];
  let ansi = '';
  for (let i = 0; i < src.length && vis < limit - 1; ) {
    const esc = src.slice(i).match(/^\x1b\[[0-9;]*m/);
    if (esc) { out += esc[0]; ansi = esc[0] === '\x1b[0m' || esc[0] === '\x1b[39m' ? '' : esc[0]; i += esc[0].length; continue; }
    const tag = src.slice(i).match(/^\{(\/)?([^{}]+)\}/);
    if (tag) {
      const full = tag[0], close = !!tag[1], name = tag[2];
      if (name === 'open' || name === 'close') {
        const cw = stringWidth(name === 'open' ? '{' : '}');
        if (vis + cw > limit - 1) break;
        out += full; vis += cw; i += full.length; continue;
      }
      out += full; i += full.length;
      if (close) { const idx = bStack.lastIndexOf(name); if (idx >= 0) bStack.splice(idx, 1); }
      else bStack.push(name);
      continue;
    }
    const cp = src.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const cw = charWidth(cp);
    if (vis + cw > limit - 1) break;
    out += ch; i += ch.length; vis += cw;
  }
  for (let i = bStack.length - 1; i >= 0; i--) out += `{/${bStack[i]}}`;
  if (ansi) out += '\x1b[0m';
  return out + '…';
}

module.exports = { stripAnsi, charWidth, stringWidth, visibleLen, splitVisible, clipAnsi };
