# ZFlow Batcher

Ekstensi Chrome (Manifest V3) untuk otomasi batch prompt di **Google Flow** (flow.google.com): antre prompt dari TXT/CSV, generate otomatis, dan unduh hasilnya — **100% lokal, tanpa akun, tanpa lisensi, tanpa server pihak ketiga**.

Ditulis dari nol sebagai reimplementasi bersih (clean-room) untuk kebutuhan pribadi, terinspirasi konsep batch automation yang beredar di komunitas (Auto Flow Batcher, MIT © 2025 mudrikam). Tidak ada satu baris pun kode atau payload lisensinya yang dipakai.

## Fitur

- **Queue massal** — paste, upload `.txt`/`.csv`, atau drag-drop; nomor otomatis (`1. ...`) dibersihkan.
- **Pengaturan per-run** — mode image/video, model (Nano Banana / Veo / Omni), rasio, durasi, variasi x1–x4.
- **Runner tangguh** — delay antar prompt, auto-retry N ronde untuk prompt gagal, pause/resume, step mode (satu per satu), badge progress di ikon.
- **Auto-download** — hasil baru dideteksi dengan membandingkan snapshot aset sebelum/sesudah submit, disimpan ke folder `Downloads/zflow-batcher/`.
- **Selector editor bawaan** — kalau Google mengubah DOM Flow, buka tab *Selectors* di side panel, *Read defaults from Flow tab*, lalu tambahkan override CSS yang benar. Tersimpan lokal, langsung aktif — tanpa perlu build ulang.

## Instalasi (developer mode)

1. `git clone https://github.com/syihab-zuhri/extencion-flow.git`
2. Buka `chrome://extensions` → aktifkan **Developer mode**.
3. Klik **Load unpacked** → pilih folder hasil clone.
4. Buka [flow.google.com](https://flow.google.com), masuk ke sebuah project, lalu klik ikon ZFlow Batcher.

## Struktur

```
manifest.json          # MV3, host access hanya flow.google.com
background.js          # side panel + antrian download
content/               # content script (isolated world)
  utils.js             # helper DOM/wait/click
  selectors.js         # registry selector lokal (bisa dioverride)
  typewriter.js        # input ProseMirror via synthetic paste
  popover.js           # pemilih model/rasio/durasi/jumlah
  monitor.js           # deteksi busy/error/aset baru
  content.js           # message router + runner per item
sidepanel/             # UI panel: queue, settings, selectors, logs
scripts/make-icons.mjs # generator ikon PNG (node stdlib saja)
```

## Keamanan

- Tidak ada `debugger`, tidak ada `<all_urls>`, tidak ada izin clipboardWrite.
- Satu-satunya network call yang dibuat ekstensi ini adalah yang dilakukan halaman Flow itu sendiri.
- Semua state (queue, settings, override selector) ada di `chrome.storage.local`.

## Lisensi

MIT © 2026 M. Syihabuddin Zuhri
