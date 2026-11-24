'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const DIR = path.join(cfg.root, '.memory');

function ensure() { fs.mkdirSync(DIR, { recursive: true }); }

function fileFor(sessionId) {
  ensure();
  const safe = String(sessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DIR, safe + '.json');
}

function empty(sessionId) {
  return { sessionId: sessionId || 'default', updatedAt: null, items: [] };
}

function load(sessionId) {
  const f = fileFor(sessionId);
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return empty(sessionId); }
}

function save(data) {
  const f = fileFor(data.sessionId);
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(f, JSON.stringify(data, null, 2));
  try { fs.chmodSync(f, 0o600); } catch { /* ignore */ }
  return data;
}

function normalize(item = {}) {
  const now = new Date().toISOString();
  return {
    id: item.id || ('m' + Date.now() + Math.random().toString(36).slice(2, 7)),
    type: String(item.type || 'note').slice(0, 32),
    title: String(item.title || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    text: String(item.text || '').trim().slice(0, 4000),
    path: item.path ? String(item.path).slice(0, 500) : '',
    tags: Array.isArray(item.tags) ? item.tags.map((t) => String(t).slice(0, 40)).slice(0, 12) : [],
    pinned: !!item.pinned,
    createdAt: item.createdAt || now,
    updatedAt: now,
  };
}

function upsert(sessionId, item) {
  const data = load(sessionId);
  const next = normalize(item);
  const idx = data.items.findIndex((x) => x.id === next.id);
  if (idx >= 0) data.items[idx] = { ...data.items[idx], ...next, createdAt: data.items[idx].createdAt };
  else data.items.push(next);
  // Batasi ukuran: simpan pinned dulu, lalu terbaru.
  const pinned = data.items.filter((x) => x.pinned).slice(-60);
  const normal = data.items.filter((x) => !x.pinned).slice(-120);
  data.items = pinned.concat(normal).slice(-180);
  save(data);
  return next;
}

function remove(sessionId, id) {
  const data = load(sessionId);
  const before = data.items.length;
  data.items = data.items.filter((x) => x.id !== id);
  if (data.items.length !== before) save(data);
  return before !== data.items.length;
}

function list(sessionId, { type, q, limit = 20 } = {}) {
  const data = load(sessionId);
  const needle = String(q || '').toLowerCase().trim();
  let items = data.items.slice().reverse();
  if (type) items = items.filter((x) => x.type === type);
  if (needle) {
    items = items.filter((x) => [x.title, x.text, x.path, ...(x.tags || [])].join(' ').toLowerCase().includes(needle));
  }
  return items.slice(0, Math.max(1, Math.min(100, limit | 0 || 20)));
}

function render(sessionId, maxChars = 6000) {
  const data = load(sessionId);
  if (!data.items.length) return '';
  const pinned = data.items.filter((x) => x.pinned).slice(-20);
  const recent = data.items.filter((x) => !x.pinned).slice(-20);
  const lines = ['MEMORI SESI (gunakan sebagai konteks, jangan diulang mentah):'];
  const pushItem = (x) => {
    const head = `- [${x.type}] ${x.title || x.id}${x.path ? ` (${x.path})` : ''}`;
    const body = x.text ? `  ${x.text.replace(/\s+/g, ' ').slice(0, 280)}` : '';
    lines.push(head);
    if (body) lines.push(body);
  };
  if (pinned.length) { lines.push('Pinned:'); pinned.forEach(pushItem); }
  if (recent.length) { lines.push('Terbaru:'); recent.forEach(pushItem); }
  let out = lines.join('\n');
  if (out.length > maxChars) out = out.slice(0, maxChars) + '\n...[memori dipotong]';
  return out;
}

function clear(sessionId) {
  const f = fileFor(sessionId);
  try { fs.unlinkSync(f); } catch { /* ignore */ }
}

module.exports = { load, save, upsert, remove, list, render, clear, fileFor, DIR };
