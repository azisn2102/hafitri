'use strict';
const cfg = require('./config');
const memory = require('./memory');
const store = require('./sessionStore');

const BAKU = 'Aku hafitri, agent CLI lokal yang membantu otomasi tugas, coding, dan riset web.';

let ai = null;
let lastInteractionId = null;
let awaitingTool = false;
let toolCursor = 0;
let queue = Promise.resolve();

function client() {
  if (ai) return ai;
  const key = process.env.GEMINI_API_KEY || cfg.geminiApiKey;
  if (!key) throw new Error('GEMINI_API_KEY belum diisi. Simpan key di /home/ai-agent/.env');
  const { GoogleGenAI } = require('@google/genai');
  // Function calling butuh v1beta.
  ai = new GoogleGenAI({ apiKey: key, apiVersion: 'v1beta' });
  return ai;
}

function generationConfig() {
  const max = parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS || '65536', 10) || 65536;
  return {
    max_output_tokens: max,
    thinking_level: cfg.geminiThinkingLevel || 'high',
  };
}

function systemOf(messages) {
  const sys = messages.find((m) => m.role === 'system');
  return (sys && sys.content) || BAKU;
}

function buildInput(messages) {
  const out = [];
  const mem = memory.render(store.activeId() || 'default', 4000);
  if (mem) out.push(mem);
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') out.push('PESAN USER:\n' + m.content);
    else if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        out.push('TOOL YANG DIPANGGIL: ' + JSON.stringify({
          name: tc.function && tc.function.name,
          arguments: tc.function && tc.function.arguments,
        }));
      }
    } else if (m.role === 'assistant' && m.content) out.push('JAWABAN SEBELUMNYA:\n' + m.content);
    else if (m.role === 'tool') out.push('HASIL TOOL:\n' + m.content);
  }
  return out.join('\n\n');
}

function toolDeclarations(tools) {
  // google_search (built-in) tidak bisa digabung dengan function calling di API.
  // Riset web tetap tersedia lewat tool hafitri web_search / web_fetch / browser.
  return (tools || []).filter((t) => t && t.function && t.function.name).map((t) => ({
    type: 'function',
    name: t.function.name,
    description: t.function.description || '',
    parameters: t.function.parameters || { type: 'object', properties: {} },
  }));
}

function toolNameFor(messages, callId) {
  for (const m of messages) {
    for (const tc of m.tool_calls || []) {
      if (tc.id === callId) return tc.function && tc.function.name;
    }
  }
  return 'shell';
}

function toolMessages(messages) {
  return messages.filter((m) => m.role === 'tool');
}

function parseResponse(r) {
  const steps = Array.isArray(r.steps) ? r.steps : [];
  let text = r.output_text || '';
  const calls = [];
  for (const step of steps) {
    if (step.type === 'function_call') {
      calls.push({
        id: step.id || 'gapi-' + Date.now() + '-' + calls.length,
        name: step.name,
        arguments: step.arguments || {},
      });
    } else if (step.type === 'model_output' && Array.isArray(step.content)) {
      for (const part of step.content) {
        if ((part.type === 'text' || part.text) && !text) text = part.text;
      }
    }
  }
  return { text: String(text || ''), calls, id: r.id };
}

function cleanAnswer(text) {
  let s = String(text || '').trim();
  if (!s) return '(kosong)';
  if (/^(Saya|Aku)\s+hafitri\b/i.test(s)
      && /(OpenAI|Google|Gemini|Hydrogen|model bahasa|asisten AI|buatan)/i.test(s)) return BAKU;
  if (!/hafitri/i.test(s)
      && /^(Saya|Aku)\s+(adalah\s+)?(sebuah\s+)?(asisten|model|AI|agent CLI)/i.test(s)) return BAKU;
  return s
    .replace(/\bsebagai model bahasa\b/gi, 'sebagai hafitri')
    .replace(/\basisten AI\b/gi, 'agent CLI lokal')
    .trim();
}

function sanitize(err) {
  const key = process.env.GEMINI_API_KEY || '';
  let msg = String((err && err.message) || err || 'Gemini API gagal');
  if (key) msg = msg.split(key).join('[REDACTED]');
  return new Error(msg.slice(0, 600));
}

async function create(params) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      return await client().interactions.create(params);
    } catch (e) {
      last = e;
      const msg = String((e && e.message) || '');
      // 429 limit harian tidak perlu di-retry (hanya membuang kuota).
      if ((/503|high demand|temporarily|fetch failed|network|ENOTFOUND|ECONNRESET/i.test(msg)) && i < 2) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      throw sanitize(e);
    }
  }
  throw sanitize(last);
}

async function doChat(messages, tools) {
  let resp;
  if (awaitingTool && lastInteractionId) {
    const all = toolMessages(messages);
    const fresh = all.slice(toolCursor);
    toolCursor = all.length;
    const input = fresh.map((m) => ({
      type: 'function_result',
      name: toolNameFor(messages, m.tool_call_id),
      call_id: m.tool_call_id || '',
      result: String(m.content),
    }));
    resp = await create({
      model: cfg.geminiApiModel,
      previous_interaction_id: lastInteractionId,
      input: input.length ? input : buildInput(messages),
      generation_config: generationConfig(),
    });
  } else {
    resp = await create({
      model: cfg.geminiApiModel,
      input: buildInput(messages),
      system_instruction: systemOf(messages),
      tools: toolDeclarations(tools),
      generation_config: generationConfig(),
    });
    toolCursor = toolMessages(messages).length;
  }

  const parsed = parseResponse(resp);
  lastInteractionId = parsed.id || lastInteractionId;
  if (parsed.calls.length) {
    awaitingTool = true;
    return {
      role: 'assistant',
      content: null,
      tool_calls: parsed.calls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.arguments) },
      })),
    };
  }
  awaitingTool = false;
  return { role: 'assistant', content: cleanAnswer(parsed.text) };
}

async function chat(messages, tools) {
  const next = queue.then(() => doChat(messages, tools));
  queue = next.catch(() => {});
  return next;
}

function reset() {
  lastInteractionId = null;
  awaitingTool = false;
  toolCursor = 0;
}

module.exports = { chat, reset };
