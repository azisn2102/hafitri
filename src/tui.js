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
const appState = require('./state');

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

const renderUi = require('./ui/render');
const { visibleLen } = require('./ui/ansi');
const {
  tidy, tidyCode, parseBlocks, prepare, wrapText, tag, linkify,
  renderMarkdownLine, highlightCode, renderCodeBlock,
} = renderUi;

const HELP = [
  '/help              bantuan ini',
  '/new               sesi baru (Ctrl+N)',
  '/sessions          pilih/filter sesi (Ctrl+O, ketik filter, Ctrl+D×2 hapus)',
  '/load <n|id>       muat sesi langsung',
  '/reset             kosongkan sesi aktif',
  '/clear             bersihkan tampilan (Ctrl+L, riwayat tetap)',
  '/history           info riwayat tersimpan',
  '/provider          pilih provider',
  '/model <nama>      auto|flash|hydrogen|pro (Gemini) atau nama model API',
  '/reasoning <level> rendah|menengah|tinggi|off (Gemini Hydrogen)',
  '/tools <mode>      compact|detail|hide tampilan tool call',
  '/theme [nama]      opencode | mimo',
  '/login ...         gemini/chatgpt/claude/deepseek/aistudio via noVNC',
  '/session ...       start|stop|status|url browser noVNC',
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
    style: { fg: palette.text, bg: palette.bg },
  });
  const log = blessed.box({
    top: 1, left: 0, width: '100%', height: '100%-3',
    tags: true, wrap: false, scrollable: true, alwaysScroll: true, keys: true, mouse: true,
    padding: { left: 1, right: 1 },
    scrollbar: {
      ch: ' ',
      style: { bg: palette.muted },
      track: { style: { bg: palette.bg } },
    },
    style: { fg: palette.text, bg: palette.bg },
  });
  const status = blessed.box({
    bottom: 2, left: 0, width: '100%', height: 1, tags: true,
    style: { fg: palette.muted, bg: palette.bg },
  });
  const sep = blessed.box({
    bottom: 1, left: 0, width: '100%', height: 1,
    style: { fg: palette.border, bg: palette.bg },
  });
  const prompt = blessed.box({
    bottom: 0, left: 0, width: 3, height: 1, tags: true,
    content: tag(palette, ' {A}{bold}❯{/bold}{/A} '),
    style: { fg: palette.accent, bg: palette.bg },
  });
  const input = blessed.textbox({
    bottom: 0, left: 3, width: '100%-3', height: 1,
    inputOnFocus: true,
    style: { fg: palette.text, bg: palette.bg },
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

  const commandPicker = blessed.list({
    top: 3, left: 'center', width: '72%', height: '60%',
    label: ' COMMAND PALETTE — ↑↓ Enter  ESC tutup ', border: { type: 'round' },
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
  screen.append(sep);
  screen.append(prompt);
  screen.append(input);
  screen.append(notice);
  screen.append(picker);
  screen.append(providerPicker);
  screen.append(helpPicker);
  screen.append(commandPicker);
  helpPicker.on('select', () => { if (helpPickerActive) chooseHelp(); });
  commandPicker.on('select', () => { if (commandPickerActive) chooseCommand(); });

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

  function fmtAge(iso) {
    const ms = Date.now() - new Date(iso || 0).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '-';
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'baru saja';
    if (m < 60) return `${m}m lalu`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}j lalu`;
    const d = Math.floor(h / 24);
    return `${d}h lalu`;
  }
  function fuzzyScore(q, text) {
    const query = String(q || '').toLowerCase().trim();
    const hay = String(text || '').toLower();
    if (!query) return 1;
    if (hay.includes(query)) return 100 - Math.min(80, hay.indexOf(query));
    let qi = 0, score = 0, last = -2;
    for (let i = 0; i < hay.length && qi < query.length; i++) {
      if (hay[i] === query[qi]) {
        score += 10 - Math.min(8, i - last - 1);
        last = i;
        qi++;
      }
    }
    return qi === query.length ? score : -1;
  }
  function sessionRows(filter = '') {
    const q = String(filter || '').trim();
    const rows = store.list().map((s) => {
      const score = fuzzyScore(q, `${s.title} ${s.id} ${s.provider} ${s.model}`);
      return { s, score };
    }).filter((x) => x.score >= 0);
    rows.sort((a, b) => b.score - a.score || String(b.s.updatedAt).localeCompare(String(a.s.updatedAt)));
    return rows.map((x) => x.s);
  }
  let pickerFilter = '';
  let pickerRows = [];
  function renderPicker() {
    pickerRows = sessionRows(pickerFilter);
    picker.setLabel(` SESI ${pickerFilter ? `filter: ${pickerFilter} ` : ''}— ↑↓ Enter  Ctrl+D×2 hapus  ketik filter  ESC `);
    if (!pickerRows.length) {
      picker.setItems([pickerFilter ? '  (tidak ada sesi cocok)' : '  (belum ada sesi)']);
    } else {
      picker.setItems(pickerRows.map((s, i) => {
        const active = s.id === store.activeId() ? '●' : ' ';
        const prov = (s.provider || '-').replace(/-web$/, '').replace(/-api$/, ' api');
        const title = String(s.title || '(kosong)').slice(0, 34);
        const chat = s.chatUrl ? 'chat↗' : '     ';
        return ` ${active} ${String(i + 1).padStart(2, ' ')}  ${title.padEnd(34)}  ${String(s.count).padStart(3, ' ')}m  ${fmtAge(s.updatedAt).padEnd(8)}  ${prov.padEnd(8)} ${chat}`;
      }));
    }
    picker.select(0);
    screen.render();
  }
  function showPicker() {
    pickerFilter = '';
    renderPicker();
    if (!store.list().length) return notify('belum ada sesi tersimpan');
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
    const index = picker.selected;
    const target = pickerRows[index];
    closePicker();
    if (target) loadSession(target.id);
  }

  function deletePickerSession() {
    const index = picker.selected;
    const target = pickerRows[index];
    if (!target) return;
    store.remove(target.id);
    try { memory.clear(target.id); } catch { /* abaikan */ }
    const next = sessionRows(pickerFilter);
    if (!store.list().length) {
      closePicker();
      messages = null;
      showMessages([]);
      drawHeader();
      notify('sesi dihapus — tidak ada sesi tersisa');
      return;
    }
    if (target.id === store.activeId()) loadSession(store.activeId());
    renderPicker();
    picker.select(Math.min(index, Math.max(0, next.length - 1)));
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
  let commandPickerActive = false;
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
      persistState();
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
    let selected = (helpPicker.ritems || [])[helpPicker.selected];
    if (selected == null) {
      const item = helpPicker.getItem(helpPicker.selected);
      selected = item && typeof item.getContent === 'function' ? item.getContent() : item;
    }
    const raw = String(selected == null ? '' : selected).replace(/^\s*\d+\.\s*/, '');
    const match = raw.match(/^(\S+(?:\s+\S+)*?)\s{2,}/);
    const cmd = (match ? match[1] : raw.trim().split(/\s+/)[0] || '').trim();
    if (cmd === '/help') { helpPicker.select(0); screen.render(); return; }
    closeHelpPicker();
    input.setValue('');
    if (!cmd) return;
    if (/[<\[]/.test(cmd) || /^\/steps\b/.test(cmd)) {
      input.setValue(cmd.split(/\s+/)[0] + ' ');
      focusInput();
      screen.render();
    } else {
      handle(cmd);
    }
  }

  const PALETTE_COMMANDS = [
    { label: 'New session', cmd: '/new' },
    { label: 'Sessions', cmd: '/sessions' },
    { label: 'Provider', cmd: '/provider' },
    { label: 'Model', cmd: '/model ' },
    { label: 'Reasoning', cmd: '/reasoning ' },
    { label: 'Tool view: compact', cmd: '/tools compact' },
    { label: 'Tool view: detail', cmd: '/tools detail' },
    { label: 'Tool view: hide', cmd: '/tools hide' },
    { label: 'Login browser', cmd: '/login' },
    { label: 'Theme', cmd: '/theme ' },
    { label: 'Clear view', cmd: '/clear' },
    { label: 'Reset active session', cmd: '/reset' },
    { label: 'Help', cmd: '/help' },
    { label: 'Quit', cmd: '/quit' },
  ];
  let paletteFilter = '';
  let paletteRows = [];
  function renderCommandPalette() {
    const q = paletteFilter.trim();
    paletteRows = PALETTE_COMMANDS
      .map((c) => ({ c, score: fuzzyScore(q, `${c.label} ${c.cmd}`) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c);
    commandPicker.setLabel(` COMMAND PALETTE ${q ? `filter: ${q} ` : ''}— ↑↓ Enter  ketik filter  ESC `);
    commandPicker.setItems(paletteRows.length ? paletteRows.map((c) => ` ${c.label.padEnd(24)} ${c.cmd}`) : ['  (tidak ada command cocok)']);
    commandPicker.select(0);
    screen.render();
  }
  function showCommandPalette() {
    paletteFilter = '';
    renderCommandPalette();
    commandPicker.show();
    commandPickerActive = true;
    commandPicker.focus();
    screen.render();
  }
  function closeCommandPalette() {
    commandPickerActive = false;
    commandPicker.hide();
    resetEscHint();
    focusInput();
    screen.render();
  }
  function chooseCommand() {
    const picked = paletteRows[commandPicker.selected];
    closeCommandPalette();
    if (!picked) return;
    if (picked.cmd.endsWith(' ')) {
      input.setValue(picked.cmd);
      focusInput();
      screen.render();
      return;
    }
    handle(picked.cmd);
  }

  let messages = null;
  let busy = false;
  let sessionState = 'cek...';
  let statusExtra = '';
  let latency = '-';
  let toolView = 'compact'; // compact|detail|hide
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

  const last = appState.load();
  if (last.provider) cfg.provider = last.provider;
  if (last.model) cfg.model = last.model;
  if (last.geminiModel) cfg.geminiModel = last.geminiModel;
  if (last.toolView && ['compact','detail','hide'].includes(last.toolView)) toolView = last.toolView;
  if (last.sessionId) store.setActive(last.sessionId);
  const active = store.load();
  if (active && active.messages && active.messages.length > 1) {
    messages = active.messages;
    geminiWeb.setChatUrl(active.meta && active.meta.geminiChatUrl || '');
    chatgptWeb.setChatUrl(active.meta && active.meta.chatgptChatUrl || '');
    claudeWeb.setChatUrl(active.meta && active.meta.claudeChatUrl || '');
    deepseekWeb.setChatUrl(active.meta && active.meta.deepseekChatUrl || '');
    showMessages(messages);
  }
  function sessionMeta() {
    const model = cfg.provider === 'gemini-web' ? cfg.geminiModel
      : cfg.provider === 'gemini-api' ? cfg.geminiApiModel
        : cfg.provider === 'aistudio-web' ? 'hydrogen'
          : cfg.model;
    return {
      provider: cfg.provider,
      model,
      geminiChatUrl: geminiWeb.getChatUrl() || '',
      chatgptChatUrl: chatgptWeb.getChatUrl() || '',
      claudeChatUrl: claudeWeb.getChatUrl() || '',
      deepseekChatUrl: deepseekWeb.getChatUrl() || '',
    };
  }
  function persistState() {
    appState.save({ provider: cfg.provider, model: cfg.model, geminiModel: cfg.geminiModel, sessionId: store.activeId() || '', toolView });
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
    header.style.fg = palette.text; header.style.bg = palette.bg;
    log.style.fg = palette.text; log.style.bg = palette.bg;
    log.options.scrollbar.style.bg = palette.muted;
    log.options.scrollbar.track.style.bg = palette.bg;
    status.style.fg = palette.muted; status.style.bg = palette.bg;
    sep.style.fg = palette.border; sep.style.bg = palette.bg;
    prompt.style.fg = palette.accent; prompt.style.bg = palette.bg;
    prompt.setContent(tag(palette, ' {A}{bold}❯{/bold}{/A} '));
    input.style.fg = palette.text; input.style.bg = palette.bg;
    notice.style.fg = palette.text; notice.style.bg = palette.panel;
    notice.style.border.fg = palette.accent; notice.style.label.fg = palette.accent;
    providerPicker.style.fg = palette.text; providerPicker.style.bg = palette.panel;
    providerPicker.style.border.fg = palette.accent; providerPicker.style.label.fg = palette.accent;
    providerPicker.style.selected.fg = palette.text; providerPicker.style.selected.bg = palette.accent;
    helpPicker.style.fg = palette.text; helpPicker.style.bg = palette.panel;
    helpPicker.style.border.fg = palette.accent; helpPicker.style.label.fg = palette.accent;
    helpPicker.style.selected.fg = palette.text; helpPicker.style.selected.bg = palette.accent;
    commandPicker.style.fg = palette.text; commandPicker.style.bg = palette.panel;
    commandPicker.style.border.fg = palette.accent; commandPicker.style.label.fg = palette.accent;
    commandPicker.style.selected.fg = palette.text; commandPicker.style.selected.bg = palette.accent;
    log.options.scrollbar.style.bg = palette.accent;
    log.options.scrollbar.track.style.bg = palette.panel;
    drawHeader();
    renderLog();
    return true;
  }

  function shortCwd() {
    const cwd = process.cwd().replace(process.env.HOME || '', '~');
    return cwd.length > 28 ? '…' + cwd.slice(-27) : cwd;
  }

  function drawHeader() {
    const cols = screen.cols || 80;
    const left = tag(palette, ` {A}{bold}${palette.brand} hafitri{/bold}{/A} {M}${shortCwd()}{/M}`);
    const right = tag(palette, `{M}${providerLabel()}  ${store.activeId() || 'no-session'}  ctrl+p{/M} `);
    const pad = Math.max(1, cols - visibleLen(left) - visibleLen(right));
    header.setContent(left + ' '.repeat(pad) + right);
    screen.render();
  }

  function drawStatus(extra) {
    if (extra !== undefined) statusExtra = extra;
    const cols = screen.cols || 80;
    const state = busy ? `${SPIN[spinFrame]} berpikir` : 'siap';
    const leftParts = [busy ? tag(palette, `{A}${state}{/A}`) : tag(palette, `{K}${state}{/K}`)];
    leftParts.push(tag(palette, `{M}${latency}{/M}`));
    if (pending.length) leftParts.push(tag(palette, `{U}antrian ${pending.length}{/U}`));
    if (statusExtra) leftParts.push(tag(palette, `{U}${statusExtra}{/U}`));
    const left = ' ' + leftParts.join(tag(palette, `{M}  ·  {/M}`));
    const hints = cols > 100 ? `tools:${toolView}  ctrl+p  ctrl+o sesi  ctrl+n baru  esc×2`
      : cols > 72 ? `tools:${toolView}  ctrl+p  ctrl+o  esc×2`
        : 'ctrl+p  esc×2';
    const right = tag(palette, `{M}${hints}{/M} `);
    const pad = Math.max(1, cols - visibleLen(left) - visibleLen(right));
    status.setContent(left + ' '.repeat(pad) + right);
    sep.setContent(tag(palette, `{M}${'─'.repeat(Math.max(0, cols))}{/M}`));
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
    const out = [];

    if (!entries.length) {
      out.push('');
      out.push(tag(palette, `  {A}{bold}${palette.brand} hafitri{/bold}{/A}`));
      out.push(tag(palette, `  {M}Agent lokal untuk coding, otomasi, riset web, dan browser.{/M}`));
      out.push('');
      out.push(tag(palette, `  {M}Coba:{/M}  jelaskan repo ini  {M}·{/M}  /provider  {M}·{/M}  /sessions  {M}·{/M}  /help`));
      out.push(tag(palette, `  {M}Ctrl+P command palette   ESC×2 keluar{/M}`));
      log.setContent(out.join('\n'));
      screen.render();
      return;
    }

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const prev = entries[i - 1];
      if (e.role === 'plain') {
        const body = prepare(e.text, maxIndent);
        for (const line of wrapText(body, inner)) out.push(linkify(line, palette));
        if (entries[i + 1]) out.push('');
        continue;
      }

      // Pisahkan giliran antar role (user/agent) dengan spasi tipis, bukan kotak.
      if (prev && prev.role !== e.role) out.push('');

      if (e.role === 'tool') {
        if (toolView === 'hide') continue;
        const body = String(e.text || '');
        if (toolView === 'detail') {
          out.push(tag(palette, `{T}·{/T} `) + tag(palette, `{M}${body.split('\n')[0].slice(0, inner - 4)}{/M}`));
          for (const line of body.split('\n').slice(1, 12)) out.push(tag(palette, `  {M}${line.slice(0, inner - 4)}{/M}`));
          if (body.split('\n').length > 13) out.push(tag(palette, `  {M}…{/M}`));
        } else {
          out.push(tag(palette, `{M}  ${body.split('\n')[0].slice(0, inner - 4)}{/M}`));
        }
        continue;
      }

      const c = e.role === 'user' ? 'U' : e.role === 'agent' ? 'A' : 'T';
      const mark = e.role === 'user' ? '▸' : e.role === 'agent' ? '●' : '·';
      const blocks = parseBlocks(e.text);
      let first = true;
      for (const b of blocks) {
        if (b.type === 'code') {
          if (first) { out.push(tag(palette, `{${c}}{bold}${mark}{/bold}{/${c}}`)); first = false; }
          out.push(...renderCodeBlock(b, Math.max(20, inner - 2), palette).map((l) => '  ' + l));
          continue;
        }
        const prepared = prepare(b.content, 4);
        const lines = wrapText(prepared, Math.max(10, inner - 4));
        for (const line of lines) {
          const rendered = renderMarkdownLine(line, palette);
          if (first) { out.push(tag(palette, `{${c}}{bold}${mark}{/bold}{/${c}} `) + rendered); first = false; }
          else out.push('  ' + rendered);
        }
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
    if (messages && messages.length > 1) store.save(store.activeId(), messages, sessionMeta());
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
    persistState();
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
        if (messages && messages.length > 1) store.save(store.activeId(), messages, sessionMeta());
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
        persistState();
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
        persistState();
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
          persistState();
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
      case 'tools':
        if (!arg || !['compact','detail','hide'].includes(arg)) notify(`tool view = ${toolView} (pakai /tools compact|detail|hide)`);
        else { toolView = arg; persistState(); renderLog(); notify(`tool view = ${toolView}`); }
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
        const args = ev.args || {};
      const shortArg = args.command || args.path || args.query || args.url || args.prompt || args.id || '';
      const argText = shortArg ? ` ${String(shortArg).replace(/\s+/g, ' ').slice(0, 80)}` : '';
      const lines = String(ev.result || '').split('\n').filter((l, i, a) => !(i === a.length - 1 && l === ''));
      const preview = lines.slice(0, 3).join(' | ').slice(0, 120);
      const more = lines.length > 3 ? ` · +${lines.length - 3} baris` : '';
      append('tool', `⚙ ${ev.name}${argText}${preview ? `\n${preview}${more}` : ''}`);
      });
      latency = ((Date.now() - started) / 1000).toFixed(1) + 's';
      append('agent', answer);
    } catch (e) {
      append('error', 'ERROR: ' + (e && e.message ? e.message : String(e)));
    } finally {
      setBusy(false);
      store.save(store.activeId(), messages, sessionMeta());
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
    if (key.ctrl && key.name === 'p' && !helpPickerActive && !providerPickerActive && !pickerActive && !commandPickerActive) {
      key.name = '';
      showCommandPalette();
      return;
    }
    if (commandPickerActive) {
      if (key.name === 'up') commandPicker.up();
      else if (key.name === 'down') commandPicker.down();
      else if (key.name === 'enter') chooseCommand();
      else if (key.name === 'escape' || (key.ctrl && key.name === 'p')) closeCommandPalette();
      else if (key.name === 'backspace') { paletteFilter = paletteFilter.slice(0, -1); renderCommandPalette(); }
      else if (ch && !key.ctrl && !key.meta && ch.length === 1 && ch >= ' ') { paletteFilter += ch; renderCommandPalette(); }
      else return;
      key.name = '';
      screen.render();
      return;
    }
    if (helpPickerActive) {
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
        if (now - pickerDelAt < 1200) { pickerDelAt = 0; deletePickerSession(); }
        else { pickerDelAt = now; notify('Tekan Ctrl+D sekali lagi untuk menghapus sesi ini', 1500); }
      } else if (key.name === 'backspace') {
        pickerFilter = pickerFilter.slice(0, -1); renderPicker();
      } else if (ch && !key.ctrl && !key.meta && ch.length === 1 && ch >= ' ') {
        pickerFilter += ch; renderPicker();
      } else return;
      key.name = '';
      screen.render();
      return;
    }
    if (key.ctrl && key.name === 'l') {
      key.name = '';
      entries.length = 0;
      renderLog();
      return;
    }
    if (key.ctrl && key.name === 'n') {
      key.name = '';
      handle('/new');
      return;
    }
    if (key.ctrl && key.name === 'o') {
      key.name = '';
      showPicker();
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
