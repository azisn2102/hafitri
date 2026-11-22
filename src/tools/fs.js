'use strict';
const fs = require('fs');
const path = require('path');

function readText(file) {
  const abs = path.resolve(file);
  const st = fs.statSync(abs);
  if (st.size > 2 * 1024 * 1024) throw new Error(`File terlalu besar (${st.size} byte). Pakai shell untuk potong.`);
  return fs.readFileSync(abs, 'utf8');
}

function read_file({ path: p, offset, limit }) {
  const lines = readText(p).split('\n');
  const start = Math.max(0, (parseInt(offset, 10) || 1) - 1);
  const count = Math.min(lines.length, start + (parseInt(limit, 10) || 400));
  const slice = lines.slice(start, count);
  const body = slice.map((l, i) => `${String(start + i + 1).padStart(6)}\t${l}`).join('\n');
  const more = lines.length > count ? `\n... (${lines.length - count} baris lagi, pakai offset ${count + 1})` : '';
  return body + more;
}

function write_file({ path: p, content }) {
  const abs = path.resolve(p);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content ?? '');
  return `Tulis OK: ${abs} (${Buffer.byteLength(content ?? '')} byte)`;
}

function list_dir({ path: p }) {
  const abs = path.resolve(p || '.');
  const entries = fs.readdirSync(abs, { withFileTypes: true })
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
    .slice(0, 200)
    .map((e) => {
      let extra = '';
      if (e.isDirectory()) extra = '/';
      else {
        try { extra = ` (${fs.statSync(path.join(abs, e.name)).size}B)`; } catch { /* skip */ }
      }
      return e.name + extra;
    });
  return entries.join('\n') || '(kosong)';
}

function grep({ pattern, path: p, include, max }) {
  const args = ['-rn', '--binary-files=without-match', '--color=never', '-E'];
  const lim = Math.min(parseInt(max, 10) || 80, 300);
  args.push('-m', String(lim));
  if (include) args.push('--include=' + include);
  args.push('--', pattern, path.resolve(p || '.'));
  return new Promise((resolve) => {
    require('child_process').execFile('grep', args, { timeout: 20000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) return resolve(stderr && !/No such file/.test(stderr) ? stderr.trim() : '(tidak ada cocok)');
      resolve(stdout.trim() || '(tidak ada cocok)');
    });
  });
}

module.exports = { read_file, write_file, list_dir, grep };
