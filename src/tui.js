'use strict';
const fs = require('fs');
const path = require('path');
const blessed = require('blessed');
const cfg = require('./config');
const { newSession, step } = require('./loop');
const sess = require('./browser');
const geminiWeb = require('./geminiWeb');
const chatgptWeb = require('./chatgptWeb');
const claudeWeb = require('./claudeWeb');
const deepseekWeb = require('./deepseekWeb');
const geminiApi = require('./geminiApi');
const aistudioWeb = require('./aistudioWeb');
const store = require('./sessionStore');
const memory = require('./memory');

const THEMES = {
  opencode: {
    bg: 234, panel: 236, border: 238, text: 252, muted: 250,
    accent: 33, tool: 51, user: 214, error: 203, ok: 78,
    brand: '◆', userMark: '❯', agentMark: '◆', toolMark: '⚙',
  },
  mimo: {
    bg: 233, panel: 235, border: 239, text: 250, muted: 252,
    accent: 78, tool: 37, user: 192, error: 203, ok: 78,
    brand: '●', userMark: '›', agentMark: '●', toolMark: '·',
  },
};

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
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseBlocks(text) {
  const src = String(text == null ? '' : text).replace(/\r\n/g, '\n');
  const re = /```([a-z0-9+_-]*)\n?([\s\S]*?)```/gi;
  const blocks = [];
  let last = 0, m;
  while ((m = re.exec(src))) {
    if (m.index > last) blocks.push({ type: 'text', content: src.slice(last, m.index) });
    blocks.push({ type: 'code', lang: (m[1] || '').trim(), content: m[2].replace(/\n$/, '') });
    last = re.lastIndex;
  }
  if (last < src.length) blocks.push({ type: 'text', content: src.slice(last) });
  return blocks.length ? blocks : [{ type: 'text', content: src }];
}

/** Rapikan struktur teks biasa (bukan code fence). */
function prepare(text, maxIndent) {
  return tidy(text)
    .replace(/^ {5,}/gm, ' '.repeat(maxIndent))
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^#{1,6}\s+/gm, '');
}

