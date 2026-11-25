'use strict';
const { visibleLen, splitVisible, clipAnsi, stringWidth } = require('./ansi');

const MATH_MAP = {
  'μ': 'mu', 'π': 'pi', 'θ': 'theta', 'ω': 'omega', 'Δ': 'Delta',
  'Φ': 'Phi', 'φ': 'phi', 'Σ': 'Sigma', '∑': 'sum', '×': 'x',
  '⋅': '*', '−': '-', '→': '->', '≤': '<=', '≥': '>=', '≠': '!=',
  '≈': '~', '°': ' deg', '∞': 'inf',
};

function tidy(text) {
  return String(text == null ? '' : text)
    .normalize('NFKD')
    .replace(/[\u200B-\u200F\u2060\uFEFF\u20D0-\u20FF\u0300-\u036F]/g, '')
    .replace(/[μπθωΔΦφΣ∑×⋅−→≤≥≠≈°∞]/g, (c) => MATH_MAP[c] || c)
    .split('\n')
    .map((line) => {
      const lead = (line.match(/^[ \t]*/) || [''])[0].replace(/\t/g, '  ');
      const body = line.slice((line.match(/^[ \t]*/) || [''])[0].length)
        .replace(/[ \t]+/g, ' ')
        .trim();
      return lead + body;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tidyCode(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '');
}

function parseBlocks(text) {
  const src = String(text == null ? '' : text).replace(/\r\n/g, '\n');
  const re = /```([a-z0-9+_-]*)\n?([\s\S]*?)```/gi;
  const blocks = [];
  let last = 0, m;
  while ((m = re.exec(src))) {
    if (m.index > last) blocks.push({ type: 'text', content: src.slice(last, m.index) });
    blocks.push({ type: 'code', lang: (m[1] || '').trim(), content: tidyCode(m[2]) });
    last = re.lastIndex;
  }
  if (last < src.length) blocks.push({ type: 'text', content: src.slice(last) });
  return blocks.length ? blocks : [{ type: 'text', content: src }];
}

function prepare(text, maxIndent) {
  return tidy(text)
    .replace(/^ {5,}/gm, ' '.repeat(maxIndent))
    .replace(/^(\s*)[-*+]\s+/gm, '$1• ')
    .replace(/^#{1,6}\s+/gm, '');
}

function wrapText(text, width) {
  const w = Math.max(8, width);
  const out = [];
  for (const para of String(text == null ? '' : text).split('\n')) {
    if (!para) { out.push(''); continue; }
    const indent = (para.match(/^\s*/) || [''])[0];
    const indentW = stringWidth(indent);
    const body = para.slice(indent.length);
    const contentW = Math.max(4, w - indentW);
    let line = '';
    for (const original of body.split(/\s+/).filter(Boolean)) {
      let word = original;
      while (visibleLen(word) > contentW) {
        if (line) { out.push(indent + line); line = ''; }
        const parts = splitVisible(word, contentW);
        out.push(...parts.slice(0, -1).map((p) => indent + p));
        word = parts[parts.length - 1] || '';
      }
      if (!word) continue;
      const candidate = line ? line + ' ' + word : word;
      if (!line) line = word;
      else if (visibleLen(candidate) <= contentW) line = candidate;
      else { out.push(indent + line); line = word; }
    }
    out.push(indent + line);
  }
  return out;
}

function tag(palette, text) {
  const esc = (n) => `\x1b[38;5;${n}m`;
  const reset = '\x1b[39m';
  return text
    .replace(/\{\/A\}/g, reset).replace(/\{\/M\}/g, reset).replace(/\{\/T\}/g, reset)
    .replace(/\{\/U\}/g, reset).replace(/\{\/E\}/g, reset).replace(/\{\/K\}/g, reset)
    .replace(/\{A\}/g, esc(palette.accent)).replace(/\{M\}/g, esc(palette.muted))
    .replace(/\{T\}/g, esc(palette.tool)).replace(/\{U\}/g, esc(palette.user))
    .replace(/\{E\}/g, esc(palette.error)).replace(/\{K\}/g, esc(palette.ok));
}

function linkify(line, palette) {
  const accent = palette ? `{${palette.accent}-fg}` : '{cyan-fg}';
  const accentClose = palette ? `{/${palette.accent}-fg}` : '{/cyan-fg}';
  const tool = palette ? `{${palette.tool}-fg}` : '{cyan-fg}';
  const toolClose = palette ? `{/${palette.tool}-fg}` : '{/cyan-fg}';
  let out = String(line == null ? '' : line)
    .replace(/([{}])/g, (c) => (c === '{' ? '{open}' : '{close}'))
    .replace(/\*\*([^*]+)\*\*/g, '{bold}$1{/bold}')
    .replace(/`([^`]+)`/g, tool + '$1' + toolClose);
  if (out.startsWith('│ ')) out = tool + out + toolClose;
  return out.replace(/https?:\/\/[^\s<>"'()]+/gi, (url) => {
    const clean = url.replace(/[.,;:!?]+$/, '');
    const tail = url.slice(clean.length);
    return `{underline}${accent}${clean}${accentClose}{/underline}${tail}`;
  });
}

function renderMarkdownLine(line, palette) {
  const tool = palette ? `{${palette.tool}-fg}` : '{cyan-fg}';
  const toolClose = palette ? `{/${palette.tool}-fg}` : '{/cyan-fg}';
  const muted = palette ? `{${palette.muted}-fg}` : '{#888-fg}';
  const mutedClose = palette ? `{/${palette.muted}-fg}` : '{/#888-fg}';
  const accent = palette ? `{${palette.accent}-fg}` : '{cyan-fg}';
  const accentClose = palette ? `{/${palette.accent}-fg}` : '{/cyan-fg}';
  let out = String(line == null ? '' : line)
    .replace(/([{}])/g, (c) => (c === '{' ? '{open}' : '{close}'))
    .replace(/\*\*([^*]+)\*\*/g, '{bold}$1{/bold}')
    .replace(/`([^`]+)`/g, tool + '$1' + toolClose);
  if (/^###\s+/.test(out)) out = '{bold}' + out.replace(/^###\s+/, '') + '{/bold}';
  else if (/^##\s+/.test(out)) out = '{bold}' + out.replace(/^##\s+/, '') + '{/bold}';
  else if (/^#\s+/.test(out)) out = '{bold}' + out.replace(/^#\s+/, '') + '{/bold}';
  if (/^\s*[-*]\s+/.test(out)) out = out.replace(/^(\s*)[-*]\s+/, '$1• ');
  if (/^>\s?/.test(out)) out = muted + '│ ' + out.replace(/^>\s?/, '') + mutedClose;
  out = out.replace(/https?:\/\/[^\s<>"'()]+/gi, (url) => {
    const clean = url.replace(/[.,;:!?]+$/, '');
    const tail = url.slice(clean.length);
    return `{underline}${accent}${clean}${accentClose}{/underline}${tail}`;
  });
  return out;
}

function highlightCode(line, lang) {
  const esc = (n) => `\x1b[38;5;${n}m`, R = '\x1b[39m';
  const kwC = esc(141), strC = esc(114), numC = esc(179), comC = esc(244), typC = esc(81);
  const l = String(lang || '').toLowerCase();
  let s = String(line == null ? '' : line).replace(/([{}])/g, (c) => (c === '{' ? '{open}' : '{close}'));
  const slots = [];
  const ph = (i) => `\x01${'x'.repeat(i + 1)}\x01`;
  const slot = (v) => { const i = slots.push(v) - 1; return ph(i); };
  s = s.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g, (m) => slot(strC + m + R));
  const hashLang = ['python','py','sh','bash','zsh','shell','rb','ruby','yaml','yml','toml','ini','conf','make','dockerfile'];
  const slashLang = ['java','js','javascript','ts','typescript','c','cpp','cc','cxx','h','hpp','go','rust','rs','php','swift','kotlin','kt','cs','scala','jsonc'];
  if (hashLang.includes(l)) s = s.replace(/(^\s*#.*$)/, (m) => slot(comC + m + R));
  else if (l === 'sql') s = s.replace(/(--.*$)/, (m) => slot(comC + m + R));
  else if (slashLang.includes(l) || !l) s = s.replace(/(\/\/.*$)/, (m) => slot(comC + m + R));
  s = s.replace(/\b(0x[\da-fA-F]+|\d+(?:\.\d+)?)\b/g, (m) => slot(numC + m + R));
  s = s.replace(/\b(class|public|private|protected|static|void|int|double|float|long|short|byte|char|boolean|new|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|throws|import|package|extends|implements|interface|enum|const|let|var|val|function|async|await|export|from|def|print|self|None|True|False|fn|pub|mut|struct|impl|use|mod|go|func|type|elif|pass|lambda|with|as|yield|match|select|where|insert|update|delete|create|table)\b/g, (m) => slot(kwC + m + R));
  s = s.replace(/\b(String|List|ArrayList|Map|HashMap|Set|Scanner|System|Object|Integer|Double|Boolean|Promise|Array|Number|console|Dict|Tuple|Optional)\b/g, (m) => slot(typC + m + R));
  return s.replace(/\x01(x+)\x01/g, (_, xs) => slots[xs.length - 1] || '');
}

function renderCodeBlock(block, width, palette) {
  const esc = (n) => `\x1b[38;5;${n}m`;
  const reset = '\x1b[39m';
  const dim = esc(palette.muted);
  const accent = esc(palette.tool);
  const lang = block.lang ? ` ${block.lang} ` : ' code ';
  const inner = Math.max(12, width - 4);
  const borderFill = Math.max(0, inner - visibleLen(lang) - 1);
  const top = dim + '┌─' + accent + lang + dim + '─'.repeat(borderFill) + '┐' + reset;
  const bot = dim + '└' + '─'.repeat(Math.max(0, inner + 1)) + '┘' + reset;
  const maxCode = Math.max(8, inner - 1);
  const lines = [top];
  for (const raw of String(block.content || '').split('\n')) {
    const code = highlightCode(raw, block.lang);
    lines.push(dim + '│ ' + reset + clipAnsi(code, maxCode));
  }
  lines.push(bot);
  return lines;
}

module.exports = {
  tidy, tidyCode, parseBlocks, prepare, wrapText, tag, linkify,
  renderMarkdownLine, highlightCode, renderCodeBlock,
};
