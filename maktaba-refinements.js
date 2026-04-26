/**
 * --------------------------------------------------------------------
 * -       MAKTABA - UI REFINEMENTS  JavaScript Utilities (v1.0)     -
 * -  Add this <script> block just before </body> in index.html,     -
 * -  or paste the individual functions into the App object.          -
 * --------------------------------------------------------------------
 */

/* -----------------------------------------------------------------
   -  FOCUS MARKER - runtime color switcher
   -----------------------------------------------------------------
   Exposes a clean API to change --focus-marker-color at runtime.
   Plugs into App.settings so the chosen color persists across
   sessions via localStorage.
   ----------------------------------------------------------------- */

const FOCUS_MARKER_PRESETS = {
  gold:     'var(--accent)',              // default champagne
  blue:     '#5BCEFA',                   // cool blue - high contrast
  softBlue: '#4A90D9',                   // warm blue - less jarring
  red:      '#E74C3C',                   // subtle red - strong contrast
  mint:     '#2ECC71',                   // mint - works on warm text
  dim:      'rgba(200,169,110,0.40)',    // dimmed gold - near-invisible
};

/**
 * Set the RSVP focus marker color.
 * @param {string|null} colorOrPreset  A preset key, any CSS color string,
 *                                     or null to reset to gold.
 *
 * Usage examples:
 *   setFocusMarkerColor('blue')          // preset
 *   setFocusMarkerColor('#FF6B6B')       // custom hex
 *   setFocusMarkerColor('hsl(210,70%,60%)') // any CSS color
 *   setFocusMarkerColor(null)            // reset to gold
 */
function setFocusMarkerColor(colorOrPreset) {
  const root = document.documentElement;
  const resolved = FOCUS_MARKER_PRESETS[colorOrPreset] ?? colorOrPreset;

  if (!resolved) {
    root.style.removeProperty('--focus-marker-color');
    if (window.App?.settings) App.settings.focusMarkerColor = null;
    return;
  }

  root.style.setProperty('--focus-marker-color', resolved);
  if (window.App?.settings) App.settings.focusMarkerColor = colorOrPreset;
}

/**
 * Set the focus marker opacity (0-1).
 * @param {number} opacity
 *
 * Usage: setFocusMarkerOpacity(0.4)   // subtle
 *        setFocusMarkerOpacity(0.9)   // bold
 */
function setFocusMarkerOpacity(opacity) {
  document.documentElement.style.setProperty(
    '--focus-marker-opacity',
    Math.min(1, Math.max(0, opacity)).toFixed(2)
  );
}

/** Restore marker settings from App.settings on boot */
function restoreFocusMarkerColor() {
  const saved = window.App?.settings?.focusMarkerColor;
  if (saved) setFocusMarkerColor(saved);
}

// -- Auto-restore on DOMContentLoaded --
document.addEventListener('DOMContentLoaded', restoreFocusMarkerColor);


/* -----------------------------------------------------------------
   -  SLIDER TRACK FILL (Webkit)
   Updates --range-progress CSS variable so the filled portion of
   the track renders in accent color via the CSS gradient rule in
   maktaba-refinements.css.
   -----------------------------------------------------------------
   Call this wherever you already call App.onFontSizeChange,
   App.onWpmChange, App.onVposChange, SoundCtrl.onVolume etc.
   The helper works on any range input.
   ----------------------------------------------------------------- */

/**
 * Updates the CSS --range-progress variable for a single range input
 * so the Webkit track gradient shows progress visually.
 *
 * @param {HTMLInputElement} input
 */
function updateSliderTrackFill(input) {
  const min = parseFloat(input.min) || 0;
  const max = parseFloat(input.max) || 100;
  const val = parseFloat(input.value) || 0;
  const pct = ((val - min) / (max - min)) * 100;
  input.style.setProperty('--range-progress', `${pct.toFixed(1)}%`);
}

/**
 * Attach fill-update listeners to all range inputs in the document.
 * Call once on DOMContentLoaded.
 */
function initSliderTrackFills() {
  document.querySelectorAll('input[type="range"]').forEach(input => {
    // Set initial fill
    updateSliderTrackFill(input);

    // Keep fill in sync on interaction
    input.addEventListener('input', () => updateSliderTrackFill(input));
    input.addEventListener('change', () => updateSliderTrackFill(input));
  });
}

document.addEventListener('DOMContentLoaded', initSliderTrackFills);

// Re-sync when the Quick Settings panel opens (sliders may have been
// updated via the Settings screen while the panel was closed)
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() {
    if (!window.App) return;
    var _origToggleReaderPanel = App.toggleReaderPanel;
    if (_origToggleReaderPanel) {
      App.toggleReaderPanel = function() {
        _origToggleReaderPanel.apply(this, arguments);
        document.querySelectorAll('#reader-settings-panel input[type="range"]')
          .forEach(updateSliderTrackFill);
      };
    }
  }, 0);
});


