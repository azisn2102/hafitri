# hafitri — AI agent CLI lokal

Agent Node.js (CommonJS) untuk **otomasi tugas sehari-hari, asisten coding, dan riset web**.
Model memakai API OpenAI-compatible; tool browser memakai Chromium lokal yang bisa Anda login
manual lewat **noVNC** (mis. Gmail/Google), lalu agent memakai sesi cookie yang sama.

## Pasang & jalankan

```bash
cd /home/ai-agent
npm install                       # hanya butuh paket "ws"
npm link                          # daftarkan command global "hafitri"
cp .env.example .env              # lalu isi AI_API_KEY (wizard juga bisa otomatis)
node --check agent.js && node --check src/*.js && node --check src/tools/*.js

hafitri "tugas sekali jalan"      # jalankan sekali lalu keluar
hafitri                           # REPL interaktif
hafitri --session                 # REPL + langsung nyalakan sesi noVNC
```

Bila `AI_API_KEY` kosong, agent menawarkan wizard isi key saat pertama dijalankan (tersimpan di
`.env` dengan chmod 600). API yang didukung: semua endpoint `/chat/completions` OpenAI-compatible
(OpenRouter, OpenAI, Groq, Gemini lewat gateway OpenAI-compatible, dll.).

## Tool yang tersedia

| Tool | Fungsi |
|---|---|
| `shell` | jalankan perintah bash (perintah berisiko minta konfirmasi / perlu `--yolo`) |
| `read_file`, `write_file`, `list_dir`, `grep` | baca/tulis/cari file |
| `web_search` | cari web via DuckDuckGo (tanpa API key) |
| `web_fetch` | ambil halaman web jadi teks |
| `browser` | navigate/snapshot/click/type/back/wait — memakai sesi login Chromium |

## Sesi login noVNC (Gmail, dll.)

```bash
hafitri --login    # langsung start sesi + tampilkan URL (tanpa API key)

# Atau di REPL:
/login             # sama seperti di atas
/session start
/session url       # http://127.0.0.1:6080/vnc.html
```

Saat sesi dinyalakan, Chromium langsung membuka halaman login Google (`accounts.google.com`).
Buka URL noVNC di browser Anda, **login Gmail/Google secara manual** di layar VNC (termasuk OTP
bila ada). Cookie tersimpan di `.profile/`, sehingga tool `browser` otomatis memakai sesi tersebut.
Halaman awal bisa diganti lewat `BROWSER_START_URL` di `.env`.

Dari mesin lain, tunnel lewat SSH:

```bash
ssh -L 6080:127.0.0.1:6080 user@mesin-ini
# lalu buka http://localhost:6080/vnc.html
```

Perintah REPL lain: `/help /tools /reset /session stop /session status /yolo on|off /steps 40 /model <nama> /quit`

## Arsitektur singkat

```
agent.js            CLI + REPL + wizard API key
src/config.js       baca .env & konfigurasi
src/llm.js          client chat-completions + retry
src/loop.js         system prompt + agent loop (tool calling)
src/tools/*         shell, file, web, browser
src/browser.js      Xvfb + Chromium(CDP) + x11vnc + websockify
src/cdp.js          klien Chrome DevTools Protocol via ws
```

## Catatan keamanan

- `.env`, `.profile/`, `.run/` tidak boleh dibagikan / di-commit.
- noVNC dan x11vnc hanya bind ke `127.0.0.1` (ubah `NOVNC_ADDR` bila perlu, dengan risiko).
- Agent mengabaikan instruksi di dalam konten web yang dibaca (prompt injection).
- Hapus massal / perintah merusak sistem ditolak kecuali dikonfirmasi atau pakai `--yolo`.

## Troubleshooting

- `Chromium tidak ditemukan` → isi `BROWSER_BIN` di `.env` dengan path binary Chrome/Chromium.
- `CDP tidak terjangkau` → `/session stop` lalu `/session start`; cek memory (`free -h`).
- noVNC blank → pastikan `websockify` & `novnc` terpasang, lalu cek `http://127.0.0.1:6080/vnc.html`.
- "Failed to connect to server" di viewer noVNC → jalankan `hafitri --login` lagi (otomatis menyalakan ulang x11vnc/websockify yang mati), lalu **refresh halaman noVNC** dan klik Connect.
