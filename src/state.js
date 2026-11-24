'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const FILE = path.join(cfg.root, '.run', 'state.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}

function save(patch) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const cur = load();
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
    try { fs.chmodSync(FILE, 0o600); } catch { /* ignore */ }
    return next;
  } catch { return null; }
}

module.exports = { FILE, load, save };
