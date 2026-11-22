'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const DIR = path.join(cfg.root, '.sessions');
const LIST = path.join(DIR, 'sessions');
const ACTIVE = path.join(DIR, 'active.json');
const LEGACY = path.join(DIR, 'chat.json');

function title(messages) {
  const first = (messages || []).find((m) => m.role === 'user');
  return first ? String(first.content).replace(/\s+/g, ' ').slice(0, 50) : '(kosong)';
}

function ensure() {
  fs.mkdirSync(LIST, { recursive: true });
  if (fs.existsSync(LEGACY) && !fs.existsSync(ACTIVE)) {
    try {
      const old = JSON.parse(fs.readFileSync(LEGACY, 'utf8'));
      const id = 's' + Date.now();
      const when = old.updatedAt || new Date().toISOString();
      fs.writeFileSync(path.join(LIST, id + '.json'), JSON.stringify({
        id, title: title(old.messages || []), createdAt: when,
        updatedAt: when, messages: old.messages || [],
      }, null, 2));
      fs.writeFileSync(ACTIVE, JSON.stringify({ id }));
      fs.unlinkSync(LEGACY);
    } catch { /* migrasi gagal */ }
  }
}

function list() {
  ensure();
  return fs.readdirSync(LIST).filter((f) => f.endsWith('.json')).map((f) => {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(LIST, f), 'utf8'));
      return { id: d.id, title: d.title || title(d.messages), updatedAt: d.updatedAt, count: (d.messages || []).length };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function activeId() {
  ensure();
  try {
    const id = JSON.parse(fs.readFileSync(ACTIVE, 'utf8')).id;
    if (fs.existsSync(path.join(LIST, id + '.json'))) return id;
  } catch { /* pilih pertama */ }
  const first = list()[0];
  return first ? first.id : null;
}

function load(id) {
  ensure();
  const target = id || activeId();
  if (!target) return null;
  try { return JSON.parse(fs.readFileSync(path.join(LIST, target + '.json'), 'utf8')); }
  catch { return null; }
}

function save(id, messages) {
  ensure();
  const current = load(id) || { id: id || 's' + Date.now(), createdAt: new Date().toISOString() };
  current.messages = messages || [];
  current.title = title(current.messages);
  current.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(LIST, current.id + '.json'), JSON.stringify(current, null, 2));
  fs.chmodSync(path.join(LIST, current.id + '.json'), 0o600);
  return current;
}

function setActive(id) {
  ensure();
  fs.writeFileSync(ACTIVE, JSON.stringify({ id }));
  fs.chmodSync(ACTIVE, 0o600);
}

function create() {
  ensure();
  const id = 's' + Date.now();
  save(id, []);
  setActive(id);
  return id;
}

function remove(id) {
  ensure();
  try { fs.unlinkSync(path.join(LIST, String(id) + '.json')); } catch { /* tidak ada */ }
  if (activeId() === id) {
    const first = list()[0];
    if (first) setActive(first.id);
    else { try { fs.unlinkSync(ACTIVE); } catch { /* tidak ada */ } }
  }
}

module.exports = { ensure, list, activeId, load, save, setActive, create, remove, title };
