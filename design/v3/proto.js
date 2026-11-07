/* Prototype behaviour only: enough interaction to judge the design.
   No libraries. The production build is a Preact web component. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var M = window.LAMotion || null; /* v2 motion layer; optional */

  function money(n) {
    return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function signed(n) {
    if (n === 0) return '0.00';
    return (n > 0 ? '+' : '−') + Math.abs(n).toFixed(2);
  }

  /* ---------- Open / close the configurator -------------------------------- */
  var root = $('.la-configurator');
  function openConfigurator() {
    if (!root) return;
    if (M) M.openLayer(root); else root.hidden = false;
    var h = $('#la-title', root);
    if (h) h.focus();
  }
  function closeConfigurator(cb) {
    if (!root) return;
    var opener = $('[data-open-configurator]');
    function done() { if (typeof cb === 'function') cb(); else if (opener) opener.focus(); }
    if (M) M.closeLayer(root, $('.la-sheet', root), done);
    else { root.hidden = true; done(); }
  }
  $$('[data-open-configurator]').forEach(function (b) { b.addEventListener('click', openConfigurator); });
  $$('[data-close-configurator]').forEach(function (b) { b.addEventListener('click', function () { closeConfigurator(); }); });
  /* Fresh visit to the product page: the sheet opens with its entrance. Arriving from
     another step: the sheet is already open, only the step content moves. */
  if (root && M && !M.stepIn() && root.hasAttribute('data-enter-on-load')) M.openLayer(root);

  /* ---------- Rx selects ---------------------------------------------------- */
  var ranges = {
    sph: { min: -20, max: 12, step: 0.25 },
    cyl: { min: -6, max: 6, step: 0.25 },
    add: { min: 0.75, max: 3.5, step: 0.25 }
  };
  $$('select[data-range]').forEach(function (sel) {
    var r = ranges[sel.dataset.range];
    var current = sel.dataset.value || '';
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = sel.dataset.range === 'add' ? 'Select' : '0.00';
    if (sel.dataset.range !== 'add') blank.value = '0';
    sel.appendChild(blank);
    for (var v = r.max; v >= r.min - 1e-9; v -= r.step) {
      var val = Math.round(v * 100) / 100;
      if (val === 0) continue;
      var o = document.createElement('option');
      o.value = String(val);
      o.textContent = signed(val);
      sel.appendChild(o);
    }
    if (current !== '') sel.value = current;
  });

  /* AXIS is required when CYL is set */
  function validateEye(eye) {
    var cyl = $('#' + eye + '-cyl');
    var axis = $('#' + eye + '-axis');
    var err = $('#' + eye + '-axis-error');
    if (!cyl || !axis || !err) return true;
    var needs = parseFloat(cyl.value || '0') !== 0;
    var a = parseInt(axis.value, 10);
    var bad = needs && (isNaN(a) || a < 1 || a > 180);
    var outOfRange = !isNaN(a) && (a < 1 || a > 180);
    axis.setAttribute('aria-invalid', bad || outOfRange ? 'true' : 'false');
    err.hidden = !(bad || outOfRange);
    if (outOfRange) err.lastElementChild.textContent = 'Axis is a number from 1 to 180.';
    else err.lastElementChild.textContent = 'Add the axis. It goes with the cylinder value (1 to 180).';
    return !(bad || outOfRange);
  }
  ['od', 'os'].forEach(function (eye) {
    var cyl = $('#' + eye + '-cyl');
    var axis = $('#' + eye + '-axis');
    if (cyl) cyl.addEventListener('change', function () { validateEye(eye); });
    /* v3: no error on arrival. Validate once the shopper leaves the field, then live. */
    if (axis) axis.addEventListener('blur', function () { axis.dataset.touched = '1'; validateEye(eye); });
    if (axis) axis.addEventListener('input', function () { if (axis.dataset.touched) validateEye(eye); });
  });

  var copyBtn = $('[data-copy-eye]');
  if (copyBtn) copyBtn.addEventListener('click', function () {
    ['sph', 'cyl', 'axis', 'add'].forEach(function (f) {
      var a = $('#od-' + f), b = $('#os-' + f);
      if (a && b) b.value = a.value;
    });
    validateEye('os');
  });

  /* PD: one number or two */
  $$('input[name="pd-mode"]').forEach(function (r) {
    r.addEventListener('change', function () {
      var dual = r.value === 'dual' && r.checked;
      $$('[data-pd="single"]').forEach(function (el) { el.hidden = dual; });
      $$('[data-pd="dual"]').forEach(function (el) { el.hidden = !dual; });
    });
  });

  /* ---------- Tabs ---------------------------------------------------------- */
  $$('[role="tablist"]').forEach(function (list) {
    var tabs = $$('[role="tab"]', list);
    function select(tab, animate) {
      tabs.forEach(function (t, i) {
        var on = t === tab;
        var panel = $('#' + t.getAttribute('aria-controls'));
        var wasHidden = panel.hidden;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        panel.hidden = !on;
        if (on) list.dataset.active = String(i);
        if (on && wasHidden && animate !== false && M) M.fadeIn(panel);
      });
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(t); });
      t.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        select(n); n.focus();
      });
    });
    if (location.hash === '#upload') {
      var up = tabs.filter(function (t) { return t.id === 'tab-upload'; })[0];
      if (up) select(up, false);
    }
  });

  /* ---------- Upload -------------------------------------------------------- */
  var drop = $('.la-drop');
  var chip = $('.la-file');
  function showFile(file) {
    if (!chip) return;
    $('.la-file__name', chip).textContent = file.name;
    $('.la-file__size', chip).textContent = (file.size / 1048576).toFixed(1) + ' MB';
    chip.hidden = false;
    if (drop) drop.setAttribute('data-has-file', '');
    var pl = $('[data-pick-label]'); if (pl) pl.textContent = 'Replace file';
  }
  $$('input[type="file"]').forEach(function (inp) {
    inp.addEventListener('change', function () { if (inp.files[0]) showFile(inp.files[0]); });
  });
  if (drop) {
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.setAttribute('data-dragover', ''); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.removeAttribute('data-dragover'); });
    });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) showFile(e.dataTransfer.files[0]); });
  }
  var remove = $('[data-remove-file]');
  if (remove) remove.addEventListener('click', function () {
    var pick = $('[data-pick-file]');
    function gone() {
      chip.hidden = true;
      if (drop) drop.removeAttribute('data-has-file');
      var pl = $('[data-pick-label]'); if (pl) pl.textContent = 'Choose file';
      if (pick) pick.focus();
    }
    if (M) M.popOut(chip, gone); else gone();
  });

  /* ---------- Accordions (lens groups, cart "includes") --------------------- */
  $$('[data-accordion]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      var panel = $('#' + btn.getAttribute('aria-controls'));
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (!M) { panel.hidden = open; return; }
      if (open) M.collapse(panel); else M.expand(panel, '.la-choice');
    });
  });

  /* ---------- Tint: colours only when a tint is chosen ---------------------- */
  $$('input[name="tint"]').forEach(function (r) {
    r.addEventListener('change', function () {
      var sw = $('.la-swatches');
      if (!sw) return;
      var hide = r.value === 'none';
      if (!M) { sw.hidden = hide; return; }
      if (hide) M.collapse(sw); else if (sw.hidden) M.expand(sw);
    });
  });

  /* ---------- Running price ----------------------------------------------- */
  var sheet = $('.la-sheet');
  function recalc() {
    if (!sheet || !$('[data-sum="total"]')) return;
    var frame = parseFloat(sheet.dataset.frame || '0');
    var lens = parseFloat(sheet.dataset.lens || '0');
    var up = parseFloat(sheet.dataset.upgrades || '0');
    var lensChosen = !!sheet.dataset.lens;
    $$('input[data-price]:checked', sheet).forEach(function (i) {
      var p = parseFloat(i.dataset.price);
      if (i.dataset.kind === 'lens') { lens += p; lensChosen = true; } else up += p;
    });
    var changed = [];
    var set = function (k, v) {
      var el = $('[data-sum="' + k + '"]', sheet);
      if (!el || el.textContent === v) return;
      if (el.textContent !== '' && k !== 'total') changed.push(el);
      el.textContent = v;
    };
    set('frame', money(frame));
    set('lens', lensChosen ? money(lens) : 'to choose');
    set('upgrades', money(up));
    var totalEl = $('[data-sum="total"]', sheet);
    var before = totalEl.textContent;
    set('total', money(frame + lens + up));
    if (M && before !== '' && before !== totalEl.textContent) M.priceChanged(totalEl, changed);
  }
  if (sheet) sheet.addEventListener('change', recalc);
  recalc();

  /* Tapping a disabled option points at the reason instead of doing nothing. */
  $$('.la-choice').forEach(function (c) {
    var inp = $('input', c);
    var why = $('.la-choice__reason', c);
    if (!inp || !inp.disabled || !why) return;
    c.addEventListener('click', function () { if (M) M.highlight(why); });
  });

  /* ---------- Continue gated on a choice (step 1, step 3-4) --------------- */
  var cont = $('[data-continue]');
  var gate = cont && cont.dataset.requires;
  function updateGate() {
    if (!gate) return;
    var ok = !!$('input[name="' + gate + '"]:checked');
    cont.setAttribute('aria-disabled', ok ? 'false' : 'true');
  }
  if (cont) {
    cont.addEventListener('click', function (e) {
      if (cont.getAttribute('aria-disabled') === 'true') {
        e.preventDefault();
        var hint = $('#continue-hint');
        if (hint) hint.hidden = false;
      }
    });
    if (sheet) sheet.addEventListener('change', updateGate);
    updateGate();
  }

  /* ---------- Cart drawer --------------------------------------------------- */
  var drawer = $('.la-drawer-backdrop');
  function openDrawer() {
    if (!drawer) return;
    function show() {
      if (M) M.openLayer(drawer); else drawer.hidden = false;
      $('.la-drawer h2', drawer).focus({ preventScroll: true });
    }
    if (root && !root.hidden) {
      closeConfigurator(function () {});
      /* the drawer starts while the sheet is still leaving: one continuous hand-off */
      setTimeout(show, M ? M.ms('--la-dur-press') : 0);
    } else show();
  }
  function closeDrawer() {
    if (!drawer) return;
    if (M) M.closeLayer(drawer, $('.la-drawer', drawer)); else drawer.hidden = true;
  }
  $$('[data-add-to-cart]').forEach(function (b) { b.addEventListener('click', openDrawer); });
  $$('[data-close-drawer]').forEach(function (b) { b.addEventListener('click', closeDrawer); });
  if (drawer) drawer.addEventListener('click', function (e) { if (e.target === drawer) closeDrawer(); });
  if (location.hash === '#cart') {
    if (root) root.hidden = true;
    if (drawer) { drawer.hidden = false; drawer.dataset.state = 'open'; }
  }

  /* ---------- v3: step 2 cannot continue past an invalid field --------------- */
  var stepAlert = $('#step-alert');
  if (stepAlert && cont) {
    cont.addEventListener('click', function (e) {
      var okR = validateEye('od'), okL = validateEye('os');
      if (okR && okL) { stepAlert.hidden = true; return; }
      e.preventDefault();
      stepAlert.hidden = false;
      stepAlert.focus();
    });
    var go = $('[data-goto-invalid]');
    if (go) go.addEventListener('click', function () {
      var bad = $('[aria-invalid="true"]');
      if (bad) bad.focus();
    });
    ['od', 'os'].forEach(function (eye) {
      var axis = $('#' + eye + '-axis');
      if (axis) axis.addEventListener('input', function () {
        if (!$('[aria-invalid="true"]')) stepAlert.hidden = true;
      });
    });
  }

  /* #errors shows the state after an attempted Continue (for review of the design). */
  if (location.hash === '#errors' && cont) setTimeout(function () { cont.click(); }, 0);

  /* ---------- v3: upload rejects the wrong type or size, in words ------------- */
  var upErr = $('#upload-error');
  if (upErr) {
    var okTypes = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf'];
    var check = function (file) {
      var msg = '';
      if (file.size > 10 * 1048576) msg = file.name + ' is ' + (file.size / 1048576).toFixed(1) + ' MB. Files can be up to 10 MB; try a photo instead of a scan.';
      else if (file.type && okTypes.indexOf(file.type) < 0 && !/^image\//.test(file.type)) msg = file.name + ' is not a photo or PDF. Use JPG, PNG, HEIC or PDF.';
      upErr.lastElementChild.textContent = msg;
      upErr.hidden = !msg;
      if (msg && chip) chip.hidden = true;
      return !msg;
    };
    $$('input[type="file"]').forEach(function (inp) {
      inp.addEventListener('change', function (e) {
        if (inp.files[0] && !check(inp.files[0])) e.stopImmediatePropagation();
      }, true);
    });
  }

  /* ---------- v3: modal focus stays inside the open layer ------------------- */
  var themeParts = $$('.theme-header, .theme-product');
  function syncInert() {
    var open = (root && !root.hidden) || (drawer && !drawer.hidden);
    themeParts.forEach(function (el) { el.inert = !!open; });
  }
  var mo = new MutationObserver(syncInert);
  [root, drawer].forEach(function (el) { if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] }); });
  syncInert();
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var layer = drawer && !drawer.hidden ? $('.la-drawer', drawer) : (root && !root.hidden ? $('.la-sheet', root) : null);
    if (!layer) return;
    var f = $$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])', layer)
      .filter(function (el) { return el.offsetParent !== null || el.getClientRects().length; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !layer.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !layer.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (drawer && !drawer.hidden) closeDrawer();
    else if (root && !root.hidden) closeConfigurator();
  });
})();
