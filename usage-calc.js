/* usage-calc.js — מחשבון שווי שימוש, ספידומטר. עודכן 16.11.2026.
 * כל המספרים כאן הם נתוני 2026 שפורסמו; מקורות בעמוד עצמו (usage-value-calculator.html).
 *  - שווי שימוש: 2.48% ממחיר המחירון, עד תקרה 596,860 ₪, מעוגל ל-10 ₪.
 *  - הפחתה (הוראת שעה עד 31.12.2028): היברידי 580, היברידי נטען 1,150, חשמלי 1,380 ₪ לחודש.
 *  - מס הכנסה 2026 אחרי ריווח המדרגות (חוק ההתייעלות, 31.3.2026, רטרואקטיבי מ-1.1.2026).
 *  - ביטוח לאומי + בריאות, חלק העובד: 4.27% עד 7,703 ₪, 12.17% עד 51,910 ₪.
 */
(function () {
  'use strict';
  var CEILING = 596860, RATE = 0.0248, POINT = 242;
  var DED = { petrol: 0, hev: 580, phev: 1150, ev: 1380 };
  var PT_LABEL = { petrol: 'בנזין / דיזל', hev: 'היברידי', phev: 'היברידי נטען', ev: 'חשמלי' };
  var BRACKETS = [[7010, 0.10], [10060, 0.14], [19000, 0.20], [25100, 0.31], [46690, 0.35], [60130, 0.47], [Infinity, 0.50]];
  var BL_LOW = 7703, BL_MAX = 51910, BL_R1 = 0.0427, BL_R2 = 0.1217;
  var GAUGE_MAX = 15000, ARC_LEN = 302;
  var SB_URL = 'https://kaykrrnmykqrfhawgtqt.supabase.co', SB_KEY = 'sb_publishable_Ms6YFTnADm-qAd9617Ey9A_D3x-Zumi';

  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return Math.round(n).toLocaleString('en-US'); };
  var digits = function (v) { var d = String(v || '').replace(/[^\d]/g, '').slice(0, 9); return d ? parseInt(d, 10) : 0; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  /* ── חישובים ── */
  function shovi(price, pt) {
    var capped = Math.min(Math.max(price, 0), CEILING);
    var gross = Math.round(capped * RATE / 10) * 10;
    var ded = DED[pt] || 0;
    return { capped: capped, gross: gross, ded: Math.min(ded, gross), value: Math.max(0, gross - ded), isCapped: price > CEILING };
  }
  function bracketTax(x) {
    var t = 0, prev = 0;
    for (var i = 0; i < BRACKETS.length; i++) {
      var top = BRACKETS[i][0], r = BRACKETS[i][1];
      if (x <= prev) break;
      t += (Math.min(x, top) - prev) * r; prev = top;
    }
    return t;
  }
  function marginal(x) { for (var i = 0; i < BRACKETS.length; i++) if (x <= BRACKETS[i][0]) return BRACKETS[i][1]; return 0.5; }
  function incomeTax(x, pts) { return Math.max(0, bracketTax(x) - pts * POINT); }
  function bl(x) { var y = Math.min(Math.max(x, 0), BL_MAX); return Math.min(y, BL_LOW) * BL_R1 + Math.max(0, y - BL_LOW) * BL_R2; }
  function netCost(salary, value, pts) {
    var tax = incomeTax(salary + value, pts) - incomeTax(salary, pts);
    var ins = bl(salary + value) - bl(salary);
    return { tax: tax, ins: ins, total: tax + ins, marginal: marginal(salary + value) };
  }

  /* ── רכבים מהמאגר ── */
  var CARS = Array.isArray(window.SP_CALC_CARS) ? window.SP_CALC_CARS : [];
  var chosen = null, chosenTrim = 0;
  function heName(c) { return c.n || ''; }
  function norm(s) { return String(s || '').toLowerCase().replace(/[׳'"`״\-–—.]/g, '').replace(/\s+/g, ' ').trim(); }
  function loadCars() {
    if (CARS.length) return Promise.resolve(CARS);
    /* גיבוי: אם העמוד נבנה בלי רשימת הרכבים, מושכים אותה מהמאגר */
    return fetch(SB_URL + '/rest/v1/cars?select=slug,brand,model,year,price,powertrain,meta_title,trims&deleted=eq.false&order=sales_rank.asc.nullslast', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        CARS = (rows || []).filter(function (r) { return r && r.slug && Number(r.price) > 0; }).map(function (r) {
          var he = String(r.meta_title || '').split('|')[0].replace(/\b20\d\d\b/g, '').replace(/\s+/g, ' ').trim() || (r.brand + ' ' + r.model);
          var trims = (Array.isArray(r.trims) ? r.trims : []).filter(function (t) { return t && t.name && Number(t.price) > 0; }).map(function (t) { return { n: String(t.name), p: Number(t.price) }; });
          return { s: r.slug, n: he, e: r.brand + ' ' + r.model, y: r.year, p: Number(r.price), pt: r.powertrain || '', t: trims };
        });
        return CARS;
      }).catch(function () { return CARS; });
  }

  /* ── עזרי ממשק ── */
  var priceText = $('priceText'), priceRange = $('priceRange'), salaryEl = $('salary'), pointsEl = $('points'), pointsCustom = $('pointsCustom');
  function curPt() { var c = document.querySelector('input[name="drive"]:checked'); return c ? c.value : 'petrol'; }
  function setPt(pt) {
    if (!DED.hasOwnProperty(pt)) pt = 'petrol';
    document.querySelectorAll('.drive-opt').forEach(function (o) {
      var on = o.getAttribute('data-pt') === pt; o.classList.toggle('active', on); o.querySelector('input').checked = on;
    });
  }
  function curPoints() {
    if (pointsEl.value === 'custom') { var v = parseFloat(String(pointsCustom.value).replace(',', '.')); return isFinite(v) && v >= 0 && v <= 20 ? v : 2.25; }
    return parseFloat(pointsEl.value) || 2.25;
  }
  function setPrice(p) { priceText.value = p ? fmt(p) : ''; }

  var lastFinal = 0, needle = $('needle'), arcFill = $('arcFill');
  function animateNumber(el, from, to) {
    var dur = 450, start = performance.now();
    (function step(t) { var p = Math.min(1, (t - start) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(from + (to - from) * e); if (p < 1) requestAnimationFrame(step); else el.textContent = fmt(to); })(start);
  }
  (function buildTicks() {
    var g = $('ticks'); if (!g) return; var cx = 110, cy = 128, r1 = 96, r2 = 88;
    for (var i = 0; i <= 8; i++) {
      var a = Math.PI + (i / 8) * Math.PI, l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', cx + r1 * Math.cos(a)); l.setAttribute('y1', cy + r1 * Math.sin(a)); l.setAttribute('x2', cx + r2 * Math.cos(a)); l.setAttribute('y2', cy + r2 * Math.sin(a));
      l.setAttribute('stroke', i % 2 === 0 ? '#4a4a52' : '#2a2a30'); l.setAttribute('stroke-width', i % 2 === 0 ? '2' : '1.2'); g.appendChild(l);
    }
  })();

  /* ── הכתובת משקפת את החישוב, כך שקישור משותף פותח את אותה תוצאה ── */
  var urlTimer = 0;
  function syncUrl() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(function () {
      try {
        var u = new URL(location.href), sp = u.searchParams;
        ['car', 'trim', 'price', 'pt', 'salary', 'pts'].forEach(function (k) { sp.delete(k); });
        if (chosen) { sp.set('car', chosen.s); if (chosenTrim) sp.set('trim', String(chosenTrim)); }
        else { var p = digits(priceText.value); if (p) sp.set('price', String(p)); }
        if (!chosen || (chosen.pt !== curPt())) sp.set('pt', curPt());
        var s = digits(salaryEl.value); if (s) sp.set('salary', String(s));
        if (curPoints() !== 2.25) sp.set('pts', String(curPoints()));
        history.replaceState(null, '', u.pathname + (sp.toString() ? '?' + sp.toString() : '') + u.hash);
      } catch (e) {}
    }, 250);
  }
  function shareUrl() { return 'https://speedometer10.co.il/usage-value-calculator.html' + location.search; }

  /* ── עדכון התצוגה ── */
  function update() {
    var price = digits(priceText.value), pt = curPt(), r = shovi(price, pt);
    $('ceilingBadge').classList.toggle('show', r.isCapped);
    $('bBase').textContent = '₪' + fmt(r.capped);
    $('bGross').textContent = '₪' + fmt(r.gross);
    $('bDed').textContent = r.ded ? '‎-₪' + fmt(r.ded) : '₪0';
    $('bFinal').textContent = '₪' + fmt(r.value);
    $('bAnnual').textContent = '₪' + fmt(r.value * 12);
    animateNumber($('finalNum'), lastFinal, r.value); lastFinal = r.value;
    var ratio = Math.min(1, r.value / GAUGE_MAX);
    if (needle) needle.style.transform = 'rotate(' + (-90 + ratio * 180) + 'deg)';
    if (arcFill) arcFill.style.strokeDashoffset = ARC_LEN - ARC_LEN * ratio;
    if (document.activeElement !== priceRange) priceRange.value = Math.min(700000, Math.max(20000, price || 20000));
    priceRange.style.setProperty('--fill', ((priceRange.value - priceRange.min) / (priceRange.max - priceRange.min) * 100) + '%');

    /* עלות נטו */
    var salary = digits(salaryEl.value), pts = curPoints(), box = $('netRes');
    if (salary > 0 && r.value > 0) {
      var n = netCost(salary, r.value, pts);
      box.classList.remove('wait');
      $('netBig').innerHTML = '<small>₪</small>' + fmt(n.total) + ' <small>לחודש</small>';
      $('netSub').innerHTML = 'מס הכנסה ' + fmt(n.tax) + ' ₪ · ביטוח לאומי ובריאות ' + fmt(n.ins) + ' ₪<br>מדרגת מס שולית ' + Math.round(n.marginal * 100) + '% · ' + fmt(n.total * 12) + ' ₪ בשנה';
    } else {
      box.classList.add('wait');
      $('netBig').textContent = r.value > 0 ? 'הזינו שכר ברוטו כדי לראות' : 'הזינו מחיר מחירון';
      $('netSub').textContent = '';
    }

    /* השוואה בין סוגי הנעה באותו מחיר */
    var rows = ['petrol', 'hev', 'phev', 'ev'].map(function (k) {
      var v = shovi(price, k).value; return { k: k, v: v, net: salary > 0 && v > 0 ? netCost(salary, v, pts).total : null };
    });
    var useNet = salary > 0, max = Math.max.apply(null, rows.map(function (x) { return useNet ? x.net || 0 : x.v; })) || 1;
    $('cmpTitle').textContent = useNet ? 'אותו מחיר, סוג הנעה אחר: עלות נטו לחודש' : 'אותו מחיר, סוג הנעה אחר: שווי לחודש';
    $('cmpRows').innerHTML = rows.map(function (x) {
      var val = useNet ? x.net || 0 : x.v;
      return '<div class="cmp-row' + (x.k === pt ? ' on' : '') + '"><span>' + PT_LABEL[x.k] + '</span><span class="bar"><i style="width:' + (val / max * 100).toFixed(1) + '%"></i></span><span class="v">₪' + fmt(val) + '</span></div>';
    }).join('');
    var base = rows[0], cur = rows.filter(function (x) { return x.k === pt; })[0];
    if (pt !== 'petrol' && base.v > 0) {
      var save = useNet ? (base.net - cur.net) : (base.v - cur.v);
      $('cmpNote').textContent = 'לעומת רכב בנזין באותו מחיר: ' + (useNet ? 'חיסכון של כ-' + fmt(save * 12) + ' ₪ בשנה מהמשכורת.' : 'שווי נמוך ב-' + fmt(save) + ' ₪ לחודש.');
    } else $('cmpNote').textContent = '';
    syncUrl();
  }

  /* ── בחירת רכב ── */
  var listEl = $('carList'), qEl = $('carQ'), hl = -1, results = [];
  function search(q) {
    var nq = norm(q); if (!nq) return CARS.slice(0, 8);
    var words = nq.split(' ');
    return CARS.filter(function (c) { var h = norm(c.n + ' ' + (c.e || '') + ' ' + c.y); return words.every(function (w) { return h.indexOf(w) !== -1; }); }).slice(0, 10);
  }
  function renderList() {
    results = search(qEl.value); hl = -1;
    listEl.innerHTML = results.length ? results.map(function (c, i) {
      return '<button type="button" role="option" data-i="' + i + '"><span>' + esc(heName(c)) + ' ' + esc(c.y) + '</span><small>מ-' + fmt(c.p) + ' ₪</small></button>';
    }).join('') : '<div class="empty">הדגם לא נמצא במאגר. הזינו את מחיר המחירון ידנית.</div>';
    listEl.classList.add('open'); qEl.setAttribute('aria-expanded', 'true');
  }
  function closeList() { listEl.classList.remove('open'); qEl.setAttribute('aria-expanded', 'false'); }
  function renderChosen() {
    var box = $('chosen');
    if (!chosen) { box.classList.remove('show'); box.innerHTML = ''; $('noteMhev').classList.remove('show'); return; }
    var trims = chosen.t || [];
    box.innerHTML = '<div class="chosen-top"><span><b>' + esc(heName(chosen)) + ' ' + esc(chosen.y) + '</b></span><span><a href="/car/' + encodeURIComponent(chosen.s) + '/">לעמוד הדגם ›</a> <button type="button" class="x" aria-label="ביטול בחירת הרכב">×</button></span></div>' +
      (trims.length > 1 ? '<select id="trimSel" aria-label="גרסה">' + trims.map(function (t, i) { return '<option value="' + i + '"' + (i === chosenTrim ? ' selected' : '') + '>' + esc(t.n) + ' · ' + fmt(t.p) + ' ₪</option>'; }).join('') + '</select>' : '');
    box.classList.add('show');
    $('noteMhev').classList.toggle('show', chosen.pt === 'mhev');
  }
  function pick(c, trimIdx, keepPt) {
    chosen = c; chosenTrim = trimIdx || 0;
    var trims = c.t || [], p = trims.length > 1 && trims[chosenTrim] ? trims[chosenTrim].p : c.p;
    setPrice(p);
    if (!keepPt) setPt(DED.hasOwnProperty(c.pt) ? c.pt : (c.pt === 'erev' ? 'phev' : 'petrol'));
    qEl.value = ''; closeList(); renderChosen(); update();
    try { if (window.gtag) gtag('event', 'calc_car_select', { car: c.s }); } catch (e) {}
  }
  qEl.addEventListener('focus', function () { loadCars().then(renderList); });
  qEl.addEventListener('input', function () { loadCars().then(renderList); });
  qEl.addEventListener('keydown', function (e) {
    var btns = listEl.querySelectorAll('button[data-i]'); if (!btns.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length; btns.forEach(function (b, i) { b.classList.toggle('hl', i === hl); }); }
    else if (e.key === 'Enter') { e.preventDefault(); var c = results[hl < 0 ? 0 : hl]; if (c) pick(c); }
    else if (e.key === 'Escape') closeList();
  });
  listEl.addEventListener('mousedown', function (e) { e.preventDefault(); });
  listEl.addEventListener('click', function (e) { var b = e.target.closest('button[data-i]'); if (b) pick(results[+b.getAttribute('data-i')]); });
  document.addEventListener('click', function (e) { if (!e.target.closest('.carpick')) closeList(); });
  $('chosen').addEventListener('click', function (e) { if (e.target.closest('button.x')) { chosen = null; chosenTrim = 0; renderChosen(); update(); } });
  $('chosen').addEventListener('change', function (e) {
    if (e.target.id === 'trimSel' && chosen) { chosenTrim = +e.target.value; setPrice(chosen.t[chosenTrim].p); update(); }
  });

  /* ── קלטים ── */
  priceText.addEventListener('input', function () { var d = digits(priceText.value); priceText.value = d ? fmt(d) : ''; if (chosen) { chosen = null; renderChosen(); } update(); });
  priceRange.addEventListener('input', function () { setPrice(+priceRange.value); if (chosen) { chosen = null; renderChosen(); } update(); });
  salaryEl.addEventListener('input', function () { var d = digits(salaryEl.value); salaryEl.value = d ? fmt(d) : ''; update(); });
  pointsEl.addEventListener('change', function () { $('pointsCustomWrap').style.display = pointsEl.value === 'custom' ? '' : 'none'; update(); });
  pointsCustom.addEventListener('input', update);
  document.querySelectorAll('.drive-opt').forEach(function (o) { o.addEventListener('click', function () { setPt(o.getAttribute('data-pt')); update(); }); });

  /* ── שיתוף ── */
  document.querySelectorAll('[data-share]').forEach(function (b) {
    b.addEventListener('click', function () {
      var price = digits(priceText.value), r = shovi(price, curPt()), salary = digits(salaryEl.value);
      var what = chosen ? heName(chosen) + ' ' + chosen.y : 'רכב במחיר ' + fmt(price) + ' ₪';
      var msg = 'שווי שימוש 2026 ל' + what + ' (' + PT_LABEL[curPt()] + '): ' + fmt(r.value) + ' ₪ לחודש' +
        (salary ? ', ועלות נטו של כ-' + fmt(netCost(salary, r.value, curPoints()).total) + ' ₪ לחודש מהמשכורת' : '') + '.\nבדקו במחשבון של ספידומטר: ' + shareUrl();
      if (b.getAttribute('data-share') === 'wa') { window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener'); return; }
      var lbl = $('copyBtnLabel'), done = function () { lbl.textContent = 'הועתק!'; b.classList.add('copied'); setTimeout(function () { lbl.textContent = 'העתקת קישור'; b.classList.remove('copied'); }, 2200); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(msg).then(done).catch(function () { window.prompt('העתיקו:', msg); });
      else window.prompt('העתיקו:', msg);
    });
  });

  /* ── מצב התחלתי מהכתובת (?car= / ?price= / ?pt= / ?salary= / ?pts=) ── */
  var q = new URLSearchParams(location.search);
  if (q.get('salary')) salaryEl.value = fmt(digits(q.get('salary')));
  if (q.get('pts')) { var pv = parseFloat(q.get('pts')); if (pv === 2.75) pointsEl.value = '2.75'; else if (isFinite(pv) && pv !== 2.25) { pointsEl.value = 'custom'; pointsCustom.value = String(pv); $('pointsCustomWrap').style.display = ''; } }
  if (q.get('price')) setPrice(digits(q.get('price')));
  if (q.get('pt')) setPt(q.get('pt'));
  if (q.get('car')) {
    loadCars().then(function () {
      var c = CARS.filter(function (x) { return x.s === q.get('car') || (x.o || []).indexOf(q.get('car')) !== -1; })[0];
      if (c) pick(c, Math.max(0, Math.min((c.t || []).length - 1, parseInt(q.get('trim') || '0', 10) || 0)), !!q.get('pt'));
      else update();
    });
  } else update();
})();
