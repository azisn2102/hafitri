#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const cfg = require('./src/config');
const { newSession, step } = require('./src/loop');
const { TOOLS } = require('./src/tools');
const sess = require('./src/browser');
const geminiWeb = require('./src/geminiWeb');
const chatgptWeb = require('./src/chatgptWeb');
const claudeWeb = require('./src/claudeWeb');
const deepseekWeb = require('./src/deepseekWeb');
const geminiApi = require('./src/geminiApi');
const aistudioWeb = require('./src/aistudioWeb');
const tui = require('./src/tui');
const store = require('./src/sessionStore');

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  dim: (s) => (COLOR ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (COLOR ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s) => (COLOR ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s) => (COLOR ? `\x1b[33m${s}\x1b[0m` : s),
};

function usage() {
  console.log(`agent — agent CLI lokal (otomasi, coding, riset web)

Pemakaian:
  hafitri "tugas"                 jalankan sekali (provider dari .env)
  hafitri --gemini "tugas"        pakai Gemini web (sesi login, tanpa API key)
  hafitri --chatgpt "tugas"       pakai ChatGPT web (sesi login, tanpa API key)
  hafitri --chatgpt-login         buka ChatGPT di noVNC untuk login manual
  hafitri --claude "tugas"        pakai Claude web (sesi login, tanpa API key)
  hafitri --claude-login          buka Claude di noVNC untuk login manual
  hafitri --deepseek "tugas"      pakai DeepSeek web (sesi login, tanpa API key)
  hafitri --deepseek-login        buka DeepSeek di noVNC untuk login manual
  hafitri --gemini-api "tugas"    pakai Gemini API (GEMINI_API_KEY, hydrogen high)
  hafitri --aistudio "tugas"      pakai AI Studio web (login Google, hydrogen high)
  hafitri --aistudio-login        buka AI Studio di noVNC untuk login manual
  hafitri --api "tugas"           pakai API OpenAI-compatible (butuh AI_API_KEY)
  hafitri                         TUI full-screen (default di terminal)
  hafitri --web                   web UI (default 127.0.0.1:7744, terpisah dari noVNC)
  hafitri --web --web-port 8080   web UI di port custom
  hafitri --web --web-host 0.0.0.0 web UI listen di semua interface (hati-hati)
  hafitri --new                   mulai sesi baru (hapus riwayat lama)
  hafitri --plain                 REPL plaintext saja
  hafitri --login                 start sesi noVNC & tampilkan URL login
  hafitri --session               REPL + langsung start sesi noVNC
  hafitri --steps 40 "..."        batasi langkah tool

Opsi: --gemini, --chatgpt, --claude, --deepseek, --gemini-api, --aistudio, --chatgpt-login, --claude-login, --deepseek-login, --aistudio-login, --api, --new, --tui, --plain, --web, --web-host, --web-port, --login, --yolo, --help
REPL: /help /tools /reset /login /session start|stop|status|url /yolo /steps /model /quit`);
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function ensureConfig(opts) {
  if (opts.gemini) cfg.provider = 'gemini-web';
  if (opts.chatgpt) cfg.provider = 'chatgpt-web';
  if (opts.claude) cfg.provider = 'claude-web';
  if (opts.deepseek) cfg.provider = 'deepseek-web';
  if (opts.geminiApi) cfg.provider = 'gemini-api';
  if (opts.aistudio) cfg.provider = 'aistudio-web';
  if (opts.api) cfg.provider = 'api';
  if (['gemini-web', 'chatgpt-web', 'claude-web', 'deepseek-web', 'aistudio-web'].includes(cfg.provider)) return true;
  if (cfg.provider === 'gemini-api' && cfg.geminiApiKey) return true;
  if (cfg.apiKey) return true;
  if (!process.stdin.isTTY) {
    console.error(c.yellow('AI_API_KEY belum ada. Pakai --gemini (sesi login) atau isi AI_API_KEY di /home/ai-agent/.env.'));
    return false;
  }
  console.log(c.yellow('\nWizard setup — API key model (OpenAI-compatible).'));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const key = (await ask(rl, 'AI_API_KEY: ')).trim();
    if (!key) throw new Error('API key kosong');
    const base = (await ask(rl, `AI_BASE_URL [${cfg.baseUrl}]: `)).trim() || cfg.baseUrl;
    const model = (await ask(rl, `AI_MODEL [${cfg.model}]: `)).trim() || cfg.model;
    const envPath = path.join(cfg.root, '.env');
    fs.writeFileSync(envPath, `# agent config (jangan dibagikan)\nAI_PROVIDER=api\nAI_BASE_URL=${base}\nAI_API_KEY=${key}\nAI_MODEL=${model}\n`);
    fs.chmodSync(envPath, 0o600);
    Object.assign(cfg, { apiKey: key, baseUrl: base.replace(/\/+$/, ''), model, provider: 'api' });
    console.log(c.green(`Tersimpan di ${envPath} (chmod 600).\n`));
    return true;
  } finally {
    rl.close();
  }
}

