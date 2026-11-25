'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const cfg = require('./config');
const { newSession, step } = require('./loop');
const sess = require('./browser');
const geminiWeb = require('./geminiWeb');
const chatgptWeb = require('./chatgptWeb');
const claudeWeb = require('./claudeWeb');
const deepseekWeb = require('./deepseekWeb');
const geminiApi = require('./geminiApi');
const aistudioWeb = require('./aistudioWeb');
const store = require('./sessionStore');
const memory = require('./memory');

const clients = new Set();
let busy = false;
let queue = Promise.resolve();

function send(ws, type, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type, ...data }));
}
function broadcast(type, data) {
  for (const ws of clients) send(ws, type, data);
}

function htmlPage() {
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>hafitri web</title>
<style>
:root{--bg:#0f172a;--panel:#111827;--muted:#94a3b8;--text:#e5e7eb;--accent:#38bdf8;--user:#f59e0b;--tool:#22d3ee;--border:#243041}
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,sans-serif}
header{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border);position:sticky;top:0;background:rgba(15,23,42,.95);backdrop-filter:blur(6px)}
.brand{font-weight:700;color:var(--accent)} .meta{color:var(--muted);font-size:12px}
main{max-width:980px;margin:0 auto;padding:16px 16px 120px}
.msg{padding:12px 0;border-bottom:1px solid #182235}
.role{font-size:12px;color:var(--muted);margin-bottom:4px;text-transform:uppercase}
.role.user{color:var(--user)} .role.agent{color:var(--accent)} .role.tool{color:var(--tool)}
pre{white-space:pre-wrap;word-break:break-word;background:#0b1220;padding:12px;border-radius:8px;border:1px solid var(--border);overflow:auto}
code{background:#0b1220;padding:1px 4px;border-radius:4px}
footer{position:fixed;left:0;right:0;bottom:0;background:rgba(15,23,42,.96);border-top:1px solid var(--border);padding:12px 16px}
.row{max-width:980px;margin:0 auto;display:flex;gap:8px}
input,select,button{background:#0b1220;color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px}
input{flex:1} button{cursor:pointer} button.primary{background:#0ea5e9;color:#082f49;border-color:#0ea5e9;font-weight:600}
#status{color:var(--muted);font-size:12px;max-width:980px;margin:6px auto 0}
</style></head><body>
<header><div><span class="brand">◆ hafitri web</span> <span class="meta" id="hdr"></span></div>
<div class="meta">noVNC terpisah di port ${cfg.novncPort}</div></header>
<main id="log"></main>
<footer><div class="row">
<select id="provider"><option value="">provider...</option><option>gemini-web</option><option>chatgpt-web</option><option>claude-web</option><option>deepseek-web</option><option>gemini-api</option><option>aistudio-web</option><option>api</option></select>
<input id="input" placeholder="Tulis pesan..." autocomplete="off">
<button class="primary" id="send">Kirim</button>
<button id="new">/new</button>
</div><div id="status">menghubungkan...</div></footer>
<script>
const log=document.getElementById('log'), input=document.getElementById('input'), status=document.getElementById('status'), hdr=document.getElementById('hdr'), prov=document.getElementById('provider');
let ws;
function esc(s){return String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function add(role,text){const d=document.createElement('div');d.className='msg';d.innerHTML='<div class="role '+esc(role)+'">'+esc(role)+'</div><div>'+render(text)+'</div>';log.appendChild(d);window.scrollTo(0,document.body.scrollHeight)}
function render(text){const s=String(text??'');if(s.includes('\`\`\`')){return esc(s).replace(/\`\`\`([a-z0-9_-]*)\\n?([\\s\\S]*?)\`\`\`/g,(_,l,c)=>'<pre><code>'+c+'</code></pre>').replace(/\\n/g,'<br>')}return '<div style="white-space:pre-wrap">'+esc(s)+'</div>'}
function connect(){ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws');ws.onopen=()=>status.textContent='terhubung';ws.onclose=()=>{status.textContent='terputus, reconnect...';setTimeout(connect,1500)};ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='hello'){hdr.textContent=m.provider+' · '+m.sessionId;prov.value=m.provider||'';log.innerHTML='';(m.messages||[]).forEach(x=>add(x.role,x.content))}if(m.type==='status')status.textContent=m.text;if(m.type==='msg')add(m.role,m.content);if(m.type==='busy')status.textContent=m.busy?'berpikir...':'siap'}}
document.getElementById('send').onclick=()=>{const t=input.value.trim();if(!t||!ws||ws.readyState!==1)return;ws.send(JSON.stringify({type:'chat',text:t}));input.value=''};input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();document.getElementById('send').click()}}
document.getElementById('new').onclick=()=>ws&&ws.send(JSON.stringify({type:'new'}));
prov.onchange=()=>ws&&ws.send(JSON.stringify({type:'provider',provider:prov.value}));
connect();
</script></body></html>`;
}

function sessionMeta(provider) {
  return { provider: provider || cfg.provider, model: cfg.model, geminiChatUrl: geminiWeb.getChatUrl()||'', chatgptChatUrl: chatgptWeb.getChatUrl()||'', claudeChatUrl: claudeWeb.getChatUrl()||'', deepseekChatUrl: deepseekWeb.getChatUrl()||'' };
}

async function handleChat(ws, text, opts) {
  if (busy) { send(ws, 'status', { text: 'sibuk, tunggu respons selesai' }); return; }
  busy = true; broadcast('busy', { busy: true });
  try {
    const id = store.activeId() || store.create();
    let data = store.load(id);
    let messages = data && data.messages && data.messages.length > 1 ? data.messages : newSession(text);
    if (messages !== data?.messages) { /* new */ } else messages.push({ role: 'user', content: text });
    if (messages[0]?.role !== 'system') messages = newSession(text);
    // if existing session, append user
    const loaded = store.load(id);
    if (loaded && loaded.messages && loaded.messages.length > 1) { messages = loaded.messages; messages.push({ role: 'user', content: text }); }
    else { messages = newSession(text); }
    broadcast('msg', { role: 'user', content: text });
    const answer = await step(messages, opts, (ev) => {
      const arg = ev.args?.command || ev.args?.path || ev.args?.query || '';
      broadcast('msg', { role: 'tool', content: `⚙ ${ev.name} ${String(arg).slice(0,80)}\n${String(ev.result||'').split('\n').slice(0,4).join('\n')}` });
    });
    store.save(id, messages, sessionMeta(cfg.provider));
    broadcast('msg', { role: 'agent', content: answer });
  } catch (e) {
    broadcast('msg', { role: 'error', content: 'ERROR: ' + (e && e.message ? e.message : String(e)) });
  } finally {
    busy = false; broadcast('busy', { busy: false });
  }
}

function start(opts = {}) {
  const port = parseInt(process.env.WEB_PORT || cfg.webPort || '7744', 10);
  const host = process.env.WEB_HOST || cfg.webHost || '127.0.0.1';
  if (port === cfg.novncPort) throw new Error(`WEB_PORT ${port} bentrok dengan NOVNC_PORT`);
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlPage());
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, provider: cfg.provider, busy, novncPort: cfg.novncPort, webPort: port }));
      return;
    }
    res.writeHead(404); res.end('not found');
  });
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    clients.add(ws);
    const id = store.activeId() || store.create();
    const data = store.load(id);
    const msgs = (data?.messages || []).filter(m => m.role === 'user' || (m.role === 'assistant' && m.content)).slice(-60).map(m => ({ role: m.role === 'assistant' ? 'agent' : m.role, content: m.content }));
    send(ws, 'hello', { provider: cfg.provider, sessionId: id, messages: msgs });
    ws.on('message', (buf) => {
      let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (msg.type === 'chat' && msg.text) {
        queue = queue.then(() => handleChat(ws, String(msg.text), opts)).catch(() => {});
      } else if (msg.type === 'new') {
        const nid = store.create();
        geminiWeb.reset(); chatgptWeb.reset(); claudeWeb.reset(); deepseekWeb.reset(); geminiApi.reset(); aistudioWeb.reset();
        send(ws, 'hello', { provider: cfg.provider, sessionId: nid, messages: [] });
      } else if (msg.type === 'provider' && msg.provider) {
        cfg.provider = String(msg.provider);
        broadcast('status', { text: `provider = ${cfg.provider}` });
      }
    });
    ws.on('close', () => clients.delete(ws));
  });
  server.listen(port, host, () => {
    console.log(`hafitri web: http://${host}:${port} (noVNC: ${cfg.novncPort}, terpisah)`);
  });
  return server;
}

module.exports = { start };
