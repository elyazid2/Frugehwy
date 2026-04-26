/**
 * MAKTABA - POLISH & MICRO-INTERACTIONS (v1.2.1)
 * Load AFTER maktaba-refinements.js
 *
 * Patches:
 *   1. Smooth ORP word slide animation
 *   2. Haptic feedback on play/pause/advance
 *   3. Stronger sentence-boundary pauses
 *   4. Pause-screen context trail + dim scrim
 */

(function() {
  'use strict';

  // Wait until App is fully initialised before patching anything.
  // App.init() is called on DOMContentLoaded, so we defer one tick
  // after that to guarantee App.Display exists and is ready.
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(applyAllPatches, 0);
  });

  function applyAllPatches() {
    if (!window.App || !App.Display) {
      console.warn('[Maktaba v1.2] App not ready - patches skipped');
      return;
    }
    patchORPAnimation();
    patchHaptics();
    patchSentencePauses();
    patchPauseScreen();
  }


  // ---------------------------------------------------
  // 1. SMOOTH ORP ANIMATION
  // ---------------------------------------------------
  function patchORPAnimation() {
    var el = document.getElementById('rsvp-word');
    if (!el) return;

    var prevLen = 0;
    var orig = App.Display._showWord.bind(App.Display);

    App.Display._showWord = function(idx) {
      var words = this.engine && this.engine.words;
      if (!words) { orig(idx); return; }

      var word   = words[idx] || '';
      var newLen = word.length;
      var delta  = newLen - prevLen;

      if (Math.abs(delta) <= 1) {
        orig(idx);
        prevLen = newLen;
        return;
      }

      var slideOut = delta > 0 ? '-4px' : '4px';
      var slideIn  = delta > 0 ?  '4px' : '-4px';

      el.style.transition = 'opacity 40ms ease, transform 40ms ease';
      el.style.opacity    = '0';
      el.style.transform  = 'translateX(' + slideOut + ')';

      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          orig(idx);
          prevLen = newLen;

          el.style.transition = 'none';
          el.style.transform  = 'translateX(' + slideIn + ')';
          el.style.opacity    = '0';

          requestAnimationFrame(function() {
            el.style.transition = 'opacity 55ms ease, transform 55ms ease';
            el.style.opacity    = '1';
            el.style.transform  = 'translateX(0)';
          });
        });
      });
    };
  }


  // ---------------------------------------------------
  // 2. HAPTIC FEEDBACK
  // ---------------------------------------------------
  function buzz(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch(e) {}
  }

  function setReaderPausedState(paused) {
    var screen = document.getElementById('screen-reader');
    var topbar = document.getElementById('reader-topbar');
    if (screen) screen.classList.toggle('reader-paused', paused);
    if (topbar) topbar.classList.toggle('paused', paused);
  }

  function patchHaptics() {
    var origPlay  = App.Display.play.bind(App.Display);
    var origPause = App.Display.pause.bind(App.Display);
    var origNext  = App.Display._scheduleNext.bind(App.Display);

    App.Display.play = function() {
      buzz(10);
      origPlay();
      setReaderPausedState(false);
    };

    App.Display.pause = function() {
      buzz([10, 30, 10]);
      origPause();
      setReaderPausedState(true);
    };

    App.Display._scheduleNext = function(immediate) {
      if (!immediate && this.isPlaying) buzz(6);
      origNext(immediate);
    };
  }


  // ---------------------------------------------------
  // 3. SENTENCE-BOUNDARY PAUSES
  // ---------------------------------------------------
  var PARA_BREAK  = '\u200B';
  var RE_SENTENCE = /[.!?\u061F]$/;
  var RE_CLAUSE   = /[,;:\u060C\u061B]$/;
  var RE_DASH     = /[\u2014\u2013]$/;
  var RE_CLEAN    = /[^a-zA-Z0-9\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;

  function patchSentencePauses() {
    var origLoad = App.Display.load.bind(App.Display);

    App.Display.load = function(book, settings) {
      origLoad(book, settings);
      if (this.engine && !this.engine._patchedPauses) {
        this.engine._patchedPauses = true;
        applyDelayPatch(this.engine);
        injectParaBreaks(this.engine);
      }
    };
  }

  function applyDelayPatch(engine) {
    engine.getWordDelay = function(word, baseMs, smartPace) {
      if (!smartPace) return baseMs;
      if (word === PARA_BREAK) return Math.round(baseMs * 2.8);

      var multiplier = 1.0;
      var clean = word.replace(RE_CLEAN, '');

      if (clean.length > 7)  multiplier += (clean.length - 7) * 0.04;
      if (clean.length > 11) multiplier += 0.25;

      if (RE_SENTENCE.test(word))      { multiplier += 1.20; }
      else if (RE_CLAUSE.test(word))   { multiplier += 0.40; }
      else if (RE_DASH.test(word))     { multiplier += 0.20; }

      if (clean.length <= 3 && multiplier === 1.0) multiplier = 0.85;

      return Math.round(baseMs * multiplier);
    };
  }

  function injectParaBreaks(engine) {
    if (engine._paraBreaksInjected) return;
    engine._paraBreaksInjected = true;
    var paras = engine.paragraphs;
    if (!paras || paras.length <= 1) return;

    var words    = engine.words;
    var newWords = [];
    var cursor   = 0;

    for (var p = 0; p < paras.length; p++) {
      var paraWords = paras[p].split(/\s+/).filter(function(w) { return w.length > 0; });
      for (var i = 0; i < paraWords.length; i++) {
        newWords.push(words[cursor] !== undefined ? words[cursor] : paraWords[i]);
        cursor++;
      }
      if (p < paras.length - 1) newWords.push(PARA_BREAK);
    }
    engine.words = newWords;
  }


  // ---------------------------------------------------
  // 4. PAUSE-SCREEN CONTEXT TRAIL
  // ---------------------------------------------------
  function patchPauseScreen() {
    injectPauseUI();

    var origPlay     = App.Display.play.bind(App.Display);
    var origPause    = App.Display.pause.bind(App.Display);
    var origStop     = App.Display.stop.bind(App.Display);
    var origSkipBack = App.Display.skipBack.bind(App.Display);
    var origSkipFwd  = App.Display.skipForward.bind(App.Display);

    App.Display.play = function() {
      hidePauseContext();
      origPlay();
    };

    App.Display.pause = function() {
      origPause();
      showPauseContext(this);
    };

    App.Display.stop = function() {
      hidePauseContext();
      origStop();
    };

    App.Display.skipBack = function() {
      origSkipBack();
      if (!this.isPlaying) showPauseContext(this);
    };

    App.Display.skipForward = function() {
      origSkipFwd();
      if (!this.isPlaying) showPauseContext(this);
    };
  }

  function injectPauseUI() {
    if (document.getElementById('pause-scrim')) return;

    var scrim = document.createElement('div');
    scrim.id = 'pause-scrim';
    scrim.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.45);pointer-events:none;z-index:3;opacity:0;transition:opacity 0.28s ease';
    var reader = document.getElementById('screen-reader');
    if (reader) reader.appendChild(scrim);

    var trail = document.createElement('div');
    trail.id = 'pause-context-trail';
    trail.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);top:calc(var(--reader-pos,50) * 1% - 4.2em);max-width:84vw;text-align:center;font-family:var(--user-font);font-size:calc(var(--reader-size) * 0.55);color:var(--text-secondary);letter-spacing:0.04em;line-height:1.4;pointer-events:none;z-index:6;opacity:0;transition:opacity 0.22s ease;white-space:normal;word-break:break-word';
    var rsvpContainer = document.getElementById('rsvp-container');
    if (rsvpContainer) rsvpContainer.appendChild(trail);
  }

  function showPauseContext(display) {
    var scrim = document.getElementById('pause-scrim');
    var trail = document.getElementById('pause-context-trail');
    if (!scrim || !trail || !display.engine) return;

    var words   = display.engine.words;
    var idx     = Math.max(0, display.currentWordIdx - 1);
    var context = [];

    for (var i = idx - 1; i >= 0 && context.length < 5; i--) {
      var w = words[i];
      if (!w || w === PARA_BREAK) break;
      context.unshift(w);
    }

    trail.textContent = context.length > 0 ? context.join(' ') + ' \u2026' : '';
    trail.style.opacity = context.length > 0 ? '1' : '0';
    scrim.style.opacity = '1';
  }

  function hidePauseContext() {
    var scrim = document.getElementById('pause-scrim');
    var trail = document.getElementById('pause-context-trail');
    if (scrim) scrim.style.opacity = '0';
    if (trail) trail.style.opacity = '0';
  }

})();
