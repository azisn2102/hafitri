'use strict';

const HELP = [
  '/help              bantuan ini',
  '/new               sesi baru (Ctrl+N)',
  '/sessions          pilih/filter sesi (Ctrl+O, ketik filter, Ctrl+D×2 hapus)',
  '/load <n|id>       muat sesi langsung',
  '/reset             kosongkan sesi aktif',
  '/clear             bersihkan tampilan (Ctrl+L, riwayat tetap)',
  '/history           info riwayat tersimpan',
  '/provider          pilih provider',
  '/model <nama>      auto|flash|hydrogen|pro (Gemini) atau nama model API',
  '/reasoning <level> rendah|menengah|tinggi|off (Gemini Hydrogen)',
  '/tools <mode>      compact|detail|hide tampilan tool call',
  '/theme [nama]      opencode | mimo',
  '/config            tampilkan path dan isi cli.json/state',
  '/login ...         gemini/chatgpt/claude/deepseek/aistudio via noVNC',
  '/session ...       start|stop|status|url browser noVNC',
  '/yolo [on|off]     izinkan perintah berisiko',
  '/steps N           batas langkah tool',
  '/quit              keluar',
];

const PROVIDERS = [
  { id: 'gemini-web', label: 'Gemini web — gratis, tool lengkap, generate gambar' },
  { id: 'chatgpt-web', label: 'ChatGPT web — gratis, shell + generate gambar' },
  { id: 'claude-web', label: 'Claude web — gratis, shell' },
  { id: 'deepseek-web', label: 'DeepSeek web — gratis, shell' },
  { id: 'gemini-api', label: 'Gemini API — hydrogen, thinking high (API key)' },
  { id: 'aistudio-web', label: 'AI Studio web — hydrogen high (login Google)' },
  { id: 'api', label: 'API OpenAI-compatible — butuh AI_API_KEY' },
];

const PALETTE_COMMANDS = [
  { label: 'New session', cmd: '/new' },
  { label: 'Sessions', cmd: '/sessions' },
  { label: 'Provider', cmd: '/provider' },
  { label: 'Model', cmd: '/model ' },
  { label: 'Reasoning', cmd: '/reasoning ' },
  { label: 'Tool view: compact', cmd: '/tools compact' },
  { label: 'Tool view: detail', cmd: '/tools detail' },
  { label: 'Tool view: hide', cmd: '/tools hide' },
  { label: 'Login browser', cmd: '/login' },
  { label: 'Theme', cmd: '/theme ' },
  { label: 'Config', cmd: '/config' },
  { label: 'Clear view', cmd: '/clear' },
  { label: 'Reset active session', cmd: '/reset' },
  { label: 'Help', cmd: '/help' },
  { label: 'Quit', cmd: '/quit' },
];

module.exports = { HELP, PROVIDERS, PALETTE_COMMANDS };
