/* Prototype behaviour only: enough interaction to judge the design.
   No libraries. The production build is a Preact web component. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

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
    root.hidden = false;
    var h = $('#la-title', root);
    if (h) h.focus();
  }
  function closeConfigurator() {
    if (!root) return;
    root.hidden = true;
    var opener = $('[data-open-configurator]');
    if (opener) opener.focus();
  }
  $$('[data-open-configurator]').forEach(function (b) { b.addEventListener('click', openConfigurator); });
  $$('[data-close-configurator]').forEach(function (b) { b.addEventListener('click', closeConfigurator); });

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
    if (axis) axis.addEventListener('input', function () { validateEye(eye); });
    if (axis && axis.dataset.showError === 'true') validateEye(eye);
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
    function select(tab) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        $('#' + t.getAttribute('aria-controls')).hidden = !on;
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
      if (up) select(up);
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
    chip.hidden = true;
    var pick = $('[data-pick-file]');
    if (pick) pick.focus();
  });

  /* ---------- Accordions (lens groups, cart "includes") --------------------- */
  $$('[data-accordion]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      $('#' + btn.getAttribute('aria-controls')).hidden = open;
    });
  });

  /* ---------- Tint: colours only when a tint is chosen ---------------------- */
  $$('input[name="tint"]').forEach(function (r) {
    r.addEventListener('change', function () {
      var sw = $('.la-swatches');
      if (sw) sw.hidden = r.value === 'none';
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
    var set = function (k, v) { var el = $('[data-sum="' + k + '"]', sheet); if (el) el.textContent = v; };
    set('frame', money(frame));
    set('lens', lensChosen ? money(lens) : 'not chosen');
    set('upgrades', money(up));
    set('total', money(frame + lens + up));
  }
  if (sheet) sheet.addEventListener('change', recalc);
  recalc();

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
    if (root) root.hidden = true;
    drawer.hidden = false;
    $('.la-drawer h2', drawer).focus();
  }
  function closeDrawer() { if (drawer) drawer.hidden = true; }
  $$('[data-add-to-cart]').forEach(function (b) { b.addEventListener('click', openDrawer); });
  $$('[data-close-drawer]').forEach(function (b) { b.addEventListener('click', closeDrawer); });
  if (drawer) drawer.addEventListener('click', function (e) { if (e.target === drawer) closeDrawer(); });
  if (location.hash === '#cart') openDrawer();

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (drawer && !drawer.hidden) closeDrawer();
    else if (root && !root.hidden) closeConfigurator();
  });
})();
