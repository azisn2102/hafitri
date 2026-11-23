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
hafitri                           # TUI full-screen: satu sesi, percakapan berlanjut
hafitri --plain                   # REPL plaintext (tanpa TUI)
hafitri --tui --session           # TUI + langsung nyalakan sesi noVNC
```

## TUI (percakapan berlanjut dalam satu sesi)

`hafitri` tanpa argumen membuka TUI full-screen: panel **Percakapan** yang bisa di-scroll,
kolom input di bawah, dan status bar (sesi/tema/latensi). Provider/model ditampilkan sekali
di header. Teks jawaban di-wrap sendiri mengikuti lebar terminal (indentasi konsisten),
markdown ringan dirender (`**tebal**`, `kode`, `# judul`, bullet, code fence), dan spinner
`berpikir...` muncul saat menunggu. `Tab` melengkapi perintah `/`. Riwayat percakapan dipertahankan
antar pesan — tidak perlu mengulang konteks. Perintah `/reset` memulai chat baru,
`/clear` hanya mengosongkan layar, `/help` menampilkan semua perintah. Tool call tampil
langsung di panel yang sama. Tekan `Ctrl+C` untuk keluar.

Riwayat percakapan tersimpan otomatis di `.sessions/chat.json` (chmod 600) dan **dimuat
kembali saat TUI dibuka**: cukup jalankan `hafitri`, percakapan sebelumnya langsung tampil
dan menjadi konteks pesan berikutnya. Beberapa sesi bisa disimpan: `/new` membuat sesi baru **tanpa menghapus sesi lama**,
`/sessions` membuka picker sesi (navigasi ↑/↓, Enter untuk memuat, ESC batal),
`/load <n|id>` memuat langsung.
`/reset` mengosongkan hanya sesi aktif, `/clear` hanya mengosongkan layar.
Dari shell, `hafitri --new` langsung membuka sesi baru. Riwayat lama `chat.json`
otomatis dimigrasikan ke format multi-sesi saat pertama dijalankan.

Tema default `opencode`: latar gelap, border round, aksen biru, marker peran berwarna
(`❯ ANDA`, `◆ HAFITRI`, `⚙ TOOL`). Alternatif `mimo` lebih minimal dengan aksen hijau.
Ganti kapan saja lewat `/theme mimo` atau `/theme opencode`.

Secara default agent memakai **Gemini web** (`AI_PROVIDER=gemini-web`) lewat sesi login browser
yang sudah Anda buka di noVNC — **tanpa API key**. Model dipilih lewat dropdown di halaman Gemini:
`GEMINI_MODEL=auto` (default, paling stabil), `flash` (model cepat), `hydrogen` (Bantuan sehari-hari
/ 4 Hydrogen), `pro` (analisis dalam / 4 Neon). Untuk Hydrogen, atur kedalaman berpikir dengan
`/reasoning rendah|menengah|tinggi` (kata kunci `off` menonaktifkan). Level ini disisipkan ke prompt
karena Gemini web tidak mengekspos kontrol UI-nya ke CDP.
Di akun yang opsi cepatnya bernama "Hydrogen", `flash` dipetakan ke mode **Otomatis** karena
Hydrogen sering macet; `pro` dipetakan ke "Analisis lebih dalam/Neon".

Untuk permintaan gambar, hafitri menyalakan menu **`+` → Buat gambar** di Gemini web sebelum
mengirim prompt, lalu mematikannya lagi setelah selesai supaya percakapan berikutnya tetap normal.
Gambar yang dihasilkan disimpan otomatis. Path tujuan diambil
dari prompt (mis. "simpan gambar di /sdcard/Pictures/"), atau dari `HAFITRI_IMAGE_DIR`, atau
default `downloads/`. Tool bawaan Gemini seperti `google:image_gen` ditolak — hanya tool yang
terdaftar yang boleh dipanggil.

Paksa provider lewat flag: `hafitri --gemini "tugas"` atau `hafitri --api "tugas"`.
Untuk provider `api`, wizard isi key muncul saat first run (tersimpan di `.env`, chmod 600).
API yang didukung: semua endpoint `/chat/completions` OpenAI-compatible (OpenRouter, OpenAI, Groq, dll.).

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
agent.js            CLI, flag provider, wizard API key
src/tui.js          TUI full-screen (blessed), sesi percakapan berlanjut
src/config.js       baca .env & konfigurasi
src/llm.js          dispatcher provider (API / Gemini web)
src/geminiWeb.js    backend Gemini web via CDP + protokol tool-call teks
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
- "Failed to connect to server" / "Connecting..." lama di viewer noVNC → jalankan `hafitri --login` lagi (otomatis menyalakan ulang x11vnc/websockify yang mati atau macet), lalu **refresh halaman noVNC** dan klik Connect.
- x11vnc di lingkungan container butuh `-noshm` (MIT-SHM sering ditolak); sudah diatur otomatis. Kalau masih gagal, cek `.run/x11vnc.log`.
