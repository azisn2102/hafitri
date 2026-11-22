'use strict';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
}

function htmlToText(html, maxChars) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article|header|footer)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s)
    .replace(/[ \t\r\f]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (s.length > maxChars) s = s.slice(0, maxChars) + `\n...[dipotong, total ${s.length} char]`;
  return s;
}

async function get(url, timeoutMs = 20000) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
  });
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 2 * 1024 * 1024) throw new Error('Respons > 2MB');
  let text = new TextDecoder('utf-8').decode(buf);
  return { status: res.status, url: res.url, text };
}

async function web_fetch({ url, max_chars }) {
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const max = Math.min(parseInt(max_chars, 10) || 12000, 50000);
  const { status, url: finalUrl, text } = await get(url);
  const body = htmlToText(text, max);
  return `URL: ${finalUrl}\nHTTP: ${status}\n\n${body}`;
}

function unwrapBing(href) {
  href = decodeEntities(href);
  const u = href.match(/[?&]u=a1([A-Za-z0-9_-]+)/);
  if (u) {
    try {
      return Buffer.from(u[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    } catch { /* pakai href apa adanya */ }
  }
  return href;
}

function parseBing(html) {
  const results = [];
  for (const block of html.split(/<li class="b_algo"/).slice(1)) {
    if (results.length >= 10) break;
    const m = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!m) continue;
    results.push({ href: unwrapBing(m[1]), title: htmlToText(m[2], 160) });
  }
  return results;
}

function parseDdgLite(html) {
  const results = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*class="result-link"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && results.length < 10) {
    let href = decodeEntities(m[1]);
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    results.push({ title: htmlToText(m[2], 160), href });
  }
  return results;
}

async function web_search({ query }) {
  const enc = encodeURIComponent(query);
  const attempts = [
    { url: `https://www.bing.com/search?q=${enc}`, parse: parseBing },
    { url: `https://lite.duckduckgo.com/lite/?q=${enc}`, parse: parseDdgLite },
  ];
  let lastErr;
  for (const a of attempts) {
    try {
      const { text } = await get(a.url, 15000);
      const results = a.parse(text);
      if (results.length) {
        return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.href}`).join('\n');
      }
      lastErr = new Error('hasil kosong');
    } catch (e) { lastErr = e; }
  }
  throw new Error(`Pencarian web gagal (${lastErr && lastErr.message}). Bisa pakai tool "browser" untuk search langsung.`);
}

module.exports = { web_fetch, web_search, htmlToText };