async function loginInfo() {
  const url = await sess.start();
  return [
    `noVNC: ${url}`,
    'Buka URL itu di browser, lalu login Gmail/Google manual di jendela Chromium yang tampil.',
    'VNC tanpa password. Cookie tersimpan di ' + cfg.userDataDir,
    'Selesai login? Agent otomatis memakai sesi itu lewat tool "browser".',
    '/session status untuk cek, /session stop untuk matikan.',
  ].join('\n');
}

function printTool(ev) {
  const args = JSON.stringify(ev.args || {});
  const argShort = args.length > 240 ? args.slice(0, 240) + '…' : args;
  console.log(`  ${c.bold('▸')} ${c.bold(ev.name)} ${c.dim(argShort)}`);
  const lines = String(ev.result || '').split('\n');
  const preview = lines.slice(0, 14).join('\n');
  const shown = preview.length > 1400 ? preview.slice(0, 1400) + '…' : preview;
  console.log(c.dim(shown.split('\n').map((l) => '    ' + l).join('\n')));
  if (lines.length > 14) console.log(c.dim(`    ... (${lines.length - 14} baris lagi)`));
}

async function runTask(messages, opts) {
  let spent = 0;
  const answer = await step(messages, opts, (ev) => {
    spent++;
    printTool(ev);
  });
  console.log(`\n${c.green('agent:')} ${answer}\n`);
  if (spent) console.log(c.dim(`(${spent} tool call)`));
  return answer;
}

