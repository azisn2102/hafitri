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
const store = require('./sessionStore');

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

/** Rapikan struktur sebelum di-wrap: indentasi, code fence, bullet. */
function prepare(text, maxIndent) {
  return tidy(text)
    .replace(/^ {5,}/gm, ' '.repeat(maxIndent))
    .replace(/```[a-z0-9+_-]*\n([\s\S]*?)```/gi, (_, code) =>
      String(code).replace(/\n$/, '').split('\n').map((l) => '│ ' + l).join('\n'))
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

function linkify(line) {
  let out = String(line == null ? '' : line)
    .replace(/([{}])/g, (c) => (c === '{' ? '{open}' : '{close}'))
    .replace(/\*\*([^*]+)\*\*/g, '{bold}$1{/bold}')
    .replace(/`([^`]+)`/g, '{cyan-fg}$1{/cyan-fg}');
  if (out.startsWith('│ ')) out = '{cyan-fg}' + out + '{/cyan-fg}';
  return out.replace(/https?:\/\/[^\s<>"'()]+/gi, (url) => {
    const clean = url.replace(/[.,;:!?]+$/, '');
    const tail = url.slice(clean.length);
    return `{underline}{cyan-fg}${clean}{/cyan-fg}{/underline}${tail}`;
  });
}

const HELP = [
  '/help              bantuan ini',
  '/theme [nama]      opencode | mimo',
  '/new               sesi baru (sesi lama tetap tersimpan)',
  '/sessions          pilih sesi (↑↓ + Enter, ESC batal)',
  '/load <n|id>       muat sesi langsung',
  '/reset             kosongkan sesi aktif',
  '/clear             bersihkan layar (riwayat tetap tersimpan)',
  '/history           info riwayat tersimpan',
  '/login             start sesi noVNC + URL login',
  '/login chatgpt     buka chatgpt.com di noVNC untuk login',
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
      ch: '▐', track: { ch: ' ' },
      style: { fg: palette.accent, bg: palette.bg },
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

  screen.append(header);
  screen.append(log);
  screen.append(status);
  screen.append(input);
  screen.append(notice);
  screen.append(picker);
  screen.append(providerPicker);

  let noticeTimer = null;
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
    picker.setItems(rows.map((s, i) => {
      const mark = s.id === store.activeId() ? '*' : ' ';
      return `${mark} [${i + 1}] ${s.title} | ${s.count} pesan | ${new Date(s.updatedAt).toLocaleString('id-ID')}`;
    }));
    picker.select(0);
    picker.show();
    pickerActive = true;
    screen.render();
  }

  function closePicker() {
    pickerActive = false;
    picker.hide();
    focusInput();
    screen.render();
  }

  let pickerActive = false;
  function choosePicker() {
    const rows = store.list();
    const index = picker.selected;
    closePicker();
    if (rows[index]) loadSession(rows[index].id);
  }

  const PROVIDERS = [
    { id: 'gemini-web', label: 'Gemini web — gratis, tool lengkap, generate gambar' },
    { id: 'chatgpt-web', label: 'ChatGPT web — gratis, shell + generate gambar' },
    { id: 'claude-web', label: 'Claude web — gratis, shell' },
    { id: 'deepseek-web', label: 'DeepSeek web — gratis, shell' },
    { id: 'api', label: 'API OpenAI-compatible — butuh AI_API_KEY' },
  ];
  let providerPickerActive = false;
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
      notify(picked.id === 'chatgpt-web' ? 'provider = ChatGPT web — /login chatgpt bila belum login'
        : picked.id === 'claude-web' ? 'provider = Claude web — /login claude bila belum login'
        : picked.id === 'deepseek-web' ? 'provider = DeepSeek web — /login deepseek bila belum login'
        : `provider = ${picked.id}`);
      drawHeader();
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
          : cfg.provider === 'deepseek-web' ? 'DeepSeek web' : `${cfg.model} @ ${cfg.baseUrl}`;
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
    log.options.scrollbar.style.bg = palette.bg;
    log.options.scrollbar.style.fg = palette.accent;
    log.options.scrollbar.track.style.fg = palette.border;
    log.options.scrollbar.track.style.bg = palette.bg;
    drawHeader();
    renderLog();
    return true;
  }

  function drawHeader() {
    header.style.fg = palette.accent;
    header.setContent(` ${palette.brand} {bold}hafitri{/bold}  ${'\u2502'}  ${providerLabel()}`);
    screen.render();
  }

  function drawStatus(extra) {
    if (extra !== undefined) statusExtra = extra;
    const spin = busy ? `${SPIN[spinFrame]} berpikir...` : '✓ siap';
    status.setContent(` ${spin}  ${'\u2502'}  sesi: ${sessionState}  ${'\u2502'}  tema: ${theme}  ${'\u2502'}  respons: ${latency}  ${'\u2502'}  ${statusExtra}`);
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
    const inner = Math.max(20, cols - 5);
    const maxIndent = cols < 60 ? 2 : 4;
    const pad = cols < 60 ? 6 : 8;
    const out = [];
    for (const e of entries) {
      const mark = e.role === 'user' ? palette.userMark
        : e.role === 'agent' ? palette.agentMark
          : e.role === 'tool' ? palette.toolMark : '·';
      const label = e.role === 'user' ? 'ANDA'
        : e.role === 'agent' ? 'HAFITRI'
          : e.role === 'tool' ? 'TOOL' : '';
      const body = prepare(e.text, maxIndent);
      if (e.role === 'plain') {
        for (const line of wrapText(body, inner)) out.push(linkify(line));
        continue;
      }
      const head = label ? `${mark} ${label.padEnd(pad)} ` : `${mark} `;
      if (e.role === 'agent') out.push('─'.repeat(inner));
      const lines = wrapText(body, Math.max(8, inner - head.length));
      lines.forEach((line, i) => {
        const pretty = i === 0 && e.role === 'agent' && lines.length > 1
          && line.length < 60 && !/[.!?:]$/.test(line);
        const text = pretty ? `{bold}{cyan-fg}${linkify(line)}{/cyan-fg}{/bold}` : linkify(line);
        out.push((i === 0 ? head : ' '.repeat(head.length)) + text);
      });
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
    store.setActive(picked.id);
    const data = store.load(picked.id);
    messages = data && data.messages && data.messages.length > 1 ? data.messages : null;
    pending.length = 0;
    geminiWeb.reset();
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
        notify(HELP.join('\n'));
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
        if (messages && messages.length > 1) store.save(store.activeId(), messages);
        const id = store.create();
        messages = null;
        pending.length = 0;
        geminiWeb.reset();
        showMessages([]);
        notify(`sesi baru ${id} — sesi lama tetap tersimpan, /sessions untuk melihat`);
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
        geminiWeb.reset();
        chatgptWeb.reset();
        claudeWeb.reset();
        deepseekWeb.reset();
        store.save(store.activeId(), []);
        showMessages([]);
        notify('sesi aktif dikosongkan — sesi lain tetap tersimpan');
        break;
      case 'login':
        if (arg === 'chatgpt') notify(await chatgptWeb.openLogin());
        else if (arg === 'claude') notify(await claudeWeb.openLogin());
        else if (arg === 'deepseek') notify(await deepseekWeb.openLogin());
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
        else if (!['gemini-web', 'chatgpt-web', 'claude-web', 'deepseek-web', 'api'].includes(arg)) notify('pakai: /provider gemini-web|chatgpt-web|claude-web|deepseek-web|api');
        else {
          cfg.provider = arg;
          geminiWeb.reset();
          chatgptWeb.reset();
          claudeWeb.reset();
          deepseekWeb.reset();
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
      notify(`masih memproses... prompt masuk antrian (${pending.length})`);
      return;
    }
    append('user', line);
    if (!messages) messages = newSession(line);
    else messages.push({ role: 'user', content: line });

    const started = Date.now();
    setBusy(true);
    drawStatus('memproses...');
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
      store.save(store.activeId(), messages);
      focusInput();
      drawStatus(pending.length ? `${pending.length} prompt menunggu` : '');
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
      if (!notice.hidden) { notice.hide(); screen.render(); }
      focusInput();
    }
  });
  input.key('C-c', () => { screen.destroy(); process.exit(0); });
  screen.key('C-c', () => { screen.destroy(); process.exit(0); });
  screen.key('C-d', () => { screen.destroy(); process.exit(0); });

  drawHeader();
  applyTheme('opencode');
  drawStatus();
  input.focus();
  screen.render();
  refreshSession();
  notify(historyInfo());
  append('plain', 'Halo. Ketik pesan untuk memulai percakapan, atau /help untuk daftar perintah.');
  return screen;
}

module.exports = { start };
