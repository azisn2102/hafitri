'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const cfg = require('./config');

const FILE = path.join(cfg.root, '.run', 'state.json');
const CLI_CONFIG = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'hafitri', 'cli.json');

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

function loadCli() {
  try { return JSON.parse(fs.readFileSync(CLI_CONFIG, 'utf8')); } catch { return {}; }
}

module.exports = { FILE, CLI_CONFIG, load, save, loadCli };
