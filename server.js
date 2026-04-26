/**
 * Maktaba YouTube Bridge
 * ──────────────────────
 * Node.js + Express middleman between Maktaba and YouTube.
 * Uses yt-dlp under the hood to extract audio + caption URLs
 * without downloading the full file — it just fetches the links.
 *
 * Usage:
 *   node server.js
 *   (default port 3847 — change with PORT env var)
 */

const express  = require('express');
const cors     = require('cors');
const { exec } = require('child_process');
const https    = require('https');
const http     = require('http');
const url      = require('url');

const app  = express();
const PORT = process.env.PORT || 3847;

// ── CORS — open to any origin so the bridge works when hosted on Railway/Render ──
app.use(cors());
app.use(express.json());

// ── Health check ──
app.get('/ping', (_req, res) => res.json({ ok: true, version: '1.0.0' }));

// ── Fetch a remote text resource (for caption content) ─────────────────────
function fetchText(targetUrl) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const proto  = parsed.protocol === 'https:' ? https : http;
    let body = '';
    proto.get(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end',  () => resolve(body));
    }).on('error', reject);
  });
}

// ── Main endpoint ──────────────────────────────────────────────────────────
// GET /get-audiobook?url=<youtube_url>
// Returns: { title, audioUrl, captionUrl, captionText, captionLang, durationSec }
// ──────────────────────────────────────────────────────────────────────────
app.get('/get-audiobook', (req, res) => {
  const ytUrl = req.query.url;

  if (!ytUrl || !isYouTubeUrl(ytUrl)) {
    return res.status(400).json({ error: 'Invalid or missing YouTube URL' });
  }

  console.log('[Bridge] Extracting:', ytUrl);

  // yt-dlp command — dump JSON, no actual download
  // Selects best audio-only format (m4a preferred, then bestaudio)
  // Also requests auto-generated captions in Arabic, then English
  const cmd = [
    'yt-dlp',
    '--dump-json',
    '--no-playlist',
    '--format', 'bestaudio[ext=m4a]/bestaudio',
    '--write-auto-sub',
    '--sub-lang', 'ar,ar-.*,en,en-.*',
    '--sub-format', 'vtt/srt',
    '--skip-download',
    '--no-warnings',
    `"${ytUrl.replace(/"/g, '\\"')}"`
  ].join(' ');

  exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }, async (err, stdout, stderr) => {
    if (err) {
      console.error('[Bridge] yt-dlp error:', stderr || err.message);
      return res.status(502).json({
        error: 'yt-dlp failed. Is it installed? Run: pip install -U yt-dlp',
        detail: stderr?.slice(0, 300) || err.message
      });
    }

    let meta;
    try {
      meta = JSON.parse(stdout);
    } catch (e) {
      return res.status(502).json({ error: 'Could not parse yt-dlp output', detail: stdout.slice(0, 200) });
    }

    // ── Pick best audio format ──
    const audioFormat = pickAudioFormat(meta.formats || []);
    if (!audioFormat) {
      return res.status(404).json({ error: 'No audio format found for this video' });
    }

    // ── Pick best caption and fetch its content immediately ──
    // We fetch the content here (server-side) so the URL-expiry problem can't
    // affect the client — the text is embedded directly in the JSON response.
    const captionInfo = pickCaption(meta.automatic_captions || meta.subtitles || {});
    let captionText = null;
    if (captionInfo?.url) {
      try {
        const raw = await fetchText(captionInfo.url);
        // Accept VTT or SRT
        if (raw.trim().startsWith('WEBVTT') || raw.includes(' --> ')) {
          captionText = raw;
          console.log('[Bridge] ✓ Caption fetched, lang:', captionInfo.lang, '| bytes:', raw.length);
        } else {
          console.warn('[Bridge] Caption fetched but format unrecognised — discarding');
        }
      } catch (e) {
        console.warn('[Bridge] Caption fetch failed:', e.message);
      }
    }

    console.log('[Bridge] OK — title:', meta.title);
    console.log('[Bridge] Audio URL ext:', audioFormat.ext, '| size:', audioFormat.filesize || '?');
    console.log('[Bridge] Caption lang:', captionInfo?.lang || 'none', captionText ? '(content embedded)' : '(not available)');

    res.json({
      title:        meta.title        || 'Untitled',
      channel:      meta.uploader     || meta.channel || '',
      durationSec:  meta.duration     || 0,
      thumbnail:    meta.thumbnail    || null,
      audioUrl:     audioFormat.url,
      audioExt:     audioFormat.ext   || 'm4a',
      audioSize:    audioFormat.filesize || null,
      captionUrl:   captionInfo?.url  || null,   // kept as fallback
      captionText:  captionText       || null,   // NEW: embedded content, no expiry issue
      captionLang:  captionInfo?.lang || null,
      captionExt:   captionInfo?.ext  || null,
    });
  });
});

