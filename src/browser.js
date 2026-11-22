'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const cfg = require('./config');
const { Cdp } = require('./cdp');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const cands = [];
  if (cfg.browserBin) cands.push(cfg.browserBin);
  try {
    const base = path.join(process.env.HOME || '/root', '.cache', 'ms-playwright');
    for (const d of fs.readdirSync(base)) {
      if (/^chromium-\d+$/.test(d)) cands.push(path.join(base, d, 'chrome-linux-arm64', 'chrome'));
    }
  } catch { /* belum ada playwright cache */ }
  cands.push('/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  for (const c of cands) {
    try { if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; } catch { /* skip */ }
  }
  throw new Error('Binary Chromium tidak ditemukan. Isi BROWSER_BIN di .env.');
}

function pidFile(name) { return path.join(cfg.runDir, `${name}.pid`); }

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readPid(name) {
  try {
    const pid = parseInt(fs.readFileSync(pidFile(name), 'utf8').trim(), 10);
    return Number.isFinite(pid) && alive(pid) ? pid : null;
  } catch { return null; }
}

function spawnDetached(name, cmd, args, env) {
  const log = fs.openSync(path.join(cfg.runDir, `${name}.log`), 'a');
  const child = spawn(cmd, args, {
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, ...env },
  });
  child.unref();
  fs.writeFileSync(pidFile(name), String(child.pid));
  return child.pid;
}

function cdpUp() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: cfg.cdpPort, path: '/json/version', timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function tcpUp(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port }, () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.setTimeout(1000, () => { sock.destroy(); resolve(false); });
  });
}

/** Status sesi: 'running' | 'stopped' */
async function status() {
  const chrome = readPid('chrome');
  const cdp = chrome ? await cdpUp() : false;
  const vnc = await tcpUp(cfg.vncPort);
  const web = await tcpUp(cfg.novncPort);
  if (chrome && cdp && vnc && web) return 'running';
  return 'stopped';
}

/**
 * Start Xvfb + Chromium + x11vnc + websockify(noVNC).
 * Mengembalikan URL noVNC untuk login manual.
 */
async function start() {
  fs.mkdirSync(cfg.runDir, { recursive: true });
  fs.mkdirSync(cfg.userDataDir, { recursive: true });

  // 1. Xvfb (adopsi display yang sudah ada bila tersedia)
  const displayNo = String(cfg.display).replace(/^:/, '').split('.')[0];
  const displaySocket = `/tmp/.X11-unix/X${displayNo}`;
  if (!fs.existsSync(displaySocket) && !readPid('xvfb')) {
    spawnDetached('xvfb', 'Xvfb', [cfg.display, '-screen', '0', '1280x800x24', '-nolisten', 'tcp']);
    await sleep(700);
  }

  // 2. Chromium (headful di Xvfb, sesi login persisten di user-data-dir)
  if (!(readPid('chrome') && (await cdpUp()))) {
    fs.rmSync(pidFile('chrome'), { force: true });
    const bin = findBrowser();
    spawnDetached('chrome', bin, [
      `--remote-debugging-port=${cfg.cdpPort}`,
      `--user-data-dir=${cfg.userDataDir}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--window-size=1280,800',
      '--lang=id',
      'about:blank',
    ], { DISPLAY: cfg.display });
    for (let i = 0; i < 40; i++) {
      if (await cdpUp()) break;
      await sleep(500);
      if (i === 39) throw new Error('Chromium gagal start (cek .run/ dan memory mesin).');
    }
  }

  // 3. x11vnc (hanya localhost)
  if (!(readPid('x11vnc') && (await tcpUp(cfg.vncPort)))) {
    fs.rmSync(pidFile('x11vnc'), { force: true });
    spawnDetached('x11vnc', 'x11vnc', [
      '-display', cfg.display,
      '-rfbport', String(cfg.vncPort),
      '-localhost', '-nopw', '-forever', '-shared', '-quiet', '-ncache', '10',
    ]);
    await sleep(500);
  }

  // 4. websockify + noVNC
  if (!(readPid('websockify') && (await tcpUp(cfg.novncPort)))) {
    fs.rmSync(pidFile('websockify'), { force: true });
    const webRoot = fs.existsSync(path.join(cfg.novncWeb, 'vnc.html'))
      ? cfg.novncWeb
      : path.join(cfg.novncWeb, 'novnc');
    spawnDetached('websockify', 'websockify', [
      `--web=${webRoot}`,
      `${cfg.novncAddr}:${cfg.novncPort}`,
      `localhost:${cfg.vncPort}`,
    ]);
  }

  // Pastikan x11vnc & websockify benar-benar siap sebelum URL dipakai
  for (let i = 0; i < 20; i++) {
    if ((await tcpUp(cfg.vncPort)) && (await tcpUp(cfg.novncPort))) break;
    await sleep(400);
  }

  return novncUrl();
}

function novncUrl() {
  return `http://${cfg.novncAddr}:${cfg.novncPort}/vnc.html`;
}

/** Matikan semua proses sesi. */
function stop() {
  const out = [];
  for (const name of ['websockify', 'x11vnc', 'chrome', 'xvfb']) {
    const pid = readPid(name);
    if (pid) {
      try { process.kill(-pid, 'SIGTERM'); } catch { /* bukan grup */ }
      try { process.kill(pid, 'SIGTERM'); } catch { /* sudah mati */ }
      out.push(name);
    }
    try { fs.unlinkSync(pidFile(name)); } catch { /* tidak ada */ }
  }
  return out;
}

/** Sambung CDP (otomatis start sesi bila perlu). */
async function cdp() {
  if ((await status()) !== 'running') await start();
  return Cdp.connect();
}

module.exports = { start, stop, status, novncUrl, cdp };
