'use strict';
const { runShell } = require('./shell');
const { read_file, write_file, list_dir, grep } = require('./fs');
const { web_fetch, web_search } = require('./web');
const { browserTool } = require('./browserTool');

const TOOLS = [
  {
    name: 'shell',
    description: 'Jalankan perintah shell di mesin lokal (bash). Untuk cek, build, git, dsb. Perintah berisiko akan minta konfirmasi.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Perintah bash' },
        cwd: { type: 'string', description: 'Direktori kerja (opsional)' },
        timeout: { type: 'integer', description: 'Timeout ms (default 60000)' },
      },
      required: ['command'],
    },
    handler: (a, opts) => runShell(a, opts),
  },
  {
    name: 'read_file',
    description: 'Baca isi file teks (dengan nomor baris).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'integer', description: 'Baris awal (default 1)' },
        limit: { type: 'integer', description: 'Jumlah baris (default 400)' },
      },
      required: ['path'],
    },
    handler: (a) => read_file(a),
  },
  {
    name: 'write_file',
    description: 'Tulis/timpa file teks (parent dibuat otomatis).',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    handler: (a) => write_file(a),
  },
  {
    name: 'list_dir',
    description: 'Daftar isi direktori.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Default: direktori kerja' } },
    },
    handler: (a) => list_dir(a),
  },
  {
    name: 'grep',
    description: 'Cari pola regex di file (grep -rn).',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' },
        include: { type: 'string', description: 'Glob filter, mis. *.js' },
        max: { type: 'integer', description: 'Maks hasil (default 80)' },
      },
      required: ['pattern'],
    },
    handler: (a) => grep(a),
  },
  {
    name: 'web_fetch',
    description: 'Ambil isi halaman web (HTML diubah jadi teks). Untuk halaman yang butuh login/JS pakai tool browser.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        max_chars: { type: 'integer', description: 'Default 12000' },
      },
      required: ['url'],
    },
    handler: (a) => web_fetch(a),
  },
  {
    name: 'web_search',
    description: 'Cari di web (DuckDuckGo, tanpa API key). Hasil: judul + URL.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    handler: (a) => web_search(a),
  },
  {
    name: 'browser',
    description: 'Kontrol browser (Chromium, sesi login persisten via noVNC). Aksi: navigate {url}, snapshot, click {index|text|selector}, type {index|text|selector, value, submit}, back, wait {ms}, stop. Snapshot mengembalikan teks halaman + daftar elemen berindex.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['navigate', 'snapshot', 'click', 'type', 'back', 'wait', 'stop'] },
        url: { type: 'string' },
        index: { type: 'integer' },
        text: { type: 'string', description: 'Cocokkan teks elemen' },
        selector: { type: 'string' },
        value: { type: 'string' },
        submit: { type: 'boolean', description: 'Tekan Enter setelah type' },
        ms: { type: 'integer' },
      },
      required: ['action'],
    },
    handler: (a) => browserTool(a),
  },
];

function schemas() {
  return TOOLS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

async function execute(name, args, opts) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`Tool "${name}" tidak dikenal`);
  return t.handler(args || {}, opts || {});
}

module.exports = { schemas, execute, TOOLS };