/* -----------------------------------------------------------------
   -  LIBRARY - Book item rendering helper
   -----------------------------------------------------------------
   If your renderLibrary / renderBookItem JS function currently
   builds book-item HTML strings manually, use the helper below.

   FIND your existing book item HTML generation (look for something
   like `innerHTML += ...` or `item.innerHTML = ...` in a renderLibrary
   or _renderBook function) and REPLACE the progress section with
   buildBookProgressHTML().
   ----------------------------------------------------------------- */

/**
 * Returns the HTML string for a book's progress bar + caption.
 *
 * @param {number} progressPct   0-100
 * @param {number} wordCount     total word count of the book
 * @returns {string}
 */
function buildBookProgressHTML(progressPct, wordCount) {
  const pct = Math.min(100, Math.max(0, progressPct || 0));
  const isStarted = pct > 0;
  const isDone    = pct >= 99;

  // Status label
  const label = isDone
    ? '- Complete'
    : isStarted
      ? `${pct}% read`
      : 'Not started';

  const barHtml = `
    <div class="book-progress-bar" title="${label}">
      <div class="book-progress-fill" style="width:${pct}%"></div>
    </div>`;

  // Compact meta line: percentage + word count
  const wStr  = wordCount ? `${wordCount.toLocaleString()} words` : '';
  const metaContent = [label, wStr].filter(Boolean).join(' - ');

  return `${barHtml}
    <div class="book-meta book-progress-pct">${metaContent}</div>`;
}

/**
 * HOW TO USE:
 *
 * In your existing renderLibrary / _buildBookItem function, replace:
 *
 *   OLD:
 *     <div class="book-meta">${book.progress || 0}% complete</div>
 *     <div class="book-progress-bar">
 *       <div class="book-progress-fill" style="width:${book.progress||0}%"></div>
 *     </div>
 *
 *   NEW (call the helper):
 *     ${buildBookProgressHTML(book.progress, book.wordCount)}
 *
 * The function also handles 0%, mid-progress, and 100% (- Complete) states.
 */


/* -----------------------------------------------------------------
   -  BONUS: Update existing book items in the DOM without a full
   re-render. Useful if App.renderLibrary is not easily patchable.
   -----------------------------------------------------------------
   Call refreshLibraryProgressBars() after App.renderLibrary() runs,
   or call it once if books are already in the DOM.
   ----------------------------------------------------------------- */

function refreshLibraryProgressBars() {
  document.querySelectorAll('.book-item').forEach(item => {
    const fill = item.querySelector('.book-progress-fill');
    if (!fill) return;

    // Extract progress from existing inline style "width: X%"
    const w = parseFloat(fill.style.width) || 0;

    // Show leading-edge glow dot only when there's meaningful progress
    fill.style.setProperty('--has-progress', w > 3 ? '1' : '0');
    fill.style.boxShadow = w > 3
      ? '0 0 8px rgba(200,169,110,0.35)'
      : 'none';
  });
}

// Run on boot and after any navigation that shows the library
document.addEventListener('DOMContentLoaded', () => {
  // Small delay to let App.renderLibrary finish
  setTimeout(refreshLibraryProgressBars, 200);
});


/* -----------------------------------------------------------------
   -  (Cleanup) Strip stale +50/-50 WPM button event listeners
   -----------------------------------------------------------------
   If you've already patched the HTML (removed the -50/+50 buttons)
   nothing more is needed in JS. This guard is a safety net in case
   the buttons are generated dynamically.
   ----------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', () => {
  // Remove any dynamically-added -50 WPM buttons
  document.querySelectorAll('.wpm-q-btn').forEach(btn => {
    const t = btn.textContent.trim();
    if (t === '-50' || t === '+50') btn.remove();
  });
});


/* -----------------------------------------------------------------
   PATCH v1.1 - chunk-mode badge class + library progress refresh
   -----------------------------------------------------------------
   Keeps the reader topbar WPM badge visually distinct when in
   Manual Pacing mode (shows "X / Y") vs RSVP mode (shows "N WPM").
   ----------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', function() {
  // Defer so App.init() runs first
  setTimeout(function() {
    if (!window.App) return;

    (function patchChunkModeBadge() {
      var origOpenReader = App.openReader ? App.openReader.bind(App) : null;
      if (!origOpenReader) return;
      App.openReader = function(book) {
        origOpenReader(book);
        var badge = document.getElementById('reader-wpm-display');
        if (!badge) return;
        badge.classList.toggle('chunk-mode', App.settings.mode === 'manual');
      };
    })();

    (function patchLibraryRefresh() {
      var origRenderLibrary = App.renderLibrary ? App.renderLibrary.bind(App) : null;
      if (!origRenderLibrary) return;
      App.renderLibrary = function() {
        origRenderLibrary();
        setTimeout(refreshLibraryProgressBars, 50);
      };
    })();

  }, 0);
}); // end DOMContentLoaded for App patches
