'use strict';
const cfg = require('./config');
const geminiWeb = require('./geminiWeb');
const chatgptWeb = require('./chatgptWeb');
const claudeWeb = require('./claudeWeb');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Panggil API chat-completions OpenAI-compatible.
 * @param {Array} messages - riwayat percakapan
 * @param {Array} [tools] - daftar tool format OpenAI
 * @returns {Promise<object>} pesan assistant (boleh berisi tool_calls)
 */
async function chat(messages, tools) {
  if (cfg.provider === 'gemini-web') return geminiWeb.chat(messages, tools);
  if (cfg.provider === 'chatgpt-web') return chatgptWeb.chat(messages, tools);
  if (cfg.provider === 'claude-web') return claudeWeb.chat(messages, tools);
  if (!cfg.apiKey) {
    throw new Error('AI_API_KEY belum diisi. Salin .env.example -> .env lalu isi API key, atau jalankan agent sekali lagi untuk wizard setup.');
  }
  const body = { model: cfg.model, messages, temperature: 0.2 };
  if (tools && tools.length) body.tools = tools;

  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if ((res.status === 429 || res.status >= 500) && i < 3) {
          await sleep(1500 * (i + 1));
          continue;
        }
        throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 400)}`);
      }
      const data = await res.json();
      const msg = data.choices && data.choices[0] && data.choices[0].message;
      if (!msg) throw new Error('Respons LLM tidak berisi choices[0].message');
      return msg;
    } catch (e) {
      lastErr = e;
      const retryable = e.name === 'TimeoutError' || /fetch failed|network|ENOTFOUND|ECONNRESET/i.test(e.message || '');
      if (retryable && i < 3) {
        await sleep(1500 * (i + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('LLM gagal');
}

module.exports = { chat };
