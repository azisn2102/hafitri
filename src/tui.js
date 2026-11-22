'use strict';
const blessed = require('blessed');
const cfg = require('./config');
const { newSession, step } = require('./loop');
const sess = require('./browser');
const geminiWeb = require('./geminiWeb');

const THEMES = {
  opencode: {
    bg: 234, panel: 236, border: 238, text: 252, muted: 245,
    accent: 141, tool: 51, user: 214, error: 203, ok: 78,
    brand: '◆', userMark: '❯', agentMark: '◆', toolMark: '⚙',
  },
  mimo: {
    bg: 233, panel: 235, border: 239, text: 250, muted: 244,
    accent: 78, tool: 37, user: 192, error: 203, ok: 78,
    brand: '●', userMark: '›', agentMark: '●', toolMark: '·',
  },
};

const HELP = [
  '/help              bantuan ini',
  '/theme [nama]      opencode | mimo',
  '/reset             hapus riwayat, mulai chat baru',
  '/clear             bersihkan layar percakapan',
  '/login             start sesi noVNC + URL login',
  '/session start     start browser + noVNC',
  '/session stop      matikan sesi browser',
  '/session status    cek status sesi',
  '/session url       URL noVNC',
  '/model <nama>      auto|flash|pro (Gemini) atau nama model API',
  '/yolo [on|off]     izinkan perintah berisiko',
  '/steps N           batas langkah tool',
  '/quit              keluar',
];

