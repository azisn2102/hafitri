'use strict';
const http = require('http');
const WebSocket = require('ws');
const cfg = require('./config');

function cdpHttp(method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: cfg.cdpPort, path, method, timeout: 5000 },
      (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => resolve(b));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('CDP timeout')));
    req.end();
  });
}

/** Klien Chrome DevTools Protocol minimal (satu halaman). */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`CDP ${msg.method || ''} ${msg.error.message}`));
        else resolve(msg.result);
      }
    });
    ws.on('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP tertutup'));
      this.pending.clear();
    });
    ws.on('error', () => {});
  }

  static async list() {
    const txt = await cdpHttp('GET', '/json/list');
    return JSON.parse(txt);
  }

  /** Sambungkan ke tab halaman pertama; buat tab baru bila belum ada. */
  static async connect() {
    let targets = [];
    try { targets = await Cdp.list(); } catch (e) { throw new Error('CDP tidak terjangkau (browser belum jalan?): ' + e.message); }
    let page = targets.find((t) => t.type === 'page');
    if (!page) {
      await cdpHttp('PUT', '/json/new?about:blank');
      targets = await Cdp.list();
      page = targets.find((t) => t.type === 'page');
    }
    if (!page) throw new Error('Tidak ada tab halaman di browser');
    return Cdp.connectTo(page.webSocketDebuggerUrl);
  }

  static connectTo(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('CDP ws timeout')); }, 10000);
      ws.on('open', () => { clearTimeout(timer); resolve(new Cdp(ws)); });
      ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    const p = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { this.pending.delete(id); reject(e); }
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP ${method} timeout`));
        }
      }, 30000);
    });
    // Cegah unhandled rejection bila ws ditutup sebelum jawaban tiba.
    p.catch(() => {});
    return p;
  }

  close() { try { this.ws.close(); } catch { /* abaikan */ } }
}

module.exports = { Cdp };
