'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadDotEnv(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch { /* .env belum ada */ }
}

loadDotEnv(path.join(ROOT, '.env'));

const cfg = {
  root: ROOT,
  baseUrl: (process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
  apiKey: process.env.AI_API_KEY || '',
  model: process.env.AI_MODEL || 'openai/gpt-4o-mini',
  provider: process.env.AI_PROVIDER || (process.env.AI_API_KEY ? 'api' : 'gemini-web'),
  geminiModel: process.env.GEMINI_MODEL || 'auto',
  geminiUrl: process.env.GEMINI_URL || 'https://gemini.google.com/app',
  maxSteps: parseInt(process.env.MAX_STEPS || '24', 10) || 24,
  browserBin: process.env.BROWSER_BIN || '',
  display: process.env.BROWSER_DISPLAY || ':99',
  cdpPort: parseInt(process.env.CDP_PORT || '9222', 10) || 9222,
  vncPort: parseInt(process.env.VNC_PORT || '5900', 10) || 5900,
  novncPort: parseInt(process.env.NOVNC_PORT || '6080', 10) || 6080,
  novncAddr: process.env.NOVNC_ADDR || '127.0.0.1',
  novncWeb: process.env.NOVNC_WEB || '/usr/share/novnc',
  startUrl: process.env.BROWSER_START_URL || 'https://accounts.google.com/',
  userDataDir: process.env.BROWSER_PROFILE || path.join(ROOT, '.profile'),
  runDir: path.join(ROOT, '.run'),
};

module.exports = cfg;