/** TUI full-screen bertema agent CLI modern: satu sesi, percakapan berlanjut. */
function start(opts) {
  if (!process.stdin.isTTY) throw new Error('TUI membutuhkan terminal interaktif (TTY).');

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
    tags: false, wrap: true, scrollable: true, alwaysScroll: true, keys: true, mouse: true,
    padding: { left: 1, right: 1 },
    scrollbar: { ch: ' ', style: { bg: palette.border } },
    style: { fg: palette.text, bg: palette.bg, border: { fg: palette.border }, label: { fg: palette.accent, bold: true } },
  });
  const status = blessed.box({
    bottom: 3, left: 0, width: '100%', height: 1,
    style: { fg: palette.muted, bg: palette.bg },
  });
  const input = blessed.textbox({
    bottom: 0, left: 0, width: '100%', height: 3,
    label: ' ❯ pesan ', border: { type: 'round' }, inputOnFocus: true,
    style: { fg: palette.text, bg: palette.panel, border: { fg: palette.accent }, label: { fg: palette.accent, bold: true } },
  });

  screen.append(header);
  screen.append(log);
  screen.append(status);
  screen.append(input);

  let messages = null;
  let busy = false;
  let sessionState = 'cek...';
  const pending = [];
  const entries = [];

  function providerLabel() {
    return cfg.provider === 'gemini-web'
      ? `Gemini web (${cfg.geminiModel})`
      : `${cfg.model} @ ${cfg.baseUrl}`;
  }

  // inputOnFocus:true menambah listener keypress tiap focus() dipanggil.
  // Fokus ganda membuat tiap karakter terbaca dua kali.
  function focusInput() {
    if (screen.focused !== input) input.focus();
  }

  function applyTheme(name) {
    if (!THEMES[name]) return false;
    theme = name;
    palette = THEMES[name];
    header.style.fg = palette.text; header.style.bg = palette.panel;
    log.style.fg = palette.text; log.style.bg = palette.bg; log.style.border.fg = palette.border;
    log.style.label.fg = palette.accent;
    status.style.fg = palette.muted; status.style.bg = palette.bg;
    input.style.fg = palette.text; input.style.bg = palette.panel; input.style.border.fg = palette.accent;
    input.style.label.fg = palette.accent;
    log.options.scrollbar.style.bg = palette.border;
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
    const mark = busy ? '◐' : '✓';
    status.setContent(` ${mark} ${providerLabel()}  ${'\u2502'}  sesi: ${sessionState}  ${'\u2502'}  tema: ${theme}  ${'\u2502'}  ${extra || 'Enter kirim · /help bantuan · Ctrl+C keluar'}`);
    screen.render();
  }

  function renderLog() {
    log.setContent(entries.map((e) => {
      const mark = e.role === 'user' ? palette.userMark
        : e.role === 'agent' ? palette.agentMark
          : e.role === 'tool' ? palette.toolMark : '·';
      const label = e.role === 'user' ? 'ANDA'
        : e.role === 'agent' ? 'HAFITRI'
          : e.role === 'tool' ? 'TOOL' : '';
      const head = label ? `${mark} ${label.padEnd(8)} ` : `${mark} `;
      const lines = e.text.split('\n');
      return head + lines.join('\n' + ' '.repeat(head.length));
    }).join('\n'));
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
        HELP.forEach((h) => append('info', h));
        break;
      case 'theme':
        if (arg && applyTheme(arg)) append('info', `tema: ${arg}`);
        else append('info', `tema saat ini: ${theme}. Pilihan: opencode | mimo`);
        break;
      case 'clear':
        entries.length = 0;
        renderLog();
        break;
      case 'reset':
        messages = null;
        geminiWeb.reset();
        append('info', 'riwayat direset — tugas berikutnya mulai percakapan baru');
        break;
      case 'login':
        append('info', await sess.start());
        await refreshSession();
        break;
      case 'session':
        if (arg === 'start') append('info', await sess.start());
        else if (arg === 'stop') append('info', 'dimatikan: ' + ((await sess.stop()).join(', ') || '(tidak ada proses)'));
        else if (arg === 'status') append('info', await sess.status());
        else if (arg === 'url') append('info', sess.novncUrl());
        else append('info', 'pakai: /session start|stop|status|url');
        await refreshSession();
        break;
      case 'yolo':
        opts.yolo = arg !== 'off';
        append('info', 'yolo = ' + opts.yolo);
        break;
      case 'steps': {
        const n = parseInt(arg, 10);
        if (n) { opts.maxSteps = n; append('info', 'maxSteps = ' + n); }
        else append('info', 'pakai: /steps 40');
        break;
      }
      case 'model':
        if (!arg) append('info', 'pakai: /model <nama>');
        else if (cfg.provider === 'gemini-web') {
          cfg.geminiModel = arg;
          geminiWeb.reset();
          append('info', `model Gemini = ${arg} (auto|flash|pro)`);
        } else {
          cfg.model = arg;
          append('info', 'model = ' + arg);
        }
        drawHeader();
        break;
      default:
        append('info', 'perintah tidak dikenal: /' + cmd);
    }
  }

  async function handle(line) {
    if (!line) return;
    if (line.startsWith('/')) {
      try { await command(line); } catch (e) { append('error', 'ERROR: ' + e.message); }
      focusInput();
      return;
    }
    if (busy) {
      pending.push(line);
      append('info', `masih memproses... prompt masuk antrian (${pending.length})`);
      return;
    }
    append('user', line);
    if (!messages) messages = newSession(line);
    else messages.push({ role: 'user', content: line });

    busy = true;
    drawStatus('memproses...');
    try {
      const answer = await step(messages, opts, (ev) => {
        append('tool', `${ev.name} ${JSON.stringify(ev.args || {})}`);
        const lines = String(ev.result || '').split('\n');
        append('tool', lines.slice(0, 10).join('\n'));
        if (lines.length > 10) append('tool', `... (${lines.length - 10} baris lagi)`);
      });
      append('agent', answer);
    } catch (e) {
      append('error', 'ERROR: ' + (e && e.message ? e.message : String(e)));
    } finally {
      busy = false;
      focusInput();
      drawStatus(pending.length ? `${pending.length} prompt menunggu` : 'siap');
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
  input.key('C-c', () => { screen.destroy(); process.exit(0); });
  screen.key('C-c', () => { screen.destroy(); process.exit(0); });
  screen.key('C-d', () => { screen.destroy(); process.exit(0); });

  drawHeader();
  applyTheme('opencode');
  drawStatus();
  input.focus();
  screen.render();
  refreshSession();
  append('agent', 'Halo. Ketik pesan untuk memulai percakapan, atau /help untuk daftar perintah.');
  return screen;
}

module.exports = { start };