async function repl(opts) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let messages = null;
  const label = cfg.provider === 'gemini-web'
    ? `Gemini web (${cfg.geminiModel})`
    : cfg.provider === 'chatgpt-web' ? 'ChatGPT web'
      : cfg.provider === 'claude-web' ? 'Claude web'
        : cfg.provider === 'deepseek-web' ? 'DeepSeek web'
          : cfg.provider === 'gemini-api' ? `Gemini API (${cfg.geminiApiModel.replace(/^models\//, '')} / ${cfg.geminiThinkingLevel})`
            : cfg.provider === 'aistudio-web' ? 'AI Studio web (hydrogen / high)'
              : `${cfg.model} @ ${cfg.baseUrl}`;
  console.log(c.bold(`hafitri v0.1`) + c.dim(` | model: ${label} | /help`));

  rl.on('SIGINT', () => {
    console.log('\n(tekan /quit atau Ctrl+D untuk keluar)');
  });

  while (true) {
    let line;
    try { line = await new Promise((resolve) => rl.question('agent> ', resolve)); }
    catch { break; }
    line = line.trim();
    if (!line) continue;
    if (line.startsWith('/')) {
      const [cmd, ...rest] = line.slice(1).split(/\s+/);
      const arg = rest.join(' ');
      try {
        if (cmd === 'quit' || cmd === 'exit') { geminiWeb.close(); chatgptWeb.close(); claudeWeb.close(); deepseekWeb.close(); geminiApi.reset(); aistudioWeb.close(); rl.close(); break; }
        if (cmd === 'help') {
          console.log('/help              bantuan ini\n' +
            '/tools             daftar tool\n' +
            '/login             start sesi noVNC + URL login\n' +
            '/reset             hapus riwayat percakapan\n' +
            '/session start     start Xvfb + browser + noVNC\n' +
            '/session stop      matikan sesi browser\n' +
            '/session status    cek status\n' +
            '/session url       URL noVNC untuk login manual\n' +
            '/yolo [on|off]     izinkan perintah berisiko\n' +
            '/steps N           batas langkah tool\n' +
            '/model <nama>      ganti model (auto|flash|hydrogen|pro untuk Gemini web)\n' +
            '/reasoning <level> rendah|menengah|tinggi|off (khusus Hydrogen)\n' +
            '/quit              keluar');
        } else if (cmd === 'tools') {
          console.log(TOOLS.map((t) => `  ${t.name} — ${t.description.split('.')[0]}`).join('\n'));
        } else if (cmd === 'reset') {
          messages = null;
          geminiWeb.reset();
          console.log('riwayat direset');
        } else if (cmd === 'login') {
          console.log(await loginInfo());
        } else if (cmd === 'session') {
          if (arg === 'start') console.log(await sess.start());
          else if (arg === 'stop') console.log('dimatikan: ' + ((await sess.stop()).join(', ') || '(tidak ada proses)'));
          else if (arg === 'status') console.log(await sess.status());
          else if (arg === 'url') console.log(sess.novncUrl());
          else console.log('pakai: /session start|stop|status|url');
        } else if (cmd === 'yolo') {
          opts.yolo = arg !== 'off';
          console.log('yolo = ' + opts.yolo);
        } else if (cmd === 'steps') {
          const n = parseInt(arg, 10);
          if (!n) console.log('pakai: /steps 40');
          else { opts.maxSteps = n; console.log('maxSteps = ' + n); }
        } else if (cmd === 'model') {
          if (!arg) console.log('pakai: /model <nama-model>');
          else if (cfg.provider === 'gemini-web') {
            cfg.geminiModel = arg;
            geminiWeb.reset();
            console.log('model Gemini = ' + arg + ' (auto|flash|hydrogen|pro)');
          } else { cfg.model = arg; console.log('model = ' + arg); }
        } else if (cmd === 'reasoning') {
          if (cfg.provider !== 'gemini-web') console.log('/reasoning hanya untuk Gemini web');
          else console.log('penalaran Hydrogen: ' + ((await geminiWeb.setReasoning(arg)) || 'mati'));
        } else {
          console.log('perintah tidak dikenal: /' + cmd);
        }
      } catch (e) {
        console.log(c.yellow('ERROR: ' + e.message));
      }
      continue;
    }
    if (!messages) messages = newSession(line);
    else messages.push({ role: 'user', content: line });
    try { await runTask(messages, opts); }
    catch (e) { console.log(c.yellow('ERROR: ' + e.message)); }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = { yolo: false, maxSteps: cfg.maxSteps, session: false, login: false, gemini: false, chatgpt: false, chatgptLogin: false, claude: false, claudeLogin: false, deepseek: false, deepseekLogin: false, geminiApi: false, aistudio: false, aistudioLogin: false, api: false, tui: false, plain: false, fresh: false, web: false, webHost: null, webPort: null };
  const parts = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yolo') opts.yolo = true;
    else if (a === '--gemini') opts.gemini = true;
    else if (a === '--chatgpt') opts.chatgpt = true;
    else if (a === '--chatgpt-login') opts.chatgptLogin = true;
    else if (a === '--claude') opts.claude = true;
    else if (a === '--claude-login') opts.claudeLogin = true;
    else if (a === '--deepseek') opts.deepseek = true;
    else if (a === '--deepseek-login') opts.deepseekLogin = true;
    else if (a === '--gemini-api') opts.geminiApi = true;
    else if (a === '--aistudio') opts.aistudio = true;
    else if (a === '--aistudio-login') opts.aistudioLogin = true;
    else if (a === '--api') opts.api = true;
    else if (a === '--session') opts.session = true;
    else if (a === '--login') opts.login = true;
    else if (a === '--new') opts.fresh = true;
    else if (a === '--tui') opts.tui = true;
    else if (a === '--plain') opts.plain = true;
    else if (a === '--web') opts.web = true;
    else if (a === '--web-host') opts.webHost = argv[++i];
    else if (a === '--web-port') opts.webPort = parseInt(argv[++i], 10);
    else if (a === '--steps') opts.maxSteps = parseInt(argv[++i], 10) || cfg.maxSteps;
    else if (a === '--help' || a === '-h') { usage(); return; }
    else parts.push(a);
  }
  if (opts.login) { console.log(await loginInfo()); return; }
  if (opts.chatgptLogin) {
    const url = await chatgptWeb.openLogin();
    console.log(`ChatGPT dibuka: ${cfg.chatgptUrl}\nnoVNC: ${url}\nLogin manual di jendela Chromium, lalu jalankan: hafitri --chatgpt "tugas"`);
    return;
  }
  if (opts.claudeLogin) {
    const url = await claudeWeb.openLogin();
    console.log(`Claude dibuka: ${cfg.claudeUrl}\nnoVNC: ${url}\nLogin manual di jendela Chromium, lalu jalankan: hafitri --claude "tugas"`);
    return;
  }
  if (opts.deepseekLogin) {
    const url = await deepseekWeb.openLogin();
    console.log(`DeepSeek dibuka: ${cfg.deepseekUrl}\nnoVNC: ${url}\nLogin manual di jendela Chromium, lalu jalankan: hafitri --deepseek "tugas"`);
    return;
  }
  if (opts.aistudioLogin) {
    const url = await aistudioWeb.openLogin();
    console.log(`AI Studio dibuka: ${cfg.aistudioUrl}\nnoVNC: ${url}\nLogin manual di jendela Chromium, lalu jalankan: hafitri --aistudio "tugas"`);
    return;
  }
  if (!(await ensureConfig(opts))) return;
  if (opts.fresh) {
    const id = store.create();
    geminiWeb.reset();
    geminiApi.reset();
    aistudioWeb.reset();
    console.log(`sesi baru ${id} — sesi lama tetap tersimpan, lihat dengan /sessions.`);
  }
  if (opts.session) console.log('noVNC: ' + await sess.start());

  if (opts.web) {
    if (opts.webHost) cfg.webHost = opts.webHost;
    if (opts.webPort) cfg.webPort = opts.webPort;
    const web = require('./src/web');
    web.start(opts);
    return;
  }

  const task = parts.join(' ').trim();
  if (task) {
    const messages = newSession(task);
    await runTask(messages, opts);
    // Simpan sesi + metadata URL chat native agar /sessions TUI bisa lanjut di chat yang sama.
    try {
      const id = store.activeId() || store.create();
      store.save(id, messages, {
        geminiChatUrl: geminiWeb.getChatUrl() || '',
        chatgptChatUrl: chatgptWeb.getChatUrl() || '',
        claudeChatUrl: claudeWeb.getChatUrl() || '',
        deepseekChatUrl: deepseekWeb.getChatUrl() || '',
      });
    } catch { /* jangan gagalkan tugas hanya karena simpan sesi */ }
    geminiWeb.close(); // lepas WebSocket CDP, kalau tidak proses menggantung setelah selesai
    chatgptWeb.close();
    claudeWeb.close();
    deepseekWeb.close();
    geminiApi.reset();
    aistudioWeb.close();
  } else if (opts.tui || (!opts.plain && process.stdin.isTTY)) {
    tui.start(opts);
  } else {
    await repl(opts);
  }
}

main().catch((e) => {
  geminiWeb.close(); // pastikan WebSocket CDP tidak menahan proses saat error
  chatgptWeb.close();
  claudeWeb.close();
  deepseekWeb.close();
  geminiApi.reset();
  aistudioWeb.close();
  console.error(c.yellow('FATAL: ' + (e && e.stack ? e.stack : e)));
  process.exitCode = 1;
});
