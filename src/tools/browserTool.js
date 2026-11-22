'use strict';
const { cdp } = require('../browser');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Helper yang di-inject ke halaman (snapshot & aksi elemen berbasis index)
const HELPERS = `
(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const els = () => Array.from(document.querySelectorAll(
    'a, button, input, select, textarea, [role=button], [role=link], [onclick]'
  )).filter(visible);
  window.__agEls = els;
  window.__agSnapshot = () => {
    const list = els().slice(0, 80).map((el, i) => {
      const t = (el.innerText || el.value || el.getAttribute('aria-label') || el.placeholder || '')
        .trim().replace(/\\s+/g, ' ').slice(0, 90);
      const href = el.href ? ' ' + el.href : '';
      return '[' + i + '] ' + el.tagName.toLowerCase() + ' "' + t + '"' + href;
    }).filter(s => !/\\[\\d+\\] \\w+ ""$/.test(s));
    return {
      title: document.title,
      url: location.href,
      text: (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 4500),
      items: list,
    };
  };
  window.__agClick = (i) => {
    const el = els()[i];
    if (!el) return 'index ' + i + ' tidak valid';
    el.scrollIntoView({ block: 'center' });
    el.click();
    return 'ok';
  };
  window.__agType = (i, value, submit) => {
    const el = els()[i];
    if (!el) return 'index ' + i + ' tidak valid';
    el.focus();
    if ('value' in el) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.textContent = value;
    }
    if (submit) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    return 'ok';
  };
})()
`;

async function evaluate(conn, expression) {
  const res = await conn.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) {
    throw new Error('Page error: ' + (res.exceptionDetails.exception && res.exceptionDetails.exception.description || res.exceptionDetails.text));
  }
  return res.result && res.result.value;
}

async function waitReady(conn, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const state = await evaluate(conn, 'document.readyState');
      if (state === 'complete' || state === 'interactive') return;
    } catch { /* navigasi sedang berlangsung */ }
    await sleep(300);
  }
}

async function snapshot(conn) {
  await evaluate(conn, HELPERS);
  const snap = await evaluate(conn, 'window.__agSnapshot()');
  if (!snap) throw new Error('Gagal mengambil snapshot halaman');
  const head = `JUDUL: ${snap.title}\nURL: ${snap.url}`;
  const body = `--- TEKS ---\n${snap.text}`;
  const items = snap.items.length
    ? `--- ELEMEN (pakai index untuk click/type) ---\n${snap.items.join('\n')}`
    : '--- ELEMEN ---\n(tidak ada elemen interaktif terlihat)';
  return `${head}\n\n${body}\n\n${items}`;
}

function pickIndex(args, snapItems) {
  if (typeof args.index === 'number') return args.index;
  if (args.text && snapItems) {
    const hit = snapItems.find((s) => s.toLowerCase().includes(String(args.text).toLowerCase()));
    if (hit) return parseInt(hit.match(/^\[(\d+)\]/)[1], 10);
    throw new Error(`Elemen dengan teks "${args.text}" tidak ditemukan — jalankan snapshot dulu.`);
  }
  throw new Error('Butuh index (dari snapshot) atau text untuk aksi ini.');
}

/**
 * Aksi browser: navigate | snapshot | click | type | back | wait | stop
 */
async function browserTool(args) {
  const action = args.action || 'snapshot';
  const conn = await cdp();
  try {
    if (action === 'stop') { conn.close(); return 'Koneksi CDP ditutup (sesi browser tetap jalan).'; }
    if (action === 'wait') {
      const ms = Math.min(parseInt(args.ms, 10) || 1000, 15000);
      await sleep(ms);
      return await snapshot(conn);
    }
    if (action === 'navigate') {
      if (!args.url) throw new Error('Butuh url');
      const url = /^(https?:\/\/|file:\/\/|data:|about:)/i.test(args.url) ? args.url : 'https://' + args.url;
      if (/^about:/i.test(url)) {
        await evaluate(conn, `location.href = ${JSON.stringify(url)}`);
        await sleep(400);
        return await snapshot(conn);
      }
      await conn.send('Page.enable');
      await conn.send('Page.navigate', { url });
      await waitReady(conn);
      await sleep(600);
      return await snapshot(conn);
    }
    if (action === 'back') {
      await evaluate(conn, 'history.back()');
      await waitReady(conn);
      await sleep(800);
      return await snapshot(conn);
    }
    if (action === 'snapshot') return await snapshot(conn);
    // click & type butuh snapshot dulu untuk resolusi index via text
    await evaluate(conn, HELPERS);
    const items = await evaluate(conn, 'window.__agSnapshot().items');

    if (action === 'click') {
      let res;
      if (args.selector) {
        res = await evaluate(conn, `(() => { const el = document.querySelector(${JSON.stringify(args.selector)}); if (!el) return 'selector tidak ditemukan'; el.click(); return 'ok'; })()`);
      } else {
        const idx = pickIndex(args, items);
        res = await evaluate(conn, `window.__agClick(${Number(idx)})`);
      }
      if (res !== 'ok') return res;
      await waitReady(conn, 5000);
      await sleep(900);
      return await snapshot(conn);
    }
    if (action === 'type') {
      if (typeof args.value !== 'string') throw new Error('Butuh value');
      let res;
      if (args.selector) {
        res = await evaluate(conn, `(() => { const el = document.querySelector(${JSON.stringify(args.selector)}); if (!el) return 'selector tidak ditemukan'; el.focus(); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(args.value)}); el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return 'ok'; })()`);
      } else {
        const idx = pickIndex(args, items);
        res = await evaluate(conn, `window.__agType(${Number(idx)}, ${JSON.stringify(args.value)}, ${!!args.submit})`);
      }
      if (res !== 'ok') return res;
      if (args.submit) { await waitReady(conn, 6000); await sleep(900); }
      return await snapshot(conn);
    }
    throw new Error(`Aksi "${action}" tidak dikenal. Pakai: navigate|snapshot|click|type|back|wait|stop`);
  } finally {
    try { conn.close(); } catch { /* abaikan */ }
  }
}

module.exports = { browserTool };
