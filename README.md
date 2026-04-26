# Maktaba Bridge — Setup Guide

YouTube import bridge for the Maktaba audiobook reader.
Extracts audio + captions from YouTube and delivers them to your browser offline.

---

## Prerequisites

| Tool     | Install command                          |
|----------|------------------------------------------|
| Node.js  | https://nodejs.org (v16+)                |
| yt-dlp   | `pip install -U yt-dlp`                  |
| ffmpeg   | https://ffmpeg.org (needed by yt-dlp)    |

Verify all three work:
```
node --version
yt-dlp --version
ffmpeg -version
```

---

## 1. Install bridge dependencies

```bash
cd maktaba-bridge
npm install
```

---

## 2. Start the bridge

```bash
node server.js
```

You should see:
```
🎧 Maktaba Bridge running on http://localhost:3847
```

Keep this terminal open whenever you want to import from YouTube.

---

## 3. Add the frontend script to Maktaba

In your `index.html`, before the closing `</body>` tag, add:

```html
<script src="maktaba-yt-import.js"></script>
```

That's it. A **YouTube Import** row will appear in the Audiobooks → Upload section.

---

## 4. Import a video

1. Open Maktaba → Upload → Audiobook
2. Paste a YouTube URL into the **YouTube Import** field
3. Click **Import**
4. Wait (30–120s depending on file size)
5. The book appears in your library with captions synced

---

## How it works

```
Browser                  Bridge (server.js)            YouTube
  │                            │                           │
  │── GET /get-audiobook?url ─►│── yt-dlp --dump-json ───►│
  │                            │◄─ JSON metadata ──────────│
  │◄─ { audioUrl, captionUrl }─│                           │
  │                            │                           │
  │── GET /proxy?url=audioUrl ►│── https.get(audioUrl) ──►│
  │◄─ audio stream ────────────│◄─ audio stream ───────────│
  │                            │                           │
  │── GET /proxy?url=capUrl ──►│── https.get(capUrl) ────►│
  │◄─ VTT/SRT text ────────────│◄─ caption text ───────────│
  │                            │                           │
  IndexedDB.save(audioBlob + captionBlob)
```

The bridge never stores anything — it just proxies requests.
All data is saved in your **browser's IndexedDB** (persists offline).

---

## Troubleshooting

| Error                          | Fix                                          |
|-------------------------------|----------------------------------------------|
| `Bridge not reachable`        | Start `node server.js` first                 |
| `yt-dlp failed`               | Run `pip install -U yt-dlp` to update        |
| `No audio format found`       | Video may be age-restricted or region-locked |
| `CORS error` in console       | Check BRIDGE_URL in maktaba-yt-import.js     |
| Audio plays but no captions   | Video has no auto-generated captions         |

---

## Adjusting the port

If port 3847 is taken:
```bash
PORT=4000 node server.js
```
Then update `BRIDGE_URL` in `maktaba-yt-import.js` to `http://localhost:4000`.

---

## Running on Android (Termux)

```bash
pkg install nodejs python ffmpeg
pip install yt-dlp
cd maktaba-bridge && npm install
node server.js
```
Then in `maktaba-yt-import.js` change `BRIDGE_URL` to `http://localhost:3847`
(same device, same LAN — it works as-is).