// ── Proxy endpoint — avoids CORS on direct audio/caption fetches ───────────
// GET /proxy?url=<encoded_url>
// Streams the remote resource through to the browser
// ──────────────────────────────────────────────────────────────────────────
app.get('/proxy', (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).json({ error: 'Missing url param' });

  let parsed;
  try { parsed = new URL(target); } catch (e) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Only allow YouTube CDN / googlevideo domains
  const allowed = /\.(googlevideo\.com|youtube\.com|ytimg\.com|ggpht\.com|googleusercontent\.com)$/i;
  if (!allowed.test(parsed.hostname)) {
    return res.status(403).json({ error: 'Proxy only allowed for YouTube CDN domains' });
  }

  const proto = parsed.protocol === 'https:' ? https : http;
  const proxyReq = proto.get(target, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (proxyRes) => {
    res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/octet-stream');
    if (proxyRes.headers['content-length']) {
      res.setHeader('Content-Length', proxyRes.headers['content-length']);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (e) => {
    if (!res.headersSent) res.status(502).json({ error: 'Proxy fetch failed', detail: e.message });
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function isYouTubeUrl(u) {
  try {
    const p = new URL(u);
    return /^(www\.|m\.)?youtube\.com$|^youtu\.be$/.test(p.hostname);
  } catch { return false; }
}

function pickAudioFormat(formats) {
  // Prefer m4a audio-only, then any audio-only, then worst video as fallback
  const audioOnly = formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none');
  if (audioOnly.length) {
    // Sort: m4a first, then by bitrate desc
    audioOnly.sort((a, b) => {
      if (a.ext === 'm4a' && b.ext !== 'm4a') return -1;
      if (b.ext === 'm4a' && a.ext !== 'm4a') return 1;
      return (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0);
    });
    return audioOnly[0];
  }
  // Fallback: any format with audio
  return formats.find(f => f.acodec !== 'none') || null;
}

function pickCaption(captions) {
  // Priority: Arabic auto, any Arabic, English auto, any English
  const priority = ['ar', 'ar-Arab', 'en', 'en-orig', 'en-US'];

  for (const lang of priority) {
    if (captions[lang]) {
      const tracks = captions[lang];
      // Prefer vtt, then srt, then json3
      const vtt = tracks.find(t => t.ext === 'vtt');
      const srt = tracks.find(t => t.ext === 'srt');
      const chosen = vtt || srt || tracks[0];
      if (chosen) return { lang, url: chosen.url, ext: chosen.ext || 'vtt' };
    }
  }

  // Accept any available language
  const anyLang = Object.keys(captions)[0];
  if (anyLang && captions[anyLang]?.length) {
    const tracks = captions[anyLang];
    const chosen = tracks.find(t => t.ext === 'vtt') || tracks[0];
    return { lang: anyLang, url: chosen.url, ext: chosen.ext || 'vtt' };
  }

  return null;
}

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎧 Maktaba Bridge running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/ping`);
  console.log(`   Import: http://localhost:${PORT}/get-audiobook?url=<youtube_url>\n`);
});
