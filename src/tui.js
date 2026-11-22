'use strict';
const blessed = require('blessed');
const cfg = require('./config');
const { newSession, step } = require('./loop');
const sess = require('./browser');
const geminiWeb = require('./geminiWeb');

const HELP = [
  '/help              bantuan ini',
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

/** TUI full-screen: satu sesi, percakapan dan riwayat tool tetap berlanjut. */
function start(opts) {
  if (!process.stdin.isTTY) throw new Error('TUI membutuhkan terminal interaktif (TTY).');

  const screen = blessed.screen({ smartCSR: true, fullUnicode: true, title: 'hafitri', warnings: false });
  const header = blessed.box({
    top: 0, left: 0, width: '100%', height: 1, tags: true,
    style: { fg: 'white', bg: 'blue' },
  });
  const log = blessed.log({
    top: 1, left: 0, width: '100%', height: '100%-5',
    label: ' Percakapan ', border: { type: 'line' },
    scrollable: true, alwaysScroll: true, keys: true, mouse: true, wrap: true,
    style: { border: { fg: 'cyan' }, fg: 'white' },
  });
  const status = blessed.box({
    bottom: 3, left: 0, width: '100%', height: 1,
    style: { fg: 'grey' },
  });
  const input = blessed.textbox({
    bottom: 0, left: 0, width: '100%', height: 3,
    label: ' pesan ', border: { type: 'line' }, inputOnFocus: true,
    style: { border: { fg: 'green' }, fg: 'white' },
  });

  screen.append(header);
  screen.append(log);
  screen.append(status);
  screen.append(input);

  let messages = null;
  let busy = false;
  let sessionState = 'cek...';

  function providerLabel() {
    return cfg.provider === 'gemini-web'
      ? `Gemini web (${cfg.geminiModel})`
      : `${cfg.model} @ ${cfg.baseUrl}`;
  }

  function drawStatus(extra) {
    status.setContent(` ${providerLabel()} | sesi: ${sessionState} | ${extra || 'ketik pesan, Enter untuk kirim'} | /help | Ctrl+C keluar`);
    screen.render();
  }

  function append(who, text) {
    const prefix = who ? `${who}: ` : '';
    for (const line of String(text == null ? '' : text).split('\n')) log.pushLine(prefix + line);
    screen.render();
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
        HELP.forEach((h) => append('', h));
        break;
      case 'clear':
        log.setContent('');
        screen.render();
        break;
      case 'reset':
        messages = null;
        geminiWeb.reset();
        append('', 'riwayat direset — tugas berikutnya mulai percakapan baru');
        break;
      case 'login':
        append('', await sess.start());
        await refreshSession();
        break;
      case 'session':
        if (arg === 'start') append('', await sess.start());
        else if (arg === 'stop') append('', 'dimatikan: ' + ((await sess.stop()).join(', ') || '(tidak ada proses)'));
        else if (arg === 'status') append('', await sess.status());
        else if (arg === 'url') append('', sess.novncUrl());
        else append('', 'pakai: /session start|stop|status|url');
        await refreshSession();
        break;
      case 'yolo':
        opts.yolo = arg !== 'off';
        append('', 'yolo = ' + opts.yolo);
        break;
      case 'steps': {
        const n = parseInt(arg, 10);
        if (n) { opts.maxSteps = n; append('', 'maxSteps = ' + n); }
        else append('', 'pakai: /steps 40');
        break;
      }
      case 'model':
        if (!arg) append('', 'pakai: /model <nama>');
        else if (cfg.provider === 'gemini-web') {
          cfg.geminiModel = arg;
          geminiWeb.reset();
          append('', 'model Gemini = ' + arg + ' (auto|flash|pro)');
        } else {
          cfg.model = arg;
          append('', 'model = ' + arg);
        }
        drawStatus();
        break;
      default:
        append('', 'perintah tidak dikenal: /' + cmd);
    }
  }

  async function handle(line) {
    if (!line) return;
    if (line.startsWith('/')) {
      try { await command(line); } catch (e) { append('hafitri', 'ERROR: ' + e.message); }
      return;
    }
    if (busy) { append('', 'masih memproses permintaan sebelumnya...'); return; }
    append('anda', line);
    if (!messages) messages = newSession(line);
    else messages.push({ role: 'user', content: line });

    busy = true;
    drawStatus('memproses...');
    try {
      const answer = await step(messages, opts, (ev) => {
        append('tool', `${ev.name} ${JSON.stringify(ev.args || {})}`);
        const lines = String(ev.result || '').split('\n');
        append('', lines.slice(0, 10).join('\n'));
        if (lines.length > 10) append('', `... (${lines.length - 10} baris lagi)`);
      });
      append('hafitri', answer);
    } catch (e) {
      append('hafitri', 'ERROR: ' + (e && e.message ? e.message : String(e)));
    } finally {
      busy = false;
      drawStatus();
    }
  }

  header.setContent(` {bold}hafitri{/#} — satu sesi, percakapan berlanjut | ${providerLabel()}`);
  drawStatus();

  input.on('submit', (value) => {
    const line = String(value).trim();
    input.clearValue();
    screen.render();
    handle(line);
  });
  input.key('C-c', () => { screen.destroy(); process.exit(0); });
  screen.key('C-c', () => { screen.destroy(); process.exit(0); });
  screen.key('C-d', () => { screen.destroy(); process.exit(0); });

  input.focus();
  screen.render();
  refreshSession();
  append('hafitri', 'Halo. Ketik pesan untuk memulai percakapan, atau /help untuk daftar perintah.');
  return screen;
}

module.exports = { start };
