'use strict';
const { exec } = require('child_process');
const readline = require('readline');

// Pola perintah berisiko: minta konfirmasi user (atau tolak bila bukan TTY, kecuali --yolo)
const DANGEROUS = [
  [/\brm\s+(-[a-z]+\s+)*(\/|~|\$HOME|\*)(\s|$)/i, 'hapus massal di path sistem/home'],
  [/\bmkfs(\.|\b)/i, 'format filesystem'],
  [/\bdd\b[^\n]*\bof=\/dev\//i, 'tulis langsung ke device'],
  [/\b(shutdown|reboot|poweroff|halt)\b/i, 'matikan mesin'],
  [/\bkill\s+-9\s+1\b/, 'kill init'],
  [/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/, 'fork bomb'],
  [/\bchmod\s+-R\s+777\s+\/(\s|$)/i, 'chmod 777 recursive di /'],
  [/\b(?:>\s*\/dev\/sd[a-z]|of=\/dev\/sd[a-z])/i, 'tulis ke block device'],
  [/\bcrontab\s+-r\b/i, 'hapus crontab'],
];

function isDangerous(cmd) {
  for (const [re, why] of DANGEROUS) if (re.test(cmd)) return { why };
  return null;
}

function confirm(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) return resolve(false);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} [y/N] `, (a) => { rl.close(); resolve(/^y(es)?$/i.test(a.trim())); });
  });
}

function runShell({ command, cwd, timeout }, opts = {}) {
  const danger = isDangerous(command);
  if (danger && !opts.yolo) {
    if (!process.stdin.isTTY) {
      return Promise.resolve(`DITOLAK: perintah berisiko (${danger.why}). Jalankan interaktif untuk konfirmasi, atau pakai flag --yolo.`);
    }
    // konfirmasi sync-ish lewat promise
    return confirm(`⚠ Perintah berisiko: ${danger.why}. Izinkan?\n  $ ${command}`)
      .then((ok) => (ok ? execNow(command, cwd, timeout) : 'Dibatalkan oleh user.'));
  }
  return execNow(command, cwd, timeout);
}

function execNow(command, cwd, timeout) {
  return new Promise((resolve) => {
    exec(command, {
      cwd: cwd || process.cwd(),
      timeout: timeout || 60000,
      maxBuffer: 4 * 1024 * 1024,
      shell: '/bin/bash',
      env: { ...process.env, FORCE_COLOR: '0' },
    }, (err, stdout, stderr) => {
      let out = '';
      if (stdout) out += stdout;
      if (stderr) out += (out ? '\n' : '') + stderr;
      if (err) {
        if (err.killed) out += `\n[timeout ${timeout || 60000}ms dipotong]`;
        else out += `\n[exit ${err.code ?? '?'}]`;
      }
      resolve(out.trim() || '(tidak ada output)');
    });
  });
}

module.exports = { runShell, isDangerous };
