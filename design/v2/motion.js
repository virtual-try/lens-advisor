/* Motion helpers (v2, animate). WAAPI only, no libraries. Every duration and
   curve is read from tokens.css so there is one source of truth.
   proto.js calls these when present; without this file the prototype still works. */
window.LAMotion = (function () {
  'use strict';
  var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  var css = getComputedStyle(document.documentElement);
  function reduced() { return mq.matches; }
  function tok(name) { return css.getPropertyValue(name).trim(); }
  function ms(name) {
    var v = tok(name);
    return v.slice(-2) === 'ms' ? parseFloat(v) : parseFloat(v) * 1000;
  }
  function px(name) { return parseFloat(tok(name)); }

  /* Wait for the element's own transition, with a timeout in case it never fires. */
  function afterTransition(el, budget, cb) {
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      el.removeEventListener('transitionend', onEnd);
      cb();
    }
    function onEnd(e) { if (e.target === el) finish(); }
    el.addEventListener('transitionend', onEnd);
    setTimeout(finish, budget + 80);
  }

  /* ---------- Layers: configurator sheet/modal, cart drawer ------------------ */
  function openLayer(layer) {
    layer.hidden = false;
    layer.dataset.state = 'closed';
    void layer.offsetWidth; // commit the closed state so the transition runs
    layer.dataset.state = 'open';
  }
  function closeLayer(layer, panel, cb) {
    layer.dataset.state = 'closing';
    afterTransition(panel, ms('--la-dur-sheet'), function () {
      layer.hidden = true;
      layer.dataset.state = 'closed';
      if (cb) cb();
    });
  }

  /* ---------- Height reveal (accordions, tint colours) ---------------------- */
  function expand(panel, staggerSelector) {
    var from = panel.hidden ? 0 : panel.getBoundingClientRect().height;
    if (panel._la) panel._la.cancel();
    panel.hidden = false;
    if (reduced()) {
      panel._la = panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms('--la-dur-fast'), easing: 'linear' });
      return;
    }
    var to = panel.scrollHeight;
    panel.style.overflow = 'hidden';
    panel._la = panel.animate(
      [{ height: from + 'px', opacity: from ? 1 : 0 }, { height: to + 'px', opacity: 1 }],
      { duration: ms('--la-dur-modal'), easing: tok('--la-ease-out') }
    );
    panel._la.onfinish = function () { panel.style.overflow = ''; };
    if (staggerSelector && !from) {
      Array.prototype.forEach.call(panel.querySelectorAll(staggerSelector), function (item, i) {
        item.animate(
          [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
          { duration: ms('--la-dur-modal'), delay: i * ms('--la-stagger'), easing: tok('--la-ease-out'), fill: 'backwards' }
        );
      });
    }
  }
  function collapse(panel) {
    if (panel.hidden) return;
    var from = panel.getBoundingClientRect().height;
    if (panel._la) panel._la.cancel();
    var frames = reduced()
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [{ height: from + 'px', opacity: 1 }, { height: '0px', opacity: 0 }];
    panel.style.overflow = 'hidden';
    panel._la = panel.animate(frames, { duration: ms('--la-dur-fast'), easing: reduced() ? 'linear' : tok('--la-ease-out') });
    panel._la.onfinish = function () { panel.hidden = true; panel.style.overflow = ''; };
  }

  /* ---------- Fade a freshly shown panel (tab switch) ----------------------- */
  function fadeIn(el) {
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms('--la-dur-fast'), easing: tok('--la-ease-out') });
  }
  function popOut(el, cb) {
    var frames = reduced() ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.96)' }];
    el.animate(frames, { duration: ms('--la-dur-fast'), easing: tok('--la-ease-out') }).onfinish = cb;
  }

  /* ---------- Price changed: settle the total, tint the part that moved ----- */
  function priceChanged(totalEl, changedEls) {
    if (totalEl) {
      if (totalEl._la) totalEl._la.cancel();
      var frames = reduced()
        ? [{ opacity: 0.4 }, { opacity: 1 }]
        : [{ opacity: 0.4, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }];
      totalEl._la = totalEl.animate(frames, { duration: ms('--la-dur-modal'), easing: tok('--la-ease-out') });
    }
    changedEls.forEach(highlight);
  }
  function highlight(el) {
    if (el._hl) el._hl.cancel();
    el._hl = el.animate(
      [{ backgroundColor: tok('--la-accent-soft') }, { backgroundColor: 'transparent' }],
      { duration: ms('--la-dur-highlight'), easing: tok('--la-ease-out') }
    );
  }

  /* ---------- Step transitions (page-per-step prototype) -------------------- */
  var ORDER = { 'product.html': 1, 'prescription.html': 2, 'lenses.html': 3, 'options.html': 5, 'review.html': 7 };
  function pageOf(href) { return href.split('#')[0].split('/').pop() || 'product.html'; }
  var KEY = 'la-step-dir';

  function stepIn() {
    var sheet = document.querySelector('.la-configurator .la-sheet');
    var dir = null;
    try { dir = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); } catch (e) { /* storage blocked */ }
    if (!sheet || !dir) return false;
    sheet.setAttribute('data-step-enter', '');
    var body = sheet.querySelector('.la-body');
    var d = dir === 'back' ? -1 : 1;
    var frames = reduced()
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ opacity: 0, transform: 'translateX(' + d * px('--la-shift') + 'px)' }, { opacity: 1, transform: 'none' }];
    body.animate(frames, { duration: ms('--la-dur-modal'), easing: tok('--la-ease-out'), fill: 'backwards' });
    return true;
  }

  function stepOut(link, e) {
    var target = pageOf(link.getAttribute('href'));
    var here = pageOf(location.pathname);
    if (!(target in ORDER) || target === here) return;
    e.preventDefault();
    var d = ORDER[target] > ORDER[here] ? 1 : -1;
    try { sessionStorage.setItem(KEY, d > 0 ? 'forward' : 'back'); } catch (err) { /* storage blocked */ }
    var body = document.querySelector('.la-configurator .la-body');
    var frames = reduced()
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(' + -d * px('--la-shift') + 'px)' }];
    body.animate(frames, { duration: ms('--la-dur-fast'), easing: tok('--la-ease-out'), fill: 'forwards' })
      .onfinish = function () { location.href = link.href; };
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('.la-configurator a[href]');
    if (!link || e.defaultPrevented || link.getAttribute('aria-disabled') === 'true') return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    stepOut(link, e);
  });

  /* Back/forward cache: never restore a half-faded body. */
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    var body = document.querySelector('.la-configurator .la-body');
    if (body) body.getAnimations().forEach(function (a) { a.cancel(); });
  });

  return {
    reduced: reduced, ms: ms,
    openLayer: openLayer, closeLayer: closeLayer,
    expand: expand, collapse: collapse,
    fadeIn: fadeIn, popOut: popOut,
    priceChanged: priceChanged, highlight: highlight,
    stepIn: stepIn
  };
})();
