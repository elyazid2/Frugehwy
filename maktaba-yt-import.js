/**
 * ══════════════════════════════════════════════════
 *  MAKTABA — YouTube Import Controller
 *  Paste this block into index.html just before </script>
 *  at the bottom, or in a separate maktaba-yt-import.js
 * ══════════════════════════════════════════════════
 *
 *  Talks to the Maktaba Bridge (server.js) to:
 *   1. Resolve a YouTube URL → audio URL + caption URL
 *   2. Download both as Blobs via the /proxy endpoint
 *   3. Store them in IndexedDB for offline use
 *   4. Hand them to AudiobookCtrl.addBookFromYT() as File objects
 */

// Auto-detect bridge URL: same host as the page, port 3847.
// Override by setting localStorage key 'maktaba_bridge_url'.
const BRIDGE_URL = (() => {
  const saved = (typeof localStorage !== 'undefined') && localStorage.getItem('maktaba_bridge_url');
  if (saved && saved.trim()) return saved.trim().replace(/\/$/, '');
  return 'http://' + window.location.hostname + ':3847';
})();

// ── IndexedDB wrapper ──────────────────────────────────────────────────────
const MaktabaDB = {
  _db: null,
  DB_NAME: 'maktaba_yt_store',
  DB_VERSION: 1,
  STORE: 'audiobooks',

  open() {
    return new Promise((resolve, reject) => {
      if (this._db) return resolve(this._db);
      const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE)) {
          // Key = YouTube video ID
          db.createObjectStore(this.STORE, { keyPath: 'videoId' });
        }
      };
      req.onsuccess = (e) => { this._db = e.target.result; resolve(this._db); };
      req.onerror   = () => reject(req.error);
    });
  },

  async save(record) {
    // record = { videoId, title, channel, durationSec, thumbnail,
    //            audioBlob, audioExt, captionBlob, captionExt, savedAt }
    const db    = await this.open();
    const tx    = db.transaction(this.STORE, 'readwrite');
    const store = tx.objectStore(this.STORE);
    store.put(record);
    return new Promise((res, rej) => {
      tx.oncomplete = () => res(record);
      tx.onerror    = () => rej(tx.error);
    });
  },

  async get(videoId) {
    const db    = await this.open();
    const tx    = db.transaction(this.STORE, 'readonly');
    const store = tx.objectStore(this.STORE);
    const req   = store.get(videoId);
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result || null);
      req.onerror   = () => rej(req.error);
    });
  },

  async list() {
    const db    = await this.open();
    const tx    = db.transaction(this.STORE, 'readonly');
    const store = tx.objectStore(this.STORE);
    const req   = store.getAll();
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  },

  async delete(videoId) {
    const db    = await this.open();
    const tx    = db.transaction(this.STORE, 'readwrite');
    const store = tx.objectStore(this.STORE);
    store.delete(videoId);
    return new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
  }
};

// ── YouTube Import Controller ──────────────────────────────────────────────
const YTImport = {

  // ── Main entry point ──
  // ytUrl   : full YouTube URL
  // onProgress(pct, label) : optional progress callback (0–100)
  async import(ytUrl, onProgress) {
    const progress = onProgress || (() => {});

    // 0 — Check bridge is reachable
    progress(2, 'Connecting to bridge…');
    await this._ping();

    // 1 — Resolve metadata
    progress(5, 'Fetching YouTube metadata…');
    const meta = await this._getMeta(ytUrl);

    // Extract video ID for caching
    const videoId = this._extractVideoId(ytUrl) || ('yt_' + Date.now());

    // 2 — Check IndexedDB cache
    const cached = await MaktabaDB.get(videoId);
    if (cached && cached.audioBlob) {
      progress(100, 'Loaded from cache');
      return this._toMaktabaFiles(cached);
    }

    // 3 — Download audio
    progress(10, `Downloading audio (${meta.audioExt})…`);
    const audioBlob = await this._fetchViaProxy(
      meta.audioUrl,
      (pct) => progress(10 + pct * 0.7, `Downloading audio… ${pct}%`)
    );

    // 4 — Download captions (optional)
    let captionBlob = null;
    if (meta.captionUrl) {
      progress(82, 'Downloading captions…');
      try {
        captionBlob = await this._fetchViaProxy(meta.captionUrl, () => {});
      } catch (e) {
        console.warn('[YTImport] Caption download failed (continuing without):', e.message);
      }
    }

    // 5 — Store in IndexedDB
    progress(92, 'Saving offline…');
    const record = {
      videoId,
      title:       meta.title,
      channel:     meta.channel,
      durationSec: meta.durationSec,
      thumbnail:   meta.thumbnail,
      audioBlob,
      audioExt:    meta.audioExt || 'm4a',
      captionBlob,
      captionExt:  meta.captionExt || 'vtt',
      savedAt:     Date.now()
    };
    await MaktabaDB.save(record);

    progress(100, 'Done!');
    return this._toMaktabaFiles(record);
  },

  // ── Convert DB record to { audioFile, captionFile, title } ──
  // (File objects can be fed directly into AudiobookCtrl)
  _toMaktabaFiles(record) {
    const audioFile = new File(
      [record.audioBlob],
      `${record.title}.${record.audioExt}`,
      { type: this._audioMime(record.audioExt) }
    );
    const captionFile = record.captionBlob
      ? new File(
          [record.captionBlob],
          `${record.title}.${record.captionExt}`,
          { type: 'text/plain' }
        )
      : null;
    return { audioFile, captionFile, title: record.title };
  },

  // ── Ping the bridge ──
  async _ping() {
    const res = await fetch(`${BRIDGE_URL}/ping`, { signal: AbortSignal.timeout(4000) })
      .catch(() => { throw new Error('Bridge not reachable. Is server.js running?'); });
    if (!res.ok) throw new Error('Bridge responded with error');
  },

  // ── Fetch metadata from bridge ──
  async _getMeta(ytUrl) {
    const res = await fetch(
      `${BRIDGE_URL}/get-audiobook?url=${encodeURIComponent(ytUrl)}`,
      { signal: AbortSignal.timeout(35000) }
    );
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Bridge error');
    if (!json.audioUrl) throw new Error('No audio URL returned');
    return json;
  },

  // ── Fetch a resource through the bridge /proxy endpoint ──
  // Reports download progress as a percentage
  async _fetchViaProxy(remoteUrl, onProgress) {
    const proxyUrl = `${BRIDGE_URL}/proxy?url=${encodeURIComponent(remoteUrl)}`;
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`Proxy fetch failed: ${res.status}`);

    const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
    if (!contentLength || !res.body) {
      // No progress info — just await the blob
      return await res.blob();
    }

    // Stream with progress
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress(Math.min(99, Math.round((received / contentLength) * 100)));
    }
    return new Blob(chunks);
  },

  // ── Helpers ──
  _extractVideoId(ytUrl) {
    try {
      const u = new URL(ytUrl);
      if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
      return u.searchParams.get('v') || null;
    } catch { return null; }
  },

  _audioMime(ext) {
    return { m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm' }[ext] || 'audio/mp4';
  }
};