/** Wrap sendiri (break_long_words=false) supaya blessed tidak memotong paksa. */
function wrapText(text, width) {
  const w = Math.max(8, width);
  const out = [];
  for (const para of String(text == null ? '' : text).split('\n')) {
    if (!para) { out.push(''); continue; }
    let line = '';
    for (const original of para.split(/\s+/)) {
      let word = original;
      while (word.length > w) {
        if (line) { out.push(line); line = ''; }
        out.push(word.slice(0, w));
        word = word.slice(w);
      }
      if (!word) continue;
      if (!line) line = word;
      else if (line.length + 1 + word.length <= w) line += ' ' + word;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

function tag(palette, text) {
  // Blessed tidak menerima {33-fg} di dalam string dinamis yang belum di-parse.
  // Gunakan ANSI langsung.
  const esc = (n) => `\x1b[38;5;${n}m`;
  const reset = '\x1b[39m';
  return text
    .replace(/\{\/A\}/g, reset)
    .replace(/\{\/M\}/g, reset)
    .replace(/\{\/T\}/g, reset)
    .replace(/\{\/U\}/g, reset)
    .replace(/\{\/E\}/g, reset)
    .replace(/\{\/K\}/g, reset)
    .replace(/\{A\}/g, esc(palette.accent))
    .replace(/\{M\}/g, esc(palette.muted))
    .replace(/\{T\}/g, esc(palette.tool))
    .replace(/\{U\}/g, esc(palette.user))
    .replace(/\{E\}/g, esc(palette.error))
    .replace(/\{K\}/g, esc(palette.ok));
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
  let out = String(line == null ? '' : line)
    .replace(/([{}])/g, (c) => (c === '{' ? '{open}' : '{close}'))
    .replace(/\*\*([^*]+)\*\*/g, '{bold}$1{/bold}')
    .replace(/`([^`]+)`/g, tool + '$1' + toolClose);
  if (/^###\s+/.test(out)) out = '{bold}' + out.replace(/^###\s+/, '') + '{/bold}';
  else if (/^##\s+/.test(out)) out = '{bold}' + out.replace(/^##\s+/, '') + '{/bold}';
  else if (/^#\s+/.test(out)) out = '{bold}' + out.replace(/^#\s+/, '') + '{/bold}';
  if (/^\s*[-*]\s+/.test(out)) out = out.replace(/^(\s*)[-*]\s+/, '$1• ');
  if (/^>\s?/.test(out)) out = muted + '│ ' + out.replace(/^>\s?/, '') + mutedClose;
  if (out.startsWith('│ ')) out = tool + out + toolClose;
  return out;
}

function renderCodeBlock(block, width, palette) {
  const esc = (n) => `\x1b[38;5;${n}m`;
  const reset = '\x1b[39m';
  const dim = esc(palette.muted);
  const accent = esc(palette.tool);
  const lang = block.lang ? ` ${block.lang} ` : ' code ';
  const inner = Math.max(10, width - 2);
  const top = dim + '┌' + '─' + accent + lang + dim + '─'.repeat(Math.max(0, inner - lang.length - 2)) + '┐' + reset;
  const bot = dim + '└' + '─'.repeat(Math.max(0, inner)) + '┘' + reset;
  const lines = [top];
  for (const raw of String(block.content || '').split('\n')) {
    const safe = raw.replace(/([{}])/g, (c) => (c === '{' ? '{open}' : '{close}'));
    const chunks = wrapText(safe, Math.max(8, inner - 2));
    for (const ch of chunks) lines.push(dim + '│ ' + reset + ch);
  }
  lines.push(bot);
  return lines;
}

function mdBody(text, width, palette) {
  const blocks = parseBlocks(String(text == null ? '' : text));
  const out = [];
  for (const b of blocks) {
    if (b.type === 'code') { out.push(...renderCodeBlock(b, width, palette)); continue; }
    const prepared = prepare(b.content, 4);
    for (const line of wrapText(prepared, Math.max(10, width - 2))) out.push('  ' + linkify(renderMarkdownLine(line, palette), palette));
  }
  return out;
}

const HELP = [
  '/help              bantuan ini (menu ini)',
  '/theme [nama]      opencode | mimo',
  '/new               sesi baru (sesi lama tetap tersimpan)',
  '/sessions          pilih sesi (↑↓ + Enter, ESC batal)',
  '/load <n|id>       muat sesi langsung',
  '/reset             kosongkan sesi aktif',
  '/clear             bersihkan layar (riwayat tetap tersimpan)',
  '/history           info riwayat tersimpan',
  '/login             start sesi noVNC + URL login',
  '/login chatgpt     buka chatgpt.com di noVNC untuk login',
  '/login claude      buka claude.ai di noVNC untuk login',
  '/login deepseek    buka chat.deepseek.com di noVNC untuk login',
  '/login aistudio    buka AI Studio di noVNC untuk login',
  '/session start     start browser + noVNC',
  '/session stop      matikan sesi browser',
  '/session status    cek status sesi',
  '/session url       URL noVNC',
  '/model <nama>      auto|flash|hydrogen|pro (Gemini) atau nama model API',
  '/reasoning <level> rendah|menengah|tinggi|off (khusus Hydrogen)',
  '/provider         pilih provider (↑↓ + Enter, ESC batal)',
  '/yolo [on|off]     izinkan perintah berisiko',
  '/steps N           batas langkah tool',
  '/quit              keluar',
];

/** TUI full-screen bertema agent CLI modern: satu sesi, percakapan berlanjut. */
function start(opts) {
  if (!process.stdin.isTTY) throw new Error('TUI membutuhkan terminal interaktif (TTY).');
  geminiWeb.setTui(true); // jangan tulis log progres ke stderr, nanti merusak layar
  chatgptWeb.setTui(true);
  claudeWeb.setTui(true);
  deepseekWeb.setTui(true);
  aistudioWeb.setTui(true);

  let theme = 'opencode';
  let palette = THEMES[theme];
  const screen = blessed.screen({ smartCSR: true, fullUnicode: true, title: 'hafitri', warnings: false });

  const header = blessed.box({
    top: 0, left: 0, width: '100%', height: 1, tags: true,
    style: { fg: palette.text, bg: palette.panel },
  });
  const log = blessed.box({
    top: 1, left: 0, width: '100%', height: '100%-5',
    label: ' PERCAKAPAN ', border: { type: 'round' },
    tags: true, wrap: true, scrollable: true, alwaysScroll: true, keys: true, mouse: true,
    padding: { left: 1, right: 1 },
    scrollbar: {
      ch: ' ',
      style: { bg: palette.accent },
      track: { style: { bg: palette.panel } },
    },
    style: { fg: palette.text, bg: palette.bg, border: { fg: palette.accent }, label: { fg: palette.accent, bold: true } },
  });
  const status = blessed.box({
    bottom: 3, left: 0, width: '100%', height: 1,
    style: { fg: palette.text, bg: palette.bg },
  });
  const input = blessed.textbox({
    bottom: 0, left: 0, width: '100%', height: 3,
    label: ' ❯ pesan (Enter kirim · /help perintah) ', border: { type: 'round' }, inputOnFocus: true,
    style: { fg: palette.text, bg: palette.panel, border: { fg: palette.accent }, label: { fg: palette.accent, bold: true } },
  });

  const notice = blessed.box({
    top: 3, left: 2, width: '86%', height: '70%',
    label: ' INFO ', border: { type: 'round' }, tags: false,
    hidden: true, scrollable: true, keys: false, mouse: false,
    padding: { left: 1, right: 1 },
    style: { fg: palette.text, bg: palette.panel, border: { fg: palette.accent }, label: { fg: palette.accent, bold: true } },
  });

  const picker = blessed.list({
    top: 3, left: 2, width: '86%', height: '70%',
    label: ' PILIH SESI — ↑↓ lalu Enter, ESC batal ', border: { type: 'round' },
    hidden: true, keys: true, mouse: true, vi: false,
    style: {
      fg: palette.text, bg: palette.panel,
      border: { fg: palette.accent }, label: { fg: palette.accent, bold: true },
      selected: { fg: palette.text, bg: palette.accent },
    },
  });

  const providerPicker = blessed.list({
    top: 3, left: 2, width: '86%', height: '40%',
    label: ' PILIH PROVIDER — ↑↓ lalu Enter, ESC batal ', border: { type: 'round' },
    hidden: true, keys: true, mouse: true, vi: false,
    style: {
      fg: palette.text, bg: palette.panel,
      border: { fg: palette.accent }, label: { fg: palette.accent, bold: true },
      selected: { fg: palette.text, bg: palette.accent },
    },
  });

  const helpPicker = blessed.list({
    top: 3, left: 2, width: '86%', height: '70%',
    label: ' BANTUAN — ↑↓ lalu Enter pilih, ESC tutup ', border: { type: 'round' },
    hidden: true, keys: false, mouse: true, vi: false,
    style: {
      fg: palette.text, bg: palette.panel,
      border: { fg: palette.accent }, label: { fg: palette.accent, bold: true },
      selected: { fg: palette.text, bg: palette.accent },
    },
  });

  screen.append(header);
  screen.append(log);
  screen.append(status);
  screen.append(input);
  screen.append(notice);
  screen.append(picker);
  screen.append(providerPicker);
  screen.append(helpPicker);
  helpPicker.on('select', () => { if (helpPickerActive) chooseHelp(); });

  const ESC_HINT = 'ESC lagi untuk keluar';
  let noticeTimer = null;
  let escHintTimer = null;
  let lastEscAt = 0;
  function resetEscHint() {
    lastEscAt = 0;
    if (escHintTimer) { clearTimeout(escHintTimer); escHintTimer = null; }
    if (statusExtra === ESC_HINT) drawStatus('');
  }
  function notify(text, ms = 8000) {
    notice.setContent(String(text == null ? '' : text));
    notice.show();
    notice.scroll(0);
    screen.render();
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hide(); screen.render(); }, ms);
    focusInput();
  }

  function showPicker() {
    const rows = store.list();
    if (!rows.length) return notify('belum ada sesi tersimpan');
    picker.setLabel(' PILIH SESI — ↑↓ Enter, Ctrl+D×2 hapus, ESC batal ');
    picker.setItems(rows.map((s, i) => {
      const mark = s.id === store.activeId() ? '*' : ' ';
      return `${mark} [${i + 1}] ${s.title} | ${s.count} pesan | ${new Date(s.updatedAt).toLocaleString('id-ID')}`;
    }));
    picker.select(0);
    picker.show();
    pickerActive = true;
    pickerDelAt = 0;
    screen.render();
  }

  function closePicker() {
    pickerActive = false;
    picker.hide();
    pickerDelAt = 0;
    resetEscHint();
    focusInput();
    screen.render();
  }

  let pickerActive = false;
  let pickerDelAt = 0;
  function choosePicker() {
    const rows = store.list();
    const index = picker.selected;
    closePicker();
    if (rows[index]) loadSession(rows[index].id);
  }

  function deletePickerSession() {
    const rows = store.list();
    const index = picker.selected;
    const target = rows[index];
    if (!target) return;
    store.remove(target.id);
    try { memory.clear(target.id); } catch { /* abaikan */ }
    const next = store.list();
    if (!next.length) {
      closePicker();
      messages = null;
      showMessages([]);
      drawHeader();
      notify('sesi dihapus — tidak ada sesi tersisa');
      return;
    }
    // Jika sesi aktif dihapus, store.remove sudah memilih sesi aktif baru.
    const active = store.activeId();
    if (target.id === active || !active) {
      // aktif sudah pindah otomatis oleh store.remove
    }
    if (messages && messages.length && !store.load(store.activeId())) {
      messages = null;
      showMessages([]);
    }
    // Kalau sesi yang sedang dibuka dihapus, muat sesi aktif baru.
    if (target.id === (messages ? store.activeId() : null) || target.id === store.activeId()) {
      loadSession(store.activeId());
    }
    showPicker();
    const idx = Math.min(index, next.length - 1);
    picker.select(idx);
    notify('sesi dihapus');
    screen.render();
  }

  const PROVIDERS = [
    { id: 'gemini-web', label: 'Gemini web — gratis, tool lengkap, generate gambar' },
    { id: 'chatgpt-web', label: 'ChatGPT web — gratis, shell + generate gambar' },
    { id: 'claude-web', label: 'Claude web — gratis, shell' },
    { id: 'deepseek-web', label: 'DeepSeek web — gratis, shell' },
    { id: 'gemini-api', label: 'Gemini API — hydrogen, thinking high (API key)' },
    { id: 'aistudio-web', label: 'AI Studio web — hydrogen high (login Google)' },
    { id: 'api', label: 'API OpenAI-compatible — butuh AI_API_KEY' },
  ];
  let providerPickerActive = false;
  let helpPickerActive = false;
  function showProviderPicker() {
    const current = cfg.provider;
    providerPicker.setItems(PROVIDERS.map((p) => `${p.id === current ? '*' : ' '} ${p.label}`));
    providerPicker.select(Math.max(0, PROVIDERS.findIndex((p) => p.id === current)));
    providerPicker.show();
    providerPickerActive = true;
    screen.render();
  }
  function closeProviderPicker() {
    providerPickerActive = false;
    providerPicker.hide();
    resetEscHint();
    focusInput();
    screen.render();
  }
  function chooseProvider() {
    const picked = PROVIDERS[providerPicker.selected];
    closeProviderPicker();
    if (picked) {
      cfg.provider = picked.id;
      geminiWeb.reset();
      chatgptWeb.reset();
      claudeWeb.reset();
      deepseekWeb.reset();
      geminiApi.reset();
      aistudioWeb.reset();
      notify(picked.id === 'chatgpt-web' ? 'provider = ChatGPT web — /login chatgpt bila belum login'
        : picked.id === 'claude-web' ? 'provider = Claude web — /login claude bila belum login'
        : picked.id === 'deepseek-web' ? 'provider = DeepSeek web — /login deepseek bila belum login'
        : picked.id === 'gemini-api' ? `provider = Gemini API (${cfg.geminiApiModel.replace(/^models\//, '')} / ${cfg.geminiThinkingLevel})`
        : picked.id === 'aistudio-web' ? 'provider = AI Studio web (hydrogen / high)'
        : `provider = ${picked.id}`);
      drawHeader();
    }
  }

  function showHelpPicker() {
    helpPicker.setItems(HELP.map((line, i) => `${String(i + 1).padStart(2, ' ')}. ${line}`));
    helpPicker.select(0);
    helpPicker.show();
    helpPickerActive = true;
    screen.render();
  }

  function closeHelpPicker() {
    helpPickerActive = false;
    helpPicker.hide();
    resetEscHint();
    focusInput();
    screen.render();
  }

  function chooseHelp() {
    // ritems berisi string asli; items[] berisi objek ListItem (String()-nya [object Object]).
    let selected = (helpPicker.ritems || [])[helpPicker.selected];
    if (selected == null) {
      const item = helpPicker.getItem(helpPicker.selected);
      selected = item && typeof item.getContent === 'function' ? item.getContent() : item;
    }
    const raw = String(selected == null ? '' : selected)
      .replace(/^\s*\d+\.\s*/, '');
    const match = raw.match(/^(\S+(?:\s+\S+)*?)\s{2,}/);
    const cmd = (match ? match[1] : raw.trim().split(/\s+/)[0] || '').trim();
    // Baris /help adalah self-reference: cukup kembali ke atas, jangan tutup-buka lagi.
    if (cmd === '/help') {
      helpPicker.select(0);
      screen.render();
      return;
    }
    closeHelpPicker();
    input.setValue('');
    if (!cmd) return;
    // Perintah dengan argumen diisi ke input supaya user bisa melengkapi;
    // sisanya langsung dijalankan.
    if (/[<\[]/.test(cmd) || /^\/steps\b/.test(cmd)) {
      input.setValue(cmd.split(/\s+/)[0] + ' ');
      input.focus();
      screen.render();
    } else {
      handle(cmd);
    }
  }

  let messages = null;
  let busy = false;
  let sessionState = 'cek...';
  let statusExtra = '';
  let latency = '-';
  let spinTimer = null;
  let spinFrame = 0;
  const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const COMMANDS = HELP.map((h) => h.trim().split(/\s+/)[0]).filter((c) => c && c.startsWith('/'));
  const pending = [];
  const entries = [];

  function showMessages(msgs) {
    entries.length = 0;
    for (const m of (msgs || []).slice(-80)) {
      if (m.role === 'user') entries.push({ role: 'user', text: m.content });
      else if (m.role === 'assistant' && m.tool_calls) {
        for (const tc of m.tool_calls) {
          entries.push({ role: 'tool', text: `${tc.function && tc.function.name} ${tc.function && tc.function.arguments}` });
        }
      } else if (m.role === 'assistant' && m.content) entries.push({ role: 'agent', text: m.content });
      else if (m.role === 'tool') entries.push({ role: 'tool', text: m.content });
    }
    renderLog();
  }

  const active = store.load();
  if (active && active.messages && active.messages.length > 1) {
    messages = active.messages;
    showMessages(messages);
  }
  function historyInfo() {
    const id = store.activeId();
    const cur = id ? store.load(id) : null;
    const total = store.list().length;
    if (cur) return `sesi aktif: ${id} — ${(cur.messages || []).length} pesan | "${cur.title}" | ${total} sesi tersimpan | /sessions`;
    return 'belum ada sesi tersimpan. /new untuk membuat sesi baru.';
  }

  function providerLabel() {
    return cfg.provider === 'gemini-web'
      ? `Gemini web (${cfg.geminiModel})`
      : cfg.provider === 'chatgpt-web' ? 'ChatGPT web'
        : cfg.provider === 'claude-web' ? 'Claude web'
          : cfg.provider === 'deepseek-web' ? 'DeepSeek web'
            : cfg.provider === 'gemini-api' ? `Gemini API (${cfg.geminiApiModel.replace(/^models\//, '')} / ${cfg.geminiThinkingLevel})`
              : cfg.provider === 'aistudio-web' ? 'AI Studio web (hydrogen / high)'
                : `${cfg.model} @ ${cfg.baseUrl}`;
  }

  // inputOnFocus:true menambah listener keypress tiap focus() dipanggil.
  // Fokus ganda membuat tiap karakter terbaca dua kali.
  function focusInput() {
    if (screen.focused !== input) input.focus();
    else if (!input.__listener) input.readInput();
  }

  function applyTheme(name) {
    if (!THEMES[name]) return false;
    theme = name;
    palette = THEMES[name];
    header.style.fg = palette.text; header.style.bg = palette.panel;
    log.style.fg = palette.text; log.style.bg = palette.bg; log.style.border.fg = palette.accent;
    log.style.label.fg = palette.accent;
    status.style.fg = palette.text; status.style.bg = palette.bg;
    input.style.fg = palette.text; input.style.bg = palette.panel; input.style.border.fg = palette.accent;
    input.style.label.fg = palette.accent;
    notice.style.fg = palette.text; notice.style.bg = palette.panel;
    notice.style.border.fg = palette.accent; notice.style.label.fg = palette.accent;
    providerPicker.style.fg = palette.text; providerPicker.style.bg = palette.panel;
    providerPicker.style.border.fg = palette.accent; providerPicker.style.label.fg = palette.accent;
    providerPicker.style.selected.fg = palette.text; providerPicker.style.selected.bg = palette.accent;
    helpPicker.style.fg = palette.text; helpPicker.style.bg = palette.panel;
    helpPicker.style.border.fg = palette.accent; helpPicker.style.label.fg = palette.accent;
    helpPicker.style.selected.fg = palette.text; helpPicker.style.selected.bg = palette.accent;
    log.options.scrollbar.style.bg = palette.accent;
    log.options.scrollbar.track.style.bg = palette.panel;
    drawHeader();
    renderLog();
    return true;
  }

  function drawHeader() {
    header.style.fg = palette.accent;
    header.setContent(tag(palette,
      ` {A}{bold}${palette.brand} hafitri{/bold}{/A}  {M}│{/M}  {bold}${providerLabel()}{/bold}  {M}│{/M}  /help  {M}│{/M}  /provider  {M}│{/M}  ESC×2 keluar`
    ));
    screen.render();
  }

  function drawStatus(extra) {
    if (extra !== undefined) statusExtra = extra;
    const cols = screen.cols || 80;
    const spin = busy ? `${SPIN[spinFrame]} berpikir` : '✓ siap';
    const parts = [spin, `sesi ${sessionState}`];
    if (cols > 70) parts.push(`tema ${theme}`);
    if (cols > 52) parts.push(`${latency}`);
    if (statusExtra) parts.push(statusExtra);
    const sep = tag(palette, `{M} │ {/M}`);
    status.setContent(' ' + parts.map((p, i) => {
      if (i === 0) return busy ? tag(palette, `{A}${p}{/A}`) : tag(palette, `{K}${p}{/K}`);
      return p === statusExtra ? tag(palette, `{U}${p}{/U}`) : tag(palette, `{M}${p}{/M}`);
    }).join(sep));
    screen.render();
  }

  function setBusy(v) {
    busy = v;
    if (v) {
      spinFrame = 0;
      spinTimer = setInterval(() => {
        spinFrame = (spinFrame + 1) % SPIN.length;
        drawStatus();
      }, 110);
    } else if (spinTimer) {
      clearInterval(spinTimer);
      spinTimer = null;
    }
    drawStatus();
  }

  function renderLog() {
    const cols = screen.cols || log.width || 80;
    const inner = Math.max(20, cols - 4);
    const maxIndent = cols < 60 ? 2 : 4;
    const out = [];

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const prev = entries[i - 1];
      const body = prepare(e.text, maxIndent);
      if (e.role === 'plain') {
        for (const line of wrapText(body, inner)) out.push(linkify(line, palette));
        if (entries[i + 1]) out.push('');
        continue;
      }

      // Pisahkan giliran antar role (user/agent) dengan spasi tipis, bukan kotak.
      if (prev && prev.role !== e.role) out.push('');

      const c = e.role === 'user' ? 'U' : e.role === 'agent' ? 'A' : 'T';
      const mark = e.role === 'user' ? '▸' : e.role === 'agent' ? '●' : '·';
      const blocks = parseBlocks(body);
      let first = true;
      for (const b of blocks) {
        if (b.type === 'code') {
          if (first) { out.push(tag(palette, `{${c}}{bold}${mark}{/bold}{/${c}}`)); first = false; }
          out.push(...renderCodeBlock(b, Math.max(20, inner - 2), palette).map((l) => '  ' + l));
          continue;
        }
        const prepared = prepare(b.content, 4);
        const lines = wrapText(prepared, Math.max(10, inner - 4));
        lines.forEach((line) => {
          const rendered = linkify(renderMarkdownLine(line, palette), palette);
          if (first) { out.push(tag(palette, `{${c}}{bold}${mark}{/bold}{/${c}} `) + rendered); first = false; }
          else out.push('  ' + rendered);
        });
      }
    }

    log.setContent(out.join('\n'));
    log.scroll(1000);
    screen.render();
  }

  function append(role, text) {
    entries.push({ role, text: String(text == null ? '' : text) });
    if (entries.length > 400) entries.splice(0, entries.length - 400);
    renderLog();
  }

  async function refreshSession() {
    sessionState = await sess.status();
    drawStatus();
  }

  function loadSession(idOrNumber) {
    const list = store.list();
    const picked = /^\d+$/.test(String(idOrNumber))
      ? list[parseInt(idOrNumber, 10) - 1]
      : list.find((s) => s.id === idOrNumber);
    if (!picked) return notify('sesi tidak ditemukan');
    if (messages && messages.length > 1) store.save(store.activeId(), messages, { geminiChatUrl: geminiWeb.getChatUrl() || '', chatgptChatUrl: chatgptWeb.getChatUrl() || '', claudeChatUrl: claudeWeb.getChatUrl() || '', deepseekChatUrl: deepseekWeb.getChatUrl() || '' });
    store.setActive(picked.id);
    const data = store.load(picked.id);
    messages = data && data.messages && data.messages.length > 1 ? data.messages : null;
    geminiWeb.setChatUrl(data && data.meta && data.meta.geminiChatUrl || '');
    chatgptWeb.setChatUrl(data && data.meta && data.meta.chatgptChatUrl || '');
    claudeWeb.setChatUrl(data && data.meta && data.meta.claudeChatUrl || '');
    deepseekWeb.setChatUrl(data && data.meta && data.meta.deepseekChatUrl || '');
    pending.length = 0;
    geminiWeb.reset();
    chatgptWeb.reset();
    claudeWeb.reset();
    deepseekWeb.reset();
    showMessages(messages);
    notify(`sesi ${picked.id} dimuat — ${picked.title}`);
  }

  async function command(line) {
    const [cmd, ...rest] = line.slice(1).split(/\s+/);
    const arg = rest.join(' ');
    switch (cmd) {
      case 'quit':
      case 'exit':
        screen.destroy();
        process.exit(0);
        break;
      case 'help':
        showHelpPicker();
        break;
      case 'theme':
        if (arg && applyTheme(arg)) notify(`tema: ${arg}`);
        else notify(`tema saat ini: ${theme}. Pilihan: opencode | mimo`);
        break;
      case 'clear':
        entries.length = 0;
        renderLog();
        break;
      case 'history':
        notify(historyInfo());
        break;
      case 'new': {
        if (messages && messages.length > 1) store.save(store.activeId(), messages, { geminiChatUrl: geminiWeb.getChatUrl() || '', chatgptChatUrl: chatgptWeb.getChatUrl() || '', claudeChatUrl: claudeWeb.getChatUrl() || '', deepseekChatUrl: deepseekWeb.getChatUrl() || '' });
        const id = store.create();
        messages = null;
        pending.length = 0;
        geminiWeb.reset(); geminiWeb.setChatUrl('');
        chatgptWeb.reset(); chatgptWeb.setChatUrl('');
        claudeWeb.reset(); claudeWeb.setChatUrl('');
        deepseekWeb.reset(); deepseekWeb.setChatUrl('');
        geminiApi.reset(); aistudioWeb.reset();
        showMessages([]);
        drawStatus('');
        break;
      }
      case 'sessions':
        showPicker();
        break;
      case 'load':
        if (!arg) showPicker();
        else loadSession(arg);
        break;
      case 'reset':
        messages = null;
        pending.length = 0;
        geminiWeb.reset(); geminiWeb.setChatUrl('');
        chatgptWeb.reset(); chatgptWeb.setChatUrl('');
        claudeWeb.reset(); claudeWeb.setChatUrl('');
        deepseekWeb.reset(); deepseekWeb.setChatUrl('');
        geminiApi.reset();
        aistudioWeb.reset();
        store.save(store.activeId(), [], { geminiChatUrl: '', chatgptChatUrl: '', claudeChatUrl: '', deepseekChatUrl: '' });
        try { memory.clear(store.activeId() || 'default'); } catch { /* abaikan */ }
        showMessages([]);
        notify('sesi aktif dikosongkan — sesi lain tetap tersimpan');
        break;
      case 'login':
        if (arg === 'chatgpt') notify(await chatgptWeb.openLogin());
        else if (arg === 'claude') notify(await claudeWeb.openLogin());
        else if (arg === 'deepseek') notify(await deepseekWeb.openLogin());
        else if (arg === 'aistudio') notify(await aistudioWeb.openLogin());
        else notify(await sess.start());
        await refreshSession();
        break;
      case 'session':
        if (arg === 'start') notify(await sess.start());
        else if (arg === 'stop') notify('dimatikan: ' + ((await sess.stop()).join(', ') || '(tidak ada proses)'));
        else if (arg === 'status') notify(await sess.status());
        else if (arg === 'url') notify(sess.novncUrl());
        else notify('pakai: /session start|stop|status|url');
        await refreshSession();
        break;
      case 'yolo':
        opts.yolo = arg !== 'off';
        notify('yolo = ' + opts.yolo);
        break;
      case 'steps': {
        const n = parseInt(arg, 10);
        if (n) { opts.maxSteps = n; notify('maxSteps = ' + n); }
        else notify('pakai: /steps 40');
        break;
      }
      case 'model':
        if (!arg) notify('pakai: /model <nama>');
        else if (cfg.provider === 'gemini-web') {
          cfg.geminiModel = arg;
          geminiWeb.reset();
          notify(`model Gemini = ${arg} (auto|flash|hydrogen|pro)`);
        } else {
          cfg.model = arg;
          notify('model = ' + arg);
        }
        drawHeader();
        break;
      case 'provider':
        if (!arg) showProviderPicker();
        else if (!['gemini-web', 'chatgpt-web', 'claude-web', 'deepseek-web', 'gemini-api', 'aistudio-web', 'api'].includes(arg)) notify('pakai: /provider gemini-web|chatgpt-web|claude-web|deepseek-web|gemini-api|aistudio-web|api');
        else {
          cfg.provider = arg;
          geminiWeb.reset();
          chatgptWeb.reset();
          claudeWeb.reset();
          deepseekWeb.reset();
          geminiApi.reset();
          aistudioWeb.reset();
          notify(arg === 'chatgpt-web' ? 'provider = chatgpt-web — jalankan /login chatgpt bila belum login' : `provider = ${arg}`);
          drawHeader();
        }
        break;
      case 'reasoning':
        if (cfg.provider !== 'gemini-web') notify('/reasoning hanya untuk Gemini web');
        else {
          const level = await geminiWeb.setReasoning(arg);
          notify(arg === 'off' || !arg
            ? `penalaran Hydrogen: ${level || 'mati'} — pakai /reasoning rendah|menengah|tinggi|off`
            : `penalaran Hydrogen: ${level}${cfg.geminiModel === 'hydrogen' ? '' : ' (aktif setelah /model hydrogen)'}`);
        }
        break;
      default:
        notify('perintah tidak dikenal: /' + cmd);
    }
  }

  async function handle(line) {
    if (!line) return;
    if (line.startsWith('/')) {
      try { await command(line); } catch (e) { notify('ERROR: ' + e.message); }
      focusInput();
      return;
    }
    if (busy) {
      pending.push(line);
      notify(`prompt diantrikan (${pending.length})`);
      return;
    }
    append('user', line);
    if (!messages) messages = newSession(line);
    else messages.push({ role: 'user', content: line });

    const started = Date.now();
    setBusy(true);
    drawStatus(pending.length ? `antrian ${pending.length}` : '');
    try {
      const answer = await step(messages, opts, (ev) => {
        append('tool', `${ev.name} ${JSON.stringify(ev.args || {})}`);
        const lines = String(ev.result || '').split('\n');
        append('tool', lines.slice(0, 10).join('\n'));
        if (lines.length > 10) append('tool', `... (${lines.length - 10} baris lagi)`);
      });
      latency = ((Date.now() - started) / 1000).toFixed(1) + 's';
      append('agent', answer);
    } catch (e) {
      append('error', 'ERROR: ' + (e && e.message ? e.message : String(e)));
    } finally {
      setBusy(false);
      store.save(store.activeId(), messages, { geminiChatUrl: geminiWeb.getChatUrl() || '', chatgptChatUrl: chatgptWeb.getChatUrl() || '', claudeChatUrl: claudeWeb.getChatUrl() || '', deepseekChatUrl: deepseekWeb.getChatUrl() || '' });
      focusInput();
      drawStatus(pending.length ? `antrian ${pending.length}` : '');
      if (pending.length) setImmediate(() => handle(pending.shift()));
    }
  }

  input.on('submit', (value) => {
    const line = String(value).trim();
    input.clearValue();
    screen.render();
    // Tunda satu tick: blessed masih menyelesaikan event Enter saat submit dipancarkan.
    setImmediate(() => {
      focusInput();
      handle(line);
    });
  });
  // ESC menutup panel INFO. Jangan biarkan textbox menganggap ESC sebagai "cancel input".
  input.on('keypress', (ch, key) => {
    if (!key) return;
    if (key.name !== 'escape' && statusExtra === ESC_HINT) resetEscHint();
    if (helpPickerActive) {
      // Panel bantuan permanen: ↑↓ navigasi, Enter pilih, ESC tutup.
      if (key.name === 'up') helpPicker.up();
      else if (key.name === 'down') helpPicker.down();
      else if (key.name === 'enter') chooseHelp();
      else if (key.name === 'escape') closeHelpPicker();
      else return;
      key.name = '';
      screen.render();
      return;
    }
    if (providerPickerActive) {
      if (key.name === 'up') providerPicker.up();
      else if (key.name === 'down') providerPicker.down();
      else if (key.name === 'enter') chooseProvider();
      else if (key.name === 'escape') closeProviderPicker();
      else return;
      key.name = '';
      screen.render();
      return;
    }
    if (pickerActive) {
      if (key.name === 'up') picker.up();
      else if (key.name === 'down') picker.down();
      else if (key.name === 'enter') choosePicker();
      else if (key.name === 'escape') closePicker();
      else if (key.ctrl && key.name === 'd') {
        const now = Date.now();
        if (now - pickerDelAt < 1200) {
          pickerDelAt = 0;
          deletePickerSession();
        } else {
          pickerDelAt = now;
          notify('Tekan Ctrl+D sekali lagi untuk menghapus sesi ini', 1500);
        }
      }
      else return;
      key.name = '';
      screen.render();
      return;
    }
    if (key.name === 'tab') {
      key.name = '';
      const v = input.getValue() || '';
      if (v.startsWith('/')) {
        const parts = v.slice(1).split(/\s+/);
        if (parts.length === 1 && parts[0]) {
          const matches = COMMANDS.filter((c) => c.startsWith('/' + parts[0]));
          if (matches.length === 1) input.setValue(matches[0] + ' ');
          else if (matches.length > 1) {
            let pre = matches[0];
            for (const c of matches) while (!c.startsWith(pre)) pre = pre.slice(0, -1);
            input.setValue(pre);
          }
        } else if (!parts[0]) input.setValue('/');
      }
      screen.render();
      return;
    }
    if (key.name === 'escape') {
      key.name = '';
      if (!notice.hidden) {
        notice.hide();
        resetEscHint();
        screen.render();
        focusInput();
        return;
      }
      const typed = (input.getValue() || '').trim();
      if (typed) {
        input.setValue('');
        resetEscHint();
        screen.render();
        focusInput();
        return;
      }
      const now = Date.now();
      if (now - lastEscAt < 1200) {
        screen.destroy();
        process.exit(0);
      }
      lastEscAt = now;
      drawStatus(ESC_HINT);
      if (escHintTimer) clearTimeout(escHintTimer);
      escHintTimer = setTimeout(() => {
        if (statusExtra === ESC_HINT) drawStatus('');
      }, 1500);
      focusInput();
    }
  });
  input.key('C-c', () => { screen.destroy(); process.exit(0); });
  screen.key('C-c', () => { screen.destroy(); process.exit(0); });
  screen.key('C-d', () => { if (!pickerActive) { screen.destroy(); process.exit(0); } });

  drawHeader();
  applyTheme('opencode');
  drawStatus();
  input.focus();
  screen.render();
  refreshSession();
  return screen;
}

module.exports = { start };