// ── Plug into AudiobookCtrl ────────────────────────────────────────────────
// Adds AudiobookCtrl.addBookFromYouTube(url) which feeds the result
// directly into the existing addBook() flow
AudiobookCtrl.addBookFromYouTube = async function(ytUrl) {
  if (!ytUrl || !ytUrl.trim()) {
    App.showToast('Paste a YouTube URL first');
    return;
  }

  // Show loading overlay
  App.showLoading('Connecting to bridge…');

  try {
    const { audioFile, captionFile, title } = await YTImport.import(
      ytUrl.trim(),
      (pct, label) => {
        // Update loading label if the API supports it
        const el = document.getElementById('loading-label') || document.getElementById('loading-text');
        if (el) el.textContent = label;
      }
    );

    // Pre-fill the existing upload form fields
    AudiobookCtrl._pendingAudio   = audioFile;
    AudiobookCtrl._pendingCaption = captionFile;

    const titleInput = document.getElementById('ab-title-input');
    if (titleInput) titleInput.value = title;

    document.getElementById('ab-audio-name').textContent   = audioFile.name;
    document.getElementById('ab-audio-zone').classList.add('has-file');

    if (captionFile) {
      document.getElementById('ab-caption-name').textContent = captionFile.name;
      document.getElementById('ab-caption-zone').classList.add('has-file');
    }

    App.hideLoading();
    App.showToast(captionFile ? '✓ Audio + captions ready' : '✓ Audio ready (no captions)');

    // Clear YouTube URL input after successful import (inside addBook finalize)
    const ytInput = document.getElementById('yt-url-input');
    if (ytInput) ytInput.value = '';

    // Auto-submit
    AudiobookCtrl.addBook();

  } catch (err) {
    App.hideLoading();
    App.showToast('Import failed: ' + err.message);
    console.error('[YTImport]', err);
  }
};

// ── UI: renders a YouTube import row inside the audiobook upload section ──
// Call once after DOMContentLoaded to inject the UI
(function injectYTImportUI() {
  document.addEventListener('DOMContentLoaded', () => {
    // Find the audiobook upload section
    const abZoneWrap = document.getElementById('ab-audio-zone')?.closest('.ab-upload-section')
      || document.getElementById('ab-audio-zone')?.parentElement;
    if (!abZoneWrap) return; // section not found, skip

    const wrapper = document.createElement('div');
    wrapper.id = 'yt-import-row';
    wrapper.style.cssText = `
      margin-bottom: 16px;
      background: var(--bg-glass);
      border: 1px solid var(--border-glass);
      border-radius: var(--radius-md);
      overflow: hidden;
    `;
    wrapper.innerHTML = `
      <div style="padding:12px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border-glass)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        <span style="font-size:12px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:0.8px">YouTube Import</span>
        <span style="font-size:10px;color:var(--text-secondary);margin-left:auto">Requires bridge running</span>
      </div>
      <div style="padding:12px 14px;display:flex;gap:8px">
        <input
          id="yt-url-input"
          type="url"
          placeholder="https://youtube.com/watch?v=..."
          style="flex:1;background:var(--bg-secondary);border:1px solid var(--border-glass);border-radius:8px;
                 color:var(--text-primary);font-size:13px;padding:9px 12px;outline:none;font-family:var(--font-ui);
                 transition:border-color 0.2s;"
          onfocus="this.style.borderColor='var(--accent)'"
          onblur="this.style.borderColor='var(--border-glass)'"
        />
        <button
          onclick="AudiobookCtrl.addBookFromYouTube(document.getElementById('yt-url-input').value)"
          style="padding:9px 16px;background:var(--accent);border:none;border-radius:8px;
                 color:var(--accent-on);font-size:13px;font-weight:700;cursor:pointer;
                 font-family:var(--font-ui);white-space:nowrap;transition:opacity 0.2s;"
          onmouseover="this.style.opacity='0.88'"
          onmouseout="this.style.opacity='1'">
          Import
        </button>
      </div>
    `;

    // Insert before the audio zone
    abZoneWrap.parentElement.insertBefore(wrapper, abZoneWrap);
  });
})();
